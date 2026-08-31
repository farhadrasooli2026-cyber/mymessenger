import { json, jsonError } from "@/lib/http";
import { requireActiveUser } from "@/lib/auth";
import {
  adminAssist,
  aiSendSchema,
  createAiChat,
  deleteAiHistory,
  deleteAiMemory,
  getAiWorkspace,
  listAiMessages,
  sendAiMessage,
  setAiFeedback,
  setChatModel,
  stopLast,
  updateAiPrefs,
} from "@/lib/ai";
import { saveItem } from "@/lib/saved";
import type { AiModelId, AiTopic } from "@/lib/ai-types";

export async function GET(request: Request) {
  const user = await requireActiveUser();
  if (!user) return jsonError("نشست فعال نیست.", 401);
  const url = new URL(request.url);
  const chatId = url.searchParams.get("chatId");
  if (chatId) {
    const row = await listAiMessages(user.id, chatId);
    if (!row) return jsonError("گفتگوی AI یافت نشد.", 404);
    return json({ ok: true, ...row });
  }
  const ws = await getAiWorkspace(user.id);
  return json({ ok: true, ...ws });
}

export async function POST(request: Request) {
  const user = await requireActiveUser();
  if (!user) return jsonError("نشست فعال نیست.", 401);
  const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
  if (!body || typeof body.action !== "string") return jsonError("درخواست نامعتبر است.");

  if (body.action === "new") {
    const topic = (body.topic as AiTopic) || "general";
    const result = await createAiChat(user.id, topic);
    return json(result);
  }
  if (body.action === "send") {
    const parsed = aiSendSchema.safeParse(body);
    if (!parsed.success) return jsonError("متن نامعتبر است.");
    const result = await sendAiMessage(user.id, parsed.data);
    if (!result.ok) return jsonError(result.error, result.status, { retryAfterSec: "retryAfterSec" in result ? result.retryAfterSec : undefined });
    return json(result);
  }
  if (body.action === "regenerate") {
    const parsed = aiSendSchema.safeParse({ ...body, text: String(body.text ?? "Regenerate") });
    if (!parsed.success) return jsonError("متن نامعتبر است.");
    const result = await sendAiMessage(user.id, { ...parsed.data, text: `Regenerate:\n${parsed.data.text}` });
    if (!result.ok) return jsonError(result.error, result.status);
    return json(result);
  }
  if (body.action === "stop") {
    const result = await stopLast(user.id, String(body.chatId ?? ""));
    if (!result.ok) return jsonError(result.error, result.status);
    return json(result);
  }
  if (body.action === "feedback") {
    const fb = body.feedback === "up" || body.feedback === "down" ? body.feedback : null;
    const result = await setAiFeedback(user.id, String(body.messageId ?? ""), fb);
    if (!result.ok) return jsonError(result.error, result.status);
    return json(result);
  }
  if (body.action === "save") {
    const result = await saveItem(user.id, {
      kind: "text",
      body: String(body.text ?? ""),
      tag: "Personal",
      source: { type: "manual", id: "nixo-ai", name: "NIXO AI" },
    });
    return json(result);
  }
  if (body.action === "prefs") {
    const result = await updateAiPrefs(user.id, body as Record<string, never>);
    if (!result.ok) return jsonError("ذخیره نشد.");
    return json(result);
  }
  if (body.action === "delete-history") {
    if (body.confirm !== true) return jsonError("تأیید لازم است.");
    return json(await deleteAiHistory(user.id));
  }
  if (body.action === "delete-memory") {
    return json(await deleteAiMemory(user.id, typeof body.id === "string" ? body.id : undefined));
  }
  if (body.action === "model") {
    const model = body.model as AiModelId;
    const result = await setChatModel(user.id, String(body.chatId ?? ""), model);
    if (!result.ok) return jsonError(result.error, result.status);
    return json(result);
  }
  if (body.action === "admin") {
    const kind = body.kind === "spam" || body.kind === "summary" ? body.kind : "announce";
    const result = await adminAssist(user.id, kind, String(body.text ?? ""));
    if (!result.ok) return jsonError(result.error, result.status);
    return json(result);
  }
  if (body.action === "external") {
    if (body.confirm !== true) {
      return json({ ok: false, needsConfirm: true, error: "عملیات حساس (ارسال پیام، پست، خرید) بدون تأیید انجام نمی‌شود." });
    }
    return json({ ok: true, did: false, message: "در این نسخه AI پیام یا خرید را خودش اجرا نمی‌کند؛ فقط پیش‌نویس می‌دهد." });
  }
  return jsonError("عملیات ناشناخته است.");
}
