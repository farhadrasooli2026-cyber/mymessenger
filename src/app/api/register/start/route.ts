import { json, jsonError } from "@/lib/http";
import { startRegistration, startSchema } from "@/lib/registration";
import { consumeHumanCookie } from "@/lib/human-cookie";
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
  const skipHuman = await consumeHumanCookie(parsed.data.humanToken);
  const result = await startRegistration(parsed.data, ipHash, { skipHuman });
  if (!result.ok) {
    return jsonError(result.error, result.status, {
      retryAfterSec: "retryAfterSec" in result ? result.retryAfterSec : undefined,
      reason: "reason" in result ? result.reason : undefined,
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
