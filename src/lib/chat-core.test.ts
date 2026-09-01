import { afterEach, describe, expect, it } from "vitest";
import { encryptText, generateThreadKey } from "./e2ee";
import { hashIp } from "./crypto-utils";
import { completeProfile } from "./profile";
import { ackHumanChallenge, issueHumanChallenge, startRegistration, verifyOtp } from "./registration";
import { getOutbox } from "./outbox";
import {
  deleteMessage,
  editMessage,
  listMessages,
  markThreadRead,
  openDm,
  sendMessage,
} from "./chat";
import { resetStoreForTests } from "./store";

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

describe("messaging core", () => {
  afterEach(async () => {
    await resetStoreForTests();
  });

  it("fans out to the peer inbox, hides IDOR, and keeps server timestamps", async () => {
    const a = await activeUser("msg_core_a");
    const b = await activeUser("msg_core_b");
    const opened = await openDm(a, b);
    expect(opened.ok).toBe(true);
    if (!opened.ok) return;
    const key = await generateThreadKey();
    const envelope = await encryptText(key, "سلام از الف");
    const before = Date.now();
    const sent = await sendMessage(a, opened.thread.id, { ...envelope, clientNonce: "nonce-aaaa-1111" });
    expect(sent.ok).toBe(true);
    if (!sent.ok) return;
    expect(sent.ack.serverId).toBeTruthy();
    expect(sent.ack.createdAt).toBeGreaterThanOrEqual(before);
    const retry = await sendMessage(a, opened.thread.id, { ...envelope, clientNonce: "nonce-aaaa-1111" });
    expect(retry.ok).toBe(true);
    if (!retry.ok) return;
    expect(retry.duplicate).toBe(true);
    expect(retry.ack.serverId).toBe(sent.ack.serverId);

    const stranger = await activeUser("msg_core_x");
    expect(await listMessages(stranger, opened.thread.id)).toBeNull();
    const stealSend = await sendMessage(stranger, opened.thread.id, envelope);
    expect(stealSend.ok).toBe(false);
    if (!stealSend.ok) expect(stealSend.status).toBe(404);

    const bOpen = await openDm(b, a);
    expect(bOpen.ok).toBe(true);
    if (!bOpen.ok) return;
    const inbound = await listMessages(b, bOpen.thread.id);
    const peerCopy = inbound?.messages.find((m) => m.sender === "peer" && m.ciphertext === envelope.ciphertext);
    expect(peerCopy).toBeTruthy();
    expect(inbound?.unreadCount).toBeGreaterThan(0);

    const marked = await markThreadRead(b, bOpen.thread.id);
    expect(marked.ok).toBe(true);
    const afterRead = await listMessages(a, opened.thread.id);
    expect(afterRead?.messages.some((m) => m.sender === "me" && m.state === "read")).toBe(true);

    const editDeny = await editMessage(b, bOpen.thread.id, peerCopy!.id, envelope);
    expect(editDeny.ok).toBe(false);
    if (!editDeny.ok) expect(editDeny.status).toBe(403);

    const mine = sent.messages.find((m) => m.id === sent.ack.serverId)!;
    const edited = await encryptText(key, "ویرایش الف");
    const editOk = await editMessage(a, opened.thread.id, mine.id, edited);
    expect(editOk.ok).toBe(true);

    const badReply = await sendMessage(a, opened.thread.id, {
      ...envelope,
      clientNonce: "nonce-bbbb-2222",
      replyToId: "not-a-real-message-id-xx",
    });
    expect(badReply.ok).toBe(false);

    const hide = await deleteMessage(b, bOpen.thread.id, peerCopy!.id, "me");
    expect(hide.ok).toBe(true);
    const hidden = await listMessages(b, bOpen.thread.id);
    expect(hidden?.messages.some((m) => m.id === peerCopy!.id)).toBe(false);
    const still = await listMessages(a, opened.thread.id);
    expect(still?.messages.some((m) => m.id === mine.id)).toBe(true);
  });

  it("paginates with a cursor and never returns another user's thread", async () => {
    const a = await activeUser("page_user_a");
    const b = await activeUser("page_user_b");
    const opened = await openDm(a, b);
    expect(opened.ok).toBe(true);
    if (!opened.ok) return;
    const key = await generateThreadKey();
    for (let i = 0; i < 8; i++) {
      const envelope = await encryptText(key, `msg-${i}`);
      const sent = await sendMessage(a, opened.thread.id, { ...envelope, clientNonce: `page-nonce-${i}-zzzz` });
      expect(sent.ok).toBe(true);
    }
    const page = await listMessages(a, opened.thread.id, { limit: 5 });
    expect(page?.messages).toHaveLength(5);
    expect(page?.nextCursor).toBeTruthy();
    const older = await listMessages(a, opened.thread.id, { limit: 5, cursor: page!.nextCursor });
    expect(older?.messages.length).toBeGreaterThan(0);
    expect(older?.messages.some((m) => page!.messages.some((x) => x.id === m.id))).toBe(false);
    const other = await listMessages(b, opened.thread.id);
    expect(other).toBeNull();
  });
});
