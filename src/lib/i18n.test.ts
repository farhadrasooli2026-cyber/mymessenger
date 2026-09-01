import { afterEach, describe, expect, it } from "vitest";
import { mutateStore, readStoreSnapshot, resetStoreForTests } from "./store";
import { t, drainMissingKeys, peekMissingKeys } from "./i18n/t";
import { localeDir, parseLocale, TRANSLATION_VERSION } from "./i18n/languages";
import { isolate } from "./i18n/bidi";
import {
  formatCurrency,
  formatNumber,
  formatPhoneDisplay,
  localeLower,
  timezoneOffsetMinutes,
  formatBytes,
  formatDistance,
} from "./i18n/format";
import { collate } from "./i18n/collate";
import { translateUgc } from "./i18n/provider";
import { formatPhone } from "./i18n/countries";
import { foldText } from "./search-match";
import { NIXO_LOCALES } from "./prefs-types";

describe("NIXO i18n", () => {
  afterEach(async () => {
    drainMissingKeys();
    await resetStoreForTests();
  });

  it("falls back to Persian for missing keys and tracks them", () => {
    expect(t("test.fa_only", { locale: "en" })).toBe("فقط فارسی");
    expect(peekMissingKeys().some((m) => m.key === "test.fa_only" && m.locale === "en")).toBe(true);
    expect(t("does.not.exist", { locale: "tr" })).toBe("does.not.exist");
    expect(TRANSLATION_VERSION).toBeGreaterThan(0);
  });

  it("interpolates and selects plurals plus gender suffixes", () => {
    expect(t("plural.messages", { locale: "en", count: 1 })).toBe("1 message");
    expect(t("plural.messages", { locale: "en", count: 3 })).toBe("3 messages");
    expect(t("plural.messages", { locale: "fa", count: 2 })).toContain("پیام");
    expect(t("gender.hello", { locale: "en", gender: "male", vars: { name: "Sam" } })).toBe("Hello Mr Sam");
    expect(t("gender.hello", { locale: "fa", gender: "female", vars: { name: "سارا" } })).toContain("سارا");
  });

  it("reports RTL for fa/ar and LTR for en/tr/ru", () => {
    expect(localeDir("fa")).toBe("rtl");
    expect(localeDir("ar")).toBe("rtl");
    expect(localeDir("en")).toBe("ltr");
    expect(isolate("NIXO", "ltr")).toMatch(/\u2066NIXO\u2069/);
  });

  it("applies DST-aware timezone offsets", () => {
    const winter = Date.UTC(2024, 0, 15, 12);
    const summer = Date.UTC(2024, 6, 15, 12);
    const nyWinter = timezoneOffsetMinutes("America/New_York", winter);
    const nySummer = timezoneOffsetMinutes("America/New_York", summer);
    expect(nySummer - nyWinter).toBe(60);
    const londonSummer = timezoneOffsetMinutes("Europe/London", summer);
    const londonWinter = timezoneOffsetMinutes("Europe/London", winter);
    expect(londonSummer - londonWinter).toBe(60);
  });

  it("formats numbers, percent-adjacent currency, bytes and distance", () => {
    const faNum = formatNumber(1234.5, { locale: "fa", numbering: "arabext" });
    expect(faNum).toMatch(/۱|1/);
    expect(formatCurrency(10, { locale: "en", country: "US" }, "USD")).toMatch(/10/);
    expect(formatBytes(2048, { locale: "en" })).toMatch(/KB/);
    expect(formatDistance(3000, { locale: "fa", measurement: "metric" })).toMatch(/km|ک|۳|3/);
    expect(formatDistance(1609, { locale: "en", measurement: "imperial" })).toMatch(/mi|ft/);
  });

  it("uses Turkish I/i mapping without changing foldText search folding", () => {
    expect(localeLower("I", "tr")).toBe("ı");
    expect("I".toLocaleLowerCase("tr")).toBe("ı");
    expect(foldText("İstanbul")).toContain("stanbul");
    expect(NIXO_LOCALES).toContain("en");
    expect(NIXO_LOCALES).toContain("tr");
  });

  it("does not treat UGC as a catalog key and denies private provider translation", async () => {
    const ugc = "سلام دوست من private-chat";
    expect(t(ugc, { locale: "en" })).toBe(ugc);
    const denied = await translateUgc({ text: ugc, to: "en", permission: false, privateContent: true }, "mock");
    expect(denied.ok).toBe(false);
    expect(denied.text).toBe(ugc);
    const noPerm = await translateUgc({ text: "public caption", to: "en", permission: false }, "mock");
    expect(noPerm.text).toBe("public caption");
    const none = await translateUgc({ text: "hello", to: "fa", permission: true }, "none");
    expect(none.text).toBe("hello");
  });

  it("collates names with the user locale and formats phones", () => {
    const names = ["بابک", "آرش", "سینا"].sort((a, b) => collate(a, b, "fa"));
    expect(names[0]).toBe("آرش");
    expect(formatPhone("IR", "09123456789")).toMatch(/^\+98/);
    expect(formatPhoneDisplay("US", "2025550123")).toMatch(/\+1/);
    expect(parseLocale("en-US")).toBe("en");
  });

  it("persists Unicode UTF-8 overlays in the store", async () => {
    await mutateStore((data) => {
      data.i18n.overlays.fa = { "demo.line": "سلام 🌟 العربية İ" };
    });
    const snap = await readStoreSnapshot();
    expect(snap.i18n.overlays.fa?.["demo.line"]).toBe("سلام 🌟 العربية İ");
    expect(JSON.stringify(snap.i18n)).not.toMatch(/nixo_reg=/);
  });
});
