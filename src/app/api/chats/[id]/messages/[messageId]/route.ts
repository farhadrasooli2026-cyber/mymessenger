import { z } from "zod";
import { json, jsonError } from "@/lib/http";
import { requireActiveUser } from "@/lib/auth";
import { deleteMessage } from "@/lib/chat";

type Ctx = { params: Promise<{ id: string; messageId: string }> };

const schema = z.object({ scope: z.enum(["me", "everyone"]) });

export async function DELETE(request: Request, ctx: Ctx) {
  const user = await requireActiveUser();
  if (!user) return jsonError("نشست فعال نیست.", 401);
  const { id, messageId } = await ctx.params;
  const parsed = schema.safeParse(await request.json().catch(() => ({ scope: "me" })));
  if (!parsed.success) return jsonError("حذف نامعتبر است.");
  const result = await deleteMessage(user.id, id, messageId, parsed.data.scope);
  if (!result.ok) return jsonError(result.error, result.status);
  return json({ ok: true });
}
