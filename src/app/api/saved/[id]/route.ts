import { json, jsonError } from "@/lib/http";
import { requireActiveUser } from "@/lib/auth";
import { deleteSaved, getSaved, patchSaved } from "@/lib/saved";

type Ctx = { params: Promise<{ id: string }> };

export async function GET(_req: Request, ctx: Ctx) {
  const user = await requireActiveUser();
  if (!user) return jsonError("نشست فعال نیست.", 401);
  const { id } = await ctx.params;
  const item = await getSaved(user.id, id);
  if (!item) return jsonError("یافت نشد.", 404);
  return json({ ok: true, item });
}

export async function PATCH(request: Request, ctx: Ctx) {
  const user = await requireActiveUser();
  if (!user) return jsonError("نشست فعال نیست.", 401);
  const { id } = await ctx.params;
  const body = (await request.json().catch(() => null)) as { tag?: string; pinned?: boolean } | null;
  const result = await patchSaved(user.id, id, {
    tag: body?.tag,
    pinned: body?.pinned,
  });
  if (!result.ok) return jsonError(result.error, result.status);
  return json({ ok: true, item: result.item });
}

export async function DELETE(_req: Request, ctx: Ctx) {
  const user = await requireActiveUser();
  if (!user) return jsonError("نشست فعال نیست.", 401);
  const { id } = await ctx.params;
  const result = await deleteSaved(user.id, [id]);
  return json(result);
}
