import { json, jsonError } from "@/lib/http";
import { requireActiveUser } from "@/lib/auth";
import { reportCapture } from "@/lib/chat";

type Ctx = { params: Promise<{ id: string; messageId: string }> };

export async function POST(_request: Request, ctx: Ctx) {
  const user = await requireActiveUser();
  if (!user) return jsonError("نشست فعال نیست.", 401);
  const { id, messageId } = await ctx.params;
  const result = await reportCapture(user.id, id, messageId);
  if (!result.ok) return jsonError(result.error, result.status);
  return json({ ok: true, captureCount: result.captureCount });
}
