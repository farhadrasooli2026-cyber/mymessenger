import { json, jsonError } from "@/lib/http";
import { requireActiveUser } from "@/lib/auth";
import { cancelJoinRequest, decideRequest } from "@/lib/groups";

type Ctx = { params: Promise<{ id: string }> };

export async function POST(request: Request, ctx: Ctx) {
  const user = await requireActiveUser();
  if (!user) return jsonError("نشست فعال نیست.", 401);
  const { id } = await ctx.params;
  const body = (await request.json().catch(() => null)) as { requestId?: string; approve?: boolean; cancel?: boolean } | null;
  if (body?.cancel) {
    const result = await cancelJoinRequest(user.id, id, body.requestId);
    if (!result.ok) return jsonError(result.error, result.status);
    return json({ ok: true });
  }
  if (!body?.requestId) return jsonError("درخواست نامعتبر است.");
  const result = await decideRequest(user.id, id, body.requestId, Boolean(body.approve));
  if (!result.ok) return jsonError(result.error, result.status);
  return json({ ok: true, group: result.group });
}
