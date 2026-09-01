import { json, jsonError } from "@/lib/http";
import { requireActiveUser } from "@/lib/auth";
import { deleteStory, editStory, forwardStory, listViewers, reactStory, replyStory, restoreStory, viewUserStory } from "@/lib/stories";

type Ctx = { params: Promise<{ id: string }> };

export async function GET(_req: Request, ctx: Ctx) {
  const user = await requireActiveUser();
  if (!user) return jsonError("نشست فعال نیست.", 401);
  const { id } = await ctx.params;
  const result = await listViewers(user.id, id);
  if (!result.ok) return jsonError(result.error, result.status);
  return json({ ok: true, viewers: result.viewers, reactions: result.reactions, replies: result.replies, analytics: result.analytics });
}

export async function POST(request: Request, ctx: Ctx) {
  const user = await requireActiveUser();
  if (!user) return jsonError("نشست فعال نیست.", 401);
  const { id } = await ctx.params;
  const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
  const action = body?.action ?? "view";
  if (action === "view") {
    const result = await viewUserStory(user.id, id, { completed: body?.completed === true });
    if (!result.ok) return jsonError(result.error, result.status);
    return json({ ok: true });
  }
  if (action === "react") {
    const result = await reactStory(user.id, id, String(body?.emoji ?? "❤️"));
    if (!result.ok) return jsonError(result.error, result.status);
    return json({ ok: true });
  }
  if (action === "reply") {
    const result = await replyStory(user.id, id, String(body?.body ?? ""));
    if (!result.ok) return jsonError(result.error, result.status);
    return json({ ok: true });
  }
  if (action === "forward") {
    const result = await forwardStory(user.id, id, String(body?.toUserId ?? ""));
    if (!result.ok) return jsonError(result.error, result.status);
    return json({ ok: true });
  }
  if (action === "restore") {
    const result = await restoreStory(user.id, id);
    if (!result.ok) return jsonError(result.error, result.status);
    return json({ ok: true, story: result.story });
  }
  return jsonError("عملیات نامعتبر است.");
}

export async function PATCH(request: Request, ctx: Ctx) {
  const user = await requireActiveUser();
  if (!user) return jsonError("نشست فعال نیست.", 401);
  const { id } = await ctx.params;
  const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
  if (!body) return jsonError("درخواست نامعتبر است.");
  const result = await editStory(user.id, id, {
    caption: typeof body.caption === "string" ? body.caption : undefined,
    body: typeof body.body === "string" ? body.body : undefined,
    visibility:
      body.visibility === "contacts" ||
      body.visibility === "friends" ||
      body.visibility === "closeFriends" ||
      body.visibility === "selected" ||
      body.visibility === "nobody" ||
      body.visibility === "everyone"
        ? body.visibility
        : undefined,
    allowShare: typeof body.allowShare === "boolean" ? body.allowShare : undefined,
    allowReplies: typeof body.allowReplies === "boolean" ? body.allowReplies : undefined,
    allowReactions: typeof body.allowReactions === "boolean" ? body.allowReactions : undefined,
    hideFromIds: Array.isArray(body.hideFromIds) ? body.hideFromIds.map(String) : undefined,
    allowIds: Array.isArray(body.allowIds) ? body.allowIds.map(String) : undefined,
  });
  if (!result.ok) return jsonError(result.error, result.status);
  return json({ ok: true, story: result.story });
}

export async function DELETE(_req: Request, ctx: Ctx) {
  const user = await requireActiveUser();
  if (!user) return jsonError("نشست فعال نیست.", 401);
  const { id } = await ctx.params;
  const result = await deleteStory(user.id, id);
  if (!result.ok) return jsonError(result.error, result.status);
  return json({ ok: true });
}
