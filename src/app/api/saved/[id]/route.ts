import { json, jsonError } from "@/lib/http";
import { requireActiveUser } from "@/lib/auth";
import { deleteSaved, getSaved, patchSaved, reportSaved, restoreSaved } from "@/lib/saved";

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
  const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
  if (body?.action === "report") {
    const result = await reportSaved(user.id, id, String(body.category ?? "other"));
    if (!result.ok) return jsonError(result.error, result.status);
    return json(result);
  }
  if (body?.action === "restore") {
    return json(await restoreSaved(user.id, [id]));
  }
  const result = await patchSaved(user.id, id, body ?? {});
  if (!result.ok) return jsonError(result.error, result.status, "item" in result ? { item: result.item } : undefined);
  return json({ ok: true, item: result.item });
}

export async function DELETE(request: Request, ctx: Ctx) {
  const user = await requireActiveUser();
  if (!user) return jsonError("نشست فعال نیست.", 401);
  const { id } = await ctx.params;
  const url = new URL(request.url);
  const mode = url.searchParams.get("permanent") === "1" ? "permanent" : "trash";
  const result = await deleteSaved(user.id, [id], mode);
  return json(result);
}
