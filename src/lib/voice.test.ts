import { describe, expect, it } from "vitest";
import {
  formatClock,
  parseVoiceInner,
  sniffVoiceBytes,
  validateVoiceDuration,
  shouldAutoDownloadVoice,
  VOICE_MAX_MS,
  VOICE_MIN_MS,
} from "./voice";

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

  it("rejects empty and overlong duration", () => {
    expect(validateVoiceDuration(100).ok).toBe(false);
    expect(validateVoiceDuration(VOICE_MIN_MS).ok).toBe(true);
    expect(validateVoiceDuration(VOICE_MAX_MS + 1).ok).toBe(false);
  });

  it("sniffs audio magic and rejects html/js", () => {
    const webm = new Uint8Array([0x1a, 0x45, 0xdf, 0xa3, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]);
    expect(sniffVoiceBytes(webm).ok).toBe(true);
    const html = new TextEncoder().encode("<!doctype html><script>alert(1)</script>xxxx");
    expect(sniffVoiceBytes(html).ok).toBe(false);
    const fakeExt = new TextEncoder().encode("not-audio-at-all!!");
    expect(sniffVoiceBytes(fakeExt).ok).toBe(false);
  });

  it("limits auto-download under data saver", () => {
    expect(shouldAutoDownloadVoice({ autoDownloadVoice: "wifi", dataSaver: true }, true)).toBe(false);
    expect(shouldAutoDownloadVoice({ autoDownloadVoice: "never" }, true)).toBe(false);
    expect(shouldAutoDownloadVoice({ autoDownloadVoice: "mobile", dataSaver: false }, false)).toBe(true);
  });
});
