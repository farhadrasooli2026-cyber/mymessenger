import { json, jsonError } from "@/lib/http";
import { requireActiveUser } from "@/lib/auth";
import { searchGroup } from "@/lib/groups";

type Ctx = { params: Promise<{ id: string }> };

export async function GET(request: Request, ctx: Ctx) {
  const user = await requireActiveUser();
  if (!user) return jsonError("نشست فعال نیست.", 401);
  const { id } = await ctx.params;
  const q = new URL(request.url).searchParams.get("q") ?? "";
  const result = await searchGroup(user.id, id, q);
  if (!result) return jsonError("گروه یافت نشد.", 404);
  return json({ ok: true, ...result });
}
