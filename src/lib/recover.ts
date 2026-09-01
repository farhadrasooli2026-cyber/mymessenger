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
import { dispatchChallengeOtp } from "@/lib/otp-delivery";
import { hitRateLimit } from "@/lib/rate-limit";
import { mutateStore } from "@/lib/store";
import { userNeedsTwoStep } from "@/lib/security";

const GENERIC = "اگر این حساب وجود داشته باشد، کد تأیید ارسال شد.";

export const recoverStartSchema = z.object({
  channel: z.enum(["phone", "email"]),
  identifier: z.string().min(3).max(254),
  humanToken: z.string().min(8).max(128),
  website: z.string().max(200).optional().default(""),
});

function publicError(message: string, status = 400, extra?: Record<string, unknown>) {
  return { ok: false as const, status, error: message, ...extra };
}

export async function startRecovery(input: z.infer<typeof recoverStartSchema>, ipHash: string) {
  const normalized = normalizeIdentifier(input.channel, input.identifier);
  if (!normalized) {
    return publicError(input.channel === "phone" ? "شماره معتبر نیست." : "ایمیل معتبر نیست.");
  }
  if (input.website?.trim()) {
    return {
      ok: true as const,
      status: 200,
      message: GENERIC,
      challengeId: randomId(),
      masked: input.channel === "phone" ? maskPhone(normalized) : maskEmail(normalized),
      channel: input.channel,
      cooldownSeconds: 45,
      ttlSeconds: 180,
    };
  }

  const identifierHash = hmacIdentifier(normalized);
  const masked = input.channel === "phone" ? maskPhone(normalized) : maskEmail(normalized);

  const result = await mutateStore((data) => {
    const human = data.humanChallenges.find((h) => h.id === input.humanToken && h.ipHash === ipHash);
    if (!human || human.consumedAt || !human.ackedAt) {
      return publicError("تأیید امنیتی انجام نشد. دوباره تلاش کنید.", 400);
    }
    human.consumedAt = Date.now();

    const ipLimit = hitRateLimit(data, `recover:ip:${ipHash}`, 15 * 60_000, 6);
    const idLimit = hitRateLimit(data, `recover:id:${identifierHash}`, 15 * 60_000, 4);
    if (!ipLimit.allowed || !idLimit.allowed) {
      return publicError("تعداد تلاش بازیابی بیش از حد است.", 429, {
        retryAfterSec: Math.max(ipLimit.retryAfterSec, idLimit.retryAfterSec),
      });
    }

    const user = data.users.find((u) => u.identifierHash === identifierHash && u.status === "active");
    if (!user) {
      return {
        ok: true as const,
        status: 200,
        message: GENERIC,
        challengeId: randomId(),
        masked,
        channel: input.channel,
        cooldownSeconds: Math.ceil(config.otp.resendCooldownMs / 1000),
        ttlSeconds: Math.ceil(config.otp.ttlMs / 1000),
        bait: true as const,
      };
    }

    const code = randomOtp(config.otp.length);
    const salt = newSalt();
    const challenge = {
      id: randomId(),
      channel: input.channel,
      identifierHash,
      identifierMasked: masked,
      identifierCipher: user.identifierCipher || encryptText(normalized),
      salt,
      codeHash: hashOtp(code, salt),
      expiresAt: Date.now() + config.otp.ttlMs,
      usedAt: null as number | null,
      attemptCount: 0,
      sendCount: 1,
      lastSentAt: Date.now(),
      createdAt: Date.now(),
      invalidatedAt: null as number | null,
      ipHash,
      deliveryStatus: "pending" as const,
    };
    data.challenges.push(challenge);
    return {
      ok: true as const,
      status: 200,
      message: GENERIC,
      challengeId: challenge.id,
      masked,
      channel: input.channel,
      cooldownSeconds: Math.ceil(config.otp.resendCooldownMs / 1000),
      ttlSeconds: Math.ceil(config.otp.ttlMs / 1000),
      otpCode: code,
    };
  });

  if (result.ok && "otpCode" in result && result.otpCode) {
    await dispatchChallengeOtp(result.challengeId, result.otpCode);
    return {
      ok: true as const,
      status: 200,
      message: result.message,
      challengeId: result.challengeId,
      masked: result.masked,
      channel: result.channel,
      cooldownSeconds: result.cooldownSeconds,
      ttlSeconds: result.ttlSeconds,
    };
  }
  return result;
}

export async function verifyRecovery(challengeId: string, code: string, ipHash: string) {
  const now = Date.now();
  return mutateStore((data) => {
    const gate = hitRateLimit(data, `recover:verify:${ipHash}`, 15 * 60_000, 12);
    if (!gate.allowed) {
      dummyOtpCompare(code);
      return publicError("تعداد تلاش بیش از حد است.", 429, { retryAfterSec: gate.retryAfterSec });
    }
    const challenge = data.challenges.find((c) => c.id === challengeId);
    if (!challenge || challenge.usedAt || challenge.invalidatedAt || now > challenge.expiresAt) {
      dummyOtpCompare(code);
      return publicError("کد تأیید نادرست یا منقضی است.", 400);
    }
    if (challenge.attemptCount >= config.otp.maxVerifyAttempts) {
      dummyOtpCompare(code);
      return publicError("تعداد تلاش برای این کد تمام شد.", 400);
    }
    challenge.attemptCount += 1;
    if (!otpHashesEqual(hashOtp(code, challenge.salt), challenge.codeHash)) {
      return publicError("کد تأیید نادرست است.", 400, {
        remainingAttempts: Math.max(0, config.otp.maxVerifyAttempts - challenge.attemptCount),
      });
    }
    const user = data.users.find((u) => u.identifierHash === challenge.identifierHash && u.status === "active");
    if (!user) {
      dummyOtpCompare(code);
      return publicError("کد تأیید نادرست است.", 400);
    }
    challenge.usedAt = now;
    return {
      ok: true as const,
      userId: user.id,
      twoStep: userNeedsTwoStep(user),
      hasPasskeys: (user.passkeys?.length ?? 0) > 0,
      masked: user.identifierMasked,
    };
  });
}
