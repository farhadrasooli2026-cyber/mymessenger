import { json, jsonError } from "@/lib/http";
import { requireActiveUser } from "@/lib/auth";
import { deleteGroupMessage, editGroupMessage, pinMessage, reactToMessage, votePoll } from "@/lib/groups";

type Ctx = { params: Promise<{ id: string; messageId: string }> };

export async function POST(request: Request, ctx: Ctx) {
  const user = await requireActiveUser();
  if (!user) return jsonError("نشست فعال نیست.", 401);
  const { id, messageId } = await ctx.params;
  const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
  const action = body?.action;
  if (action === "react") {
    const result = await reactToMessage(user.id, id, messageId, String(body?.emoji ?? "❤️"));
    if (!result.ok) return jsonError(result.error, result.status);
    return json({ ok: true, reactions: result.reactions });
  }
  if (action === "vote") {
    const indexes = Array.isArray(body?.indexes) ? body!.indexes.map(Number) : [];
    const result = await votePoll(user.id, id, messageId, indexes);
    if (!result.ok) return jsonError(result.error, result.status);
    return json({ ok: true, poll: result.poll });
  }
  if (action === "pin" || action === "unpin") {
    const result = await pinMessage(user.id, id, messageId, action === "pin");
    if (!result.ok) return jsonError(result.error, result.status);
    return json({ ok: true, pinIds: result.pinIds });
  }
  if (action === "delete") {
    const result = await deleteGroupMessage(user.id, id, messageId);
    if (!result.ok) return jsonError(result.error, result.status);
    return json({ ok: true });
  }
  if (action === "edit") {
    const result = await editGroupMessage(user.id, id, messageId, {
      ciphertext: typeof body?.ciphertext === "string" ? body.ciphertext : undefined,
      nonce: typeof body?.nonce === "string" ? body.nonce : undefined,
    });
    if (!result.ok) return jsonError(result.error, result.status);
    return json({ ok: true, message: result.message });
  }
  return jsonError("عملیات نامعتبر است.");
}
