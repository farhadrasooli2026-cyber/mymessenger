import { json, jsonError } from "@/lib/http";
import { requireActiveUser } from "@/lib/auth";
import { addChannel, attachGroup, detachGroup, removeChannel } from "@/lib/communities";

type Ctx = { params: Promise<{ id: string }> };

export async function POST(request: Request, ctx: Ctx) {
  const user = await requireActiveUser();
  if (!user) return jsonError("نشست فعال نیست.", 401);
  const { id } = await ctx.params;
  const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
  if (!body?.action) return jsonError("درخواست نامعتبر است.");
  if (body.action === "addGroup") {
    const result = await attachGroup(user.id, id, String(body.groupId ?? ""));
    if (!result.ok) return jsonError(result.error, result.status);
    return json({ ok: true, community: result.community });
  }
  if (body.action === "removeGroup") {
    const result = await detachGroup(user.id, id, String(body.groupId ?? ""));
    if (!result.ok) return jsonError(result.error, result.status);
    return json({ ok: true, community: result.community });
  }
  if (body.action === "addChannel") {
    const result = await addChannel(user.id, id, String(body.name ?? ""), typeof body.description === "string" ? body.description : "");
    if (!result.ok) return jsonError(result.error, result.status);
    return json({ ok: true, community: result.community });
  }
  if (body.action === "removeChannel") {
    const result = await removeChannel(user.id, id, String(body.channelId ?? ""));
    if (!result.ok) return jsonError(result.error, result.status);
    return json({ ok: true, community: result.community });
  }
  return jsonError("عملیات نامعتبر است.");
}
