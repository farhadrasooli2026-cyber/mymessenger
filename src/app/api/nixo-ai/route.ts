import { json, jsonError } from "@/lib/http";
import { requireActiveUser } from "@/lib/auth";
import { aiSendSchema, sendAiMessage } from "@/lib/ai";
import { DEFAULT_SYSTEM, NIXO_AI_UNAVAILABLE } from "@/lib/nixo-ai-live";

export async function POST(request: Request) {
  const user = await requireActiveUser();
  if (!user) return jsonError("نشست فعال نیست.", 401);

  const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
  if (!body) return jsonError("درخواست نامعتبر است.");

  const prompt = typeof body.prompt === "string" ? body.prompt : typeof body.text === "string" ? body.text : "";
  const regenerate = body.regenerate === true || body.action === "regenerate";
  const text = regenerate ? `Regenerate:\n${prompt}` : prompt;
  const parsed = aiSendSchema.safeParse({
    chatId: typeof body.chatId === "string" ? body.chatId : undefined,
    text,
    fileText: typeof body.fileText === "string" ? body.fileText : undefined,
    consentE2ee: body.consentE2ee === true,
    idempotencyKey: typeof body.idempotencyKey === "string" ? body.idempotencyKey : undefined,
  });
  if (!parsed.success) return jsonError("متن نامعتبر است.");

  try {
    const result = await sendAiMessage(user.id, parsed.data, { system: DEFAULT_SYSTEM });
    if (!result.ok) {
      const message = result.error || NIXO_AI_UNAVAILABLE;
      return json(
        {
          ok: false,
          error: message,
          text: result.assistant?.text ?? message,
          chatId: result.chatId,
          userMessage: result.userMessage ?? null,
          assistant: result.assistant ?? null,
        },
        result.status,
      );
    }
    return json({
      ok: true,
      text: result.assistant.text,
      chatId: result.chatId,
      userMessage: result.userMessage,
      assistant: result.assistant,
      refused: result.refused,
      uncertain: result.uncertain,
      generatedByAi: true,
    });
  } catch {
    return json({ ok: false, error: NIXO_AI_UNAVAILABLE, text: NIXO_AI_UNAVAILABLE }, 503);
  }
}
