import { json, jsonError } from "@/lib/http";
import { requireActiveUser } from "@/lib/auth";
import { syncChannel } from "@/lib/channels";

type Ctx = { params: Promise<{ id: string }> };

export async function GET(request: Request, ctx: Ctx) {
  const user = await requireActiveUser();
  if (!user) return jsonError("نشست فعال نیست.", 401);
  const { id } = await ctx.params;
  const since = Number(new URL(request.url).searchParams.get("since") ?? "0") || 0;
  const result = await syncChannel(user.id, id, since);
  if (!result) return jsonError("کانال یافت نشد.", 404);
  return json({ ok: true, ...result });
}
