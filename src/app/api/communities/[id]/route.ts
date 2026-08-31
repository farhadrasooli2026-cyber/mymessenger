import { json, jsonError } from "@/lib/http";
import { requireActiveUser } from "@/lib/auth";
import { deleteCommunity, getCommunity, leaveCommunity, updateCommunity } from "@/lib/communities";
import type { CommunityPerms } from "@/lib/community-types";

type Ctx = { params: Promise<{ id: string }> };

export async function GET(_req: Request, ctx: Ctx) {
  const user = await requireActiveUser();
  if (!user) return jsonError("نشست فعال نیست.", 401);
  const { id } = await ctx.params;
  const result = await getCommunity(user.id, id);
  if (!result) return jsonError("جامعه یافت نشد.", 404);
  return json({ ok: true, ...result });
}

export async function PATCH(request: Request, ctx: Ctx) {
  const user = await requireActiveUser();
  if (!user) return jsonError("نشست فعال نیست.", 401);
  const { id } = await ctx.params;
  const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
  if (!body) return jsonError("درخواست نامعتبر است.");
  const result = await updateCommunity(user.id, id, {
    name: typeof body.name === "string" ? body.name : undefined,
    description: typeof body.description === "string" ? body.description : undefined,
    rules: typeof body.rules === "string" ? body.rules : undefined,
    username: body.username === null || typeof body.username === "string" ? (body.username as string | null) : undefined,
    color: typeof body.color === "string" ? body.color : undefined,
    joinMode: body.joinMode === "open" || body.joinMode === "request" || body.joinMode === "invite" ? body.joinMode : undefined,
    perms: body.perms && typeof body.perms === "object" ? (body.perms as CommunityPerms) : undefined,
  });
  if (!result.ok) return jsonError(result.error, result.status);
  return json({ ok: true, community: result.community });
}

export async function DELETE(request: Request, ctx: Ctx) {
  const user = await requireActiveUser();
  if (!user) return jsonError("نشست فعال نیست.", 401);
  const { id } = await ctx.params;
  const url = new URL(request.url);
  if (url.searchParams.get("leave") === "1") {
    const result = await leaveCommunity(user.id, id);
    if (!result.ok) return jsonError(result.error, result.status);
    return json({ ok: true });
  }
  const result = await deleteCommunity(user.id, id);
  if (!result.ok) return jsonError(result.error, result.status);
  return json({ ok: true });
}
