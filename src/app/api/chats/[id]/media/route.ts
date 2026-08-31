import { json, jsonError } from "@/lib/http";
import { requireActiveUser } from "@/lib/auth";
import { listSharedMedia } from "@/lib/chat";

type Ctx = { params: Promise<{ id: string }> };

export async function GET(_request: Request, ctx: Ctx) {
  const user = await requireActiveUser();
  if (!user) return jsonError("نشست فعال نیست.", 401);
  const { id } = await ctx.params;
  const result = await listSharedMedia(user.id, id);
  if (!result) return jsonError("گفتگو یافت نشد.", 404);
  return json({ ok: true, items: result.items });
}
