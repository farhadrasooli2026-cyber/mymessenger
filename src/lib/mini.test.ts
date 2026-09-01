import { afterEach, describe, expect, it } from "vitest";
import { hashIp } from "./crypto-utils";
import { completeProfile } from "./profile";
import { getOutbox } from "./outbox";
import { ackHumanChallenge, issueHumanChallenge, startRegistration, verifyOtp } from "./registration";
import { resetStoreForTests, mutateStore } from "./store";
import { createBot, registerMiniApp } from "./bots";
import {
  adminMiniStatus,
  getMiniProfile,
  listMiniDirectory,
  miniBridge,
  openMiniSession,
  reviewMini,
  setMiniScopes,
  validMiniWebUrl,
} from "./mini";
import { revokeAllDevices } from "./security";

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
    firstName: "مینی",
    lastName: "آزمایش",
    username,
    bio: "بیو",
    privacyPhoto: "everyone",
    privacyBio: "everyone",
    photoAllowIds: [],
    bioAllowIds: [],
  });
  if (!done.ok) throw new Error("profile");
  return verified.userId;
}

describe("NIXO mini apps isolation", () => {
  afterEach(async () => {
    await resetStoreForTests();
  });

  it("rejects http web urls and open redirects off the registered host", async () => {
    expect(validMiniWebUrl("http://evil.test/app")).toBe(false);
    expect(validMiniWebUrl("https://ok.example/app")).toBe(true);
    const owner = await activeUser("mini_dev_a");
    const user = await activeUser("mini_user_a");
    const bot = await createBot(owner, { name: "اپ", username: "mini_web_bot", description: "وب‌اپ آزمایشی" });
    expect(bot.ok).toBe(true);
    if (!bot.ok) return;
    const mini = await registerMiniApp(owner, bot.bot.id, {
      title: "وب‌اپ",
      category: "utilities",
      description: "HTTPS only",
      requestedScopes: ["profile"],
      webUrl: "https://ok.example/app",
    });
    expect(mini.ok).toBe(true);
    if (!mini.ok) return;
    await setMiniScopes(user, mini.mini.id, { profile: true });
    const bad = await miniBridge(user, mini.mini.id, "open-link", { url: "https://phish.example/x" });
    expect(bad.ok).toBe(false);
    const http = await miniBridge(user, mini.mini.id, "open-link", { url: "http://ok.example/app" });
    expect(http.ok).toBe(false);
  });

  it("does not leak profile across users or forged user ids", async () => {
    const owner = await activeUser("mini_dev_b");
    const alice = await activeUser("mini_alice");
    const bob = await activeUser("mini_bob");
    const bot = await createBot(owner, { name: "پروفایل", username: "mini_prof_bot", description: "پروفایل آزمایشی" });
    if (!bot.ok) return;
    const mini = await registerMiniApp(owner, bot.bot.id, {
      title: "پروفایل",
      category: "social",
      description: "کمینه",
      requestedScopes: ["profile", "username"],
    });
    if (!mini.ok) return;
    await setMiniScopes(alice, mini.mini.id, { profile: true, username: true });
    const denied = await miniBridge(bob, mini.mini.id, "profile");
    expect(denied.ok).toBe(false);
    await setMiniScopes(bob, mini.mini.id, { profile: true, username: true });
    const steal = await miniBridge(bob, mini.mini.id, "profile", { userId: alice });
    expect(steal.ok).toBe(false);
    const own = await miniBridge(bob, mini.mini.id, "profile");
    expect(own.ok).toBe(true);
    if (own.ok && own.profile) {
      expect(own.profile.username).toBe("mini_bob");
      expect(own.profile.username).not.toBe("mini_alice");
    }
  });

  it("blocks denied scopes, pending apps, and removed deep links", async () => {
    const owner = await activeUser("mini_dev_c");
    const user = await activeUser("mini_user_c");
    const bot = await createBot(owner, { name: "حساس", username: "mini_sens_bot", description: "مجوز حساس" });
    if (!bot.ok) return;
    const pending = await registerMiniApp(owner, bot.bot.id, {
      title: "مخاطب",
      category: "social",
      description: "نیاز به بررسی",
      requestedScopes: ["contacts"],
    });
    expect(pending.ok).toBe(true);
    if (!pending.ok) return;
    const dir = await listMiniDirectory(user);
    expect(dir.items.some((i) => i.id === pending.mini.id)).toBe(false);
    const openOther = await openMiniSession(user, pending.mini.id);
    expect(openOther.ok).toBe(false);
    const safe = await registerMiniApp(owner, bot.bot.id, {
      title: "ابزار",
      category: "utilities",
      description: "پروفایل",
      requestedScopes: ["profile"],
    });
    if (!safe.ok) return;
    const contacts = await miniBridge(user, safe.mini.id, "contacts");
    expect(contacts.ok).toBe(false);
    const staff = await activeUser("nixo_ops");
    await adminMiniStatus(staff, safe.mini.id, "removed");
    const gone = await openMiniSession(user, safe.mini.id);
    expect(gone.ok).toBe(false);
    const profile = await getMiniProfile(user, safe.mini.id);
    expect(profile.ok).toBe(false);
  });

  it("revokes mini tokens on logout and hides spam reviews", async () => {
    const owner = await activeUser("mini_dev_d");
    const user = await activeUser("mini_user_d");
    const bot = await createBot(owner, { name: "خروج", username: "mini_out_bot", description: "توکن" });
    if (!bot.ok) return;
    const mini = await registerMiniApp(owner, bot.bot.id, {
      title: "خروج",
      category: "utilities",
      description: "توکن منقضی",
      requestedScopes: ["profile"],
    });
    if (!mini.ok) return;
    await setMiniScopes(user, mini.mini.id, { profile: true });
    const opened = await openMiniSession(user, mini.mini.id);
    expect(opened.ok).toBe(true);
    await revokeAllDevices(user);
    const after = await miniBridge(user, mini.mini.id, "profile");
    expect(after.ok).toBe(false);
    const spam = await reviewMini(user, mini.mini.id, 5, "buy now free crypto http://x");
    expect(spam.ok).toBe(true);
    if (spam.ok) expect(spam.hidden).toBe(true);
    const view = await getMiniProfile(user, mini.mini.id);
    expect(view.ok).toBe(true);
    if (view.ok) expect(view.reviews.length).toBe(0);
  });

  it("rejects malicious file metadata without files scope bypass", async () => {
    const owner = await activeUser("mini_dev_e");
    const user = await activeUser("mini_user_e");
    const bot = await createBot(owner, { name: "فایل", username: "mini_file_bot", description: "فایل" });
    if (!bot.ok) return;
    const mini = await registerMiniApp(owner, bot.bot.id, {
      title: "فایل",
      category: "utilities",
      description: "آپلود",
      requestedScopes: ["files"],
    });
    if (!mini.ok) return;
    await mutateStore((data) => {
      const row = data.miniApps.find((m) => m.id === mini.mini.id);
      if (row) row.status = "active";
      return true;
    });
    const bypass = await miniBridge(user, mini.mini.id, "file-meta", { name: "ok.pdf", mime: "application/pdf", size: 10 });
    expect(bypass.ok).toBe(false);
    await setMiniScopes(user, mini.mini.id, { files: true });
    const evil = await miniBridge(user, mini.mini.id, "file-meta", { name: "payload.exe", mime: "application/octet-stream", size: 10 });
    expect(evil.ok).toBe(false);
  });
});
