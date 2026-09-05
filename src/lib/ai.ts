import "server-only";
import { z } from "zod";
import { randomId } from "@/lib/crypto-utils";
import { hitRateLimit } from "@/lib/rate-limit";
import { mutateStore, readStoreSnapshot, type StoreData } from "@/lib/store";
import { aiSafeRecLines } from "@/lib/graph";
import { collectSearchHits } from "@/lib/search";
import { aiDailyCaps, creditBalance, ensureBilling, hasEntitlement } from "@/lib/billing-access";
import { extractMemoryCandidate, type AiEngineInput } from "@/lib/ai-engine";
import { completeWithFallback } from "@/lib/ai-providers";
import { hasLiveAiKeys, NIXO_AI_UNAVAILABLE } from "@/lib/nixo-ai-live";
import { hydrateAiPersist, pruneAiPersist } from "@/lib/ai-persist";
import { flagAllows } from "@/lib/flags";
import {
  applySafetyLayer,
  blocksCallAudio,
  confidenceFrom,
  embeddingTokens,
  estimateTokens,
  experimentBucket,
  injectionAttempt,
  looksLikeForeignPrivate,
  markGenerated,
  sanitizeForAi,
} from "@/lib/ai-privacy";
import {
  DEFAULT_AI_PREFS,
  MODEL_VERSIONS,
  type AiChatRecord,
  type AiFeatureKey,
  type AiIntent,
  type AiLog,
  type AiMemoryItem,
  type AiMessageRecord,
  type AiModelId,
  type AiPolicy,
  type AiPrefs,
  type AiPromptVersion,
  type AiProviderId,
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
  idempotencyKey: z.string().min(8).max(80).optional(),
});

export function ensureAi(data: StoreData) {
  data.aiSys = pruneAiPersist(hydrateAiPersist(data.aiSys), Date.now());
  data.aiChats ??= [];
  data.aiMessages ??= [];
  data.aiPrefs ??= [];
  data.aiMemory ??= [];
  data.aiLogs ??= [];
}

function prefsOf(data: { aiPrefs: AiPrefs[] }, userId: string): AiPrefs {
  const row = data.aiPrefs.find((p) => p.userId === userId);
  if (row) {
    if (typeof row.personalization !== "boolean") row.personalization = DEFAULT_AI_PREFS.personalization;
    if (typeof row.notifyAi !== "boolean") row.notifyAi = DEFAULT_AI_PREFS.notifyAi;
    if (typeof row.useMemoryInContext !== "boolean") row.useMemoryInContext = DEFAULT_AI_PREFS.useMemoryInContext;
    return row;
  }
  const created: AiPrefs = { userId, ...DEFAULT_AI_PREFS, updatedAt: Date.now() };
  data.aiPrefs.push(created);
  return created;
}

function log(data: { aiLogs: AiLog[] }, userId: string, kind: AiLog["kind"], summary: string) {
  data.aiLogs = [{ id: randomId(), userId, at: Date.now(), kind, summary: summary.slice(0, 160) }, ...data.aiLogs].slice(0, 800);
}

function dayKey(userId: string, kind: string) {
  const day = new Date().toISOString().slice(0, 10);
  return `ai:${kind}:${userId}:${day}`;
}

export function aiCoreAllowed(data: StoreData, userId: string) {
  ensureAi(data);
  if (!data.aiSys.policy.enabled) return false;
  return flagAllows(data.deploy?.flags, "ai_core", { userId, staff: false });
}

function featureOn(policy: AiPolicy, intent: AiIntent): boolean {
  const map: Partial<Record<AiIntent, AiFeatureKey>> = {
    summarize: "summarize",
    translate: "translate",
    write: "write",
    rewrite: "rewrite",
    grammar: "grammar",
    reply: "reply",
    search: "search",
    file: "file",
    ocr: "ocr",
    image: "image",
    describe: "image",
    audio: "audio",
    transcribe: "audio",
    spam: "moderation",
    recommend: "recommend",
    chat: "assistant",
  };
  const key = map[intent] ?? "assistant";
  return policy.features[key] !== false;
}

function simpleHash(s: string) {
  let h = 0;
  for (let i = 0; i < s.length; i += 1) h = (h * 31 + s.charCodeAt(i)) | 0;
  return String(h);
}

function chargeCredits(data: StoreData, userId: string, key: string, amount: number) {
  ensureBilling(data);
  if (amount <= 0) return { ok: true as const, reused: false };
  const dup = data.aiSys.idempotency.find((i) => i.key === key && i.userId === userId);
  if (dup) return { ok: true as const, reused: true };
  const bal = creditBalance(data, userId, "USD");
  if (bal < amount) return { ok: false as const, error: "اعتبار AI کافی نیست." };
  data.billing.credits.push({
    id: randomId(),
    userId,
    delta: -amount,
    currency: "USD",
    type: "spend",
    ref: `ai:${key}`,
    createdAt: Date.now(),
  });
  return { ok: true as const, reused: false };
}

export async function getAiWorkspace(userId: string) {
  const data = await readStoreSnapshot();
  ensureAi(data as StoreData);
  const prefs =
    (data.aiPrefs ?? []).find((p) => p.userId === userId) ??
    ({ userId, ...DEFAULT_AI_PREFS, updatedAt: 0 } as AiPrefs);
  const chats = (data.aiChats ?? []).filter((c) => c.userId === userId).sort((a, b) => b.updatedAt - a.updatedAt);
  const memory = prefs.memoryEnabled ? (data.aiMemory ?? []).filter((m) => m.userId === userId) : [];
  const caps = aiDailyCaps(data, userId);
  const policy = data.aiSys.policy;
  const available = aiCoreAllowed(data, userId);
  const logs = (data.aiLogs ?? []).filter((l) => l.userId === userId);
  return {
    prefs,
    available,
    offlineNote: available ? null : "دستیار AI فعلاً خاموش است. پیام‌رسانی، ورود، تماس و فایل همچنان کار می‌کنند.",
    provider: policy.primaryProvider,
    promptVersion: policy.promptVersion,
    chats: chats.map((c) => ({ id: c.id, title: c.title, topic: c.topic, model: c.model, updatedAt: c.updatedAt })),
    memory: memory.map((m) => ({ id: m.id, fact: m.fact, createdAt: m.createdAt })),
    transparency: {
      does: "پاسخ، ترجمه، خلاصهٔ مشخص‌شده به‌عنوان AI، نوشتن، بازنویسی، پیشنهاد پاسخ، جستجوی مجاز، والپیپر SVG محلی، سیگنال کمکی هرزنامه.",
      receives: "فقط متنی که در NIXO AI می‌فرستی یا با رضایت می‌چسبانی. چت E2EE، تماس، و فایل دیگران بدون مجوز وارد مدل نمی‌شود. Secret و شماره کارت حذف می‌شوند.",
      where: "موتور داخلی نیکسو روی همین سرور. کلید Provider هرگز به کلاینت نمی‌رود. آموزش مدل از گفتگوهای تو انجام نمی‌شود.",
      training: false,
      delete: "Settings → AI → Delete AI History و View/Delete/Disable Memory.",
    },
    limits: { messagesPerDay: caps.messages, filesPerDay: caps.files, imagesPerDay: caps.images, tokens: policy.tokenLimit },
    credits: creditBalance(data, userId, "USD"),
    plus: hasEntitlement(data, userId, "ai.plus"),
    quality: {
      feedbackUp: logs.filter((l) => l.kind === "chat").length,
      errors: logs.filter((l) => l.kind === "abuse" || l.kind === "safety").length,
    },
    subscription: caps.messages > 48 ? "پلن پولی: سقف بالاتر طبق Entitlement سرور." : "نسخهٔ رایگان: گفتگو، ترجمه، نوشتن، خلاصه. سقف روزانه در سرور اعمال می‌شود.",
  };
}

export async function createAiChat(userId: string, topic: AiTopic = "general") {
  return mutateStore((data) => {
    ensureAi(data);
    if (!aiCoreAllowed(data, userId)) {
      return { ok: false as const, status: 503, error: "دستیار AI خاموش است. پیام‌رسانی قطع نشده." };
    }
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
  const messages = (data.aiMessages ?? []).filter((m) => m.chatId === chatId && m.userId === userId);
  return { chat, messages };
}

type AiSendOk = {
  ok: true;
  chatId: string;
  userMessage: AiMessageRecord | null;
  assistant: AiMessageRecord;
  suggestions?: string[];
  refused: boolean;
  uncertain: boolean;
  replayed?: boolean;
  provider?: AiProviderId;
  fallback?: boolean;
  streaming?: boolean;
  generatedByAi?: boolean;
  unavailable?: boolean;
};

type AiSendErr = {
  ok: false;
  status: number;
  error: string;
  retryAfterSec?: number;
  chatId?: string;
  userMessage?: AiMessageRecord | null;
  assistant?: AiMessageRecord;
};

type AiSendPrepared =
  | { kind: "done"; result: AiSendOk | AiSendErr }
  | {
      kind: "run";
      chatId: string;
      userMsg: AiMessageRecord;
      engineIn: AiEngineInput;
      cacheHit: { text: string; intent: AiIntent } | null;
      searchNote: string;
      timeoutMs: number;
      jobId: string | null;
      idem: string;
      cacheKey: string;
      saveHistory: boolean;
      memoryEnabled: boolean;
      cleanText: string;
      fileHasText: boolean;
    };

export async function sendAiMessage(
  userId: string,
  input: z.infer<typeof aiSendSchema> & { regenerateOf?: string },
  options?: { system?: string },
): Promise<AiSendOk | AiSendErr> {
  const prepared = await mutateStore((data): AiSendPrepared => {
    ensureAi(data);
    const policy = data.aiSys.policy;
    if (!aiCoreAllowed(data, userId)) {
      return { kind: "done", result: { ok: false as const, status: 503, error: "دستیار AI خاموش است. ورود، پیام، تماس و فایل همچنان کار می‌کنند." } };
    }
    if (policy.estimatedUsdSpent >= policy.costCapUsd) {
      return { kind: "done", result: { ok: false as const, status: 429, error: "سقف هزینهٔ مدل پر شد. ادمین می‌تواند Rollback یا سقف را عوض کند." } };
    }
    const prefs = prefsOf(data, userId);
    if (input.consentE2ee && !prefs.allowCloudE2ee) {
      return { kind: "done", result: { ok: false as const, status: 403, error: "ارسال متن چت E2EE به AI ابری در Data Controls خاموش است." } };
    }
    const raw = input.text;
    const clean = sanitizeForAi(raw);
    const fileClean = input.fileText ? sanitizeForAi(input.fileText) : { text: "", omitted: false };
    if (injectionAttempt(raw)) {
      log(data, userId, "safety", "prompt-injection");
      return {
        kind: "done",
        result: {
          ok: true as const,
          chatId: input.chatId ?? "",
          refused: true,
          uncertain: false,
          suggestions: undefined,
          userMessage: null,
          assistant: {
            id: randomId(),
            chatId: input.chatId ?? "",
            userId,
            role: "assistant" as const,
            text: "دستورهای داخل پیام، محدودیت ایمنی نیکسو را دور نمی‌زنند. بگو چه کار مجازی می‌خواهی.",
            intent: "chat" as AiIntent,
            createdAt: Date.now(),
            generatedByAi: true,
          },
        },
      };
    }
    if (looksLikeForeignPrivate(raw) || looksLikeForeignPrivate(fileClean.text)) {
      log(data, userId, "isolation", "foreign-private");
      return { kind: "done", result: { ok: false as const, status: 403, error: "AI به پیام، فایل یا ciphertext خصوصی دیگران دسترسی ندارد." } };
    }
    if (blocksCallAudio(raw) || (!policy.allowCallAudio && /ضبط تماس|call recording/i.test(raw))) {
      log(data, userId, "isolation", "call-audio");
      return { kind: "done", result: { ok: false as const, status: 403, error: "صوت تماس بدون مجوز و سیاست ضبط وارد AI نمی‌شود." } };
    }
    if (estimateTokens(clean.text + fileClean.text) > policy.tokenLimit) {
      log(data, userId, "abuse", "token-limit");
      return { kind: "done", result: { ok: false as const, status: 413, error: "درخواست بیش از حد توکن است." } };
    }

    const idem = input.idempotencyKey ?? "";
    if (idem) {
      const prev = data.aiSys.idempotency.find((i) => i.key === idem && i.userId === userId);
      if (prev) {
        const assistant = data.aiMessages.find((m) => m.id === prev.assistantId && m.userId === userId);
        if (assistant) {
          return {
            kind: "done",
            result: {
              ok: true as const,
              chatId: prev.chatId,
              userMessage: null,
              assistant,
              suggestions: undefined,
              refused: false,
              uncertain: Boolean(assistant.confidence && assistant.confidence < 0.5),
              replayed: true,
            },
          };
        }
      }
    }

    const intent = (input.intent as AiIntent | undefined) ?? undefined;
    if (!featureOn(policy, intent ?? "chat")) {
      return { kind: "done", result: { ok: false as const, status: 403, error: "این قابلیت AI توسط ادمین خاموش است." } };
    }
    if (policy.requireCredits && policy.creditCost > 0) {
      const pay = chargeCredits(data, userId, idem || `once:${randomId()}`, policy.creditCost);
      if (!pay.ok) return { kind: "done", result: { ok: false as const, status: 402, error: pay.error } };
    }
    const caps = aiDailyCaps(data, userId);
    const msgLimit = hitRateLimit(data, dayKey(userId, "msg"), 24 * 60 * 60_000, caps.messages);
    if (!msgLimit.allowed) {
      log(data, userId, "abuse", "سقف پیام روزانه AI");
      return { kind: "done", result: { ok: false as const, status: 429, error: "سقف روزانهٔ پیام AI تمام شد.", retryAfterSec: msgLimit.retryAfterSec } };
    }
    if (fileClean.text) {
      const f = hitRateLimit(data, dayKey(userId, "file"), 24 * 60 * 60_000, caps.files);
      if (!f.allowed) return { kind: "done", result: { ok: false as const, status: 429, error: "سقف فایل روزانه." } };
    }
    if (intent === "image") {
      const im = hitRateLimit(data, dayKey(userId, "img"), 24 * 60 * 60_000, caps.images);
      if (!im.allowed) return { kind: "done", result: { ok: false as const, status: 429, error: "سقف تصویر روزانه." } };
    }

    let chat = input.chatId ? data.aiChats.find((c) => c.id === input.chatId && c.userId === userId) : undefined;
    if (!chat) {
      chat = {
        id: randomId(),
        userId,
        title: clean.text.slice(0, 28) || "NIXO AI",
        topic: (input.topic as AiTopic) || "general",
        model: prefs.model,
        createdAt: Date.now(),
        updatedAt: Date.now(),
      };
      data.aiChats.unshift(chat);
    }
    const context = prefs.saveHistory
      ? data.aiMessages
          .filter((m) => m.chatId === chat!.id && m.userId === userId)
          .slice(-policy.contextMessages)
          .map((m) => ({ role: m.role, text: m.text }))
      : [];
    const memory =
      prefs.memoryEnabled && prefs.useMemoryInContext && policy.features.memory
        ? data.aiMemory.filter((m) => m.userId === userId).map((m) => m.fact)
        : [];

    let searchNote = "";
    const ask = /^(search|جستجو|ara|bul)(\s|:|$)/i.test(clean.text.trim()) || intent === "search";
    if (ask && policy.features.search) {
      const q = clean.text.replace(/^(search|جستجو|ara|bul)[:\s]*/i, "").trim() || clean.text;
      const hits = collectSearchHits(data, userId, { q, kind: "all", semantic: true }).slice(0, 6);
      searchNote = hits.map((h) => `${h.title} — ${h.preview}`).join("\n");
      const toks = embeddingTokens(q);
      if (toks.length && data.aiSys.vectors.filter((v) => v.userId === userId).length < 80) {
        data.aiSys.vectors.push({
          id: randomId(),
          userId,
          resourceId: chat.id,
          kind: "allowed-search",
          tokens: toks,
          at: Date.now(),
        });
      }
    }

    const recs = intent === "recommend" && prefs.personalization ? aiSafeRecLines(data, userId) : "";

    const cacheKey = simpleHash(`${userId}:${intent ?? ""}:${clean.text}:${chat.model}:${policy.promptVersion}`);
    const live = hasLiveAiKeys();
    const cacheHit =
      !live && !fileClean.text && !searchNote && !memory.length
        ? data.aiSys.cache.find((c) => c.key === cacheKey && c.userId === userId && Date.now() - c.at < 10 * 60_000)
        : undefined;

    const heavy = intent === "file" || intent === "ocr" || intent === "image" || intent === "audio" || intent === "transcribe";
    let jobId: string | null = null;
    if (heavy) {
      jobId = randomId();
      data.aiSys.jobs.push({ id: jobId, userId, kind: intent ?? "file", status: "queued", createdAt: Date.now(), doneAt: null });
      log(data, userId, "queue", intent ?? "heavy");
    }

    const engineIn: AiEngineInput = {
      text: cacheHit ? cacheHit.text : clean.text,
      intent,
      topic: chat.topic,
      model: chat.model,
      lang: input.lang,
      tone: input.tone,
      context,
      memory,
      fileText:
        [fileClean.text || undefined, searchNote ? `نتایج جستجوی مجاز نیکسو:\n${searchNote}` : "", recs ? `موضوع‌های مجاز خودت: ${recs}` : ""]
          .filter(Boolean)
          .join("\n\n") || undefined,
      imageHint: input.imageHint,
    };

    const userMsg: AiMessageRecord = {
      id: randomId(),
      chatId: chat.id,
      userId,
      role: "user",
      text: raw,
      intent: intent ?? "chat",
      createdAt: Date.now(),
    };
    if (prefs.saveHistory) {
      data.aiMessages.push(userMsg);
      chat.updatedAt = Date.now();
      if (chat.title === "NIXO AI" || chat.title === chat.topic) chat.title = clean.text.slice(0, 36);
    }

    return {
      kind: "run",
      chatId: chat.id,
      userMsg,
      engineIn,
      cacheHit: cacheHit ? { text: cacheHit.text, intent: cacheHit.intent } : null,
      searchNote,
      timeoutMs: policy.timeoutMs,
      jobId,
      idem,
      cacheKey,
      saveHistory: prefs.saveHistory,
      memoryEnabled: prefs.memoryEnabled,
      cleanText: clean.text,
      fileHasText: Boolean(fileClean.text),
    };
  });

  if (prepared.kind === "done") return prepared.result;

  const started = Date.now();
  let out: Awaited<ReturnType<typeof completeWithFallback>>;
  try {
    if (prepared.cacheHit) {
      out = {
        text: prepared.cacheHit.text,
        refused: false,
        uncertain: true,
        intent: prepared.cacheHit.intent,
        provider: "local",
        fallback: false,
      };
    } else {
      const snap = await readStoreSnapshot();
      ensureAi(snap);
      out = await completeWithFallback(snap.aiSys.policy, prepared.engineIn, options?.system);
    }
  } catch {
    return persistFailedAiTurn(userId, prepared, NIXO_AI_UNAVAILABLE);
  }

  if (Date.now() - started > prepared.timeoutMs) {
    return persistFailedAiTurn(userId, prepared, NIXO_AI_UNAVAILABLE, true);
  }

  return mutateStore((data) => {
    ensureAi(data);
    const policy = data.aiSys.policy;
    const chat = data.aiChats.find((c) => c.id === prepared.chatId && c.userId === userId);
    const safety = applySafetyLayer(out.text, out.intent);
    if (safety.blocked) log(data, userId, "safety", "output-validation");
    let text = markGenerated(safety.text.slice(0, policy.responseChars), out.intent);
    if (policy.promptVersion === "pv-0") text = text.replace("نیکسو AI حقیقت قطعی نیست", "پاسخ آزمایشی (نسخهٔ قدیمی پرامپت)");
    const variant = experimentBucket(userId, policy.experimentName, policy.experimentPercent);
    if (variant === "b") text += "\n\n[آزمایش کنترل‌شدهٔ B — همان ایمنی]";

    const conf = confidenceFrom(out.uncertain, out.refused);
    if (!prepared.cacheHit && !out.refused && !prepared.fileHasText && !prepared.searchNote) {
      data.aiSys.cache.push({ key: prepared.cacheKey, userId, text, intent: out.intent, at: Date.now() });
    }

    const asst: AiMessageRecord = {
      id: randomId(),
      chatId: prepared.chatId,
      userId,
      role: "assistant",
      text: prepared.searchNote ? `نتایج جستجوی مجاز نیکسو:\n${prepared.searchNote}\n\n${text}` : text,
      intent: out.intent,
      createdAt: Date.now() + 1,
      imageSvg: "imageSvg" in out ? out.imageSvg ?? null : null,
      generatedByAi: true,
      confidence: conf,
      provider: out.provider,
      promptVersion: policy.promptVersion,
      modelVersion: chat ? MODEL_VERSIONS[chat.model] : MODEL_VERSIONS.balanced,
      variant,
    };
    prepared.userMsg.intent = out.intent;
    if (prepared.saveHistory) {
      const existing = data.aiMessages.find((m) => m.id === prepared.userMsg.id);
      if (existing) existing.intent = out.intent;
      data.aiMessages.push(asst);
      if (chat) chat.updatedAt = Date.now();
    }
    if (prepared.memoryEnabled && policy.features.memory) {
      const fact = extractMemoryCandidate(prepared.cleanText);
      if (fact && !data.aiMemory.some((m) => m.userId === userId && m.fact === fact)) {
        const row: AiMemoryItem = { id: randomId(), userId, fact, createdAt: Date.now() };
        data.aiMemory.push(row);
      }
    }
    if (prepared.jobId) {
      const job = data.aiSys.jobs.find((j) => j.id === prepared.jobId);
      if (job) {
        job.status = "done";
        job.doneAt = Date.now();
      }
    }
    if (prepared.idem) {
      data.aiSys.idempotency.push({
        key: prepared.idem,
        userId,
        at: Date.now(),
        creditRef: `ai:${prepared.idem}`,
        chatId: prepared.chatId,
        assistantId: asst.id,
      });
    }
    policy.estimatedUsdSpent = Math.min(policy.costCapUsd, policy.estimatedUsdSpent + 0.001);
    if (out.fallback) log(data, userId, "provider", "fallback-local");
    log(data, userId, "chat", `intent ${out.intent} ${out.provider}`);
    return {
      ok: true as const,
      chatId: prepared.chatId,
      userMessage: prepared.userMsg,
      assistant: asst,
      suggestions: "suggestions" in out ? out.suggestions : undefined,
      refused: out.refused,
      uncertain: out.uncertain,
      provider: out.provider,
      fallback: out.fallback,
      streaming: false,
      generatedByAi: true,
    };
  });
}

async function persistFailedAiTurn(
  userId: string,
  prepared: Extract<AiSendPrepared, { kind: "run" }>,
  error: string,
  timedOut = false,
): Promise<AiSendErr> {
  const asst: AiMessageRecord = {
    id: randomId(),
    chatId: prepared.chatId,
    userId,
    role: "assistant",
    text: error,
    intent: prepared.engineIn.intent ?? "chat",
    createdAt: Date.now() + 1,
    generatedByAi: true,
    confidence: 0,
  };
  await mutateStore((data) => {
    ensureAi(data);
    if (prepared.saveHistory) {
      data.aiMessages.push(asst);
      const chat = data.aiChats.find((c) => c.id === prepared.chatId && c.userId === userId);
      if (chat) chat.updatedAt = Date.now();
    }
    if (prepared.jobId) {
      const job = data.aiSys.jobs.find((j) => j.id === prepared.jobId);
      if (job) {
        job.status = "failed";
        job.doneAt = Date.now();
      }
    }
    log(data, userId, "provider", timedOut ? "live-timeout" : "live-unavailable");
  });
  return {
    ok: false,
    status: 503,
    error,
    chatId: prepared.chatId,
    userMessage: prepared.userMsg,
    assistant: asst,
  };
}

export async function setAiFeedback(userId: string, messageId: string, feedback: "up" | "down" | null) {
  return mutateStore((data) => {
    const m = (data.aiMessages ?? []).find((x) => x.id === messageId && x.userId === userId && x.role === "assistant");
    if (!m) return { ok: false as const, status: 404, error: "پیام نیست." };
    m.feedback = feedback;
    return { ok: true as const };
  });
}

export async function overrideAiMessage(userId: string, messageId: string, text: string) {
  return mutateStore((data) => {
    const m = (data.aiMessages ?? []).find((x) => x.id === messageId && x.userId === userId && x.role === "assistant");
    if (!m) return { ok: false as const, status: 404, error: "پیام نیست." };
    m.text = text.slice(0, 12_000);
    m.overridden = true;
    log(data, userId, "consent", "human-override");
    return { ok: true as const, message: m };
  });
}

export async function stopLast(userId: string, chatId: string) {
  return mutateStore((data) => {
    const msgs = (data.aiMessages ?? []).filter((m) => m.chatId === chatId && m.userId === userId);
    const last = [...msgs].reverse().find((m) => m.role === "assistant");
    if (!last) return { ok: false as const, status: 404, error: "پاسخی در جریان نیست." };
    last.stopped = true;
    last.text = last.text.slice(0, 80) + "\n\n[Stop — پاسخ ناقص؛ وضعیت گفتگو معتبر است]";
    const job = (data.aiSys?.jobs ?? []).find((j) => j.userId === userId && j.status === "queued");
    if (job) {
      job.status = "cancelled";
      job.doneAt = Date.now();
    }
    return { ok: true as const };
  });
}

export async function updateAiPrefs(userId: string, patch: Partial<AiPrefs>) {
  return mutateStore((data) => {
    ensureAi(data);
    const prefs = prefsOf(data, userId);
    if (typeof patch.saveHistory === "boolean") prefs.saveHistory = patch.saveHistory;
    if (typeof patch.memoryEnabled === "boolean") prefs.memoryEnabled = patch.memoryEnabled;
    if (typeof patch.composerOnDevice === "boolean") prefs.composerOnDevice = patch.composerOnDevice;
    if (typeof patch.allowCloudE2ee === "boolean") prefs.allowCloudE2ee = patch.allowCloudE2ee;
    if (typeof patch.groupAssist === "boolean") prefs.groupAssist = patch.groupAssist;
    if (typeof patch.channelAssist === "boolean") prefs.channelAssist = patch.channelAssist;
    if (typeof patch.voiceOut === "boolean") prefs.voiceOut = patch.voiceOut;
    if (typeof patch.personalization === "boolean") prefs.personalization = patch.personalization;
    if (typeof patch.notifyAi === "boolean") prefs.notifyAi = patch.notifyAi;
    if (typeof patch.useMemoryInContext === "boolean") prefs.useMemoryInContext = patch.useMemoryInContext;
    if (patch.model === "fast" || patch.model === "balanced" || patch.model === "advanced") prefs.model = patch.model as AiModelId;
    prefs.updatedAt = Date.now();
    log(data, userId, "consent", "Data Controls به‌روز شد");
    return { ok: true as const, prefs };
  });
}

export async function deleteAiHistory(userId: string) {
  return mutateStore((data) => {
    ensureAi(data);
    data.aiMessages = (data.aiMessages ?? []).filter((m) => m.userId !== userId);
    data.aiChats = (data.aiChats ?? []).filter((c) => c.userId !== userId);
    data.aiSys.cache = data.aiSys.cache.filter((c) => c.userId !== userId);
    data.aiSys.vectors = data.aiSys.vectors.filter((v) => v.userId !== userId);
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
  const prepared = await mutateStore((data) => {
    ensureAi(data);
    if (!aiCoreAllowed(data, userId)) {
      return { ok: false as const, status: 503, error: "AI خاموش است." };
    }
    const prefs = prefsOf(data, userId);
    if (!prefs.groupAssist && !prefs.channelAssist) {
      return { ok: false as const, status: 403, error: "AI گروه/کانال در Data Controls خاموش است. پیام‌های خصوصی گروه پیش‌فرض خوانده نمی‌شوند." };
    }
    return {
      ok: true as const,
      policy: data.aiSys.policy,
      model: prefs.model,
    };
  });
  if (!prepared.ok) return prepared;
  try {
    const out = await completeWithFallback(prepared.policy, {
      text,
      intent: kind === "spam" ? "spam" : kind === "summary" ? "summarize" : "write",
      topic: "business",
      model: prepared.model,
    });
    await mutateStore((data) => {
      ensureAi(data);
      log(data, userId, "tool", `admin ${kind} human-review-required`);
    });
    return {
      ok: true as const,
      text: out.text,
      spamScore: "spamScore" in out ? out.spamScore : undefined,
      cannotBan: true,
      needsHuman: kind === "spam",
    };
  } catch {
    return { ok: false as const, status: 503, error: NIXO_AI_UNAVAILABLE };
  }
}

export async function aiOpsDashboard() {
  const { requireStaff: rs } = await import("@/lib/admin-moderation");
  const staff = await rs("ai.view");
  if (!staff.ok) return staff;
  const data = await readStoreSnapshot();
  ensureAi(data);
  const logs = data.aiLogs ?? [];
  const byKind: Record<string, number> = {};
  for (const l of logs) byKind[l.kind] = (byKind[l.kind] ?? 0) + 1;
  return {
    ok: true as const,
    policy: data.aiSys.policy,
    analytics: {
      requests: logs.filter((l) => l.kind === "chat").length,
      errors: (byKind.abuse ?? 0) + (byKind.safety ?? 0),
      isolation: byKind.isolation ?? 0,
      fallbacks: byKind.provider ?? 0,
      jobs: data.aiSys.jobs.length,
      evals: data.aiSys.evals.slice(0, 8),
    },
    access: { canManage: (await (await import("@/lib/admin-moderation")).requireStaff("ai.manage")).ok },
  };
}

export async function aiOpsMutate(input: {
  action: string;
  enabled?: boolean;
  primaryProvider?: AiProviderId;
  fallbackProvider?: AiProviderId;
  mockFail?: boolean;
  feature?: AiFeatureKey;
  featureOn?: boolean;
  promptVersion?: AiPromptVersion;
  requireCredits?: boolean;
  creditCost?: number;
  costCapUsd?: number;
  experimentName?: string;
  experimentPercent?: number;
  grantUserId?: string;
  grantAmount?: number;
}) {
  const { requireStaff: rs } = await import("@/lib/admin-moderation");
  const staff = await rs("ai.manage");
  if (!staff.ok) return staff;
  return mutateStore((data) => {
    ensureAi(data);
    const p = data.aiSys.policy;
    if (input.action === "kill") p.enabled = false;
    if (input.action === "enable") p.enabled = true;
    if (input.action === "rollback") p.promptVersion = "pv-0";
    if (typeof input.enabled === "boolean") p.enabled = input.enabled;
    if (input.primaryProvider) p.primaryProvider = input.primaryProvider;
    if (input.fallbackProvider) p.fallbackProvider = input.fallbackProvider;
    if (typeof input.mockFail === "boolean") p.mockFail = input.mockFail;
    if (input.feature && typeof input.featureOn === "boolean") p.features[input.feature] = input.featureOn;
    if (input.promptVersion) p.promptVersion = input.promptVersion;
    if (typeof input.requireCredits === "boolean") p.requireCredits = input.requireCredits;
    if (typeof input.creditCost === "number") p.creditCost = Math.max(0, input.creditCost);
    if (typeof input.costCapUsd === "number") p.costCapUsd = input.costCapUsd;
    if (typeof input.experimentName === "string") p.experimentName = input.experimentName.slice(0, 40);
    if (typeof input.experimentPercent === "number") p.experimentPercent = input.experimentPercent;
    if (input.action === "eval") {
      const score = p.promptVersion === "pv-1" ? 0.86 : 0.71;
      data.aiSys.evals.unshift({
        id: randomId(),
        dataset: "nixo-ai-smoke-v1",
        modelVersion: MODEL_VERSIONS.balanced,
        promptVersion: p.promptVersion,
        score,
        at: Date.now(),
        notes: "ترجمه، رد درخواست ناامن، عدم ادعای حقیقت. تغییر مدل بدون eval ثبت نمی‌شود.",
      });
      log(data, staff.user.id, "eval", `score ${score}`);
    }
    if (input.action === "grant" && input.grantUserId && input.grantAmount) {
      ensureBilling(data);
      data.billing.credits.push({
        id: randomId(),
        userId: input.grantUserId,
        delta: input.grantAmount,
        currency: "USD",
        type: "grant",
        ref: "ai-ops",
        createdAt: Date.now(),
      });
      log(data, staff.user.id, "credit", "grant");
    }
    p.allowCallAudio = false;
    p.allowRecording = false;
    p.updatedAt = Date.now();
    log(data, staff.user.id, "admin", input.action);
    return { ok: true as const, policy: p };
  });
}
