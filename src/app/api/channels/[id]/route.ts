import { json, jsonError } from "@/lib/http";
import { requireActiveUser } from "@/lib/auth";
import { deleteChannel, getChannel, updateChannel } from "@/lib/channels";
import type { ChannelAdminPerms } from "@/lib/channel-types";

type Ctx = { params: Promise<{ id: string }> };

export async function GET(_req: Request, ctx: Ctx) {
  const user = await requireActiveUser();
  if (!user) return jsonError("نشست فعال نیست.", 401);
  const { id } = await ctx.params;
  const result = await getChannel(user.id, id);
  if (!result) return jsonError("کانال یافت نشد.", 404);
  return json({ ok: true, ...result });
}

export async function PATCH(request: Request, ctx: Ctx) {
  const user = await requireActiveUser();
  if (!user) return jsonError("نشست فعال نیست.", 401);
  const { id } = await ctx.params;
  const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
  if (!body) return jsonError("درخواست نامعتبر است.");
  const result = await updateChannel(user.id, id, {
    name: typeof body.name === "string" ? body.name : undefined,
    description: typeof body.description === "string" ? body.description : undefined,
    color: typeof body.color === "string" ? body.color : undefined,
    username: body.username === null || typeof body.username === "string" ? (body.username as string | null) : undefined,
    visibility: body.visibility === "private" || body.visibility === "public" ? body.visibility : undefined,
    commentsEnabled: typeof body.commentsEnabled === "boolean" ? body.commentsEnabled : undefined,
    reactionsEnabled: typeof body.reactionsEnabled === "boolean" ? body.reactionsEnabled : undefined,
    allowForward: typeof body.allowForward === "boolean" ? body.allowForward : undefined,
    allowCopy: typeof body.allowCopy === "boolean" ? body.allowCopy : undefined,
    discussionGroupId: body.discussionGroupId === null || typeof body.discussionGroupId === "string" ? (body.discussionGroupId as string | null) : undefined,
    adminPerms: body.adminPerms && typeof body.adminPerms === "object" ? (body.adminPerms as ChannelAdminPerms) : undefined,
    photoDataUrl: body.photoDataUrl === null || typeof body.photoDataUrl === "string" ? (body.photoDataUrl as string | null) : undefined,
    rules: typeof body.rules === "string" ? body.rules : undefined,
    purpose:
      body.purpose === "news" ||
      body.purpose === "products" ||
      body.purpose === "promotions" ||
      body.purpose === "announcements" ||
      body.purpose === "general"
        ? body.purpose
        : undefined,
  });
  if (!result.ok) return jsonError(result.error, result.status);
  return json({ ok: true, channel: result.channel });
}

export async function DELETE(_req: Request, ctx: Ctx) {
  const user = await requireActiveUser();
  if (!user) return jsonError("نشست فعال نیست.", 401);
  const { id } = await ctx.params;
  const result = await deleteChannel(user.id, id);
  if (!result.ok) return jsonError(result.error, result.status);
  return json({ ok: true });
}
