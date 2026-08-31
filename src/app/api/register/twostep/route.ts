import { json, jsonError } from "@/lib/http";
import { requireTwoStepPending } from "@/lib/auth";
import { issuePasskeyChallenge, verifySecondFactor } from "@/lib/security";
import { clientIp, establishCompleteSession } from "@/lib/session";

export async function GET() {
  const pending = await requireTwoStepPending();
  if (!pending) return jsonError("نشست رمز دومرحله‌ای معتبر نیست.", 401);
  const challenge = await issuePasskeyChallenge(pending.user.id, "login");
  return json({
    ok: true,
    hasPasskeys: (pending.user.passkeys?.length ?? 0) > 0,
    recoveryLeft: pending.user.recoveryCodeHashes?.length ?? 0,
    challengeId: challenge.challengeId,
    challenge: challenge.challenge,
    rpId: challenge.rpId,
    allowCredentials: challenge.allowCredentials,
  });
}

export async function POST(request: Request) {
  const pending = await requireTwoStepPending();
  if (!pending) return jsonError("نشست رمز دومرحله‌ای معتبر نیست.", 401);
  const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
  if (!body) return jsonError("درخواست نامعتبر است.");
  const ip = await clientIp();
  const result = await verifySecondFactor(pending.user.id, ip, {
    password: typeof body.password === "string" ? body.password : undefined,
    recovery: typeof body.recovery === "string" ? body.recovery : undefined,
    credentialId: typeof body.credentialId === "string" ? body.credentialId : undefined,
    clientDataJSON: typeof body.clientDataJSON === "string" ? body.clientDataJSON : undefined,
    challengeId: typeof body.challengeId === "string" ? body.challengeId : undefined,
  });
  if (!result.ok) return jsonError(result.error, result.status, { retryAfterSec: "retryAfterSec" in result ? result.retryAfterSec : undefined });
  const established = await establishCompleteSession({
    userId: pending.user.id,
    challengeId: pending.session.challengeId,
    recovery: pending.session.purpose === "recovery",
  });
  const recovered = pending.session.purpose === "recovery";
  return json({
    ok: true,
    via: result.via,
    recovered,
    next: established.pending ? "/device" : recovered ? "/app/settings/security?recovered=1" : "/app",
  });
}
