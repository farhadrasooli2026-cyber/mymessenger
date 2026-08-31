import { json, jsonError } from "@/lib/http";
import { resendOtp } from "@/lib/registration";
import { clientIpHash, readSession } from "@/lib/session";

export async function POST() {
  const session = await readSession();
  if (!session || session.step !== "verify") {
    return jsonError("نشست تأیید معتبر نیست. ثبت‌نام را از ابتدا شروع کنید.", 401);
  }
  const ipHash = await clientIpHash();
  const result = await resendOtp(session.challengeId, ipHash);
  if (!result.ok) {
    return jsonError(result.error, result.status, {
      retryAfterSec: "retryAfterSec" in result ? result.retryAfterSec : undefined,
    });
  }
  return json({
    ok: true,
    message: result.message,
    cooldownSeconds: result.cooldownSeconds,
    ttlSeconds: result.ttlSeconds,
  });
}
