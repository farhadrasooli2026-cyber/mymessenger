import { json, jsonError } from "@/lib/http";
import { handlePayWebhook } from "@/lib/shop";
import { hitRateLimit } from "@/lib/rate-limit";
import { mutateStore } from "@/lib/store";

export async function POST(request: Request) {
  const raw = await request.text();
  const sig = request.headers.get("x-nixo-pay-signature") ?? "";
  const limited = await mutateStore((data) => {
    const r = hitRateLimit(data, "pay-webhook", 60_000, 40);
    return r.allowed;
  });
  if (!limited) return jsonError("سقف Webhook.", 429);
  const result = await handlePayWebhook(raw, sig);
  if (!result.ok) return jsonError(result.error, result.status);
  return json(result);
}
