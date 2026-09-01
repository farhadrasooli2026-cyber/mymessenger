import { json, jsonError } from "@/lib/http";
import { requireActiveUser } from "@/lib/auth";
import { listMessages, parseCipherPayload, sendMessage } from "@/lib/chat";

type Ctx = { params: Promise<{ id: string }> };

export async function GET(request: Request, ctx: Ctx) {
  const user = await requireActiveUser();
  if (!user) return jsonError("نشست فعال نیست.", 401);
  const { id } = await ctx.params;
  const url = new URL(request.url);
  const cursor = url.searchParams.get("cursor");
  const sinceRaw = url.searchParams.get("since");
  const limitRaw = url.searchParams.get("limit");
  const since = sinceRaw ? Number(sinceRaw) : undefined;
  const limit = limitRaw ? Number(limitRaw) : undefined;
  const result = await listMessages(user.id, id, {
    cursor,
    since: Number.isFinite(since) ? since : undefined,
    limit: Number.isFinite(limit) ? limit : undefined,
  });
  if (!result) return jsonError("گفتگو یافت نشد.", 404);
  return json({
    ok: true,
    thread: result.thread,
    messages: result.messages,
    nextCursor: result.nextCursor,
    unreadCount: result.unreadCount,
    typing: result.typing,
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
    ack: result.ack,
    duplicate: "duplicate" in result ? result.duplicate : false,
  });
}
