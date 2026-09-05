import "server-only";
import { NIXO_AI_UNAVAILABLE } from "@/lib/nixo-ai-copy";

export { NIXO_AI_UNAVAILABLE };

export class NixoAiUnavailableError extends Error {
  constructor(message = NIXO_AI_UNAVAILABLE) {
    super(message);
    this.name = "NixoAiUnavailableError";
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

const DEFAULT_SYSTEM = [
  "You are NIXO AI, an empathetic, highly intelligent, and versatile AI assistant.",
  "Your primary goal is to help users solve technical and real-world problems step-by-step while maintaining a warm, engaging, and collaborative tone.",
  "Adopt a natural conversational style in Persian (or the user's input language). Be direct, helpful, and concise, but thorough when solving complex tasks.",
  "When users ask technical or troubleshooting questions, guide them step-by-step with actionable advice.",
  "Avoid unnecessary pleasantries or robotic disclaimers. Jump straight into providing real value.",
].join("\n");

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

async function postJson(url: string, init: RequestInit, timeoutMs: number): Promise<unknown> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(url, { ...init, signal: ctrl.signal });
    const body = await res.json().catch(() => null);
    if (!res.ok) {
      throw new NixoAiUnavailableError();
    }
    return body;
  } catch (err) {
    if (err instanceof NixoAiUnavailableError) throw err;
    throw new NixoAiUnavailableError();
  } finally {
    clearTimeout(timer);
  }
}

function turnsToGemini(messages: LiveChatTurn[], prompt: string) {
  const contents: { role: "user" | "model"; parts: { text: string }[] }[] = [];
  for (const m of messages) {
    if (m.role === "system") continue;
    const text = m.text.trim();
    if (!text) continue;
    contents.push({ role: m.role === "assistant" ? "model" : "user", parts: [{ text }] });
  }
  contents.push({ role: "user", parts: [{ text: prompt }] });
  return contents;
}

function turnsToOpenAi(system: string, messages: LiveChatTurn[], prompt: string) {
  const out: { role: "system" | "user" | "assistant"; content: string }[] = [{ role: "system", content: system }];
  for (const m of messages) {
    const text = m.text.trim();
    if (!text || m.role === "system") continue;
    out.push({ role: m.role === "assistant" ? "assistant" : "user", content: text });
  }
  out.push({ role: "user", content: prompt });
  return out;
}

async function completeGemini(input: LiveCompleteInput, system: string, timeoutMs: number): Promise<string> {
  const key = process.env.GEMINI_API_KEY?.trim();
  if (!key) throw new NixoAiUnavailableError();
  const models = ["gemini-2.5-flash", "gemini-1.5-flash", "gemini-1.5-flash-latest"];
  let lastErr: unknown;
  for (const model of models) {
    try {
      const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`;
      const body = await postJson(
        url,
        {
          method: "POST",
          headers: { "Content-Type": "application/json", "x-goog-api-key": key },
          body: JSON.stringify({
            systemInstruction: { parts: [{ text: system }] },
            contents: turnsToGemini(input.messages ?? [], input.prompt),
            generationConfig: { temperature: 0.7, maxOutputTokens: 2048 },
          }),
        },
        timeoutMs,
      );
      const text = parseGeminiText(body);
      if (text) return text;
      lastErr = new NixoAiUnavailableError();
    } catch (err) {
      lastErr = err;
    }
  }
  throw lastErr instanceof NixoAiUnavailableError ? lastErr : new NixoAiUnavailableError();
}

async function completeOpenAi(input: LiveCompleteInput, system: string, timeoutMs: number): Promise<string> {
  const key = process.env.OPENAI_API_KEY?.trim();
  if (!key) throw new NixoAiUnavailableError();
  const body = await postJson(
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
        messages: turnsToOpenAi(system, input.messages ?? [], input.prompt),
      }),
    },
    timeoutMs,
  );
  const text = parseOpenAiText(body);
  if (!text) throw new NixoAiUnavailableError();
  return text;
}

export async function completeLive(input: LiveCompleteInput): Promise<{ text: string; provider: "gemini" | "openai" }> {
  const prompt = input.prompt.trim();
  if (!prompt) throw new NixoAiUnavailableError();
  const system = (input.system ?? DEFAULT_SYSTEM).trim() || DEFAULT_SYSTEM;
  const timeoutMs = liveTimeoutMs(input.timeoutMs);
  const provider = preferredLiveProvider();
  if (!provider) throw new NixoAiUnavailableError();
  if (provider === "gemini") {
    try {
      const text = await completeGemini(input, system, timeoutMs);
      return { text, provider: "gemini" };
    } catch {
      if (process.env.OPENAI_API_KEY?.trim()) {
        const text = await completeOpenAi(input, system, timeoutMs);
        return { text, provider: "openai" };
      }
      throw new NixoAiUnavailableError();
    }
  }
  const text = await completeOpenAi(input, system, timeoutMs);
  return { text, provider: "openai" };
}

export function engineInputToLivePrompt(input: {
  text: string;
  intent?: string;
  topic?: string;
  lang?: string;
  tone?: string;
  memory?: string[];
  fileText?: string;
  context?: Array<{ role: "user" | "assistant"; text: string }>;
}): { prompt: string; messages: LiveChatTurn[]; system: string } {
  const bits = [
    input.memory?.length ? `User memory (consented):\n${input.memory.slice(0, 12).join("\n")}` : "",
    input.fileText ? `Attached text:\n${input.fileText.slice(0, 12_000)}` : "",
    input.text,
  ].filter(Boolean);

  const history: LiveChatTurn[] = (input.context ?? [])
    .filter((m) => m.text.trim())
    .slice(-16)
    .map((m) => ({ role: m.role, text: m.text.slice(0, 4000) }));

  return { prompt: bits.join("\n\n"), messages: history, system: DEFAULT_SYSTEM };
}
