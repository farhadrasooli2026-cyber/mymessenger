import { json, jsonError } from "@/lib/http";
import { requireActiveUser } from "@/lib/auth";
import { actOnCall, refuseCallRecording } from "@/lib/calls";

type Ctx = { params: Promise<{ id: string }> };

export async function POST(request: Request, ctx: Ctx) {
  const user = await requireActiveUser();
  if (!user) return jsonError("نشست فعال نیست.", 401);
  const { id } = await ctx.params;
  const body = (await request.json().catch(() => null)) as { action?: string } | null;
  const action = body?.action;
  if (action === "record" || action === "recording" || action === "start-recording") {
    const refused = refuseCallRecording();
    return jsonError(refused.error, refused.status);
  }
  if (
    action !== "accept" &&
    action !== "connect" &&
    action !== "decline" &&
    action !== "end" &&
    action !== "message-decline" &&
    action !== "end-current-accept" &&
    action !== "cancel" &&
    action !== "fail" &&
    action !== "reconnect"
  ) {
    return jsonError("عملیات نامعتبر است.");
  }
  const result = await actOnCall(user.id, id, action);
  if (!result.ok) return jsonError(result.error, result.status);
  return json({ ok: true, call: result.call });
}
