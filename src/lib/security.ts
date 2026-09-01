import "server-only";

import { hashOtp, hmacIdentifier, newSalt, otpHashesEqual, randomId, encryptText, decryptText } from "@/lib/crypto-utils";
import { APP_VERSION, DEVICE_INACTIVE_MS, deviceKindFa, parseUserAgent } from "@/lib/device-info";
import { hitRateLimit } from "@/lib/rate-limit";
import { mutateStore, readStoreSnapshot } from "@/lib/store";
import type { AuditEvent, DeviceSession, SecurityEventKind, StoreData, UserRecord } from "@/lib/store";
import { emitNotification } from "@/lib/notify";
import { otpauthUrl, randomTotpSecret, totpValid } from "@/lib/totp";

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
  const skip: SecurityEventKind[] = ["logout", "backup", "vuln_report", "privacy"];
  if (!skip.includes(kind)) {
    emitNotification(data, {
      userId,
      category: "security",
      kind,
      title: publicAudit(event).title,
      body: opts.detail || publicAudit(event).title,
      senderName: "NIXO Security",
      priority: "high",
      sourceId: `sec:${kind}`,
      target: { type: "security", id: event.id, href: "/app/settings/security" },
    });
  }
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
    device_trust: "دستگاه مورد اعتماد تأیید شد",
    device_deny: "دستگاه ناشناس رد شد",
    privacy: "تغییر حریم خصوصی",
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
  const inactive = Date.now() - d.lastSeenAt > DEVICE_INACTIVE_MS;
  const unknown = Boolean(d.pending) || !d.trusted;
  return {
    id: d.id,
    label: d.label,
    name: d.name || d.label,
    deviceType: d.deviceType,
    deviceTypeFa: deviceKindFa(d.deviceType),
    os: d.os,
    appVersion: d.appVersion,
    userAgent: d.userAgent,
    approx: d.approx,
    createdAt: d.createdAt,
    lastSeenAt: d.lastSeenAt,
    current: d.id === currentId,
    trusted: Boolean(d.trusted) && !d.pending,
    pending: Boolean(d.pending),
    unknown,
    status: d.revokedAt ? ("revoked" as const) : inactive ? ("inactive" as const) : ("active" as const),
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

export async function sessionDeviceStatus(sessionId: string | undefined, userId: string) {
  if (!sessionId) return { ok: false as const, reason: "invalid" as const, pending: false, trusted: false };
  const data = await readStoreSnapshot();
  const d = (data.devices ?? []).find((x) => x.id === sessionId);
  if (!d || d.userId !== userId) return { ok: false as const, reason: "invalid" as const, pending: false, trusted: false };
  if (d.revokedAt) return { ok: false as const, reason: "revoked" as const, pending: false, trusted: false };
  return {
    ok: true as const,
    reason: "ok" as const,
    pending: Boolean(d.pending),
    trusted: Boolean(d.trusted) && !d.pending,
    device: d,
  };
}

export async function isDeviceActive(sessionId: string | undefined, userId: string) {
  return (await sessionDeviceStatus(sessionId, userId)).ok;
}

export async function createDeviceSessionForUser(input: {
  userId: string;
  ip: string;
  userAgent: string;
  approx: string;
  recovery?: boolean;
}) {
  return mutateStore((data) => {
    data.devices ??= [];
    const ua = input.userAgent.slice(0, 180);
    const parsed = parseUserAgent(ua);
    const live = data.devices.filter((d) => d.userId === input.userId && !d.revokedAt);
    const trustedLive = live.filter((d) => d.trusted && !d.pending);
    const knownUa = live.some((d) => d.userAgent === ua && d.trusted && !d.pending);
    const isNewDevice = !live.some((d) => d.userAgent === ua);
    let pending = false;
    let trusted = true;
    if (input.recovery) {
      pending = false;
      trusted = true;
    } else if (knownUa) {
      pending = false;
      trusted = true;
    } else if (trustedLive.length === 0) {
      pending = false;
      trusted = true;
    } else {
      pending = true;
      trusted = false;
    }
    const suspicious = pending || (isNewDevice && trustedLive.length > 0 && !input.recovery);
    const refreshPlain = randomId() + randomId();
    const refreshSalt = newSalt();
    const device: DeviceSession = {
      id: randomId(),
      userId: input.userId,
      createdAt: Date.now(),
      lastSeenAt: Date.now(),
      userAgent: ua,
      ipHint: ipHint(input.ip),
      approx: input.approx.slice(0, 120),
      label: parsed.name,
      name: parsed.name,
      deviceType: parsed.kind,
      os: parsed.os,
      appVersion: APP_VERSION,
      trusted,
      pending,
      refreshSalt,
      refreshHash: hashOtp(refreshPlain, refreshSalt),
      refreshRotatedAt: Date.now(),
    };
    data.devices.unshift(device);
    if (input.recovery) {
      appendAudit(data, input.userId, "recovery", {
        ip: input.ip,
        userAgent: ua,
        deviceSessionId: device.id,
        detail: "بازیابی حساب؛ نشست‌های دیگر باطل می‌شوند",
      });
    }
    appendAudit(data, input.userId, isNewDevice ? "new_device" : "login", {
      ip: input.ip,
      userAgent: ua,
      deviceSessionId: device.id,
      detail: pending
        ? "New login detected from a new device — در انتظار تأیید دستگاه مورد اعتماد"
        : device.name,
    });
    if (suspicious) {
      appendAudit(data, input.userId, "suspicious", {
        ip: input.ip,
        userAgent: ua,
        deviceSessionId: device.id,
        detail: "ورود مشکوک: دستگاه جدید یا ناشناس",
      });
    }
    return { device, isNewDevice, suspicious, pending, refreshToken: refreshPlain };
  });
}

export async function approveDevice(userId: string, deviceId: string, actorSid: string | undefined, actorIp?: string) {
  return mutateStore((data) => {
    const actor = (data.devices ?? []).find((d) => d.id === actorSid && d.userId === userId && !d.revokedAt);
    if (!actor || actor.pending || !actor.trusted) {
      return { ok: false as const, status: 403, error: "فقط دستگاه Trusted می‌تواند دستگاه جدید را تأیید کند." };
    }
    const target = (data.devices ?? []).find((d) => d.id === deviceId && d.userId === userId && !d.revokedAt);
    if (!target) {
      return { ok: false as const, status: 404, error: "دستگاه یافت نشد." };
    }
    if (!target.pending && target.trusted) {
      return { ok: true as const };
    }
    target.pending = false;
    target.trusted = true;
    appendAudit(data, userId, "device_trust", {
      ip: actorIp,
      deviceSessionId: target.id,
      detail: `تأیید ${target.name} از ${actor.name}`,
    });
    return { ok: true as const };
  });
}

export async function listUserDevices(userId: string, currentSid?: string) {
  const data = await readStoreSnapshot();
  const devices = (data.devices ?? [])
    .filter((d) => d.userId === userId && !d.revokedAt)
    .sort((a, b) => b.lastSeenAt - a.lastSeenAt);
  const mapped = devices.map((d) => publicDevice(d, currentSid));
  return {
    devices: mapped,
    pending: mapped.filter((d) => d.pending),
    trusted: mapped.filter((d) => d.trusted),
  };
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
    d.refreshHash = undefined;
    d.refreshSalt = undefined;
    appendAudit(data, userId, "revoke", {
      ip: actorIp,
      deviceSessionId: deviceId,
      detail: `خروج از ${d.name || d.label}`,
    });
    if (d.pending || !d.trusted) {
      appendAudit(data, userId, "device_deny", {
        ip: actorIp,
        deviceSessionId: deviceId,
        detail: "Remove Device → Revoke Sessions → Security Alert",
      });
      appendAudit(data, userId, "suspicious", {
        ip: actorIp,
        deviceSessionId: deviceId,
        detail: "دستگاه ناشناس حذف شد",
      });
    }
    return true;
  });
}

export async function revokeAllDevices(userId: string, actorIp?: string) {
  return mutateStore((data) => {
    let n = 0;
    for (const d of data.devices ?? []) {
      if (d.userId === userId && !d.revokedAt) {
        d.revokedAt = Date.now();
        d.refreshHash = undefined;
        d.refreshSalt = undefined;
        n += 1;
      }
    }
    appendAudit(data, userId, "revoke", { ip: actorIp, detail: "خروج از همهٔ دستگاه‌ها" });
    const now = Date.now();
    for (const g of data.miniGrants ?? []) {
      if (g.userId === userId) {
        g.revokedAt = now;
        g.tokenHash = undefined;
        g.tokenExp = 0;
      }
    }
    for (const s of data.miniSessions ?? []) {
      if (s.userId === userId && !s.revokedAt) s.revokedAt = now;
    }
    return n;
  });
}

export async function revokeAllOtherDevices(userId: string, keepId: string | undefined, actorIp?: string) {
  return mutateStore((data) => {
    let n = 0;
    for (const d of data.devices ?? []) {
      if (d.userId === userId && d.id !== keepId && !d.revokedAt) {
        d.revokedAt = Date.now();
        d.refreshHash = undefined;
        d.refreshSalt = undefined;
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
      { id: "totp", label: "Authenticator", ok: Boolean(user.totpSecretCipher) },
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
  const loginHistory = events
    .filter((e) => e.kind === "login" || e.kind === "new_device" || e.kind === "suspicious")
    .slice(0, 20)
    .map(publicAudit);
  const scoreItems = checkup(user, devices, events).items;
  const score = Math.round((scoreItems.filter((i) => i.ok).length / Math.max(1, scoreItems.length)) * 100);
  return {
    checkup: checkup(user, devices, events),
    devices: devices.sort((a, b) => b.lastSeenAt - a.lastSeenAt).map((d) => publicDevice(d, currentSid)),
    events: events.map(publicAudit),
    loginHistory,
    twoStepEnabled: Boolean(user.twoStepEnabled),
    totpEnabled: Boolean(user.totpSecretCipher),
    recoveryLeft: user.recoveryCodeHashes?.length ?? 0,
    passkeys: (user.passkeys ?? []).map((p) => ({ id: p.id, name: p.name, createdAt: p.createdAt })),
    backupSet: Boolean(user.e2eeBackupVerifier),
    hasPassword: Boolean(user.passwordHash),
    mutedCount: (user.mutedPeerKeys ?? []).length,
    blockedCount: (user.blockedPeerKeys ?? []).length,
    restrictedCount: (user.restrictedPeerKeys ?? []).length,
    consents: user.prefs?.consents ?? { analytics: false, contactSync: false, location: false, marketing: false },
    screenshotProtect: Boolean(user.prefs?.screenshotProtect),
    score,
    metrics: {
      activeSessions: devices.filter((d) => !d.revokedAt).length,
      suspicious24h: events.filter((e) => e.kind === "suspicious" && Date.now() - e.createdAt < 86_400_000).length,
      failedLogins: events.filter((e) => e.kind === "suspicious").length,
    },
  };
}

export async function recentSecurityNotices(userId: string) {
  const data = await readStoreSnapshot();
  const since = Date.now() - 36 * 60 * 60 * 1000;
  return (data.audit ?? [])
    .filter((e) => e.userId === userId && e.createdAt >= since)
    .filter((e) =>
      ["new_device", "suspicious", "login", "recovery", "identifier_change", "twostep_on", "twostep_off", "password", "device_trust", "device_deny", "privacy"].includes(
        e.kind,
      ),
    )
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
  input: { password?: string; recovery?: string; credentialId?: string; clientDataJSON?: string; challengeId?: string; totp?: string },
) {
  return mutateStore((data) => {
    const gate = twoStepGate(data, userId, ip);
    if (!gate.allowed) {
      return { ok: false as const, error: "تعداد تلاش بیش از حد است.", status: 429, retryAfterSec: gate.retryAfterSec };
    }
    const user = data.users.find((u) => u.id === userId);
    if (!user) return { ok: false as const, error: "حساب فعال نیست.", status: 401 };
    if (!user.twoStepEnabled && !user.totpSecretCipher) {
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
    if (input.totp) {
      if (!user.totpSecretCipher) return { ok: false as const, error: "Authenticator فعال نیست.", status: 400 };
      let secret = "";
      try {
        secret = decryptText(user.totpSecretCipher);
      } catch {
        return { ok: false as const, error: "Authenticator نامعتبر است.", status: 400 };
      }
      if (!totpValid(secret, input.totp)) {
        return { ok: false as const, error: "کد Authenticator نادرست است.", status: 400 };
      }
      return { ok: true as const, via: "totp" as const };
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

export function passwordPolicyOk(password: string, username?: string) {
  const p = password.trim();
  if (p.length < PASSWORD_MIN) return { ok: false as const, error: `رمز باید حداقل ${PASSWORD_MIN} نویسه باشد.` };
  if (username && p.toLowerCase().includes(username.toLowerCase())) {
    return { ok: false as const, error: "رمز نباید شامل نام کاربری باشد." };
  }
  if (/password|123456|nixo/i.test(p) && p.length < 16) {
    return { ok: false as const, error: "رمز خیلی قابل حدس است." };
  }
  return { ok: true as const };
}

export async function changeAccountPassword(userId: string, current: string, next: string, ip: string) {
  return mutateStore((data) => {
    const gate = twoStepGate(data, userId, ip);
    if (!gate.allowed) return { ok: false as const, error: "تعداد تلاش بیش از حد است.", status: 429 };
    const user = data.users.find((u) => u.id === userId);
    if (!user) return { ok: false as const, error: "حساب فعال نیست.", status: 401 };
    const policy = passwordPolicyOk(next, user.username ?? undefined);
    if (!policy.ok) return { ok: false as const, error: policy.error, status: 400 };
    if (user.passwordHash && !passwordMatches(user, current)) {
      return { ok: false as const, error: "رمز فعلی نادرست است.", status: 400 };
    }
    const { salt, hash } = hashPassword(next);
    user.passwordSalt = salt;
    user.passwordHash = hash;
    appendAudit(data, userId, "password", { ip, detail: "تغییر رمز؛ فقط هش ذخیره شد" });
    return { ok: true as const };
  });
}

export async function beginAuthenticator(userId: string, ip: string) {
  return mutateStore((data) => {
    const gate = twoStepGate(data, userId, ip);
    if (!gate.allowed) return { ok: false as const, error: "تعداد تلاش بیش از حد است.", status: 429 };
    const user = data.users.find((u) => u.id === userId);
    if (!user) return { ok: false as const, error: "حساب فعال نیست.", status: 401 };
    const secret = randomTotpSecret();
    user.totpPendingCipher = encryptText(secret);
    return {
      ok: true as const,
      secret,
      otpauth: otpauthUrl(secret, user.username || user.id),
    };
  });
}

export async function confirmAuthenticator(userId: string, code: string, ip: string) {
  return mutateStore((data) => {
    const user = data.users.find((u) => u.id === userId);
    if (!user?.totpPendingCipher) return { ok: false as const, error: "Authenticator شروع نشده.", status: 400 };
    let secret = "";
    try {
      secret = decryptText(user.totpPendingCipher);
    } catch {
      return { ok: false as const, error: "رمز Authenticator نامعتبر است.", status: 400 };
    }
    if (!totpValid(secret, code)) return { ok: false as const, error: "کد تأیید نادرست است.", status: 400 };
    user.totpSecretCipher = user.totpPendingCipher;
    user.totpPendingCipher = undefined;
    appendAudit(data, userId, "twostep_on", { ip, detail: "Authenticator تأیید و فعال شد" });
    return { ok: true as const };
  });
}

export async function disableAuthenticator(userId: string, password: string, ip: string, totpCode?: string) {
  return mutateStore((data) => {
    const user = data.users.find((u) => u.id === userId);
    if (!user) return { ok: false as const, error: "حساب فعال نیست.", status: 401 };
    if (!user.totpSecretCipher) return { ok: false as const, error: "Authenticator فعال نیست.", status: 400 };
    if (user.passwordHash) {
      if (!passwordMatches(user, password)) {
        return { ok: false as const, error: "رمز عبور نادرست است.", status: 400 };
      }
    } else {
      let secret = "";
      try {
        secret = decryptText(user.totpSecretCipher);
      } catch {
        return { ok: false as const, error: "Authenticator نامعتبر است.", status: 400 };
      }
      if (!totpValid(secret, totpCode ?? "")) {
        return { ok: false as const, error: "کد تأیید نادرست است.", status: 400 };
      }
    }
    user.totpSecretCipher = undefined;
    user.totpPendingCipher = undefined;
    appendAudit(data, userId, "twostep_off", { ip, detail: "Authenticator خاموش شد" });
    return { ok: true as const };
  });
}

export async function rotateDeviceRefresh(userId: string, deviceId: string, presented: string) {
  return mutateStore((data) => {
    const d = (data.devices ?? []).find((x) => x.id === deviceId && x.userId === userId && !x.revokedAt);
    if (!d || !d.refreshHash || !d.refreshSalt) return { ok: false as const, error: "نشست نامعتبر است.", status: 401 };
    if (!otpHashesEqual(d.refreshHash, hashOtp(presented, d.refreshSalt))) {
      d.revokedAt = Date.now();
      d.refreshHash = undefined;
      appendAudit(data, userId, "suspicious", { deviceSessionId: deviceId, detail: "Refresh Token نامعتبر — نشست باطل شد" });
      return { ok: false as const, error: "Refresh Token باطل شد.", status: 401 };
    }
    const next = randomId() + randomId();
    d.refreshSalt = newSalt();
    d.refreshHash = hashOtp(next, d.refreshSalt);
    d.refreshRotatedAt = Date.now();
    return { ok: true as const, refreshToken: next };
  });
}

export async function createPrivacyExport(userId: string, ip: string) {
  return mutateStore((data) => {
    const user = data.users.find((u) => u.id === userId);
    if (!user) return { ok: false as const, error: "حساب فعال نیست.", status: 401 };
    const gate = hitRateLimit(data, `export:${userId}`, 60 * 60_000, 4);
    if (!gate.allowed) return { ok: false as const, error: "خروجی محدود شد.", status: 429 };
    const token = randomId() + randomId();
    const payload = {
      kind: "nixo-privacy-export",
      exportedAt: Date.now(),
      userId,
      username: user.username,
      displayName: user.displayName,
      privacy: {
        photo: user.privacyPhoto,
        bio: user.privacyBio,
        phone: user.privacyPhone,
        email: user.privacyEmail,
        lastSeen: user.privacyLastSeen,
        online: user.privacyOnline,
        messages: user.privacyMessages,
        findUsername: user.privacyFindUsername,
      },
      consents: user.prefs?.consents,
      blockedCount: user.blockedPeerKeys.length,
    };
    const job = {
      id: randomId(),
      ownerUserId: userId,
      tokenHash: hmacIdentifier(token),
      expiresAt: Date.now() + 15 * 60_000,
      createdAt: Date.now(),
      consumedAt: null as number | null,
      cipher: encryptText(JSON.stringify(payload)),
    };
    data.privacyExports = [job, ...(data.privacyExports ?? [])].slice(0, 20);
    appendAudit(data, userId, "backup", { ip, detail: "خروجی حریم خصوصی با لینک منقضی" });
    return { ok: true as const, exportId: job.id, token, expiresAt: job.expiresAt };
  });
}

export async function downloadPrivacyExport(userId: string, token: string) {
  return mutateStore((data) => {
    const hash = hmacIdentifier(token);
    const job = (data.privacyExports ?? []).find((j) => j.tokenHash === hash);
    if (!job || job.ownerUserId !== userId) return { ok: false as const, error: "یافت نشد.", status: 404 };
    if (job.consumedAt || job.expiresAt < Date.now()) return { ok: false as const, error: "لینک منقضی است.", status: 410 };
    job.consumedAt = Date.now();
    let json = "";
    try {
      json = decryptText(job.cipher);
    } catch {
      return { ok: false as const, error: "خروجی خراب است.", status: 500 };
    }
    return { ok: true as const, export: JSON.parse(json) as Record<string, unknown> };
  });
}

export async function updateConsents(userId: string, patch: Record<string, boolean>, ip: string) {
  return mutateStore((data) => {
    const user = data.users.find((u) => u.id === userId);
    if (!user) return { ok: false as const, error: "حساب فعال نیست.", status: 401 };
    data.consentEvents ??= [];
    const keys = ["analytics", "contactSync", "location", "marketing"] as const;
    for (const key of keys) {
      if (typeof patch[key] === "boolean" && user.prefs.consents[key] !== patch[key]) {
        user.prefs.consents[key] = patch[key];
        data.consentEvents.unshift({ id: randomId(), userId, key, value: patch[key], at: Date.now() });
      }
    }
    data.consentEvents = data.consentEvents.slice(0, 200);
    appendAudit(data, userId, "privacy", { ip, detail: "به‌روزرسانی رضایت داده" });
    return { ok: true as const, consents: user.prefs.consents, history: data.consentEvents.filter((e) => e.userId === userId).slice(0, 20) };
  });
}

export async function setScreenshotProtect(userId: string, on: boolean, ip: string) {
  return mutateStore((data) => {
    const user = data.users.find((u) => u.id === userId);
    if (!user) return { ok: false as const, error: "حساب فعال نیست.", status: 401 };
    user.prefs.screenshotProtect = on;
    appendAudit(data, userId, "privacy", { ip, detail: on ? "سیاست اسکرین‌شات روشن شد" : "سیاست اسکرین‌شات خاموش شد" });
    return { ok: true as const, screenshotProtect: on };
  });
}

export function requestOriginAllowed(request: Request) {
  const origin = request.headers.get("origin");
  if (!origin) return true;
  const host = request.headers.get("host");
  if (!host) return false;
  try {
    return new URL(origin).host === host;
  } catch {
    return false;
  }
}

export function userNeedsTwoStep(user: UserRecord | null | undefined) {
  return Boolean(user?.status === "active" && ((user.twoStepEnabled && user.passwordHash) || user.totpSecretCipher));
}

/** Test helper: never persist plaintext. */
export function storeContainsPlainPassword(data: StoreData, password: string) {
  const blob = JSON.stringify(data);
  return blob.includes(password);
}
