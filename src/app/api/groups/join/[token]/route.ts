import { json, jsonError } from "@/lib/http";
import { requireActiveUser } from "@/lib/auth";
import { joinByToken, previewInvite } from "@/lib/groups";

type Ctx = { params: Promise<{ token: string }> };

export async function GET(_req: Request, ctx: Ctx) {
  const { token } = await ctx.params;
  const preview = await previewInvite(token);
  if (!preview) return jsonError("لینک دعوت نامعتبر یا باطل است.", 404);
  return json({ ok: true, group: preview });
}

export async function POST(_req: Request, ctx: Ctx) {
  const user = await requireActiveUser();
  if (!user) return jsonError("نشست فعال نیست.", 401);
  const { token } = await ctx.params;
  const result = await joinByToken(user.id, token);
  if (!result.ok) return jsonError(result.error, result.status);
  return json({ ok: true, pending: "pending" in result ? result.pending : undefined, already: "already" in result ? result.already : undefined, group: "group" in result ? result.group : undefined });
}
