import { json, jsonError } from "@/lib/http";
import { requireActiveUser } from "@/lib/auth";
import { deleteGroup, getGroup, leaveGroup, updateGroup } from "@/lib/groups";

type Ctx = { params: Promise<{ id: string }> };

export async function GET(_req: Request, ctx: Ctx) {
  const user = await requireActiveUser();
  if (!user) return jsonError("نشست فعال نیست.", 401);
  const { id } = await ctx.params;
  const result = await getGroup(user.id, id);
  if (!result) return jsonError("گروه یافت نشد.", 404);
  return json({ ok: true, ...result });
}

export async function PATCH(request: Request, ctx: Ctx) {
  const user = await requireActiveUser();
  if (!user) return jsonError("نشست فعال نیست.", 401);
  const { id } = await ctx.params;
  const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
  if (!body) return jsonError("درخواست نامعتبر است.");
  const result = await updateGroup(user.id, id, {
    name: typeof body.name === "string" ? body.name : undefined,
    description: typeof body.description === "string" ? body.description : undefined,
    rules: typeof body.rules === "string" ? body.rules : undefined,
    welcome: typeof body.welcome === "string" ? body.welcome : undefined,
    username: body.username === null || typeof body.username === "string" ? (body.username as string | null) : undefined,
    color: typeof body.color === "string" ? body.color : undefined,
    photoDataUrl: body.photoDataUrl === null || typeof body.photoDataUrl === "string" ? (body.photoDataUrl as string | null) : undefined,
    joinMode: body.joinMode === "open" || body.joinMode === "request" || body.joinMode === "invite" ? body.joinMode : undefined,
    perms: body.perms && typeof body.perms === "object" ? (body.perms as never) : undefined,
    adminPerms: body.adminPerms && typeof body.adminPerms === "object" ? (body.adminPerms as never) : undefined,
    slowModeMs: typeof body.slowModeMs === "number" ? body.slowModeMs : undefined,
    historyMode: body.historyMode === "all" || body.historyMode === "from-join" ? body.historyMode : undefined,
    maxMembers: typeof body.maxMembers === "number" ? body.maxMembers : undefined,
  });
  if (!result.ok) return jsonError(result.error, result.status);
  return json({ ok: true, group: result.group });
}

export async function DELETE(request: Request, ctx: Ctx) {
  const user = await requireActiveUser();
  if (!user) return jsonError("نشست فعال نیست.", 401);
  const { id } = await ctx.params;
  const url = new URL(request.url);
  if (url.searchParams.get("leave") === "1") {
    const result = await leaveGroup(user.id, id);
    if (!result.ok) return jsonError(result.error, result.status);
    return json({ ok: true });
  }
  const result = await deleteGroup(user.id, id);
  if (!result.ok) return jsonError(result.error, result.status);
  return json({ ok: true });
}
