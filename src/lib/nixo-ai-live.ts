import "server-only";
import { NIXO_AI_UNAVAILABLE } from "@/lib/nixo-ai-copy";

export { NIXO_AI_UNAVAILABLE };

export class NixoAiUnavailableError extends Error {
  readonly status?: number;
  readonly model?: string;
  constructor(message = NIXO_AI_UNAVAILABLE, extra?: { status?: number; model?: string }) {
    super(message);
    this.name = "NixoAiUnavailableError";
    this.status = extra?.status;
    this.model = extra?.model;
  }
}

export function hasLiveAiKeys() {
  return Boolean(process.env.GEMINI_API_KEY?.trim() || process.env.OPENAI_API_KEY?.trim());
}

export function preferredLiveProvider(): "gemini" | "openai" | null {
  if (process.env.GEMINI_API_KEY?.trim()) return "gemini";
  if (process.env.OPENAI_API_KEY?.trim()) return "openai";
  return null;
}

export type LiveChatTurn = { role: "user" | "assistant" | "system"; text: string };

export type LiveCompleteInput = {
  prompt: string;
  messages?: LiveChatTurn[];
  system?: string;
  timeoutMs?: number;
};

export type LivePackedPrompt = {
  prompt: string;
  messages: LiveChatTurn[];
  system: string;
};

/** Warm, problem-solving Nixo AI persona used when a route does not pass its own system string. */
export const DEFAULT_SYSTEM = [
  "You are NIXO AI, an empathetic, highly intelligent, problem-solving AI assistant.",
  "Your primary goal is to help users solve technical and real-world problems step-by-step while maintaining a warm, engaging, and collaborative tone.",
  "Adopt a natural conversational style in Persian (or the user's input language). Be direct, helpful, and concise, but thorough when solving complex tasks.",
  "Treat the conversation history as short-term memory: stay consistent with earlier turns, names, code, constraints, and decisions.",
  "When users ask technical or troubleshooting questions, guide them step-by-step with actionable advice.",
  "Automatically detect the user's intent (coding, translation, summarization, writing, grammar, image/OCR analysis) without asking them to pick a mode.",
  "Avoid unnecessary pleasantries or robotic disclaimers. Jump straight into providing real value.",
  "Use clear code blocks for programming, elegant bullet points for analysis, and fluent natural translations.",
].join("\n");

const CONTEXT_TURNS = 16;
const TURN_CHARS = 4000;

export function geminiModelCandidates(): string[] {
  const override = process.env.GEMINI_MODEL?.trim();
  const models = [
    override,
    "gemini-2.5-flash",
    "gemini-2.0-flash",
    "gemini-1.5-flash",
    "gemini-1.5-flash-latest",
  ].filter((m): m is string => Boolean(m));
  return [...new Set(models)];
}

function aiDebugEnabled() {
  return process.env.NIXO_AI_DEBUG === "1";
}

export function logNixoAi(event: string, extra: Record<string, unknown> = {}) {
  const row = { src: "nixo-ai", event, ...extra };
  if (event === "error" || event === "provider-http") {
    console.warn(JSON.stringify(row));
    return;
  }
  if (aiDebugEnabled()) console.info(JSON.stringify(row));
}

export function parseGeminiText(payload: unknown): string | null {
  if (!payload || typeof payload !== "object") return null;
  const candidates = (payload as { candidates?: unknown }).candidates;
  if (!Array.isArray(candidates) || !candidates[0] || typeof candidates[0] !== "object") return null;
  const content = (candidates[0] as { content?: { parts?: unknown } }).content;
  const parts = content?.parts;
  if (!Array.isArray(parts)) return null;
  const text = parts
    .map((p) => (p && typeof p === "object" && typeof (p as { text?: unknown }).text === "string" ? (p as { text: string }).text : ""))
    .join("")
    .trim();
  return text || null;
}

export function parseOpenAiText(payload: unknown): string | null {
  if (!payload || typeof payload !== "object") return null;
  const choices = (payload as { choices?: unknown }).choices;
  if (!Array.isArray(choices) || !choices[0] || typeof choices[0] !== "object") return null;
  const msg = (choices[0] as { message?: { content?: unknown } }).message;
  const content = msg?.content;
  if (typeof content === "string" && content.trim()) return content.trim();
  if (Array.isArray(content)) {
    const text = content
      .map((p) => (p && typeof p === "object" && typeof (p as { text?: unknown }).text === "string" ? (p as { text: string }).text : ""))
      .join("")
      .trim();
    return text || null;
  }
  return null;
}

function liveTimeoutMs(requested?: number) {
  const n = requested ?? 20_000;
  return Math.min(Math.max(n, 8_000), 45_000);
}

async function postJson(
  url: string,
  init: RequestInit,
  timeoutMs: number,
): Promise<{ ok: true; body: unknown } | { ok: false; status: number }> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(url, { ...init, signal: ctrl.signal });
    const body = await res.json().catch(() => null);
    if (!res.ok) {
      return { ok: false, status: res.status };
    }
    return { ok: true, body };
  } catch (err) {
    if (err instanceof NixoAiUnavailableError) throw err;
    throw new NixoAiUnavailableError();
  } finally {
    clearTimeout(timer);
  }
}

function pushGeminiTurn(contents: { role: "user" | "model"; parts: { text: string }[] }[], role: "user" | "model", text: string) {
  const last = contents[contents.length - 1];
  if (last?.role === role) {
    last.parts[0] = { text: `${last.parts[0]?.text ?? ""}\n${text}`.trim() };
    return;
  }
  contents.push({ role, parts: [{ text }] });
}

export function turnsToGemini(messages: LiveChatTurn[], prompt: string) {
  const contents: { role: "user" | "model"; parts: { text: string }[] }[] = [];
  for (const m of messages) {
    if (m.role === "system") continue;
    const text = m.text.trim();
    if (!text) continue;
    pushGeminiTurn(contents, m.role === "assistant" ? "model" : "user", text);
  }
  const current = prompt.trim();
  const last = contents[contents.length - 1];
  if (current && !(last?.role === "user" && last.parts[0]?.text === current)) {
    pushGeminiTurn(contents, "user", current);
  }
  while (contents[0]?.role === "model") contents.shift();
  return contents;
}

export function turnsToOpenAi(system: string, messages: LiveChatTurn[], prompt: string) {
  const out: { role: "system" | "user" | "assistant"; content: string }[] = [{ role: "system", content: system }];
  for (const m of messages) {
    const text = m.text.trim();
    if (!text || m.role === "system") continue;
    out.push({ role: m.role === "assistant" ? "assistant" : "user", content: text });
  }
  const current = prompt.trim();
  const last = out[out.length - 1];
  if (!(last?.role === "user" && last.content === current) && current) {
    out.push({ role: "user", content: current });
  }
  return out;
}

function contextToTurns(context: { role: "user" | "assistant" | "system"; text: string }[] | undefined, currentText: string): LiveChatTurn[] {
  const messages: LiveChatTurn[] = [];
  for (const turn of context ?? []) {
    const text = turn.text.trim().slice(0, TURN_CHARS);
    if (!text) continue;
    if (turn.role !== "user" && turn.role !== "assistant") continue;
    messages.push({ role: turn.role, text });
  }
  const last = messages[messages.length - 1];
  if (last?.role === "user" && last.text === currentText.trim()) messages.pop();
  return messages.slice(-CONTEXT_TURNS);
}

export function engineInputToLivePrompt(input: {
  text: string;
  intent?: string;
  topic?: string;
  lang?: string;
  tone?: string;
  memory?: string[];
  fileText?: string;
  context?: { role: "user" | "assistant" | "system"; text: string }[];
}): LivePackedPrompt {
  const bits = [
    input.memory?.length ? `User memory (consented):\n${input.memory.slice(0, 12).join("\n")}` : "",
    input.fileText ? `Attached text:\n${input.fileText.slice(0, 12_000)}` : "",
    input.text,
  ].filter(Boolean);
  const prompt = bits.join("\n\n");
  const messages = contextToTurns(input.context, input.text);
  logNixoAi("pack", { turns: messages.length, promptChars: prompt.length, hasMemory: Boolean(input.memory?.length) });
  return { prompt, messages, system: DEFAULT_SYSTEM };
}

async function completeGemini(input: LiveCompleteInput, system: string, timeoutMs: number): Promise<string> {
  const key = process.env.GEMINI_API_KEY?.trim();
  if (!key) throw new NixoAiUnavailableError();
  const models = geminiModelCandidates();
  const contents = turnsToGemini(input.messages ?? [], input.prompt);
  logNixoAi("gemini-attempt", { models: models.length, contents: contents.length });
  let lastStatus: number | undefined;
  for (const model of models) {
    try {
      const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`;
      const result = await postJson(
        url,
        {
          method: "POST",
          headers: { "Content-Type": "application/json", "x-goog-api-key": key },
          body: JSON.stringify({
            systemInstruction: { parts: [{ text: system }] },
            contents,
            generationConfig: { temperature: 0.7, maxOutputTokens: 2048 },
          }),
        },
        timeoutMs,
      );
      if (!result.ok) {
        lastStatus = result.status;
        logNixoAi("provider-http", { provider: "gemini", model, status: result.status });
        continue;
      }
      const text = parseGeminiText(result.body);
      if (text) {
        logNixoAi("gemini-ok", { model, chars: text.length });
        return text;
      }
      logNixoAi("error", { provider: "gemini", model, reason: "empty-text" });
    } catch (err) {
      logNixoAi("error", {
        provider: "gemini",
        model,
        reason: err instanceof Error ? err.name : "unknown",
      });
    }
  }
  throw new NixoAiUnavailableError(NIXO_AI_UNAVAILABLE, { status: lastStatus, model: models[0] });
}

async function completeOpenAi(input: LiveCompleteInput, system: string, timeoutMs: number): Promise<string> {
  const key = process.env.OPENAI_API_KEY?.trim();
  if (!key) throw new NixoAiUnavailableError();
  const messages = turnsToOpenAi(system, input.messages ?? [], input.prompt);
  logNixoAi("openai-attempt", { messages: messages.length });
  const result = await postJson(
    "https://api.openai.com/v1/chat/completions",
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${key}`,
      },
      body: JSON.stringify({
        model: "gpt-4o-mini",
        temperature: 0.7,
        max_tokens: 2048,
        messages,
      }),
    },
    timeoutMs,
  );
  if (!result.ok) {
    logNixoAi("provider-http", { provider: "openai", model: "gpt-4o-mini", status: result.status });
    throw new NixoAiUnavailableError(NIXO_AI_UNAVAILABLE, { status: result.status, model: "gpt-4o-mini" });
  }
  const text = parseOpenAiText(result.body);
  if (!text) throw new NixoAiUnavailableError();
  logNixoAi("openai-ok", { chars: text.length });
  return text;
}

export async function completeLive(input: LiveCompleteInput): Promise<{ text: string; provider: "gemini" | "openai" }> {
  const prompt = input.prompt.trim();
  if (!prompt) throw new NixoAiUnavailableError();
  const system = (input.system ?? DEFAULT_SYSTEM).trim() || DEFAULT_SYSTEM;
  const timeoutMs = liveTimeoutMs(input.timeoutMs);
  const preferred = preferredLiveProvider();
  if (!preferred) throw new NixoAiUnavailableError();
  const order: ("gemini" | "openai")[] = preferred === "openai" ? ["openai", "gemini"] : ["gemini", "openai"];
  const available = order.filter((id) => (id === "gemini" ? Boolean(process.env.GEMINI_API_KEY?.trim()) : Boolean(process.env.OPENAI_API_KEY?.trim())));
  logNixoAi("complete-live", { preferred, historyTurns: input.messages?.length ?? 0, promptChars: prompt.length, chain: available });
  let lastErr: unknown;
  for (const id of available) {
    try {
      const text = id === "gemini" ? await completeGemini(input, system, timeoutMs) : await completeOpenAi(input, system, timeoutMs);
      return { text, provider: id };
    } catch (err) {
      lastErr = err;
      logNixoAi("error", { provider: id, reason: "try-next" });
    }
  }
  throw lastErr instanceof NixoAiUnavailableError ? lastErr : new NixoAiUnavailableError();
}
