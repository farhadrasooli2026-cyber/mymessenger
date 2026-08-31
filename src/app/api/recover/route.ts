import { json, jsonError } from "@/lib/http";
import { recoverStartSchema, startRecovery, verifyRecovery } from "@/lib/recover";
import { clientIpHash, establishCompleteSession, readSession, writeSession } from "@/lib/session";
import { userNeedsTwoStep } from "@/lib/security";
import { getUserById } from "@/lib/registration";

export async function POST(request: Request) {
  const url = new URL(request.url);
  const phase = url.searchParams.get("phase") ?? "start";

  if (phase === "start") {
    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return jsonError("درخواست نامعتبر است.");
    }
    const parsed = recoverStartSchema.safeParse(body);
    if (!parsed.success) return jsonError("اطلاعات واردشده معتبر نیست.");
    const ipHash = await clientIpHash();
    const result = await startRecovery(parsed.data, ipHash);
    if (!result.ok) return jsonError(result.error, result.status, { retryAfterSec: "retryAfterSec" in result ? result.retryAfterSec : undefined });
    await writeSession({
      step: "recover",
      challengeId: result.challengeId,
      purpose: "recovery",
    });
    return json({
      ok: true,
      message: result.message,
      masked: result.masked,
      channel: result.channel,
      cooldownSeconds: result.cooldownSeconds,
      ttlSeconds: result.ttlSeconds,
    });
  }

  if (phase === "verify") {
    const session = await readSession();
    if (!session || session.step !== "recover" || session.purpose !== "recovery") {
      return jsonError("ابتدا شناسه را وارد کنید. بازیابی Verification را دور نمی‌زند.", 401);
    }
    const body = (await request.json().catch(() => null)) as { code?: string } | null;
    const code = body?.code ?? "";
    if (!/^\d{6}$/.test(code)) return jsonError("کد تأیید باید ۶ رقم باشد.");
    const ipHash = await clientIpHash();
    const result = await verifyRecovery(session.challengeId, code, ipHash);
    if (!result.ok) return jsonError(result.error, result.status, { remainingAttempts: "remainingAttempts" in result ? result.remainingAttempts : undefined });
    const user = await getUserById(result.userId);
    if (userNeedsTwoStep(user) || result.twoStep) {
      await writeSession({
        step: "twostep",
        challengeId: session.challengeId,
        userId: result.userId,
        purpose: "recovery",
      });
      return json({ ok: true, next: "twostep", hasPasskeys: result.hasPasskeys, masked: result.masked });
    }
    const established = await establishCompleteSession({
      userId: result.userId,
      challengeId: session.challengeId,
      recovery: true,
    });
    return json({
      ok: true,
      next: established.pending ? "/device" : "/app/settings/security?recovered=1",
      recovered: true,
    });
  }

  return jsonError("مرحله نامعتبر است.");
}
