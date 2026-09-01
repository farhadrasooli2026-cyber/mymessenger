import "server-only";
import { z } from "zod";
import { loginBlocked } from "@/lib/account-gate";
import { dummyOtpCompare, hmacIdentifier, randomId } from "@/lib/crypto-utils";
import { detectChannel, normalizeIdentifier } from "@/lib/identifiers";
import { hitRateLimit } from "@/lib/rate-limit";
import { consumeHumanInStore } from "@/lib/registration";
import { passwordMatches, userNeedsTotpOrPasskey } from "@/lib/security";
import { mutateStore } from "@/lib/store";

const GENERIC =
  "ورود ناموفق بود. شناسه یا رمز را بررسی کنید؛ اگر ورود با رمز برای این حساب فعال نیست، از تأیید با کد استفاده کنید.";

export const passwordLoginSchema = z.object({
  identifier: z.string().min(3).max(254),
  password: z.string().min(1).max(200),
  humanToken: z.string().min(8).max(128),
  website: z.string().max(200).optional().default(""),
});

function publicError(message: string, status = 400, extra?: Record<string, unknown>) {
  return { ok: false as const, status, error: message, ...extra };
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function loginWithPassword(input: z.infer<typeof passwordLoginSchema>, ipHash: string) {
  const channel = detectChannel(input.identifier);
  const normalized = normalizeIdentifier(channel, input.identifier);
  if (!normalized) {
    return publicError(
      channel === "phone"
        ? "شماره موبایل معتبر نیست. از قالب 09xxxxxxxxx استفاده کنید."
        : "ایمیل واردشده معتبر نیست.",
    );
  }

  if (input.website && input.website.trim().length > 0) {
    await sleep(400 + Math.floor(Math.random() * 300));
    dummyOtpCompare("000000");
    return { ok: true as const, bait: true as const, next: "app" as const };
  }

  const identifierHash = hmacIdentifier(normalized);
  const now = Date.now();

  return mutateStore((data) => {
    const human = consumeHumanInStore(data, input.humanToken, ipHash, now);
    if (!human.ok) {
      return publicError("تأیید امنیتی انجام نشد. دوباره تلاش کنید.", 400);
    }

    const ipLimit = hitRateLimit(data, `password-login:ip:${ipHash}`, 15 * 60 * 1000, 12, now);
    if (!ipLimit.allowed) {
      return publicError("تعداد درخواست‌ها بیش از حد مجاز است. بعداً تلاش کنید.", 429, {
        retryAfterSec: ipLimit.retryAfterSec,
      });
    }
    const idLimit = hitRateLimit(data, `password-login:id:${identifierHash}`, 15 * 60 * 1000, 8, now);
    if (!idLimit.allowed) {
      return publicError("تعداد درخواست‌ها بیش از حد مجاز است. بعداً تلاش کنید.", 429, {
        retryAfterSec: idLimit.retryAfterSec,
      });
    }

    dummyOtpCompare(input.password.slice(0, 6).padEnd(6, "0"));

    const user = data.users.find((u) => u.identifierHash === identifierHash);
    if (!user || user.status !== "active") {
      dummyOtpCompare("000000");
      return publicError(GENERIC, 401);
    }

    const blocked = loginBlocked(user);
    if (blocked.blocked) {
      return publicError(blocked.error, 403, { code: blocked.code });
    }

    if (!user.passwordHash || !user.passwordSalt || !passwordMatches(user, input.password)) {
      dummyOtpCompare("111111");
      return publicError(GENERIC, 401);
    }

    const extraFactor = userNeedsTotpOrPasskey(user);
    return {
      ok: true as const,
      bait: false as const,
      userId: user.id,
      challengeId: randomId(),
      next: extraFactor ? ("twostep" as const) : ("complete" as const),
      hasPasskeys: (user.passkeys?.length ?? 0) > 0,
    };
  });
}
