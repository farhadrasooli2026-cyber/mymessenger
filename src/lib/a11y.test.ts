import { afterEach, describe, expect, it } from "vitest";
import { auditMarkup, keyboardOrderOk } from "./a11y/audit";
import { contrastRatio, meetsWcagAa, NIXO_CONTRAST_PAIRS } from "./a11y/contrast";
import { A11Y_SHORTCUTS, isReservedCombo, matchShortcut, normalizeCombo, RESERVED_SHORTCUTS } from "./a11y/shortcuts";
import { describeEmojiOnly, isEmojiOnly, messageAccessibleName, statusLabel } from "./a11y/message";
import { defaultA11yPrefs, hydrateA11yPrefs } from "./a11y/types";
import { hashIp } from "./crypto-utils";
import { completeProfile } from "./profile";
import { ackHumanChallenge, issueHumanChallenge, startRegistration, verifyOtp } from "./registration";
import { getOutbox } from "./outbox";
import { resetStoreForTests } from "./store";
import { updateAccountPrefs } from "./account";

async function activeUser(username: string) {
  const ip = hashIp(`test-ip:${username}`);
  const issued = await issueHumanChallenge(ip);
  await ackHumanChallenge(issued.token, ip);
  const start = await startRegistration(
    { channel: "email", identifier: `${username}@nixo.test`, humanToken: issued.token, website: "" },
    ip,
  );
  if (!start.ok) throw new Error("start");
  const code = getOutbox(start.challengeId)?.body.match(/\b(\d{6})\b/)?.[1] ?? "";
  const verified = await verifyOtp(start.challengeId, code, ip);
  if (!verified.ok) throw new Error("verify");
  const done = await completeProfile(verified.userId, {
    firstName: "دسترسی",
    lastName: "آزمایش",
    username,
    bio: "",
    privacyPhoto: "everyone",
    privacyBio: "everyone",
    photoAllowIds: [],
    bioAllowIds: [],
  });
  if (!done.ok) throw new Error("profile");
  return verified.userId;
}

describe("NIXO accessibility", () => {
  afterEach(async () => {
    await resetStoreForTests();
  });

  it("meets WCAG AA for documented chrome color pairs", () => {
    for (const pair of NIXO_CONTRAST_PAIRS) {
      expect(meetsWcagAa(pair.fg, pair.bg, pair.large), pair.name).toBe(true);
      expect(contrastRatio(pair.fg, pair.bg)).toBeGreaterThan(3);
    }
  });

  it("does not register reserved browser shortcuts", () => {
    for (const s of A11Y_SHORTCUTS) {
      expect(isReservedCombo(s.combo), s.combo).toBe(false);
    }
    expect(RESERVED_SHORTCUTS.includes("ctrl+t")).toBe(true);
    expect(matchShortcut({ altKey: true, shiftKey: true, ctrlKey: false, metaKey: false, key: "f" }, A11Y_SHORTCUTS.find((s) => s.id === "search")!)).toBe(true);
    expect(normalizeCombo({ ctrl: true, key: "t" })).toBe("ctrl+t");
  });

  it("flags unlabeled buttons and images in markup audit", () => {
    const bad = `<html><button></button><img src="x.png"><input type="text"></html>`;
    const issues = auditMarkup(bad);
    expect(issues.some((i) => i.code === "button-name")).toBe(true);
    expect(issues.some((i) => i.code === "img-alt")).toBe(true);
    expect(issues.some((i) => i.code === "control-label")).toBe(true);
    expect(issues.some((i) => i.code === "html-lang")).toBe(true);

    const good = `<html lang="fa" dir="rtl"><label for="q">جستجو</label><input id="q" /><button aria-label="ارسال">ارسال</button><img alt="" role="presentation" /></html>`;
    expect(auditMarkup(good)).toEqual([]);
    expect(keyboardOrderOk([0, 0, 0])).toBe(true);
  });

  it("builds screen-reader names for messages, emoji-only, and status without translating UGC", () => {
    const ugc = "سلام 👋 مرحبا";
    const name = messageAccessibleName({
      sender: "peer",
      senderName: "علی",
      text: ugc,
      createdAt: Date.UTC(2026, 0, 1, 12, 0),
      state: "delivered",
      replyToId: "x",
      editedAt: 1,
    });
    expect(name).toContain("علی");
    expect(name).toContain(ugc);
    expect(name).toContain("ویرایش");
    expect(isEmojiOnly("🔥🔥")).toBe(true);
    expect(isEmojiOnly("آتش 🔥")).toBe(false);
    expect(describeEmojiOnly("😀")).toContain("ایموجی");
    expect(statusLabel("read")).toBe("خوانده شد");
    expect(statusLabel("failed")).toBe("ارسال نشد");
  });

  it("hydrates a11y prefs and persists them on the account without touching security secrets", async () => {
    const id = await activeUser("a11y_prefs");
    const saved = await updateAccountPrefs(id, {
      reducedMotion: true,
      highContrast: true,
      fontScale: 150,
      liveAnnounce: "all",
      followSystemA11y: false,
      largeTargets: true,
    });
    expect(saved.ok).toBe(true);
    if (!saved.ok) return;
    expect(saved.prefs.reducedMotion).toBe(true);
    expect(saved.prefs.highContrast).toBe(true);
    expect(saved.prefs.fontScale).toBe(150);
    expect(saved.prefs.liveAnnounce).toBe("all");
    expect(saved.prefs.followSystemA11y).toBe(false);
    expect(hydrateA11yPrefs(saved.prefs).fontScale).toBe(150);
    expect(defaultA11yPrefs().keyboardShortcuts).toBe(true);
  });
});
