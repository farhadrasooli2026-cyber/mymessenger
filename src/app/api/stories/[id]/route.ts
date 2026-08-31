import { json, jsonError } from "@/lib/http";
import { requireActiveUser } from "@/lib/auth";
import { deleteStory, listViewers, reactStory, replyStory, viewUserStory } from "@/lib/stories";

type Ctx = { params: Promise<{ id: string }> };

export async function GET(_req: Request, ctx: Ctx) {
  const user = await requireActiveUser();
  if (!user) return jsonError("نشست فعال نیست.", 401);
  const { id } = await ctx.params;
  const result = await listViewers(user.id, id);
  if (!result.ok) return jsonError(result.error, result.status);
  return json({ ok: true, viewers: result.viewers, reactions: result.reactions, replies: result.replies });
}

export async function POST(request: Request, ctx: Ctx) {
  const user = await requireActiveUser();
  if (!user) return jsonError("نشست فعال نیست.", 401);
  const { id } = await ctx.params;
  const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
  const action = body?.action ?? "view";
  if (action === "view") {
    const result = await viewUserStory(user.id, id);
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
  return jsonError("عملیات نامعتبر است.");
}

export async function DELETE(_req: Request, ctx: Ctx) {
  const user = await requireActiveUser();
  if (!user) return jsonError("نشست فعال نیست.", 401);
  const { id } = await ctx.params;
  const result = await deleteStory(user.id, id);
  if (!result.ok) return jsonError(result.error, result.status);
  return json({ ok: true });
}
