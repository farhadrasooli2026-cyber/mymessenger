import { json, jsonError } from "@/lib/http";
import { requireActiveUser } from "@/lib/auth";
import { inviteDirect, moderateSubscriber, setNotify, setStaff, subscribe, unsubscribe } from "@/lib/channels";

type Ctx = { params: Promise<{ id: string }> };

export async function POST(request: Request, ctx: Ctx) {
  const user = await requireActiveUser();
  if (!user) return jsonError("نشست فعال نیست.", 401);
  const { id } = await ctx.params;
  const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
  if (!body?.action) return jsonError("درخواست نامعتبر است.");
  if (body.action === "subscribe") {
    const result = await subscribe(user.id, id);
    if (!result.ok) return jsonError(result.error, result.status);
    return json({ ok: true, channel: result.channel });
  }
  if (body.action === "unsubscribe") {
    const result = await unsubscribe(user.id, id);
    if (!result.ok) return jsonError(result.error, result.status);
    return json({ ok: true });
  }
  if (body.action === "notify") {
    const notify = body.notify;
    if (notify !== "on" && notify !== "off" && notify !== "important") return jsonError("حالت اعلان نامعتبر است.");
    const result = await setNotify(user.id, id, notify);
    if (!result.ok) return jsonError(result.error, result.status);
    return json({ ok: true, notify: result.notify });
  }
  if (body.action === "invite") {
    const keys = Array.isArray(body.keys) ? body.keys.map(String) : [];
    const result = await inviteDirect(user.id, id, keys);
    if (!result.ok) return jsonError(result.error, result.status);
    return json({ ok: true, channel: result.channel });
  }
  if (body.action === "staff") {
    const role = body.role === "admin" || body.role === "moderator" || body.role === "none" ? body.role : "none";
    const result = await setStaff(user.id, id, String(body.targetId ?? ""), role);
    if (!result.ok) return jsonError(result.error, result.status);
    return json({ ok: true, channel: result.channel });
  }
  const action = body.action as "remove" | "ban" | "unban";
  const result = await moderateSubscriber(user.id, id, String(body.targetId ?? ""), action);
  if (!result.ok) return jsonError(result.error, result.status);
  return json({ ok: true, channel: result.channel });
}
