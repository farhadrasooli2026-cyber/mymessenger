import { json, jsonError } from "@/lib/http";
import { requireActiveUser } from "@/lib/auth";
import { inviteDirect, liveChat, listChannelSubscribers, moderateSubscriber, publishChannelStory, setLive, setNotify, setStaff, subscribe, transferChannelOwner, unsubscribe, moderateJoinRequest, exportChannelData, adminChannelLifecycle } from "@/lib/channels";

type Ctx = { params: Promise<{ id: string }> };

export async function GET(request: Request, ctx: Ctx) {
  const user = await requireActiveUser();
  if (!user) return jsonError("نشست فعال نیست.", 401);
  const { id } = await ctx.params;
  const url = new URL(request.url);
  const result = await listChannelSubscribers(user.id, id, url.searchParams.get("q") ?? "", url.searchParams.get("cursor") ?? "");
  if (!result) return jsonError("کانال یافت نشد.", 404);
  if (result.ok === false) return jsonError(result.error, result.status);
  return json(result);
}

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
  if (body.action === "join-approve" || body.action === "join-reject") {
    const result = await moderateJoinRequest(user.id, id, String(body.targetId ?? ""), body.action === "join-approve");
    if (!result.ok) return jsonError(result.error, result.status);
    return json({ ok: true, channel: result.channel });
  }
  if (body.action === "export") {
    const result = await exportChannelData(user.id, id);
    if (!result.ok) return jsonError(result.error, result.status);
    return json({ ok: true, export: result.export });
  }
  if (body.action === "platform") {
    const status = body.status;
    if (status !== "active" && status !== "restricted" && status !== "suspended" && status !== "deleted") {
      return jsonError("وضعیت نامعتبر است.");
    }
    const result = await adminChannelLifecycle(user.id, id, status, { verified: typeof body.verified === "boolean" ? body.verified : undefined });
    if (!result.ok) return jsonError(result.error, result.status);
    return json({ ok: true, status: result.status, verified: result.verified });
  }
  if (body.action === "notify") {
    const notify = body.notify;
    if (notify !== "on" && notify !== "off" && notify !== "important") return jsonError("حالت اعلان نامعتبر است.");
    const result = await setNotify(
      user.id,
      id,
      notify,
      typeof body.ms === "number" ? Date.now() + body.ms : body.ms === null ? null : undefined,
    );
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
    const role = body.role === "admin" || body.role === "editor" || body.role === "moderator" || body.role === "none" ? body.role : "none";
    const result = await setStaff(user.id, id, String(body.targetId ?? ""), role, {
      staffId: typeof body.staffId === "string" ? body.staffId : undefined,
      customRoleId: body.customRoleId === null || typeof body.customRoleId === "string" ? (body.customRoleId as string | null) : undefined,
    });
    if (!result.ok) return jsonError(result.error, result.status);
    return json({ ok: true, channel: result.channel });
  }
  if (body.action === "transfer") {
    const result = await transferChannelOwner(user.id, id, String(body.targetId ?? ""), String(body.confirm ?? ""));
    if (!result.ok) return jsonError(result.error, result.status);
    return json({ ok: true, channel: result.channel });
  }
  if (body.action === "live") {
    const result = await setLive(user.id, id, Boolean(body.active), typeof body.title === "string" ? body.title : undefined, typeof body.chatEnabled === "boolean" ? body.chatEnabled : undefined);
    if (!result.ok) return jsonError(result.error, result.status);
    return json({ ok: true, channel: result.channel });
  }
  if (body.action === "live-chat") {
    const result = await liveChat(user.id, id, String(body.body ?? ""));
    if (!result.ok) return jsonError(result.error, result.status);
    return json({ ok: true, liveChat: result.liveChat });
  }
  if (body.action === "story") {
    const result = await publishChannelStory(user.id, id, String(body.body ?? ""), typeof body.photoDataUrl === "string" ? body.photoDataUrl : null);
    if (!result.ok) return jsonError(result.error, result.status);
    return json({ ok: true, channel: result.channel });
  }
  const action = body.action as "remove" | "ban" | "unban";
  const result = await moderateSubscriber(user.id, id, String(body.targetId ?? ""), action);
  if (!result.ok) return jsonError(result.error, result.status);
  return json({ ok: true, channel: result.channel });
}
