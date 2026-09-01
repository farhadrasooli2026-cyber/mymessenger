import "server-only";
import { randomId } from "@/lib/crypto-utils";
import type { StoreData } from "@/lib/store";

const KEEP = 4000;

export function appendCallEvent(
  data: StoreData,
  input: { userId: string; callId: string; kind: string; detail?: string },
) {
  data.callEvents ??= [];
  data.callEvents.push({
    id: randomId(),
    userId: input.userId,
    callId: input.callId,
    kind: input.kind.slice(0, 40),
    at: Date.now(),
    detail: input.detail ? input.detail.replace(/v=0|a=candidate|sdp/gi, "").slice(0, 80) : undefined,
  });
  if (data.callEvents.length > KEEP) data.callEvents = data.callEvents.slice(-KEEP);
}
