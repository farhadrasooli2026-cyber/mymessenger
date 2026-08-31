import { json, jsonError } from "@/lib/http";
import { requireActiveUser } from "@/lib/auth";
import { listMessages, parseCipherPayload, sendMessage } from "@/lib/chat";

type Ctx = { params: Promise<{ id: string }> };

export async function GET(_request: Request, ctx: Ctx) {
  const user = await requireActiveUser();
  if (!user) return jsonError("نشست فعال نیست.", 401);
  const { id } = await ctx.params;
  const result = await listMessages(user.id, id);
  if (!result) return jsonError("گفتگو یافت نشد.", 404);
  return json({
    ok: true,
    thread: result.thread,
    messages: result.messages,
    blocked: result.blocked,
    blockedByMe: result.blockedByMe,
    blockedByPeer: result.blockedByPeer,
    messagesAllowed: result.messagesAllowed,
    callsAllowed: result.callsAllowed,
    interactionsAllowed: result.interactionsAllowed,
  });
}

export async function POST(request: Request, ctx: Ctx) {
  const user = await requireActiveUser();
  if (!user) return jsonError("نشست فعال نیست.", 401);
  const { id } = await ctx.params;
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return jsonError("درخواست نامعتبر است.");
  }
  const payload = parseCipherPayload(body);
  if (!payload) {
    return jsonError("فقط پاکت رمزنگاری‌شده پذیرفته می‌شود. سرور محتوای صوت یا متن را نمی‌بیند.");
  }
  const result = await sendMessage(user.id, id, payload);
  if (!result.ok) return jsonError(result.error, result.status);
  return json({
    ok: true,
    thread: result.thread,
    messages: result.messages,
    messagesAllowed: result.messagesAllowed,
  });
}
