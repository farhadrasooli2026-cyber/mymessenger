import { json, jsonError } from "@/lib/http";
import { requireActiveUser } from "@/lib/auth";
import { searchCommunity } from "@/lib/communities";

type Ctx = { params: Promise<{ id: string }> };

export async function GET(request: Request, ctx: Ctx) {
  const user = await requireActiveUser();
  if (!user) return jsonError("نشست فعال نیست.", 401);
  const { id } = await ctx.params;
  const q = new URL(request.url).searchParams.get("q") ?? "";
  const result = await searchCommunity(user.id, id, q);
  if (!result) return jsonError("جامعه یافت نشد.", 404);
  return json({ ok: true, ...result });
}
