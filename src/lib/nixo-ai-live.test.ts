import { afterEach, describe, expect, it, vi } from "vitest";
import {
  DEFAULT_SYSTEM,
  engineInputToLivePrompt,
  geminiModelCandidates,
  parseGeminiText,
  parseOpenAiText,
  turnsToGemini,
  turnsToOpenAi,
} from "./nixo-ai-live";
import { NIXO_AI_UNAVAILABLE } from "./nixo-ai-copy";

describe("live Nixo AI parsers", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("extracts Gemini candidate text", () => {
    expect(
      parseGeminiText({
        candidates: [{ content: { parts: [{ text: "سلام از جمینی" }] } }],
      }),
    ).toBe("سلام از جمینی");
  });

  it("extracts OpenAI chat text", () => {
    expect(parseOpenAiText({ choices: [{ message: { content: "hello from mini" } }] })).toBe("hello from mini");
  });

  it("keeps the user-facing unavailable copy exact", () => {
    expect(NIXO_AI_UNAVAILABLE).toBe("ارتباط با Nixo AI برقرار نشد. لطفاً تنظیمات API Key را بررسی کنید.");
  });

  it("keeps a friendly problem-solving default system prompt", () => {
    expect(DEFAULT_SYSTEM).toMatch(/NIXO AI/);
    expect(DEFAULT_SYSTEM).toMatch(/short-term memory/i);
    expect(DEFAULT_SYSTEM).toMatch(/problem-solving/i);
  });

  it("packs conversation context into chat turns for live providers", () => {
    const packed = engineInputToLivePrompt({
      text: "پس خروجی تابع چیست؟",
      context: [
        { role: "user", text: "این کد را توضیح بده: const n = 2" },
        { role: "assistant", text: "n برابر ۲ است." },
        { role: "user", text: "   " },
      ],
      memory: ["ترجیح کاربر: فارسی کوتاه"],
    });
    expect(packed.messages).toEqual([
      { role: "user", text: "این کد را توضیح بده: const n = 2" },
      { role: "assistant", text: "n برابر ۲ است." },
    ]);
    expect(packed.prompt).toContain("پس خروجی تابع چیست؟");
    expect(packed.prompt).toContain("ترجیح کاربر: فارسی کوتاه");
    expect(packed.system).toBe(DEFAULT_SYSTEM);
  });

  it("does not duplicate the current user turn in history", () => {
    const packed = engineInputToLivePrompt({
      text: "ادامه بده",
      context: [
        { role: "user", text: "سلام" },
        { role: "assistant", text: "سلام! چطور کمک کنم؟" },
        { role: "user", text: "ادامه بده" },
      ],
    });
    expect(packed.messages.map((m) => m.text)).toEqual(["سلام", "سلام! چطور کمک کنم؟"]);
  });

  it("builds Gemini contents and OpenAI messages from packed turns", () => {
    const packed = engineInputToLivePrompt({
      text: "step 2",
      context: [
        { role: "user", text: "step 1" },
        { role: "assistant", text: "ok 1" },
      ],
    });
    expect(turnsToGemini(packed.messages, packed.prompt)).toEqual([
      { role: "user", parts: [{ text: "step 1" }] },
      { role: "model", parts: [{ text: "ok 1" }] },
      { role: "user", parts: [{ text: "step 2" }] },
    ]);
    const openai = turnsToOpenAi(packed.system, packed.messages, packed.prompt);
    expect(openai[0]).toEqual({ role: "system", content: packed.system });
    expect(openai.slice(1)).toEqual([
      { role: "user", content: "step 1" },
      { role: "assistant", content: "ok 1" },
      { role: "user", content: "step 2" },
    ]);
  });

  it("prefers Gemini 2.5 Flash then faster flash fallbacks", () => {
    vi.stubEnv("GEMINI_MODEL", "");
    expect(geminiModelCandidates()[0]).toBe("gemini-2.5-flash");
    expect(geminiModelCandidates()).toContain("gemini-1.5-flash");
  });
});
