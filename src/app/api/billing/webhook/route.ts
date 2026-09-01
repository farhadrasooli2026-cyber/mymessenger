import { json, jsonError } from "@/lib/http";
import { handleBillingWebhook } from "@/lib/billing";
import { hitRateLimit } from "@/lib/rate-limit";
import { mutateStore } from "@/lib/store";

export async function POST(request: Request) {
  const raw = await request.text();
  const sig = request.headers.get("x-nixo-billing-signature") ?? "";
  const limited = await mutateStore((data) => hitRateLimit(data, "bill-webhook", 60_000, 40).allowed);
  if (!limited) return jsonError("سقف Webhook.", 429);
  const result = await handleBillingWebhook(raw, sig);
  if (!result.ok) return jsonError(result.error, result.status);
  return json(result);
}
