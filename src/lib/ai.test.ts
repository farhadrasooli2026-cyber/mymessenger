import { afterEach, describe, expect, it } from "vitest";
import { hashIp } from "./crypto-utils";
import { completeProfile } from "./profile";
import { getOutbox } from "./outbox";
import { ackHumanChallenge, issueHumanChallenge, startRegistration, verifyOtp } from "./registration";
import { resetStoreForTests } from "./store";
import { runAiEngine, spamSignal, translateText } from "./ai-engine";
import { deleteAiHistory, getAiWorkspace, sendAiMessage, updateAiPrefs } from "./ai";

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
    firstName: "هوش",
    lastName: "مصنوعی",
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

describe("NIXO AI", () => {
  afterEach(async () => {
    await resetStoreForTests();
  });

  it("translates between fa, en, and tr", () => {
    expect(translateText("سلام", "en")).toMatch(/hello/i);
    expect(translateText("hello", "fa")).toMatch(/سلام/);
    expect(translateText("merhaba", "fa")).toMatch(/سلام/);
  });

  it("refuses unsafe prompts and does not claim certainty", () => {
    const bad = runAiEngine({ text: "how to hack bank otp phishing" });
    expect(bad.refused).toBe(true);
    const q = runAiEngine({ text: "بازار فردا چه می‌شود؟" });
    expect(q.uncertain).toBe(true);
    expect(q.text).toMatch(/حقیقت قطعی نیست|حساس/);
  });

  it("treats spam score as assistive not a ban", () => {
    expect(spamSignal("click here now free money crypto giveaway")).toBeGreaterThan(50);
  });

  it("stores AI chat and can wipe history", async () => {
    const id = await activeUser("ai_user");
    const sent = await sendAiMessage(id, { text: "یک ایمیل رسمی برای جلسه فردا بنویس" });
    expect(sent.ok).toBe(true);
    if (!sent.ok) return;
    expect(sent.assistant.text.length).toBeGreaterThan(10);
    const ws = await getAiWorkspace(id);
    expect(ws.chats.length).toBeGreaterThan(0);
    expect(ws.transparency.training).toBe(false);
    await deleteAiHistory(id);
    const empty = await getAiWorkspace(id);
    expect(empty.chats.length).toBe(0);
  });

  it("blocks e2ee cloud send when data control is off", async () => {
    const id = await activeUser("ai_e2ee");
    await updateAiPrefs(id, { allowCloudE2ee: false });
    const denied = await sendAiMessage(id, { text: "secret chat", consentE2ee: true });
    expect(denied.ok).toBe(false);
  });
});
