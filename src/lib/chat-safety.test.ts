import { afterEach, describe, expect, it } from "vitest";
import { decryptText, encryptText, generateThreadKey } from "./e2ee";
import { hashIp } from "./crypto-utils";
import { completeProfile } from "./profile";
import { ackHumanChallenge, issueHumanChallenge, startRegistration, verifyOtp } from "./registration";
import { getOutbox } from "./outbox";
import { listMessages, listThreads, parseCipherPayload, sendMessage } from "./chat";
import { fileReport, setBlocked } from "./safety";
import { readStoreSnapshot, resetStoreForTests } from "./store";

async function readyHuman(ip: string) {
  const issued = await issueHumanChallenge(ip);
  const ack = await ackHumanChallenge(issued.token, ip);
  expect(ack.ok).toBe(true);
  return issued.token;
}

async function activeUser(username: string) {
  const ip = hashIp(`test-ip:${username}`);
  const token = await readyHuman(ip);
  const start = await startRegistration(
    { channel: "email", identifier: `${username}@nixo.test`, humanToken: token, website: "" },
    ip,
  );
  if (!start.ok) throw new Error(`start failed: ${"error" in start ? start.error : "unknown"}`);
  const code = getOutbox(start.challengeId)?.body.match(/\b(\d{6})\b/)?.[1] ?? "";
  const verified = await verifyOtp(start.challengeId, code, ip);
  if (!verified.ok) throw new Error("verify failed");
  const done = await completeProfile(verified.userId, {
    firstName: "آزمایش",
    lastName: "چت",
    username,
    bio: "",
    privacyPhoto: "everyone",
    privacyBio: "everyone",
    photoAllowIds: [],
    bioAllowIds: [],
  });
  if (!done.ok) throw new Error("profile failed");
  return verified.userId;
}

describe("e2ee envelopes", () => {
  it("round-trips AES-GCM on the device", async () => {
    const key = await generateThreadKey();
    const envelope = await encryptText(key, "سلام نیکسو");
    expect(envelope.enc).toBe("e2ee-v1");
    expect(envelope.ciphertext).not.toContain("سلام");
    expect(await decryptText(key, envelope)).toBe("سلام نیکسو");
  });

  it("rejects plaintext send bodies", () => {
    expect(parseCipherPayload({ text: "hello" })).toBeNull();
    expect(parseCipherPayload({ enc: "e2ee-v1", ciphertext: "abc", nonce: "def" })).toBeNull();
  });
});

describe("private chat safety", () => {
  afterEach(async () => {
    await resetStoreForTests();
  });

  it("stores ciphertext only and never message plaintext", async () => {
    const userId = await activeUser("e2ee_user");
    const threads = await listThreads(userId);
    const thread = threads.find((t) => t.peerKey === "arya");
    expect(thread).toBeTruthy();
    const key = await generateThreadKey();
    const envelope = await encryptText(key, "این متن هرگز نباید روی سرور باشد");
    const sent = await sendMessage(userId, thread!.id, envelope);
    expect(sent.ok).toBe(true);
    const snapshot = await readStoreSnapshot();
    const raw = JSON.stringify(snapshot.messages);
    expect(raw).not.toContain("این متن هرگز نباید روی سرور باشد");
    expect(snapshot.messages.some((m) => m.enc === "e2ee-v1" && m.ciphertext.length > 8)).toBe(true);
    const listed = await listMessages(userId, thread!.id);
    expect(listed?.messages.some((m) => "text" in m && Boolean((m as { text?: string }).text))).toBe(false);
  });

  it("blocks messages after the user blocks the peer", async () => {
    const userId = await activeUser("block_user");
    const threads = await listThreads(userId);
    const thread = threads.find((t) => t.peerKey === "noor")!;
    const blocked = await setBlocked(userId, thread.id, true);
    expect(blocked.ok).toBe(true);
    if (!blocked.ok) return;
    expect(blocked.messagesAllowed).toBe(false);
    expect(blocked.callsAllowed).toBe(false);
    const key = await generateThreadKey();
    const envelope = await encryptText(key, "should fail");
    const sent = await sendMessage(userId, thread.id, envelope);
    expect(sent.ok).toBe(false);
    if (!sent.ok) expect(sent.status).toBe(403);
  });

  it("accepts chat and user reports without storing message plaintext", async () => {
    const userId = await activeUser("report_user");
    const threads = await listThreads(userId);
    const thread = threads[0]!;
    const filed = await fileReport(userId, {
      targetKind: "chat",
      targetKey: thread.id,
      threadId: thread.id,
      category: "spam",
      details: "هرزنامه تکراری",
      messageIds: [],
    });
    expect(filed.ok).toBe(true);
    const userReport = await fileReport(userId, {
      targetKind: "user",
      targetKey: thread.peerKey,
      category: "harassment",
      details: "",
      messageIds: [],
    });
    expect(userReport.ok).toBe(true);
    const snapshot = await readStoreSnapshot();
    expect(snapshot.reports).toHaveLength(2);
    expect(snapshot.reports.map((r) => r.category).sort()).toEqual(["harassment", "spam"]);
  });
});
