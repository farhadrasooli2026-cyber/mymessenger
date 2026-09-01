import { json, jsonError } from "@/lib/http";
import { requireActiveUser } from "@/lib/auth";
import { markAllDirectRead, markThreadRead } from "@/lib/chat";

type Ctx = { params: Promise<{ id: string }> };

export async function POST(request: Request, ctx: Ctx) {
  const user = await requireActiveUser();
  if (!user) return jsonError("نشست فعال نیست.", 401);
  const { id } = await ctx.params;
  const body = (await request.json().catch(() => null)) as { upTo?: number; all?: boolean } | null;
  if (body?.all) {
    const result = await markAllDirectRead(user.id);
    return json(result);
  }
  const result = await markThreadRead(user.id, id, body?.upTo);
  if (!result.ok) return jsonError(result.error, result.status);
  return json({ ok: true, marked: result.marked });
}
