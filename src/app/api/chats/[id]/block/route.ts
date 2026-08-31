import { z } from "zod";
import { json, jsonError } from "@/lib/http";
import { requireActiveUser } from "@/lib/auth";
import { setBlocked } from "@/lib/safety";

type Ctx = { params: Promise<{ id: string }> };

const schema = z.object({ blocked: z.boolean() });

export async function POST(request: Request, ctx: Ctx) {
  const user = await requireActiveUser();
  if (!user) return jsonError("نشست فعال نیست.", 401);
  const { id } = await ctx.params;
  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return jsonError("درخواست نامعتبر است.");
  const result = await setBlocked(user.id, id, parsed.data.blocked);
  if (!result.ok) return jsonError(result.error, result.status);
  return json({
    ok: true,
    blocked: result.blocked,
    blockedByMe: result.blockedByMe,
    messagesAllowed: result.messagesAllowed,
    callsAllowed: result.callsAllowed,
    interactionsAllowed: result.interactionsAllowed,
  });
}
