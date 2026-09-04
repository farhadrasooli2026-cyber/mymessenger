import { describe, expect, it } from "vitest";
import { guessMessageLang, searchIso6391, shouldShowTranslateButton } from "./nixo-iso639";
import { mergeNixoPrefs, shouldSelfDeleteForInactivity } from "./nixo-features";

describe("nixo features", () => {
  it("searches ISO 639-1 languages", () => {
    expect(searchIso6391("fa").some((l) => l.code === "fa")).toBe(true);
    expect(searchIso6391("persian").some((l) => l.code === "fa")).toBe(true);
    expect(searchIso6391("zzzz").length).toBe(0);
  });

  it("never self-deletes unless the same account opted in", () => {
    const now = Date.now();
    expect(
      shouldSelfDeleteForInactivity({
        enabled: false,
        months: 6,
        lastSeenAt: now - 400 * 86_400_000,
        createdAt: now - 500 * 86_400_000,
        accountStatus: "active",
        now,
      }),
    ).toBe(false);
    expect(
      shouldSelfDeleteForInactivity({
        enabled: true,
        months: 6,
        lastSeenAt: now - 10 * 86_400_000,
        createdAt: now - 400 * 86_400_000,
        accountStatus: "active",
        now,
      }),
    ).toBe(false);
    expect(
      shouldSelfDeleteForInactivity({
        enabled: true,
        months: 6,
        lastSeenAt: now - 200 * 86_400_000,
        createdAt: now - 400 * 86_400_000,
        accountStatus: "active",
        now,
      }),
    ).toBe(true);
  });

  it("clamps wallpaper and skip list", () => {
    const p = mergeNixoPrefs({
      translateSkip: ["fa", "nope", "en"],
      chatWallpaperPublic: "/wallpapers/aurora.svg",
      glassOpacity: 140,
    });
    expect(p.translateSkip).toEqual(["fa", "en"]);
    expect(p.chatWallpaperPublic).toBe("/wallpapers/aurora.svg");
    expect(p.glassOpacity).toBe(100);
  });

  it("hides translate when the guessed language is skipped", () => {
    expect(guessMessageLang("سلام نیکسو")).toBe("fa");
    expect(shouldShowTranslateButton("سلام نیکسو", ["fa", "en"])).toBe(false);
    expect(shouldShowTranslateButton("Hello Nixo", ["fa"])).toBe(true);
  });
});
