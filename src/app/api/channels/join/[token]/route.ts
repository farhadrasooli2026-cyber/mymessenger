import { json, jsonError } from "@/lib/http";
import { requireActiveUser } from "@/lib/auth";
import { joinByToken, previewInvite } from "@/lib/channels";

type Ctx = { params: Promise<{ token: string }> };

export async function GET(_req: Request, ctx: Ctx) {
  const { token } = await ctx.params;
  const preview = await previewInvite(token);
  if (!preview) return jsonError("لینک دعوت نامعتبر یا منقضی است.", 404);
  return json({ ok: true, channel: preview });
}

export async function POST(_req: Request, ctx: Ctx) {
  const user = await requireActiveUser();
  if (!user) return jsonError("نشست فعال نیست.", 401);
  const { token } = await ctx.params;
  const result = await joinByToken(user.id, token);
  if (!result.ok) return jsonError(result.error, result.status);
  return json({ ok: true, channel: result.channel });
}
