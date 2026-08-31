import { json, jsonError } from "@/lib/http";
import { requireActiveUser } from "@/lib/auth";
import { decideRequest } from "@/lib/communities";

type Ctx = { params: Promise<{ id: string }> };

export async function POST(request: Request, ctx: Ctx) {
  const user = await requireActiveUser();
  if (!user) return jsonError("نشست فعال نیست.", 401);
  const { id } = await ctx.params;
  const body = (await request.json().catch(() => null)) as { requestId?: string; approve?: boolean } | null;
  if (!body?.requestId) return jsonError("درخواست نامعتبر است.");
  const result = await decideRequest(user.id, id, body.requestId, Boolean(body.approve));
  if (!result.ok) return jsonError(result.error, result.status);
  return json({ ok: true, community: result.community });
}
