import { json, jsonError } from "@/lib/http";
import { requireActiveUser } from "@/lib/auth";
import { addToGroupCall, getGroupCall, joinGroupCall, moderateGroupCall, setOwnCallMedia } from "@/lib/group-calls";

type Ctx = { params: Promise<{ id: string }> };

export async function GET(_request: Request, ctx: Ctx) {
  const user = await requireActiveUser();
  if (!user) return jsonError("نشست فعال نیست.", 401);
  const { id } = await ctx.params;
  const r = await getGroupCall(user.id, id);
  if (!r.ok) return jsonError(r.error, r.status);
  return json({ ok: true, call: r.call });
}

export async function POST(request: Request, ctx: Ctx) {
  const user = await requireActiveUser();
  if (!user) return jsonError("نشست فعال نیست.", 401);
  const { id } = await ctx.params;
  const body = (await request.json().catch(() => null)) as {
    action?: string;
    targetUserId?: string;
    maxParticipants?: number;
    camOff?: boolean;
    micMuted?: boolean;
  } | null;
  const action = body?.action;
  if (!action) return jsonError("عملیات نامعتبر است.");
  if (action === "join") {
    const r = await joinGroupCall(user.id, id);
    if (!r.ok) return jsonError(r.error, r.status);
    return json({ ok: true, call: r.call });
  }
  if (action === "media") {
    const r = await setOwnCallMedia(user.id, id, { camOff: body?.camOff, micMuted: body?.micMuted });
    if (!r.ok) return jsonError(r.error, r.status);
    return json({ ok: true, call: r.call });
  }
  if (action === "add") {
    if (!body?.targetUserId) return jsonError("عضو مشخص نیست.");
    const r = await addToGroupCall(user.id, id, body.targetUserId);
    if (!r.ok) return jsonError(r.error, r.status);
    return json({ ok: true, call: r.call });
  }
  const mapped =
    action === "revoke-link" ? "revoke" : action === "link" || action === "leave" || action === "end" || action === "kick" || action === "mute" || action === "unmute" || action === "cap" ? action : null;
  if (!mapped) return jsonError("عملیات نامعتبر است.");
  const r = await moderateGroupCall(user.id, id, mapped, {
    targetId: body?.targetUserId,
    maxParticipants: body?.maxParticipants,
  });
  if (!r.ok) return jsonError(r.error, r.status);
  return json({ ok: true, call: r.call });
}
