import { json, jsonError } from "@/lib/http";
import { requireActiveUser } from "@/lib/auth";
import { sendDmSticker } from "@/lib/stickers";

type Ctx = { params: Promise<{ id: string }> };

export async function POST(request: Request, ctx: Ctx) {
  const user = await requireActiveUser();
  if (!user) return jsonError("نشست فعال نیست.", 401);
  const { id } = await ctx.params;
  const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
  if (!body) return jsonError("درخواست نامعتبر است.");
  const result = await sendDmSticker(user.id, id, String(body.stickerId ?? ""));
  if (!result.ok) return jsonError(result.error, result.status);
  return json({ ok: true, message: result.message });
}
