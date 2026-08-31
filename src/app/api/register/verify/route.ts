import { json, jsonError } from "@/lib/http";
import { verifyOtp, verifySchema } from "@/lib/registration";
import { clientIpHash, readSession, writeSession } from "@/lib/session";

export async function POST(request: Request) {
  const session = await readSession();
  if (!session || session.step !== "verify") {
    return jsonError("ابتدا باید شماره یا ایمیل را وارد کنید. رد کردن تأیید ممکن نیست.", 401);
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return jsonError("درخواست نامعتبر است.");
  }
  const parsed = verifySchema.safeParse(body);
  if (!parsed.success) return jsonError("کد تأیید باید ۶ رقم باشد.");

  const ipHash = await clientIpHash();
  const result = await verifyOtp(session.challengeId, parsed.data.code, ipHash);
  if (!result.ok) {
    return jsonError(result.error, result.status, {
      remainingAttempts: "remainingAttempts" in result ? result.remainingAttempts : undefined,
      expired: "expired" in result ? result.expired : undefined,
      retryAfterSec: "retryAfterSec" in result ? result.retryAfterSec : undefined,
    });
  }

  if (result.alreadyActive) {
    await writeSession({
      step: "complete",
      challengeId: session.challengeId,
      userId: result.userId,
    });
    return json({
      ok: true,
      alreadyActive: true,
      next: "/app",
      masked: result.masked,
    });
  }

  await writeSession({
    step: "profile",
    challengeId: session.challengeId,
    userId: result.userId,
  });

  return json({
    ok: true,
    alreadyActive: false,
    next: "profile",
    masked: result.masked,
  });
}
