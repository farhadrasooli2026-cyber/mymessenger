import { afterEach, describe, expect, it } from "vitest";
import { hashIp } from "./crypto-utils";
import { completeProfile } from "./profile";
import { getOutbox } from "./outbox";
import { ackHumanChallenge, issueHumanChallenge, startRegistration, verifyOtp } from "./registration";
import { mutateStore, readStoreSnapshot, resetStoreForTests } from "./store";
import { encryptText, generateThreadKey } from "./e2ee";
import { listThreads, markVoicePlayed, parseCipherPayload, sendMessage } from "./chat";
import { createGroup, sendGroupMessage } from "./groups";
import { createChannel, createPost } from "./channels";

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
    firstName: "صوت",
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

describe("voice access control", () => {
  afterEach(async () => {
    await resetStoreForTests();
  });

  it("rejects too-short voice envelopes at parse time", () => {
    const parsed = parseCipherPayload({
      enc: "e2ee-v1",
      ciphertext: "AAAAAAAA",
      nonce: "BBBBBBBB",
      kind: "voice",
      durationMs: 100,
    });
    expect(parsed).toBeNull();
  });

  it("retries the same voice envelope without duplicating", async () => {
    const userId = await activeUser("voice_dup");
    const threads = await listThreads(userId);
    const thread = threads.find((t) => t.peerKey === "arya")!;
    const key = await generateThreadKey();
    const envelope = await encryptText(key, JSON.stringify({ mime: "audio/webm", audio: "abcdefghij", durationMs: 1200, peaks: [] }));
    const first = await sendMessage(userId, thread.id, { ...envelope, kind: "voice", durationMs: 1200 });
    expect(first.ok).toBe(true);
    const second = await sendMessage(userId, thread.id, { ...envelope, kind: "voice", durationMs: 1200 });
    expect(second.ok).toBe(true);
    const snap = await readStoreSnapshot();
    expect(snap.messages.filter((m) => m.ownerUserId === userId && m.kind === "voice" && m.threadId === thread.id).length).toBe(1);
  });

  it("does not let another user mark a private voice as played", async () => {
    const a = await activeUser("voice_a");
    const b = await activeUser("voice_b");
    const threads = await listThreads(a);
    const thread = threads.find((t) => t.peerKey === "arya")!;
    const key = await generateThreadKey();
    const envelope = await encryptText(key, JSON.stringify({ mime: "audio/webm", audio: "abcdefghij", durationMs: 900, peaks: [] }));
    const sent = await sendMessage(a, thread.id, { ...envelope, kind: "voice", durationMs: 900, viewOnce: true });
    expect(sent.ok).toBe(true);
    if (!sent.ok) return;
    const msg = sent.messages.find((m) => m.kind === "voice")!;
    const stolen = await markVoicePlayed(b, thread.id, msg.id);
    expect(stolen.ok).toBe(false);
  });

  it("blocks group voice when sendVoice is off", async () => {
    const a = await activeUser("voice_g");
    const g = await createGroup(a, { name: "گروه صوت", memberKeys: [] });
    expect(g.ok).toBe(true);
    if (!g.ok) return;
    await mutateStore((data) => {
      const row = data.groups.find((x) => x.id === g.group.id);
      if (row) row.perms.sendVoice = false;
    });
    const key = await generateThreadKey();
    const envelope = await encryptText(key, JSON.stringify({ mime: "audio/webm", audio: "abcdefghij", durationMs: 800, peaks: [] }));
    const blocked = await sendGroupMessage(a, g.group.id, { ...envelope, kind: "voice", durationMs: 800 });
    expect(blocked.ok).toBe(false);
  });

  it("rejects html uploaded as channel voice", async () => {
    const a = await activeUser("voice_ch");
    const ch = await createChannel(a, { name: "کانال صوت", username: "voicechanx", visibility: "public" });
    expect(ch.ok).toBe(true);
    if (!ch.ok) return;
    const html = `data:audio/webm;base64,${Buffer.from("<html><script>x</script>").toString("base64")}`;
    const bad = await createPost(a, ch.channel.id, { kind: "voice", voiceDataUrl: html, durationMs: 800 });
    expect(bad.ok).toBe(false);
  });
});
