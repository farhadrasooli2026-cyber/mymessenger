import "server-only";

import { hashOtp, hmacIdentifier, newSalt, otpHashesEqual, randomId } from "@/lib/crypto-utils";
import { hitRateLimit } from "@/lib/rate-limit";
import { mutateStore, readStoreSnapshot } from "@/lib/store";
import type { AuditEvent, DeviceSession, SecurityEventKind, StoreData, UserRecord } from "@/lib/store";

export const PASSWORD_MIN = 10;

function ipHint(ip: string) {
  return hmacIdentifier(`ip:${ip}`).slice(0, 16);
}

export function approxFromRequest(headers: Headers, ip: string): string {
  const country = headers.get("cf-ipcountry")?.trim();
  if (country && country !== "XX" && country.length <= 8) {
    return `کشور تقریبی: ${country} — بدون GPS`;
  }
  if (headers.get("x-forwarded-for") || ip) {
    return "موقعیت تقریبی از شبکهٔ اتصال — بدون GPS";
  }
  return "موقعیت نامشخص — نیکسو موقعیت دقیق ذخیره نمی‌کند";
}

export function deviceLabel(userAgent: string) {
  const ua = userAgent.toLowerCase();
  if (ua.includes("iphone")) return "iPhone";
  if (ua.includes("ipad")) return "iPad";
  if (ua.includes("android") && ua.includes("mobile")) return "Android Phone";
  if (ua.includes("android")) return "Android Tablet";
  if (ua.includes("macintosh") || ua.includes("mac os")) return "Mac";
  if (ua.includes("windows")) return "Windows PC";
  if (ua.includes("linux")) return "Linux";
  if (ua.includes("edg/")) return "مرورگر Edge";
  if (ua.includes("chrome")) return "مرورگر Chrome";
  if (ua.includes("firefox")) return "مرورگر Firefox";
  if (ua.includes("safari")) return "مرورگر Safari";
  return "دستگاه ناشناس";
}

export function appendAudit(
  data: StoreData,
  userId: string,
  kind: SecurityEventKind,
  opts: { ip?: string; userAgent?: string; deviceSessionId?: string; detail?: string },
) {
  const event: AuditEvent = {
    id: randomId(),
    userId,
    kind,
    createdAt: Date.now(),
    ipHint: opts.ip ? ipHint(opts.ip) : undefined,
    userAgent: opts.userAgent?.slice(0, 180),
    deviceSessionId: opts.deviceSessionId,
    detail: opts.detail?.slice(0, 280),
  };
  data.audit = [event, ...(data.audit ?? [])].slice(0, 400);
  return event;
}

export function publicAudit(e: AuditEvent) {
  const titles: Record<SecurityEventKind, string> = {
    login: "ورود به حساب",
    logout: "خروج",
    new_device: "دستگاه جدید",
    revoke: "لغو نشست",
    twostep_on: "رمز دومرحله‌ای فعال شد",
    twostep_off: "رمز دومرحله‌ای خاموش شد",
    password: "تغییر رمز عبور",
    recovery: "کد بازیابی استفاده شد",
    passkey: "تغییر Passkey",
    backup: "کلید پشتیبان E2EE",
    suspicious: "ورود مشکوک",
    vuln_report: "گزارش آسیب‌پذیری ثبت شد",
    account_delete: "درخواست حذف حساب",
    account_cancel: "لغو حذف حساب",
    identifier_change: "تغییر شماره یا ایمیل",
    restore: "بازیابی پشتیبان",
  };
  return {
    id: e.id,
    kind: e.kind,
    title: titles[e.kind],
    createdAt: e.createdAt,
    detail: e.detail,
    userAgent: e.userAgent,
  };
}

export function publicDevice(d: DeviceSession, currentId?: string) {
  return {
    id: d.id,
    label: d.label,
    userAgent: d.userAgent,
    approx: d.approx,
    createdAt: d.createdAt,
    lastSeenAt: d.lastSeenAt,
    current: d.id === currentId,
  };
}

export function hashPassword(password: string) {
  const salt = newSalt();
  return { salt, hash: hashOtp(password, salt) };
}

export function passwordMatches(user: UserRecord, password: string) {
  if (!user.passwordHash || !user.passwordSalt) return false;
  return otpHashesEqual(user.passwordHash, hashOtp(password, user.passwordSalt));
}

export function generateRecoveryCodes() {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  const codes: string[] = [];
  for (let i = 0; i < 8; i += 1) {
    const bytes = crypto.getRandomValues(new Uint8Array(10));
    codes.push(Array.from(bytes, (b) => alphabet[b % alphabet.length]).join("").slice(0, 10));
  }
  const hashes = codes.map((c) => hashOtp(c.toUpperCase(), "nixo-recovery"));
  return { codes, hashes };
}

export function consumeRecoveryCode(user: UserRecord, code: string) {
  const hash = hashOtp(code.trim().toUpperCase(), "nixo-recovery");
  const hashes = user.recoveryCodeHashes ?? [];
  const idx = hashes.findIndex((h) => otpHashesEqual(h, hash));
  if (idx < 0) return false;
  hashes.splice(idx, 1);
  user.recoveryCodeHashes = hashes;
  return true;
}

export function backupVerifier(secret: string) {
  return hmacIdentifier(`e2ee-backup:${secret.trim()}`);
}

export async function isDeviceActive(sessionId: string | undefined, userId: string) {
  if (!sessionId) return false;
  const data = await readStoreSnapshot();
  const d = (data.devices ?? []).find((x) => x.id === sessionId);
  return Boolean(d && d.userId === userId && !d.revokedAt);
}

export async function createDeviceSessionForUser(input: {
  userId: string;
  ip: string;
  userAgent: string;
  approx: string;
}) {
  return mutateStore((data) => {
    data.devices ??= [];
    const ua = input.userAgent.slice(0, 180);
    const recent = data.devices.filter((d) => d.userId === input.userId && !d.revokedAt);
    const isNewDevice = !recent.some((d) => d.userAgent === ua);
    const suspicious = isNewDevice && recent.length > 0;
    const device: DeviceSession = {
      id: randomId(),
      userId: input.userId,
      createdAt: Date.now(),
      lastSeenAt: Date.now(),
      userAgent: ua,
      ipHint: ipHint(input.ip),
      approx: input.approx.slice(0, 120),
      label: deviceLabel(ua),
    };
    data.devices.unshift(device);
    appendAudit(data, input.userId, isNewDevice ? "new_device" : "login", {
      ip: input.ip,
      userAgent: ua,
      deviceSessionId: device.id,
      detail: suspicious ? "ورود از دستگاه جدید نسبت به نشست‌های قبلی" : device.label,
    });
    if (suspicious) {
      appendAudit(data, input.userId, "suspicious", {
        ip: input.ip,
        userAgent: ua,
        deviceSessionId: device.id,
        detail: "ورود مشکوک: دستگاه جدید",
      });
    }
    return { device, isNewDevice, suspicious };
  });
}

export async function touchDevice(sessionId: string | undefined, ip: string, userAgent: string) {
  if (!sessionId) return;
  await mutateStore((data) => {
    const d = (data.devices ?? []).find((x) => x.id === sessionId);
    if (!d || d.revokedAt) return;
    d.lastSeenAt = Date.now();
    d.ipHint = ipHint(ip);
    d.userAgent = userAgent.slice(0, 180);
  });
}

export async function revokeDevice(userId: string, deviceId: string, actorIp?: string) {
  return mutateStore((data) => {
    const d = (data.devices ?? []).find((x) => x.id === deviceId && x.userId === userId);
    if (!d || d.revokedAt) return false;
    d.revokedAt = Date.now();
    appendAudit(data, userId, "revoke", {
      ip: actorIp,
      deviceSessionId: deviceId,
      detail: `خروج از ${d.label}`,
    });
    return true;
  });
}

export async function revokeAllDevices(userId: string, actorIp?: string) {
  return mutateStore((data) => {
    let n = 0;
    for (const d of data.devices ?? []) {
      if (d.userId === userId && !d.revokedAt) {
        d.revokedAt = Date.now();
        n += 1;
      }
    }
    appendAudit(data, userId, "revoke", { ip: actorIp, detail: "خروج از همهٔ دستگاه‌ها" });
    return n;
  });
}

export async function revokeAllOtherDevices(userId: string, keepId: string | undefined, actorIp?: string) {
  return mutateStore((data) => {
    let n = 0;
    for (const d of data.devices ?? []) {
      if (d.userId === userId && d.id !== keepId && !d.revokedAt) {
        d.revokedAt = Date.now();
        n += 1;
      }
    }
    if (n) {
      appendAudit(data, userId, "revoke", {
        ip: actorIp,
        deviceSessionId: keepId,
        detail: `خروج از ${n} دستگاه دیگر`,
      });
    }
    return n;
  });
}

export async function markLogout(userId: string, sessionId: string | undefined, ip?: string) {
  await mutateStore((data) => {
    const d = sessionId ? (data.devices ?? []).find((x) => x.id === sessionId && x.userId === userId) : undefined;
    if (d && !d.revokedAt) d.revokedAt = Date.now();
    appendAudit(data, userId, "logout", { ip, deviceSessionId: sessionId, detail: d?.label });
  });
}

function checkup(user: UserRecord, devices: DeviceSession[], events: AuditEvent[]) {
  const active = devices.filter((d) => !d.revokedAt);
  const suspicious = events.filter((e) => e.kind === "suspicious").slice(0, 5);
  return {
    twoStep: Boolean(user.twoStepEnabled && user.passwordHash),
    recoveryCodes: (user.recoveryCodeHashes?.length ?? 0) > 0,
    passkeys: (user.passkeys?.length ?? 0) > 0,
    backup: Boolean(user.e2eeBackupVerifier),
    sessions: active.length,
    suspiciousCount: events.filter((e) => e.kind === "suspicious").length,
    items: [
      { id: "twostep", label: "رمز دومرحله‌ای", ok: Boolean(user.twoStepEnabled && user.passwordHash) },
      { id: "sessions", label: "نشست‌های فعال", ok: active.length > 0, value: String(active.length) },
      { id: "recovery", label: "کدهای بازیابی", ok: (user.recoveryCodeHashes?.length ?? 0) > 0 },
      { id: "passkeys", label: "Passkey", ok: (user.passkeys?.length ?? 0) > 0 },
      { id: "backup", label: "کلید پشتیبان E2EE", ok: Boolean(user.e2eeBackupVerifier) },
      { id: "suspicious", label: "ورود مشکوک اخیر", ok: suspicious.length === 0, value: String(suspicious.length) },
    ],
    suspiciousDevices: suspicious.map((e) => ({
      id: e.id,
      at: e.createdAt,
      detail: e.detail,
      label: e.userAgent,
    })),
  };
}

export async function getSecurityDashboard(userId: string, currentSid?: string) {
  const data = await readStoreSnapshot();
  const user = data.users.find((u) => u.id === userId);
  if (!user) return null;
  const devices = (data.devices ?? []).filter((d) => d.userId === userId && !d.revokedAt);
  const events = (data.audit ?? []).filter((e) => e.userId === userId).slice(0, 40);
  return {
    checkup: checkup(user, devices, events),
    devices: devices.sort((a, b) => b.lastSeenAt - a.lastSeenAt).map((d) => publicDevice(d, currentSid)),
    events: events.map(publicAudit),
    twoStepEnabled: Boolean(user.twoStepEnabled),
    recoveryLeft: user.recoveryCodeHashes?.length ?? 0,
    passkeys: (user.passkeys ?? []).map((p) => ({ id: p.id, name: p.name, createdAt: p.createdAt })),
    backupSet: Boolean(user.e2eeBackupVerifier),
    hasPassword: Boolean(user.passwordHash),
  };
}

export async function recentSecurityNotices(userId: string) {
  const data = await readStoreSnapshot();
  const since = Date.now() - 36 * 60 * 60 * 1000;
  return (data.audit ?? [])
    .filter((e) => e.userId === userId && e.createdAt >= since)
    .filter((e) => e.kind === "new_device" || e.kind === "suspicious" || e.kind === "login")
    .slice(0, 8)
    .map(publicAudit);
}

function twoStepGate(data: StoreData, userId: string, ip: string) {
  return hitRateLimit(data, `2fa:${userId}:${ip}`, 15 * 60_000, 8);
}

export async function enableTwoStep(userId: string, password: string, ip: string) {
  if (password.trim().length < PASSWORD_MIN) {
    return { ok: false as const, error: `رمز باید حداقل ${PASSWORD_MIN} نویسه باشد.`, status: 400 };
  }
  return mutateStore((data) => {
    const gate = twoStepGate(data, userId, ip);
    if (!gate.allowed) {
      return { ok: false as const, error: "تعداد تلاش بیش از حد است.", status: 429, retryAfterSec: gate.retryAfterSec };
    }
    const user = data.users.find((u) => u.id === userId);
    if (!user) return { ok: false as const, error: "کاربر یافت نشد.", status: 404 };
    const { salt, hash } = hashPassword(password);
    user.passwordSalt = salt;
    user.passwordHash = hash;
    user.twoStepEnabled = true;
    const rec = generateRecoveryCodes();
    user.recoveryCodeHashes = rec.hashes;
    appendAudit(data, userId, "twostep_on", { ip, detail: "رمز دومرحله‌ای با هش استاندارد فعال شد" });
    appendAudit(data, userId, "password", { ip, detail: "رمز عبور ذخیره نشد؛ فقط هش" });
    return { ok: true as const, codes: rec.codes };
  });
}

export async function disableTwoStep(userId: string, password: string, ip: string) {
  return mutateStore((data) => {
    const gate = twoStepGate(data, userId, ip);
    if (!gate.allowed) {
      return { ok: false as const, error: "تعداد تلاش بیش از حد است.", status: 429, retryAfterSec: gate.retryAfterSec };
    }
    const user = data.users.find((u) => u.id === userId);
    if (!user) return { ok: false as const, error: "کاربر یافت نشد.", status: 404 };
    if (!passwordMatches(user, password)) {
      return { ok: false as const, error: "رمز عبور نادرست است.", status: 400 };
    }
    user.twoStepEnabled = false;
    appendAudit(data, userId, "twostep_off", { ip });
    return { ok: true as const };
  });
}

export async function rotateRecoveryCodes(userId: string, password: string, ip: string) {
  return mutateStore((data) => {
    const user = data.users.find((u) => u.id === userId);
    if (!user) return { ok: false as const, error: "کاربر یافت نشد.", status: 404 };
    if (!passwordMatches(user, password)) {
      return { ok: false as const, error: "رمز عبور نادرست است.", status: 400 };
    }
    const rec = generateRecoveryCodes();
    user.recoveryCodeHashes = rec.hashes;
    appendAudit(data, userId, "recovery", { ip, detail: "کدهای بازیابی جدید صادر شد؛ متن فقط یک‌بار نمایش داده می‌شود" });
    return { ok: true as const, codes: rec.codes };
  });
}

export async function setBackupSecret(userId: string, secret: string, ip: string) {
  if (secret.trim().length < 16) {
    return { ok: false as const, error: "کلید پشتیبان باید حداقل ۱۶ نویسه باشد و فقط نزد شما بماند.", status: 400 };
  }
  return mutateStore((data) => {
    const user = data.users.find((u) => u.id === userId);
    if (!user) return { ok: false as const, error: "کاربر یافت نشد.", status: 404 };
    user.e2eeBackupVerifier = backupVerifier(secret);
    appendAudit(data, userId, "backup", { ip, detail: "فقط تأییدگر HMAC ذخیره شد؛ سرور کلید را ندارد" });
    return { ok: true as const };
  });
}

export async function clearBackupSecret(userId: string, secret: string, ip: string) {
  return mutateStore((data) => {
    const user = data.users.find((u) => u.id === userId);
    if (!user?.e2eeBackupVerifier) return { ok: false as const, error: "کلید پشتیبان تنظیم نشده.", status: 400 };
    if (user.e2eeBackupVerifier !== backupVerifier(secret)) {
      return { ok: false as const, error: "کلید پشتیبان نادرست است.", status: 400 };
    }
    user.e2eeBackupVerifier = undefined;
    appendAudit(data, userId, "backup", { ip, detail: "تأییدگر پشتیبان حذف شد" });
    return { ok: true as const };
  });
}

export function challengeMatchesClientData(clientDataJSON: string, expectedB64url: string) {
  try {
    const json = JSON.parse(Buffer.from(clientDataJSON, "base64url").toString("utf8")) as { challenge?: string };
    return json.challenge === expectedB64url;
  } catch {
    try {
      const json = JSON.parse(Buffer.from(clientDataJSON, "base64").toString("utf8")) as { challenge?: string };
      return json.challenge === expectedB64url;
    } catch {
      return false;
    }
  }
}

export async function issuePasskeyChallenge(userId: string, mode: "register" | "login") {
  const challenge = Buffer.from(crypto.getRandomValues(new Uint8Array(32))).toString("base64url");
  return mutateStore((data) => {
    data.passkeyChallenges ??= [];
    const row = {
      id: randomId(),
      userId,
      challenge,
      mode,
      exp: Date.now() + 5 * 60_000,
    };
    data.passkeyChallenges.push(row);
    const user = data.users.find((u) => u.id === userId);
    return {
      ok: true as const,
      challengeId: row.id,
      challenge,
      rpId: "localhost",
      allowCredentials: mode === "login" ? (user?.passkeys ?? []).map((p) => p.credentialId) : [],
    };
  });
}

export async function registerPasskey(
  userId: string,
  input: { challengeId: string; credentialId: string; name: string; clientDataJSON: string },
  ip: string,
) {
  return mutateStore((data) => {
    const ch = (data.passkeyChallenges ?? []).find((c) => c.id === input.challengeId && c.userId === userId);
    if (!ch || ch.exp < Date.now() || ch.mode !== "register") {
      return { ok: false as const, error: "چالش Passkey نامعتبر یا منقضی است.", status: 400 };
    }
    if (!challengeMatchesClientData(input.clientDataJSON, ch.challenge)) {
      return { ok: false as const, error: "چالش Passkey با دادهٔ مرورگر هم‌خوان نیست.", status: 400 };
    }
    const user = data.users.find((u) => u.id === userId);
    if (!user) return { ok: false as const, error: "کاربر یافت نشد.", status: 404 };
    user.passkeys ??= [];
    if (user.passkeys.some((p) => p.credentialId === input.credentialId)) {
      return { ok: false as const, error: "این Passkey قبلاً ثبت شده.", status: 400 };
    }
    user.passkeys.push({
      id: randomId(),
      credentialId: input.credentialId.slice(0, 512),
      name: (input.name || "Passkey").slice(0, 40),
      createdAt: Date.now(),
    });
    ch.exp = 0;
    appendAudit(data, userId, "passkey", { ip, detail: "Passkey ثبت شد. تأیید امضای کامل FIDO2 برای production لازم است." });
    return { ok: true as const };
  });
}

export async function deletePasskey(userId: string, passkeyId: string, ip: string) {
  return mutateStore((data) => {
    const user = data.users.find((u) => u.id === userId);
    if (!user) return { ok: false as const, error: "کاربر یافت نشد.", status: 404 };
    const before = user.passkeys?.length ?? 0;
    user.passkeys = (user.passkeys ?? []).filter((p) => p.id !== passkeyId);
    if ((user.passkeys?.length ?? 0) === before) {
      return { ok: false as const, error: "Passkey یافت نشد.", status: 404 };
    }
    appendAudit(data, userId, "passkey", { ip, detail: "Passkey حذف شد" });
    return { ok: true as const };
  });
}

export async function verifySecondFactor(
  userId: string,
  ip: string,
  input: { password?: string; recovery?: string; credentialId?: string; clientDataJSON?: string; challengeId?: string },
) {
  return mutateStore((data) => {
    const gate = twoStepGate(data, userId, ip);
    if (!gate.allowed) {
      return { ok: false as const, error: "تعداد تلاش بیش از حد است.", status: 429, retryAfterSec: gate.retryAfterSec };
    }
    const user = data.users.find((u) => u.id === userId);
    if (!user?.twoStepEnabled) {
      return { ok: false as const, error: "رمز دومرحله‌ای برای این حساب فعال نیست.", status: 400 };
    }
    if (input.password) {
      if (!passwordMatches(user, input.password)) {
        return { ok: false as const, error: "رمز عبور نادرست است.", status: 400 };
      }
      return { ok: true as const, via: "password" as const };
    }
    if (input.recovery) {
      if (!consumeRecoveryCode(user, input.recovery)) {
        return { ok: false as const, error: "کد بازیابی نادرست است.", status: 400 };
      }
      appendAudit(data, userId, "recovery", { ip, detail: "ورود با کد بازیابی یک‌بارمصرف" });
      return { ok: true as const, via: "recovery" as const };
    }
    if (input.credentialId && input.clientDataJSON && input.challengeId) {
      const ch = (data.passkeyChallenges ?? []).find((c) => c.id === input.challengeId && c.userId === userId);
      if (!ch || ch.exp < Date.now() || ch.mode !== "login") {
        return { ok: false as const, error: "چالش Passkey نامعتبر است.", status: 400 };
      }
      if (!challengeMatchesClientData(input.clientDataJSON, ch.challenge)) {
        return { ok: false as const, error: "چالش Passkey تأیید نشد.", status: 400 };
      }
      const known = (user.passkeys ?? []).some((p) => p.credentialId === input.credentialId);
      if (!known) return { ok: false as const, error: "این Passkey برای حساب ثبت نشده.", status: 400 };
      ch.exp = 0;
      return { ok: true as const, via: "passkey" as const };
    }
    return { ok: false as const, error: "عامل دوم لازم است.", status: 400 };
  });
}

export async function fileVulnReport(userId: string | null, summary: string, contact: string | undefined, ip: string) {
  if (summary.trim().length < 12) {
    return { ok: false as const, error: "شرح آسیب‌پذیری خیلی کوتاه است.", status: 400 };
  }
  return mutateStore((data) => {
    data.vulnReports ??= [];
    data.vulnReports.unshift({
      id: randomId(),
      createdAt: Date.now(),
      summary: summary.trim().slice(0, 2000),
      contact: contact?.trim().slice(0, 120),
      reporterId: userId ?? undefined,
    });
    if (userId) appendAudit(data, userId, "vuln_report", { ip, detail: "گزارش آسیب‌پذیری ثبت شد" });
    return { ok: true as const };
  });
}

export function userNeedsTwoStep(user: UserRecord | null | undefined) {
  return Boolean(user?.status === "active" && user.twoStepEnabled && user.passwordHash);
}

/** Test helper: never persist plaintext. */
export function storeContainsPlainPassword(data: StoreData, password: string) {
  const blob = JSON.stringify(data);
  return blob.includes(password);
}
