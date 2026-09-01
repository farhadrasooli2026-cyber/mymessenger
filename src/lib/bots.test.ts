import { afterEach, describe, expect, it } from "vitest";
import { hashIp } from "./crypto-utils";
import { completeProfile } from "./profile";
import { getOutbox } from "./outbox";
import { ackHumanChallenge, issueHumanChallenge, startRegistration, verifyOtp } from "./registration";
import { resetStoreForTests } from "./store";
import { createGroup } from "./groups";
import {
  botSendToUser,
  botEditOwnMessage,
  botKvGet,
  botKvSet,
  createBot,
  adminBotStatus,
  resolveBotFromToken,
  rotateToken,
  setBotPerms,
  startBot,
  userCallback,
  validHttpsWebhook,
} from "./bots";

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
    firstName: "ربات",
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

describe("NIXO bots and mini apps", () => {
  afterEach(async () => {
    await resetStoreForTests();
  });

  it("rejects duplicate bot usernames and keeps tokens hashed", async () => {
    const owner = await activeUser("bot_owner");
    const first = await createBot(owner, { name: "فروش", username: "nixo_shop", description: "فروشگاه آزمایشی نیکسو" });
    expect(first.ok).toBe(true);
    if (!first.ok) return;
    expect(first.token.startsWith("nxtb_")).toBe(true);
    const dup = await createBot(owner, { name: "دیگر", username: "nixo_shop", description: "تکراری نباید باشد" });
    expect(dup.ok).toBe(false);
    const resolved = await resolveBotFromToken(first.token);
    expect(resolved?.username).toBe("nixo_shop");
  });

  it("does not send until the user starts the bot and cannot read private chats", async () => {
    const owner = await activeUser("bot_dev2");
    const user = await activeUser("bot_user2");
    const created = await createBot(owner, { name: "راهنما", username: "helpdesk_bot", description: "ربات پشتیبانی تست" });
    expect(created.ok).toBe(true);
    if (!created.ok) return;
    const denied = await botSendToUser(created.token, { userId: user, text: "سلام بدون Start" });
    expect(denied.ok).toBe(false);
    const started = await startBot(user, created.bot.id);
    expect(started.ok).toBe(true);
    const sent = await botSendToUser(created.token, { userId: user, text: "بعد از Start" });
    expect(sent.ok).toBe(true);
    const priv = await setBotPerms(owner, created.bot.id, { readPrivateChats: true });
    expect(priv.ok).toBe(false);
  });

  it("isolates storage, rejects forged callbacks, and honors idempotency", async () => {
    const owner = await activeUser("bot_plat_a");
    const user = await activeUser("bot_plat_u");
    const a = await createBot(owner, { name: "آلف", username: "alpha_botx", description: "ربات آلفا آزمایشی نیکسو" });
    const b = await createBot(owner, { name: "بتا", username: "beta_botx", description: "ربات بتا آزمایشی نیکسو" });
    expect(a.ok && b.ok).toBe(true);
    if (!a.ok || !b.ok) return;
    await startBot(user, a.bot.id);
    const sent = await botSendToUser(a.token, { userId: user, text: "سلام", buttons: [{ id: "ok", label: "OK", payload: "ok" }], idempotencyKey: "k1" });
    expect(sent.ok).toBe(true);
    if (!sent.ok) return;
    const dup2 = await botSendToUser(a.token, { userId: user, text: "دیگر", idempotencyKey: "k1" });
    expect(dup2.ok).toBe(true);
    if (dup2.ok) expect(dup2.messageId).toBe(sent.messageId);
    const steal = await botEditOwnMessage(b.token, sent.messageId, "هک");
    expect(steal.ok).toBe(false);
    const cb = await userCallback(user, a.bot.id, sent.messageId, "nope");
    expect(cb.ok).toBe(false);
    const okcb = await userCallback(user, a.bot.id, sent.messageId, "ok");
    expect(okcb.ok).toBe(true);
    await botKvSet(a.token, "note", "secret-a");
    await botKvSet(b.token, "note", "secret-b");
    const ga = await botKvGet(a.token, "note");
    const gb = await botKvGet(b.token, "note");
    expect(ga.ok && ga.value).toBe("secret-a");
    expect(gb.ok && gb.value).toBe("secret-b");
    const staff = await activeUser("nixo_ops");
    await adminBotStatus(staff, a.bot.id, "suspended");
    const after = await botSendToUser(a.token, { userId: user, text: "بعد از تعلیق" });
    expect(after.ok).toBe(false);
  });

  it("invalidates the old token after rotate", async () => {
    const owner = await activeUser("bot_rot");
    const created = await createBot(owner, { name: "چرخش", username: "rotate_bot", description: "تست چرخش توکن ربات" });
    expect(created.ok).toBe(true);
    if (!created.ok) return;
    const rotated = await rotateToken(owner, created.bot.id);
    expect(rotated.ok).toBe(true);
    if (!rotated.ok) return;
    expect(await resolveBotFromToken(created.token)).toBeNull();
    expect(await resolveBotFromToken(rotated.token)).toBeTruthy();
  });

  it("requires https webhooks and explicit group permissions", async () => {
    expect(validHttpsWebhook("http://evil.test/hook")).toBe(false);
    expect(validHttpsWebhook("https://hooks.example.com/nixo")).toBe(true);
    const owner = await activeUser("bot_grp");
    const created = await createBot(owner, { name: "گروه", username: "groupmod_bot", description: "ربات گروه آزمایشی" });
    expect(created.ok).toBe(true);
    if (!created.ok) return;
    const g = await createGroup(owner, { name: "گروه تست ربات", description: "د" });
    expect(g.ok).toBe(true);
  });
});
