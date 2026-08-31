import { describe, expect, it } from "vitest";
import { formatClock, parseVoiceInner } from "./voice";

describe("voice helpers", () => {
  it("formats live clock", () => {
    expect(formatClock(5000)).toBe("00:05");
    expect(formatClock(125_000)).toBe("02:05");
  });

  it("parses encrypted-inner voice json", () => {
    const inner = parseVoiceInner(
      JSON.stringify({ mime: "audio/webm", audio: "abcdefghij", durationMs: 1200, peaks: [0.2, 0.9] }),
    );
    expect(inner?.durationMs).toBe(1200);
    expect(inner?.peaks).toHaveLength(2);
  });
});
