import { json, jsonError } from "@/lib/http";
import { requireActiveUser } from "@/lib/auth";
import { getPublicByUsername, subscribe } from "@/lib/channels";

type Ctx = { params: Promise<{ username: string }> };

export async function GET(_req: Request, ctx: Ctx) {
  const user = await requireActiveUser();
  const { username } = await ctx.params;
  const result = await getPublicByUsername(username, user?.id ?? null);
  if (!result) return jsonError("کانال عمومی یافت نشد.", 404);
  return json({ ok: true, ...result });
}

export async function POST(_req: Request, ctx: Ctx) {
  const user = await requireActiveUser();
  if (!user) return jsonError("نشست فعال نیست.", 401);
  const { username } = await ctx.params;
  const listed = await getPublicByUsername(username, user.id);
  if (!listed) return jsonError("کانال عمومی یافت نشد.", 404);
  const result = await subscribe(user.id, listed.channel.id);
  if (!result.ok) return jsonError(result.error, result.status);
  return json({ ok: true, channel: result.channel });
}
