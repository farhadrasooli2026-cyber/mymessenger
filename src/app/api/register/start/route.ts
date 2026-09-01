import { json, jsonError } from "@/lib/http";
import { startRegistration, startSchema } from "@/lib/registration";
import { clientIpHash, writeSession } from "@/lib/session";

export async function POST(request: Request) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return jsonError("درخواست نامعتبر است.");
  }
  const parsed = startSchema.safeParse(body);
  if (!parsed.success) return jsonError("اطلاعات واردشده معتبر نیست.");

  const ipHash = await clientIpHash();
  const result = await startRegistration(parsed.data, ipHash);
  if (!result.ok) {
    const challengeId = "challengeId" in result ? result.challengeId : undefined;
    if (result.status === 502 && typeof challengeId === "string") {
      await writeSession({ step: "verify", challengeId });
    }
    return jsonError(result.error, result.status, {
      retryAfterSec: "retryAfterSec" in result ? result.retryAfterSec : undefined,
    });
  }

  await writeSession({
    step: "verify",
    challengeId: result.challengeId,
  });

  return json({
    ok: true,
    message: result.message,
    cooldownSeconds: result.cooldownSeconds,
    ttlSeconds: result.ttlSeconds,
    masked: result.masked,
    channel: result.channel,
  });
}
