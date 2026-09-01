import { afterEach, describe, expect, it } from "vitest";
import { hashIp } from "./crypto-utils";
import { completeProfile } from "./profile";
import { ackHumanChallenge, issueHumanChallenge, startRegistration, verifyOtp } from "./registration";
import { getOutbox } from "./outbox";
import { listThreads } from "./chat";
import { mutateStore, resetStoreForTests } from "./store";
import { createGroup, joinByToken } from "./groups";
import { actOnCall, startIncomingDemo, startOutgoing } from "./calls";
import {
  addToGroupCall,
  GROUP_CALL_HARD_MAX,
  joinByToken as joinCallByToken,
  joinGroupCall,
  moderateGroupCall,
  peekCallLink,
  setOwnCallMedia,
  startGroupCall,
} from "./group-calls";

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
    firstName: "تماس",
    lastName: "گروه",
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

describe("group calls and second-line", () => {
  afterEach(async () => {
    await resetStoreForTests();
  });

  it("enforces server capacity, membership, host kick, and invite auth", async () => {
    const host = await activeUser("gcall_h");
    const a = await activeUser("gcall_a");
    const b = await activeUser("gcall_b");
    const stranger = await activeUser("gcall_s");
    const created = await createGroup(host, { name: "اتاق تماس", joinMode: "open" });
    expect(created.ok).toBe(true);
    if (!created.ok) return;
    await joinByToken(a, created.group.inviteToken!);
    await joinByToken(b, created.group.inviteToken!);

    const started = await startGroupCall(host, created.group.id, "video", 2);
    expect(started.ok).toBe(true);
    if (!started.ok) return;
    expect(started.call.maxParticipants).toBe(2);
    expect(started.call.maxParticipants).toBeLessThanOrEqual(GROUP_CALL_HARD_MAX);

    const joinedA = await joinGroupCall(a, started.call.id);
    expect(joinedA.ok).toBe(true);

    const overflow = await joinGroupCall(b, started.call.id);
    expect(overflow.ok).toBe(false);
    if (!overflow.ok) expect(overflow.status).toBe(403);

    const outsider = await joinGroupCall(stranger, started.call.id);
    expect(outsider.ok).toBe(false);

    const kickFail = await moderateGroupCall(a, started.call.id, "kick", { targetId: host });
    expect(kickFail.ok).toBe(false);

    const kicked = await moderateGroupCall(host, started.call.id, "kick", { targetId: a });
    expect(kicked.ok).toBe(true);

    const link = await moderateGroupCall(host, started.call.id, "link");
    expect(link.ok).toBe(true);
    if (!link.ok) return;
    const token = typeof link.call.inviteToken === "string" ? link.call.inviteToken : "";
    expect(token.length).toBeGreaterThan(4);

    const peekStranger = await peekCallLink(stranger, token);
    expect(peekStranger.ok).toBe(false);

    const joinStranger = await joinCallByToken(stranger, token);
    expect(joinStranger.ok).toBe(false);

    const capUp = await moderateGroupCall(host, started.call.id, "cap", { maxParticipants: 4 });
    expect(capUp.ok).toBe(true);
    const added = await addToGroupCall(host, started.call.id, b);
    expect(added.ok).toBe(true);

    const media = await setOwnCallMedia(b, started.call.id, { camOff: true, micMuted: true });
    expect(media.ok).toBe(true);
    if (media.ok) {
      const self = media.call.participants.find((p) => p.userId === b);
      expect(self?.camOff).toBe(true);
      expect(self?.micMuted).toBe(true);
    }

    await mutateStore((data) => {
      const room = data.groupCalls.find((c) => c.id === started.call.id);
      if (room) room.inviteExpiresAt = Date.now() - 1;
      return true;
    });
    const expiredPeek = await peekCallLink(a, token);
    expect(expiredPeek.ok).toBe(false);
    const expiredJoin = await joinCallByToken(a, token);
    expect(expiredJoin.ok).toBe(false);
  });

  it("queues a second incoming call and supports end-current-accept", async () => {
    const userId = await activeUser("gcall_q");
    const threads = await listThreads(userId);
    const thread = threads.find((t) => t.peerKey === "arya")!;
    const out = await startOutgoing(userId, thread.id, "voice");
    expect(out.ok).toBe(true);
    if (!out.ok) return;
    await actOnCall(userId, out.call.id, "connect");

    const incoming = await startIncomingDemo(userId, "video");
    expect(incoming.ok).toBe(true);
    if (!incoming.ok) return;
    expect(incoming.call.status).toBe("queued");

    const swapped = await actOnCall(userId, incoming.call.id, "end-current-accept");
    expect(swapped.ok).toBe(true);
    if (!swapped.ok) return;
    expect(swapped.call.status).toBe("active");
  });

  it("rate-limits incoming call floods", async () => {
    const userId = await activeUser("gcall_f");
    let lastOk = true;
    for (let i = 0; i < 12; i++) {
      const r = await startIncomingDemo(userId, "voice");
      if (!r.ok) {
        lastOk = false;
        expect(r.status).toBe(429);
        break;
      }
      if (r.call.status === "ringing" || r.call.status === "queued") {
        await actOnCall(userId, r.call.id, "decline");
      }
    }
    expect(lastOk).toBe(false);
  });
});
