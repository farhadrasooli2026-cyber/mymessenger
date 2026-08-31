import "server-only";
import { z } from "zod";
import { randomId } from "@/lib/crypto-utils";
import { hitRateLimit } from "@/lib/rate-limit";
import { mutateStore, readStoreSnapshot } from "@/lib/store";
import { collectSearchHits } from "@/lib/search";
import { extractMemoryCandidate, runAiEngine, type AiEngineInput } from "@/lib/ai-engine";
import {
  AI_FREE,
  DEFAULT_AI_PREFS,
  type AiChatRecord,
  type AiIntent,
  type AiLog,
  type AiMemoryItem,
  type AiMessageRecord,
  type AiModelId,
  type AiPrefs,
  type AiTopic,
} from "@/lib/ai-types";

export const aiSendSchema = z.object({
  chatId: z.string().min(4).max(80).optional(),
  text: z.string().trim().min(1).max(12_000),
  intent: z.string().max(24).optional(),
  topic: z.string().max(24).optional(),
  lang: z.enum(["fa", "en", "tr"]).optional(),
  tone: z.enum(["neutral", "formal", "friendly", "short"]).optional(),
  fileText: z.string().max(20_000).optional(),
  imageHint: z.string().max(200).optional(),
  consentE2ee: z.boolean().optional(),
});

function prefsOf(data: { aiPrefs: AiPrefs[] }, userId: string): AiPrefs {
  const row = data.aiPrefs.find((p) => p.userId === userId);
  if (row) return row;
  const created: AiPrefs = { userId, ...DEFAULT_AI_PREFS, updatedAt: Date.now() };
  data.aiPrefs.push(created);
  return created;
}

function log(data: { aiLogs: AiLog[] }, userId: string, kind: AiLog["kind"], summary: string) {
  data.aiLogs = [{ id: randomId(), userId, at: Date.now(), kind, summary: summary.slice(0, 160) }, ...data.aiLogs].slice(0, 400);
}

function dayKey(userId: string, kind: string) {
  const day = new Date().toISOString().slice(0, 10);
  return `ai:${kind}:${userId}:${day}`;
}

export async function getAiWorkspace(userId: string) {
  const data = await readStoreSnapshot();
  const prefs =
    (data.aiPrefs ?? []).find((p) => p.userId === userId) ??
    ({ userId, ...DEFAULT_AI_PREFS, updatedAt: 0 } as AiPrefs);
  const chats = (data.aiChats ?? []).filter((c) => c.userId === userId).sort((a, b) => b.updatedAt - a.updatedAt);
  const memory = prefs.memoryEnabled ? (data.aiMemory ?? []).filter((m) => m.userId === userId) : [];
  return {
    prefs,
    chats: chats.map((c) => ({ id: c.id, title: c.title, topic: c.topic, model: c.model, updatedAt: c.updatedAt })),
    memory: memory.map((m) => ({ id: m.id, fact: m.fact, createdAt: m.createdAt })),
    transparency: {
      does: "پاسخ، ترجمه، خلاصه، نوشتن، بازنویسی، پیشنهاد پاسخ، والپیپر SVG محلی، سیگنال کمکی هرزنامه.",
      receives: "فقط متنی که در NIXO AI می‌فرستی یا با رضایت برای ابزار ابری می‌چسبانی. چت E2EE پیش‌فرض روی دستگاه می‌ماند.",
      where: "موتور داخلی نیکسو روی همین سرور. آموزش مدل از گفتگوهای تو انجام نمی‌شود.",
      training: false,
      delete: "Settings → AI → Delete AI History و View/Delete/Disable Memory.",
    },
    limits: AI_FREE,
    subscription: "نسخهٔ رایگان: گفتگو، ترجمه، نوشتن، خلاصه، پیشنهاد پاسخ، SVG. Premium آینده: مدل بینایی و فایل خیلی بزرگ.",
  };
}

export async function createAiChat(userId: string, topic: AiTopic = "general") {
  return mutateStore((data) => {
    data.aiChats ??= [];
    data.aiPrefs ??= [];
    const prefs = prefsOf(data, userId);
    const chat: AiChatRecord = {
      id: randomId(),
      userId,
      title: topic === "general" ? "NIXO AI" : topic,
      topic,
      model: prefs.model,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };
    data.aiChats.unshift(chat);
    return { ok: true as const, chat };
  });
}

export async function listAiMessages(userId: string, chatId: string) {
  const data = await readStoreSnapshot();
  const chat = (data.aiChats ?? []).find((c) => c.id === chatId && c.userId === userId);
  if (!chat) return null;
  const messages = (data.aiMessages ?? []).filter((m) => m.chatId === chatId);
  return { chat, messages };
}

export async function sendAiMessage(userId: string, input: z.infer<typeof aiSendSchema> & { regenerateOf?: string }) {
  return mutateStore((data) => {
    data.aiChats ??= [];
    data.aiMessages ??= [];
    data.aiPrefs ??= [];
    data.aiMemory ??= [];
    data.aiLogs ??= [];
    const prefs = prefsOf(data, userId);
    if (input.consentE2ee && !prefs.allowCloudE2ee) {
      return { ok: false as const, status: 403, error: "ارسال متن چت E2EE به AI ابری در Data Controls خاموش است." };
    }
    const msgLimit = hitRateLimit(data, dayKey(userId, "msg"), 24 * 60 * 60_000, AI_FREE.messagesPerDay);
    if (!msgLimit.allowed) {
      log(data, userId, "abuse", "سقف پیام روزانه AI");
      return { ok: false as const, status: 429, error: "سقف روزانهٔ پیام AI تمام شد.", retryAfterSec: msgLimit.retryAfterSec };
    }
    if (input.fileText) {
      const f = hitRateLimit(data, dayKey(userId, "file"), 24 * 60 * 60_000, AI_FREE.filesPerDay);
      if (!f.allowed) return { ok: false as const, status: 429, error: "سقف فایل روزانه." };
    }
    const intent = (input.intent as AiIntent | undefined) ?? undefined;
    if (intent === "image") {
      const im = hitRateLimit(data, dayKey(userId, "img"), 24 * 60 * 60_000, AI_FREE.imagesPerDay);
      if (!im.allowed) return { ok: false as const, status: 429, error: "سقف تصویر روزانه." };
    }
    let chat = input.chatId ? data.aiChats.find((c) => c.id === input.chatId && c.userId === userId) : undefined;
    if (!chat) {
      chat = {
        id: randomId(),
        userId,
        title: input.text.slice(0, 28) || "NIXO AI",
        topic: (input.topic as AiTopic) || "general",
        model: prefs.model,
        createdAt: Date.now(),
        updatedAt: Date.now(),
      };
      data.aiChats.unshift(chat);
    }
    const context = prefs.saveHistory
      ? data.aiMessages
          .filter((m) => m.chatId === chat!.id)
          .slice(-16)
          .map((m) => ({ role: m.role, text: m.text }))
      : [];
    const memory = prefs.memoryEnabled ? data.aiMemory.filter((m) => m.userId === userId).map((m) => m.fact) : [];
    let searchNote = "";
    const ask = /^(search|جستجو|ara|bul)(\s|:|$)/i.test(input.text.trim()) || input.intent === "search";
    if (ask) {
      const q = input.text.replace(/^(search|جستجو|ara|bul)[:\s]*/i, "").trim() || input.text;
      const hits = collectSearchHits(data, userId, { q, kind: "all" }).slice(0, 6);
      searchNote = hits.map((h) => `${h.title} — ${h.preview}`).join("\n");
    }
    const engineIn: AiEngineInput = {
      text: input.text,
      intent,
      topic: chat.topic,
      model: chat.model,
      lang: input.lang,
      tone: input.tone,
      context,
      memory,
      fileText: [input.fileText, searchNote ? `نتایج جستجوی مجاز نیکسو (بدون دادهٔ خصوصی):\n${searchNote}` : ""].filter(Boolean).join("\n\n") || undefined,
      imageHint: input.imageHint,
    };
    const out = runAiEngine(engineIn);
    const userMsg: AiMessageRecord = {
      id: randomId(),
      chatId: chat.id,
      userId,
      role: "user",
      text: input.text,
      intent: out.intent,
      createdAt: Date.now(),
    };
    const asst: AiMessageRecord = {
      id: randomId(),
      chatId: chat.id,
      userId,
      role: "assistant",
      text: searchNote ? `نتایج جستجوی مجاز نیکسو:\n${searchNote}\n\n${out.text}` : out.text,
      intent: out.intent,
      createdAt: Date.now() + 1,
      imageSvg: out.imageSvg ?? null,
    };
    if (prefs.saveHistory) {
      data.aiMessages.push(userMsg, asst);
      chat.updatedAt = Date.now();
      if (chat.title === "NIXO AI" || chat.title === chat.topic) chat.title = input.text.slice(0, 36);
    }
    if (prefs.memoryEnabled) {
      const fact = extractMemoryCandidate(input.text);
      if (fact && !data.aiMemory.some((m) => m.userId === userId && m.fact === fact)) {
        const row: AiMemoryItem = { id: randomId(), userId, fact, createdAt: Date.now() };
        data.aiMemory.push(row);
      }
    }
    log(data, userId, "chat", `intent ${out.intent}`);
    return {
      ok: true as const,
      chatId: chat.id,
      userMessage: userMsg,
      assistant: asst,
      suggestions: out.suggestions,
      refused: out.refused,
      uncertain: out.uncertain,
    };
  });
}

export async function setAiFeedback(userId: string, messageId: string, feedback: "up" | "down" | null) {
  return mutateStore((data) => {
    const m = (data.aiMessages ?? []).find((x) => x.id === messageId && x.userId === userId && x.role === "assistant");
    if (!m) return { ok: false as const, status: 404, error: "پیام نیست." };
    m.feedback = feedback;
    return { ok: true as const };
  });
}

export async function stopLast(userId: string, chatId: string) {
  return mutateStore((data) => {
    const msgs = (data.aiMessages ?? []).filter((m) => m.chatId === chatId && m.userId === userId);
    const last = [...msgs].reverse().find((m) => m.role === "assistant");
    if (!last) return { ok: false as const, status: 404, error: "پاسخی در جریان نیست." };
    last.stopped = true;
    last.text = last.text.slice(0, 80) + "\n\n[Stop]";
    return { ok: true as const };
  });
}

export async function updateAiPrefs(userId: string, patch: Partial<AiPrefs>) {
  return mutateStore((data) => {
    data.aiPrefs ??= [];
    const prefs = prefsOf(data, userId);
    if (typeof patch.saveHistory === "boolean") prefs.saveHistory = patch.saveHistory;
    if (typeof patch.memoryEnabled === "boolean") prefs.memoryEnabled = patch.memoryEnabled;
    if (typeof patch.composerOnDevice === "boolean") prefs.composerOnDevice = patch.composerOnDevice;
    if (typeof patch.allowCloudE2ee === "boolean") prefs.allowCloudE2ee = patch.allowCloudE2ee;
    if (typeof patch.groupAssist === "boolean") prefs.groupAssist = patch.groupAssist;
    if (typeof patch.channelAssist === "boolean") prefs.channelAssist = patch.channelAssist;
    if (typeof patch.voiceOut === "boolean") prefs.voiceOut = patch.voiceOut;
    if (patch.model === "fast" || patch.model === "balanced" || patch.model === "advanced") prefs.model = patch.model as AiModelId;
    prefs.updatedAt = Date.now();
    log(data, userId, "consent", "Data Controls به‌روز شد");
    return { ok: true as const, prefs };
  });
}

export async function deleteAiHistory(userId: string) {
  return mutateStore((data) => {
    data.aiMessages = (data.aiMessages ?? []).filter((m) => m.userId !== userId);
    data.aiChats = (data.aiChats ?? []).filter((c) => c.userId !== userId);
    log(data, userId, "delete", "Delete AI History");
    return { ok: true as const };
  });
}

export async function deleteAiMemory(userId: string, id?: string) {
  return mutateStore((data) => {
    if (id) data.aiMemory = (data.aiMemory ?? []).filter((m) => !(m.userId === userId && m.id === id));
    else data.aiMemory = (data.aiMemory ?? []).filter((m) => m.userId !== userId);
    return { ok: true as const };
  });
}

export async function setChatModel(userId: string, chatId: string, model: AiModelId) {
  return mutateStore((data) => {
    const chat = (data.aiChats ?? []).find((c) => c.id === chatId && c.userId === userId);
    if (!chat) return { ok: false as const, status: 404, error: "گفتگو نیست." };
    chat.model = model;
    return { ok: true as const };
  });
}

export async function adminAssist(userId: string, kind: "announce" | "spam" | "summary", text: string) {
  return mutateStore((data) => {
    data.aiPrefs ??= [];
    const prefs = prefsOf(data, userId);
    if (!prefs.groupAssist && !prefs.channelAssist) {
      return { ok: false as const, status: 403, error: "AI گروه/کانال در Data Controls خاموش است. پیام‌های خصوصی گروه پیش‌فرض خوانده نمی‌شوند." };
    }
    const out = runAiEngine({
      text,
      intent: kind === "spam" ? "spam" : kind === "summary" ? "summarize" : "write",
      topic: "business",
      model: prefs.model,
    });
    log(data, userId, "tool", `admin ${kind}`);
    return { ok: true as const, text: out.text, spamScore: out.spamScore };
  });
}
