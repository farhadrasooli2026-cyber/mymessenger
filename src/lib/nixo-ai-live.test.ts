import { describe, expect, it } from "vitest";
import { parseGeminiText, parseOpenAiText } from "./nixo-ai-live";
import { NIXO_AI_UNAVAILABLE } from "./nixo-ai-copy";

describe("live Nixo AI parsers", () => {
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
});
