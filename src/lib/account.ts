import "server-only";
import { config } from "@/lib/config";
import {
  encryptText,
  hashOtp,
  hmacIdentifier,
  hashIp,
  maskEmail,
  maskPhone,
  newSalt,
  otpHashesEqual,
  randomId,
  randomOtp,
} from "@/lib/crypto-utils";
import { normalizeIdentifier, type Channel } from "@/lib/identifiers";
import { buildOtpMessage, putOutbox } from "@/lib/outbox";
import { hitRateLimit } from "@/lib/rate-limit";
import { appendAudit, passwordMatches } from "@/lib/security";
import { mutateStore, readStoreSnapshot, finalizeDueAccounts, type StoreData } from "@/lib/store";
import { DELETION_PHRASE, DEACTIVATION_PHRASE } from "@/lib/account-types";
import { NIXO_LOCALES, TIMEZONES, defaultUserPrefs, type UserPrefs } from "@/lib/prefs-types";

export const ACCOUNT_POLICY = {
  persistence:
    "حساب نیکسو به‌خاطر غیرفعال بودن حذف نمی‌شود. فقط درخواست خود کاربر، نقض شرایط استفاده، یا الزام قانونی آن را می‌بندد.",
  graceDays: Math.round(config.deletionGraceMs / 86_400_000),
};

export async function getAccount(userId: string) {
  const data = await readStoreSnapshot();
  const user = data.users.find((u) => u.id === userId);
  if (!user) return null;
  return {
    channel: user.channel,
    identifierMasked: user.identifierMasked,
    accountStatus: user.accountStatus ?? "active",
    deletionRequestedAt: user.deletionRequestedAt,
    deletionFinalizeAt: user.deletionFinalizeAt ?? null,
    graceDays: ACCOUNT_POLICY.graceDays,
    persistence: ACCOUNT_POLICY.persistence,
    twoStep: Boolean(user.twoStepEnabled),
    pendingIdentifier: user.pendingIdentifier ?? null,
    devices: (data.devices ?? []).filter((d) => d.userId === userId && !d.revokedAt).length,
    prefs: user.prefs ?? defaultUserPrefs(),
    deactivatedAt: user.deactivatedAt ?? null,
  };
}

function pushOtpChallenge(
  data: StoreData,
  input: {
    channel: Channel;
    identifierHash: string;
    identifierMasked: string;
    identifierCipher: string;
    ip: string;
    code: string;
  },
) {
  const salt = newSalt();
  const challenge = {
    id: randomId(),
    channel: input.channel,
    identifierHash: input.identifierHash,
    identifierMasked: input.identifierMasked,
    identifierCipher: input.identifierCipher,
    salt,
    codeHash: hashOtp(input.code, salt),
    expiresAt: Date.now() + config.otp.ttlMs,
    usedAt: null as number | null,
    attemptCount: 0,
    sendCount: 1,
    lastSentAt: Date.now(),
    createdAt: Date.now(),
    invalidatedAt: null as number | null,
    ipHash: hashIp(input.ip),
  };
  data.challenges.push(challenge);
  putOutbox({
    challengeId: challenge.id,
    channel: input.channel,
    maskedTo: input.identifierMasked,
    body: buildOtpMessage(input.channel, input.code, Math.ceil(config.otp.ttlMs / 60000)),
    createdAt: Date.now(),
  });
  return challenge;
}

export async function startDeletionChallenge(userId: string, ip: string) {
  return mutateStore((data) => {
    const user = data.users.find((u) => u.id === userId);
    if (!user) return { ok: false as const, error: "حساب یافت نشد.", status: 404 };
    const gate = hitRateLimit(data, `delotp:${userId}:${ip}`, 15 * 60_000, 4);
    if (!gate.allowed) {
      return { ok: false as const, error: "تعداد درخواست کد بیش از حد است.", status: 429 };
    }
    const code = randomOtp(config.otp.length);
    const challenge = pushOtpChallenge(data, {
      channel: user.channel,
      identifierHash: user.identifierHash,
      identifierMasked: user.identifierMasked,
      identifierCipher: user.identifierCipher,
      ip,
      code,
    });
    return { ok: true as const, challengeId: challenge.id, masked: user.identifierMasked };
  });
}

export async function scheduleDeletion(
  userId: string,
  input: { phrase: string; code?: string; challengeId?: string; password?: string },
  ip: string,
) {
  if (input.phrase.trim() !== DELETION_PHRASE) {
    return { ok: false as const, error: "عبارت تأیید را دقیقاً بنویسید: حذف حساب", status: 400 };
  }
  return mutateStore((data) => {
    const user = data.users.find((u) => u.id === userId);
    if (!user) return { ok: false as const, error: "حساب یافت نشد.", status: 404 };
    if (user.twoStepEnabled) {
      if (!input.password || !passwordMatches(user, input.password)) {
        return { ok: false as const, error: "برای حذف حساب، رمز دومرحله‌ای لازم است.", status: 400 };
      }
    }
    if (!input.challengeId || !input.code) {
      return { ok: false as const, error: "کد تأیید حذف ارسال و وارد نشده است.", status: 400 };
    }
    const ch = data.challenges.find((c) => c.id === input.challengeId);
    if (!ch || ch.usedAt || ch.invalidatedAt || ch.identifierHash !== user.identifierHash) {
      return { ok: false as const, error: "کد تأیید حذف نامعتبر است.", status: 400 };
    }
    if (Date.now() > ch.expiresAt) return { ok: false as const, error: "کد تأیید منقضی شده است.", status: 400 };
    ch.attemptCount += 1;
    if (!otpHashesEqual(hashOtp(input.code, ch.salt), ch.codeHash)) {
      return { ok: false as const, error: "کد تأیید نادرست است.", status: 400 };
    }
    ch.usedAt = Date.now();
    const now = Date.now();
    user.accountStatus = "pending_deletion";
    user.deletionRequestedAt = now;
    user.deletionFinalizeAt = now + config.deletionGraceMs;
    appendAudit(data, userId, "account_delete", {
      ip,
      detail: `حذف پس از دورهٔ بازیابی تا ${new Date(user.deletionFinalizeAt).toISOString()}`,
    });
    return {
      ok: true as const,
      deletionFinalizeAt: user.deletionFinalizeAt,
      deletionRequestedAt: now,
    };
  });
}

export async function cancelDeletion(userId: string, ip: string) {
  return mutateStore((data) => {
    const user = data.users.find((u) => u.id === userId);
    if (!user) return { ok: false as const, error: "حساب یافت نشد.", status: 404 };
    if ((user.accountStatus ?? "active") !== "pending_deletion") {
      return { ok: false as const, error: "حذف معلقی وجود ندارد.", status: 400 };
    }
    user.accountStatus = "active";
    user.deletionRequestedAt = null;
    user.deletionFinalizeAt = null;
    appendAudit(data, userId, "account_cancel", { ip, detail: "کاربر حذف را لغو کرد" });
    return { ok: true as const };
  });
}

export async function startIdentifierChange(userId: string, channel: Channel, identifier: string, ip: string) {
  const normalized = normalizeIdentifier(channel, identifier);
  if (!normalized) return { ok: false as const, error: "شماره یا ایمیل جدید معتبر نیست.", status: 400 };
  return mutateStore((data) => {
    const user = data.users.find((u) => u.id === userId);
    if (!user) return { ok: false as const, error: "حساب یافت نشد.", status: 404 };
    const hash = hmacIdentifier(normalized);
    const taken = data.users.some(
      (u) => u.id !== userId && u.identifierHash === hash && (u.accountStatus ?? "active") !== "closed",
    );
    if (taken) return { ok: false as const, error: "این شناسه به حساب دیگری متصل است.", status: 409 };
    const gate = hitRateLimit(data, `idchg:${userId}:${ip}`, 15 * 60_000, 4);
    if (!gate.allowed) return { ok: false as const, error: "تعداد تلاش بیش از حد است.", status: 429 };
    const code = randomOtp(config.otp.length);
    const masked = channel === "phone" ? maskPhone(normalized) : maskEmail(normalized);
    const challenge = pushOtpChallenge(data, {
      channel,
      identifierHash: hash,
      identifierMasked: masked,
      identifierCipher: encryptText(normalized),
      ip,
      code,
    });
    user.pendingIdentifier = { channel, challengeId: challenge.id, masked };
    return { ok: true as const, challengeId: challenge.id, masked };
  });
}

export async function confirmIdentifierChange(
  userId: string,
  input: { code: string; password?: string },
  ip: string,
) {
  return mutateStore((data) => {
    const user = data.users.find((u) => u.id === userId);
    if (!user?.pendingIdentifier) return { ok: false as const, error: "تغییر شناسه‌ای در جریان نیست.", status: 400 };
    if (user.twoStepEnabled && (!input.password || !passwordMatches(user, input.password))) {
      return { ok: false as const, error: "رمز دومرحله‌ای برای تغییر ورود لازم است.", status: 400 };
    }
    const ch = data.challenges.find((c) => c.id === user.pendingIdentifier?.challengeId);
    if (!ch || ch.usedAt || Date.now() > ch.expiresAt) {
      return { ok: false as const, error: "کد تأیید شناسه منقضی یا نامعتبر است.", status: 400 };
    }
    ch.attemptCount += 1;
    if (!otpHashesEqual(hashOtp(input.code, ch.salt), ch.codeHash)) {
      return { ok: false as const, error: "کد تأیید نادرست است.", status: 400 };
    }
    ch.usedAt = Date.now();
    user.channel = ch.channel;
    user.identifierHash = ch.identifierHash;
    user.identifierMasked = ch.identifierMasked;
    user.identifierCipher = ch.identifierCipher;
    user.pendingIdentifier = null;
    appendAudit(data, userId, "identifier_change", { ip, detail: `شناسه به ${ch.identifierMasked} تغییر کرد` });
    return { ok: true as const, masked: user.identifierMasked, channel: user.channel };
  });
}

export async function runDueFinalizations() {
  return mutateStore((data) => {
    finalizeDueAccounts(data, Date.now());
    return { ok: true as const };
  });
}

export async function deactivateAccount(userId: string, phrase: string, ip: string) {
  if (phrase.trim() !== DEACTIVATION_PHRASE) {
    return { ok: false as const, error: "عبارت تأیید را دقیقاً بنویسید: غیرفعال کردن", status: 400 };
  }
  return mutateStore((data) => {
    const user = data.users.find((u) => u.id === userId);
    if (!user) return { ok: false as const, error: "حساب یافت نشد.", status: 404 };
    if ((user.accountStatus ?? "active") === "pending_deletion") {
      return { ok: false as const, error: "ابتدا حذف معلق را لغو کنید.", status: 400 };
    }
    const gate = hitRateLimit(data, `deact:${userId}`, 60 * 60_000, 6);
    if (!gate.allowed) return { ok: false as const, error: "غیرفعال‌سازی محدود شد.", status: 429 };
    user.accountStatus = "deactivated";
    user.deactivatedAt = Date.now();
    appendAudit(data, userId, "privacy", { ip, detail: "حساب موقتاً غیرفعال شد" });
    return { ok: true as const, accountStatus: user.accountStatus };
  });
}

export async function reactivateAccount(userId: string, ip: string) {
  return mutateStore((data) => {
    const user = data.users.find((u) => u.id === userId);
    if (!user) return { ok: false as const, error: "حساب یافت نشد.", status: 404 };
    if ((user.accountStatus ?? "active") !== "deactivated") {
      return { ok: false as const, error: "حساب غیرفعال نیست.", status: 400 };
    }
    user.accountStatus = "active";
    user.deactivatedAt = null;
    appendAudit(data, userId, "privacy", { ip, detail: "حساب دوباره فعال شد" });
    return { ok: true as const, accountStatus: user.accountStatus };
  });
}

export async function updateAccountPrefs(userId: string, patch: Record<string, unknown>) {
  return mutateStore((data) => {
    const user = data.users.find((u) => u.id === userId);
    if (!user) return { ok: false as const, error: "حساب یافت نشد.", status: 404 };
    const gate = hitRateLimit(data, `prefs:${userId}`, 60_000, 30);
    if (!gate.allowed) return { ok: false as const, error: "تنظیمات محدود شد.", status: 429 };
    user.prefs ??= defaultUserPrefs();
    const loc = patch.locale;
    if (typeof loc === "string" && (NIXO_LOCALES as readonly string[]).includes(loc)) user.prefs.locale = loc as UserPrefs["locale"];
    const tz = patch.timezone;
    if (typeof tz === "string" && (TIMEZONES as readonly string[]).includes(tz)) user.prefs.timezone = tz as UserPrefs["timezone"];
    if (patch.dateFormat === "system" || patch.dateFormat === "jalali" || patch.dateFormat === "gregorian") {
      user.prefs.dateFormat = patch.dateFormat;
    }
    if (patch.timeFormat === "system" || patch.timeFormat === "12" || patch.timeFormat === "24") {
      user.prefs.timeFormat = patch.timeFormat;
    }
    if (patch.uiFont === "vazir" || patch.uiFont === "system") user.prefs.uiFont = patch.uiFont;
    if (typeof patch.reducedMotion === "boolean") user.prefs.reducedMotion = patch.reducedMotion;
    if (typeof patch.highContrast === "boolean") user.prefs.highContrast = patch.highContrast;
    if (typeof patch.screenReaderHints === "boolean") user.prefs.screenReaderHints = patch.screenReaderHints;
    if (typeof patch.autoplayVideo === "boolean") user.prefs.autoplayVideo = patch.autoplayVideo;
    if (typeof patch.autoplayGif === "boolean") user.prefs.autoplayGif = patch.autoplayGif;
    if (typeof patch.appLockEnabled === "boolean") user.prefs.appLockEnabled = patch.appLockEnabled;
    if (typeof patch.appLockBiometric === "boolean") user.prefs.appLockBiometric = patch.appLockBiometric;
    if (patch.autoLockSec === 0 || patch.autoLockSec === 30 || patch.autoLockSec === 60 || patch.autoLockSec === 300 || patch.autoLockSec === 600) {
      user.prefs.autoLockSec = patch.autoLockSec;
    }
    return { ok: true as const, prefs: user.prefs };
  });
}
