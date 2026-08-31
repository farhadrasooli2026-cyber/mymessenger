import "server-only";
import { z } from "zod";
import { config } from "@/lib/config";
import {
  dummyOtpCompare,
  encryptText,
  hashOtp,
  hmacIdentifier,
  maskEmail,
  maskPhone,
  newSalt,
  otpHashesEqual,
  randomId,
  randomOtp,
} from "@/lib/crypto-utils";
import { normalizeIdentifier } from "@/lib/identifiers";
import { buildOtpMessage, getOutbox, putOutbox } from "@/lib/outbox";
import {
  clearFailedCycles,
  isIdentifierLocked,
  recordExhaustedCycle,
  sendLimits,
  verifyIpLimit,
} from "@/lib/rate-limit";
import { mutateStore, readStoreSnapshot } from "@/lib/store";
import type { StoreData } from "@/lib/store";
import { defaultUserFields } from "@/lib/profile-types";

const GENERIC_SENT =
  "اگر این اطلاعات قابل استفاده باشد، کد تأیید ارسال شد.";

export const startSchema = z.object({
  channel: z.enum(["phone", "email"]),
  identifier: z.string().min(3).max(254),
  humanToken: z.string().min(8).max(128),
  website: z.string().max(200).optional().default(""),
});

export const verifySchema = z.object({
  code: z.string().regex(/^\d{6}$/),
});

function publicError(message: string, status = 400, extra?: Record<string, unknown>) {
  return { ok: false as const, status, error: message, ...extra };
}

export async function issueHumanChallenge(ipHash: string) {
  const id = randomId();
  const now = Date.now();
  await mutateStore((data) => {
    data.humanChallenges.push({
      id,
      ipHash,
      issuedAt: now,
      ackedAt: null,
      consumedAt: null,
    });
  });
  return { token: id, issuedAt: now };
}

export async function ackHumanChallenge(token: string, ipHash: string) {
  const now = Date.now();
  return mutateStore((data) => {
    const row = data.humanChallenges.find((h) => h.id === token);
    if (!row || row.ipHash !== ipHash) {
      return { ok: false as const, error: "نشست امنیتی نامعتبر است. صفحه را تازه‌سازی کنید." };
    }
    if (row.consumedAt) {
      return { ok: false as const, error: "نشست امنیتی منقضی شده است." };
    }
    if (now - row.issuedAt > config.human.tokenTtlMs) {
      return { ok: false as const, error: "نشست امنیتی منقضی شده است." };
    }
    row.ackedAt = now;
    return { ok: true as const };
  });
}

function consumeHuman(data: StoreData, token: string, ipHash: string, now: number) {
  const row = data.humanChallenges.find((h) => h.id === token);
  if (!row || row.ipHash !== ipHash || row.consumedAt) return { ok: false as const, reason: "invalid" };
  if (now - row.issuedAt > config.human.tokenTtlMs) return { ok: false as const, reason: "expired" };
  if (!row.ackedAt) return { ok: false as const, reason: "not_acked" };
  if (row.ackedAt - row.issuedAt < config.human.minElapsedMs) return { ok: false as const, reason: "too_fast" };
  row.consumedAt = now;
  return { ok: true as const };
}

export async function startRegistration(input: z.infer<typeof startSchema>, ipHash: string) {
  const now = Date.now();
  const normalized = normalizeIdentifier(input.channel, input.identifier);
  if (!normalized) {
    return publicError(
      input.channel === "phone"
        ? "شماره موبایل معتبر نیست. از قالب 09xxxxxxxxx استفاده کنید."
        : "ایمیل واردشده معتبر نیست.",
    );
  }

  if (input.website && input.website.trim().length > 0) {
    await sleep(400 + Math.floor(Math.random() * 300));
    return {
      ok: true as const,
      status: 200,
      message: GENERIC_SENT,
      cooldownSeconds: Math.ceil(config.otp.resendCooldownMs / 1000),
      ttlSeconds: Math.ceil(config.otp.ttlMs / 1000),
      masked: input.channel === "phone" ? maskPhone(normalized) : maskEmail(normalized),
      channel: input.channel,
      challengeId: randomId(),
      bait: true as const,
    };
  }

  const identifierHash = hmacIdentifier(normalized);
  const masked = input.channel === "phone" ? maskPhone(normalized) : maskEmail(normalized);

  const result = await mutateStore((data) => {
    const human = consumeHuman(data, input.humanToken, ipHash, now);
    if (!human.ok) {
      return publicError("تأیید امنیتی انجام نشد. دوباره تلاش کنید.", 400);
    }

    if (isIdentifierLocked(data, identifierHash, now)) {
      return {
        ok: true as const,
        status: 200,
        message: GENERIC_SENT,
        cooldownSeconds: Math.ceil(config.otp.resendCooldownMs / 1000),
        ttlSeconds: Math.ceil(config.otp.ttlMs / 1000),
        masked,
        channel: input.channel,
        challengeId: randomId(),
        locked: true as const,
      };
    }

    const limits = sendLimits(data, identifierHash, ipHash, now);
    if (!limits.ok) {
      return publicError("تعداد درخواست‌ها بیش از حد مجاز است. بعداً تلاش کنید.", 429, {
        retryAfterSec: limits.retryAfterSec,
      });
    }

    for (const existing of data.challenges) {
      if (existing.identifierHash === identifierHash && !existing.usedAt && !existing.invalidatedAt) {
        existing.invalidatedAt = now;
      }
    }

    const code = randomOtp(config.otp.length);
    const salt = newSalt();
    const challenge = {
      id: randomId(),
      channel: input.channel,
      identifierHash,
      identifierMasked: masked,
      identifierCipher: encryptText(normalized),
      salt,
      codeHash: hashOtp(code, salt),
      expiresAt: now + config.otp.ttlMs,
      usedAt: null,
      attemptCount: 0,
      sendCount: 1,
      lastSentAt: now,
      createdAt: now,
      invalidatedAt: null,
      ipHash,
    };
    data.challenges.push(challenge);

    putOutbox({
      challengeId: challenge.id,
      channel: input.channel,
      maskedTo: masked,
      body: buildOtpMessage(input.channel, code, Math.ceil(config.otp.ttlMs / 60000)),
      createdAt: now,
    });

    return {
      ok: true as const,
      status: 200,
      message: GENERIC_SENT,
      cooldownSeconds: Math.ceil(config.otp.resendCooldownMs / 1000),
      ttlSeconds: Math.ceil(config.otp.ttlMs / 1000),
      masked,
      channel: input.channel,
      challengeId: challenge.id,
    };
  });

  return result;
}

export async function resendOtp(challengeId: string, ipHash: string) {
  const now = Date.now();
  return mutateStore((data) => {
    const challenge = data.challenges.find((c) => c.id === challengeId);
    if (!challenge || challenge.usedAt || challenge.invalidatedAt) {
      dummyOtpCompare("000000");
      return publicError("نشست تأیید معتبر نیست. ثبت‌نام را از ابتدا شروع کنید.", 401);
    }

    if (now < challenge.lastSentAt + config.otp.resendCooldownMs) {
      const wait = Math.ceil((challenge.lastSentAt + config.otp.resendCooldownMs - now) / 1000);
      return publicError("برای ارسال مجدد کمی صبر کنید.", 429, { retryAfterSec: wait });
    }

    if (isIdentifierLocked(data, challenge.identifierHash, now)) {
      return publicError("تعداد درخواست‌ها بیش از حد مجاز است. بعداً تلاش کنید.", 429);
    }

    const limits = sendLimits(data, challenge.identifierHash, ipHash, now);
    if (!limits.ok) {
      return publicError("تعداد درخواست‌های ارسال کد بیش از حد مجاز است.", 429, {
        retryAfterSec: limits.retryAfterSec,
      });
    }

    const code = randomOtp(config.otp.length);
    challenge.salt = newSalt();
    challenge.codeHash = hashOtp(code, challenge.salt);
    challenge.expiresAt = now + config.otp.ttlMs;
    challenge.attemptCount = 0;
    challenge.sendCount += 1;
    challenge.lastSentAt = now;
    challenge.usedAt = null;

    putOutbox({
      challengeId: challenge.id,
      channel: challenge.channel,
      maskedTo: challenge.identifierMasked,
      body: buildOtpMessage(challenge.channel, code, Math.ceil(config.otp.ttlMs / 60000)),
      createdAt: now,
    });

    return {
      ok: true as const,
      status: 200,
      message: GENERIC_SENT,
      cooldownSeconds: Math.ceil(config.otp.resendCooldownMs / 1000),
      ttlSeconds: Math.ceil(config.otp.ttlMs / 1000),
    };
  });
}

export async function verifyOtp(challengeId: string, code: string, ipHash: string) {
  const now = Date.now();
  return mutateStore((data) => {
    const ip = verifyIpLimit(data, ipHash, now);
    if (!ip.allowed) {
      dummyOtpCompare(code);
      return publicError("تعداد تلاش‌ها بیش از حد مجاز است.", 429, { retryAfterSec: ip.retryAfterSec });
    }

    const challenge = data.challenges.find((c) => c.id === challengeId);
    if (!challenge) {
      dummyOtpCompare(code);
      return publicError("کد تأیید نادرست است.", 400);
    }

    if (challenge.invalidatedAt || challenge.usedAt) {
      dummyOtpCompare(code);
      return publicError("این کد دیگر معتبر نیست. کد جدید درخواست کنید.", 400);
    }

    if (now > challenge.expiresAt) {
      dummyOtpCompare(code);
      challenge.invalidatedAt = now;
      recordExhaustedCycle(data, challenge.identifierHash, now);
      return publicError("کد تأیید منقضی شده است. کد جدید درخواست کنید.", 400, { expired: true });
    }

    if (challenge.attemptCount >= config.otp.maxVerifyAttempts) {
      dummyOtpCompare(code);
      challenge.invalidatedAt = now;
      recordExhaustedCycle(data, challenge.identifierHash, now);
      return publicError("تعداد تلاش برای این کد به پایان رسید. کد جدید درخواست کنید.", 400, {
        locked: true,
      });
    }

    challenge.attemptCount += 1;
    const submitted = hashOtp(code, challenge.salt);
    if (!otpHashesEqual(submitted, challenge.codeHash)) {
      const left = config.otp.maxVerifyAttempts - challenge.attemptCount;
      if (left <= 0) {
        challenge.invalidatedAt = now;
        recordExhaustedCycle(data, challenge.identifierHash, now);
      }
      return publicError("کد تأیید نادرست است.", 400, { remainingAttempts: Math.max(0, left) });
    }

    challenge.usedAt = now;
    clearFailedCycles(data, challenge.identifierHash);

    let user = data.users.find((u) => u.identifierHash === challenge.identifierHash);
    if (!user) {
      user = {
        id: randomId(),
        status: "pending_profile",
        channel: challenge.channel,
        identifierHash: challenge.identifierHash,
        identifierMasked: challenge.identifierMasked,
        identifierCipher: challenge.identifierCipher,
        createdAt: now,
        verifiedAt: now,
        ...defaultUserFields(),
      };
      data.users.push(user);
    } else if (!user.verifiedAt) {
      user.verifiedAt = now;
      if (user.status !== "active") user.status = "pending_profile";
    }

    return {
      ok: true as const,
      status: 200,
      alreadyActive: user.status === "active",
      userId: user.id,
      masked: user.identifierMasked,
      channel: user.channel,
    };
  });
}

export async function getUserById(userId: string) {
  const data = await readStoreSnapshot();
  return data.users.find((u) => u.id === userId) ?? null;
}

export async function readInbox(challengeId: string) {
  if (!config.demoInbox) return null;
  return getOutbox(challengeId);
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
