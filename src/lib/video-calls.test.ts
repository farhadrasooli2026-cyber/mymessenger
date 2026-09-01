import { afterEach, describe, expect, it } from "vitest";
import { hashIp } from "./crypto-utils";
import { completeProfile } from "./profile";
import { ackHumanChallenge, issueHumanChallenge, startRegistration, verifyOtp } from "./registration";
import { getOutbox } from "./outbox";
import { openDm } from "./chat";
import { resetStoreForTests } from "./store";
import { actOnCall, listCalls, startOutgoing } from "./calls";
import { listCallSignals, postCallSignal } from "./call-signal";
import { CALL_RECONNECT_MAX } from "./calls";

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
    firstName: "ویدیو",
    lastName: "تماس",
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

describe("1:1 video calls and WebRTC signaling rooms", () => {
  afterEach(async () => {
    await resetStoreForTests();
  });

  it("fans out a video invite, shares a signaling room, and blocks IDOR + bad ICE", async () => {
    const a = await activeUser("vid_a");
    const b = await activeUser("vid_b");
    const stranger = await activeUser("vid_x");
    const opened = await openDm(a, b);
    expect(opened.ok).toBe(true);
    if (!opened.ok) return;
    const started = await startOutgoing(a, opened.thread.id, "video");
    expect(started.ok).toBe(true);
    if (!started.ok) return;
    expect(started.call.kind).toBe("video");
    expect(started.call.bridged).toBe(true);
    expect(started.call.phase).toBe("calling");
    expect(started.mediaToken).toBeTruthy();

    const bOpen = await openDm(b, a);
    expect(bOpen.ok).toBe(true);
    if (!bOpen.ok) return;
    const inbox = await listCalls(b, "incoming");
    const incoming = inbox.find((c) => c.sessionId === started.call.sessionId && c.direction === "in");
    expect(incoming).toBeTruthy();
    expect(incoming?.phase).toBe("ringing");

    const stolen = await postCallSignal(stranger, started.call.id, {
      type: "offer",
      body: "v=0\r\no=- steal",
      token: started.mediaToken ?? undefined,
    });
    expect(stolen.ok).toBe(false);

    const noTok = await postCallSignal(a, started.call.id, { type: "offer", body: "v=0\r\no=- nixo video" });
    expect(noTok.ok).toBe(false);

    const offer = await postCallSignal(a, started.call.id, {
      type: "offer",
      body: "v=0\r\no=- nixo video sdp",
      token: started.mediaToken!,
    });
    expect(offer.ok).toBe(true);

    const listedB = await listCallSignals(b, incoming!.id);
    expect(listedB.ok).toBe(true);
    if (listedB.ok) expect(listedB.items.some((i) => i.type === "offer" && !i.fromMe && i.body)).toBe(true);

    const badIce = await postCallSignal(a, started.call.id, {
      type: "ice",
      body: "host-only-udp-xyzzy-12345678",
      token: started.mediaToken!,
    });
    expect(badIce.ok).toBe(false);

    const ice = await postCallSignal(a, started.call.id, {
      type: "ice",
      body: JSON.stringify({ candidate: "candidate:1 1 UDP 1 127.0.0.1 9 typ host", sdpMid: "0" }),
      token: started.mediaToken!,
    });
    expect(ice.ok).toBe(true);

    const accepted = await actOnCall(b, incoming!.id, "accept");
    expect(accepted.ok).toBe(true);
    if (!accepted.ok) return;
    expect(accepted.call.status).toBe("active");
    expect(accepted.call.videoState).toBe("camera-on");

    const cam = await actOnCall(b, incoming!.id, "cam-off");
    expect(cam.ok).toBe(true);
    if (!cam.ok) return;
    expect(cam.call.camOff).toBe(true);
    expect(cam.call.status).toBe("active");
    const peerSees = await actOnCall(a, started.call.id, "mute");
    expect(peerSees.ok).toBe(true);
    if (peerSees.ok) expect(peerSees.call.peerCamOff).toBe(true);

    const share = await actOnCall(a, started.call.id, "share-start");
    expect(share.ok).toBe(true);
    if (share.ok) expect(share.call.sharing).toBe(true);
    const bShare = await actOnCall(b, incoming!.id, "cam-on");
    expect(bShare.ok).toBe(true);
    if (bShare.ok) expect(bShare.call.peerSharing).toBe(true);

    const fallback = await actOnCall(a, started.call.id, "voice-fallback");
    expect(fallback.ok).toBe(true);
    if (fallback.ok) {
      expect(fallback.call.voiceFallback).toBe(true);
      expect(fallback.call.videoState).toBe("camera-off");
      expect(fallback.call.status).toBe("active");
    }
    const retry = await actOnCall(a, started.call.id, "retry-video");
    expect(retry.ok).toBe(true);
    if (retry.ok) expect(retry.call.voiceFallback).toBe(false);
    const aLive = await listCalls(a, "video");
    expect(aLive.some((c) => c.id === started.call.id && c.status === "active")).toBe(true);

    const ended = await actOnCall(a, started.call.id, "end");
    expect(ended.ok).toBe(true);
    const after = await postCallSignal(a, started.call.id, {
      type: "offer",
      body: "v=0\r\no=- after end",
      token: started.mediaToken!,
    });
    expect(after.ok).toBe(false);
  });

  it("caps reconnect attempts on a live 1:1 call", async () => {
    const a = await activeUser("rec_a");
    const b = await activeUser("rec_b");
    const opened = await openDm(a, b);
    if (!opened.ok) return;
    const started = await startOutgoing(a, opened.thread.id, "video");
    if (!started.ok) return;
    const incoming = (await listCalls(b, "incoming")).find((c) => c.sessionId === started.call.sessionId);
    expect(incoming).toBeTruthy();
    await actOnCall(b, incoming!.id, "accept");
    let last: Awaited<ReturnType<typeof actOnCall>> | null = null;
    for (let i = 0; i < CALL_RECONNECT_MAX + 1; i++) {
      last = await actOnCall(a, started.call.id, "reconnect");
    }
    expect(last?.ok).toBe(false);
  });
});
