import { json, jsonError } from "@/lib/http";
import { requireActiveUser } from "@/lib/auth";
import { reactOnDm } from "@/lib/stickers";

type Ctx = { params: Promise<{ id: string }> };

export async function POST(request: Request, ctx: Ctx) {
  const user = await requireActiveUser();
  if (!user) return jsonError("نشست فعال نیست.", 401);
  const { id } = await ctx.params;
  const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
  if (!body) return jsonError("درخواست نامعتبر است.");
  const result = await reactOnDm(user.id, id, String(body.messageId ?? ""), String(body.emoji ?? ""));
  if (!result.ok) return jsonError(result.error, result.status);
  return json({ ok: true, reactions: result.reactions, action: result.action });
}
