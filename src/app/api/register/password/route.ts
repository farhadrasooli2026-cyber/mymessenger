import { json, jsonError } from "@/lib/http";
import { loginWithPassword, passwordLoginSchema } from "@/lib/password-login";
import { clientIpHash, establishCompleteSession, writeSession } from "@/lib/session";

export async function POST(request: Request) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return jsonError("درخواست نامعتبر است.");
  }
  const parsed = passwordLoginSchema.safeParse(body);
  if (!parsed.success) return jsonError("اطلاعات واردشده معتبر نیست.");

  const ipHash = await clientIpHash();
  const result = await loginWithPassword(parsed.data, ipHash);
  if (!result.ok) {
    return jsonError(result.error, result.status, {
      retryAfterSec: "retryAfterSec" in result ? result.retryAfterSec : undefined,
    });
  }

  if (result.bait) {
    return json({ ok: true, next: "/app" });
  }

  if (result.next === "twostep") {
    await writeSession({
      step: "twostep",
      challengeId: result.challengeId,
      userId: result.userId,
    });
    return json({
      ok: true,
      next: "twostep",
      hasPasskeys: result.hasPasskeys,
    });
  }

  const established = await establishCompleteSession({
    userId: result.userId,
    challengeId: result.challengeId,
  });
  return json({
    ok: true,
    next: established.pending ? "/device" : "/app",
    newLogin: established.pending,
  });
}
