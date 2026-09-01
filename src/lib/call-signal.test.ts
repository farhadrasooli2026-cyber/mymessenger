import { afterEach, describe, expect, it } from "vitest";
import { hashIp } from "./crypto-utils";
import { completeProfile } from "./profile";
import { getOutbox } from "./outbox";
import { ackHumanChallenge, issueHumanChallenge, startRegistration, verifyOtp } from "./registration";
import { listThreads } from "./chat";
import { resetStoreForTests } from "./store";
import { actOnCall, startOutgoing } from "./calls";
import { listCallSignals, postCallSignal } from "./call-signal";
import { blobLooksEmpty, classifyAudioLabel, voiceBitrate } from "./voice";

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
    firstName: "سیگنال",
    lastName: "صوت",
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

describe("call signaling and voice helpers", () => {
  afterEach(async () => {
    await resetStoreForTests();
  });

  it("rejects signaling for a call the user does not own", async () => {
    const a = await activeUser("sig_a");
    const b = await activeUser("sig_b");
    const threads = await listThreads(a);
    const thread = threads.find((t) => t.peerKey === "arya")!;
    const started = await startOutgoing(a, thread.id, "voice");
    expect(started.ok).toBe(true);
    if (!started.ok) return;
    const stolen = await postCallSignal(b, started.call.id, { type: "offer", body: "v=0 fake sdp xxxxxx" });
    expect(stolen.ok).toBe(false);
    if (!stolen.ok) expect(stolen.status).toBe(403);
    const listed = await listCallSignals(b, started.call.id);
    expect(listed.ok).toBe(false);
  });

  it("stores authenticated offer for the caller and cancel marks endReason", async () => {
    const a = await activeUser("sig_ok");
    const threads = await listThreads(a);
    const thread = threads.find((t) => t.peerKey === "arya")!;
    const started = await startOutgoing(a, thread.id, "voice");
    expect(started.ok).toBe(true);
    if (!started.ok) return;
    const posted = await postCallSignal(a, started.call.id, { type: "offer", body: "v=0\r\no=- nixo signaling" });
    expect(posted.ok).toBe(true);
    const listed = await listCallSignals(a, started.call.id);
    expect(listed.ok).toBe(true);
    if (listed.ok) expect(listed.items.some((i) => i.type === "offer")).toBe(true);
    const cancelled = await actOnCall(a, started.call.id, "cancel");
    expect(cancelled.ok).toBe(true);
    if (cancelled.ok) {
      expect(cancelled.call.status).toBe("ended");
      expect(cancelled.call.endReason).toBe("cancel");
    }
  });

  it("classifies audio routes and empty blobs", () => {
    expect(classifyAudioLabel("AirPods Bluetooth")).toBe("bluetooth");
    expect(classifyAudioLabel("Wired Headphones")).toBe("headphones");
    expect(blobLooksEmpty(10)).toBe(true);
    expect(blobLooksEmpty(500)).toBe(false);
    expect(voiceBitrate("high")).toBeGreaterThan(voiceBitrate("standard", true));
  });

  it("rejects replayed signaling nonce and quality SDP", async () => {
    const a = await activeUser("sig_nonce");
    const threads = await listThreads(a);
    const thread = threads.find((t) => t.peerKey === "arya")!;
    const started = await startOutgoing(a, thread.id, "voice");
    expect(started.ok).toBe(true);
    if (!started.ok) return;
    const first = await postCallSignal(a, started.call.id, {
      type: "quality",
      body: "rtt=40,loss=1,jitter=8",
      nonce: "n1-unique",
    });
    expect(first.ok).toBe(true);
    const replay = await postCallSignal(a, started.call.id, {
      type: "quality",
      body: "rtt=41,loss=1,jitter=8",
      nonce: "n1-unique",
    });
    expect(replay.ok).toBe(false);
    if (!replay.ok) expect(replay.status).toBe(409);
    const sdp = await postCallSignal(a, started.call.id, { type: "quality", body: "v=0 sdp leak" });
    expect(sdp.ok).toBe(false);
  });
});
