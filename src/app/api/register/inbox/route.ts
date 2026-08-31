import { config } from "@/lib/config";
import { json, jsonError } from "@/lib/http";
import { readInbox } from "@/lib/registration";
import { readSession } from "@/lib/session";

export async function GET() {
  if (!config.demoInbox) {
    return jsonError("صندوق آزمایشی در این محیط غیرفعال است.", 404);
  }
  const session = await readSession();
  if (!session || (session.step !== "verify" && session.step !== "profile")) {
    return jsonError("نشست تأیید یافت نشد.", 401);
  }
  const item = await readInbox(session.challengeId);
  if (!item) {
    return json({ ok: true, message: null });
  }
  return json({
    ok: true,
    message: {
      channel: item.channel,
      maskedTo: item.maskedTo,
      body: item.body,
      createdAt: item.createdAt,
    },
  });
}
