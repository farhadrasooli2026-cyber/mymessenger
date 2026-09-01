import { afterEach, describe, expect, it } from "vitest";
import { hashIp } from "./crypto-utils";
import { completeProfile } from "./profile";
import { ackHumanChallenge, issueHumanChallenge, startRegistration, verifyOtp } from "./registration";
import { getOutbox } from "./outbox";
import { listMessages, listThreads, openDm } from "./chat";
import { setBlocked, fileReport } from "./safety";
import { mutateStore, resetStoreForTests } from "./store";
import { actOnCall, deleteCallHistory, listCalls, refuseCallRecording, startIncomingDemo, startOutgoing, updateCallSettings, CALL_RECONNECT_TIMEOUT_MS } from "./calls";
import { searchCallHistory, requestCallRecording } from "./call-center";
import { mintTurnCredential } from "./ice";
import { setMutedPeer } from "./privacy";
import { postCallSignal } from "./call-signal";

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

describe("voice and video calls", () => {
  afterEach(async () => {
    await resetStoreForTests();
  });

  it("starts an outgoing call, connects, then records duration on hangup", async () => {
    const userId = await activeUser("call_out");
    const threads = await listThreads(userId);
    const thread = threads.find((t) => t.peerKey === "arya")!;
    const started = await startOutgoing(userId, thread.id, "voice");
    expect(started.ok).toBe(true);
    if (!started.ok) return;
    expect(started.call.status).toBe("ringing");
    const connected = await actOnCall(userId, started.call.id, "connect");
    expect(connected.ok).toBe(true);
    if (!connected.ok) return;
    expect(connected.call.status).toBe("active");
    const ended = await actOnCall(userId, started.call.id, "end");
    expect(ended.ok).toBe(true);
    if (!ended.ok) return;
    expect(ended.call.status).toBe("ended");
    const hist = await listCalls(userId, "voice");
    expect(hist.some((c) => c.id === started.call.id && c.status === "ended")).toBe(true);
  });

  it("blocks outgoing calls when the peer is blocked", async () => {
    const userId = await activeUser("call_block");
    const threads = await listThreads(userId);
    const thread = threads.find((t) => t.peerKey === "noor")!;
    await setBlocked(userId, thread.id, true);
    const started = await startOutgoing(userId, thread.id, "video");
    expect(started.ok).toBe(false);
  });

  it("records declined and missed incoming, and honors nobody privacy", async () => {
    const userId = await activeUser("call_in");
    const incoming = await startIncomingDemo(userId, "video");
    expect(incoming.ok).toBe(true);
    if (!incoming.ok) return;
    const declined = await actOnCall(userId, incoming.call.id, "decline");
    expect(declined.ok).toBe(true);
    if (!declined.ok) return;
    expect(declined.call.status).toBe("declined");

    const again = await startIncomingDemo(userId, "voice");
    expect(again.ok).toBe(true);
    if (!again.ok) return;
    await actOnCall(userId, again.call.id, "end");
    const missed = (await listCalls(userId, "missed")).find((c) => c.id === again.call.id);
    expect(missed?.status).toBe("missed");

    await updateCallSettings(userId, { callPrivacy: "nobody" });
    const blocked = await startIncomingDemo(userId, "voice");
    expect(blocked.ok).toBe(false);
  });

  it("reuses a recent ringing outbound call and hides only own history", async () => {
    const a = await activeUser("call_dup");
    const b = await activeUser("call_idor");
    const threads = await listThreads(a);
    const thread = threads.find((t) => t.peerKey === "arya")!;
    const first = await startOutgoing(a, thread.id, "voice");
    expect(first.ok).toBe(true);
    if (!first.ok) return;
    const second = await startOutgoing(a, thread.id, "voice");
    expect(second.ok).toBe(true);
    if (!second.ok) return;
    expect(second.call.id).toBe(first.call.id);

    await actOnCall(a, first.call.id, "cancel");
    const hidden = await deleteCallHistory(b, [first.call.id]);
    expect(hidden.cleared).toBe(0);
    expect((await listCalls(a)).some((c) => c.id === first.call.id)).toBe(true);
    const mine = await deleteCallHistory(a, [first.call.id]);
    expect(mine.cleared).toBe(1);
    expect((await listCalls(a)).some((c) => c.id === first.call.id)).toBe(false);
    expect(refuseCallRecording().status).toBe(403);
  });

  it("does not treat mute as a call block and paginates only the owner's history", async () => {
    const a = await activeUser("call_mute_a");
    const b = await activeUser("call_mute_b");
    const mute = await setMutedPeer(b, a, true);
    expect(mute.ok).toBe(true);
    const opened = await openDm(a, b);
    expect(opened.ok).toBe(true);
    if (!opened.ok) return;
    const started = await startOutgoing(a, opened.thread.id, "voice");
    expect(started.ok).toBe(true);
    if (!started.ok) return;
    const page = await searchCallHistory(a, { filter: "outgoing", limit: 5 });
    expect(page.calls.some((c) => c.id === started.call.id)).toBe(true);
    const other = await searchCallHistory(b, { limit: 40 });
    expect(other.calls.some((c) => c.id === started.call.id)).toBe(false);
    const rec = await requestCallRecording(a, started.call.id);
    expect(rec.status).toBe(403);
    const stolen = await requestCallRecording(b, started.call.id);
    expect(stolen.status).toBe(404);
    const turn = mintTurnCredential(a);
    expect(turn.username).toMatch(/^\d+:/);
    expect(turn.username.includes(a.slice(0, 8))).toBe(true);
  });

  it("writes a missed-call system line into the chat", async () => {
    const userId = await activeUser("call_chat");
    const incoming = await startIncomingDemo(userId, "voice");
    expect(incoming.ok).toBe(true);
    if (!incoming.ok) return;
    await actOnCall(userId, incoming.call.id, "end");
    const listed = await listMessages(userId, incoming.call.threadId);
    expect(listed?.messages.some((m) => m.kind === "system" && m.systemEvent?.type === "missed_call")).toBe(true);
  });

  it("rejects self-call, friends-only privacy, handoff token rotation, and reconnect timeout", async () => {
    const a = await activeUser("call_sec_a");
    const b = await activeUser("call_sec_b");
    await mutateStore((data) => {
      data.threads.push({
        id: "self-thread",
        ownerUserId: a,
        peerKey: a,
        peerName: "من",
        peerTitle: "خودم",
        color: "#34d399",
        updatedAt: Date.now(),
      });
    });
    const self = await startOutgoing(a, "self-thread", "voice");
    expect(self.ok).toBe(false);

    await updateCallSettings(b, { callPrivacy: "friends" });
    const opened = await openDm(a, b);
    expect(opened.ok).toBe(true);
    if (!opened.ok) return;
    const denied = await startOutgoing(a, opened.thread.id, "voice");
    expect(denied.ok).toBe(false);
    await mutateStore((data) => {
      const ua = data.users.find((u) => u.id === a);
      const ub = data.users.find((u) => u.id === b);
      if (ua && ub) {
        ua.friendIds = [...(ua.friendIds ?? []), b];
        ub.friendIds = [...(ub.friendIds ?? []), a];
      }
    });
    const allowed = await startOutgoing(a, opened.thread.id, "voice");
    expect(allowed.ok).toBe(true);
    if (!allowed.ok) return;
    expect(allowed.call.participantId).toBeTruthy();
    const accepted = await actOnCall(b, (await listCalls(b, "incoming"))[0]!.id, "accept");
    expect(accepted.ok).toBe(true);
    const oldToken = allowed.mediaToken;
    const moved = await actOnCall(a, allowed.call.id, "handoff", { deviceId: "dev-2" });
    expect(moved.ok).toBe(true);
    if (moved.ok && oldToken) {
      const stale = await postCallSignal(a, allowed.call.id, { type: "offer", body: "v=0\r\no=- nixo", token: oldToken });
      expect(stale.ok).toBe(false);
      const fresh = await postCallSignal(a, allowed.call.id, {
        type: "offer",
        body: "v=0\r\no=- nixo",
        token: moved.mediaToken ?? undefined,
      });
      expect(fresh.ok).toBe(true);
    }
    await actOnCall(a, allowed.call.id, "end");

    const seed = await startOutgoing(a, (await listThreads(a)).find((t) => t.peerKey === "arya")!.id, "voice");
    expect(seed.ok).toBe(true);
    if (!seed.ok) return;
    await actOnCall(a, seed.call.id, "connect");
    await actOnCall(a, seed.call.id, "reconnect");
    await mutateStore((data) => {
      const c = data.calls.find((x) => x.id === seed.call.id);
      if (c) c.reconnectStartedAt = Date.now() - CALL_RECONNECT_TIMEOUT_MS - 1000;
    });
    const timed = await listCalls(a);
    expect(timed.find((c) => c.id === seed.call.id)?.phase).toBe("failed");
  });

  it("gives the callee a live media token and rejects signaling without it", async () => {
    const a = await activeUser("call_tok_a");
    const b = await activeUser("call_tok_b");
    const opened = await openDm(a, b);
    expect(opened.ok).toBe(true);
    if (!opened.ok) return;
    const started = await startOutgoing(a, opened.thread.id, "voice");
    expect(started.ok).toBe(true);
    if (!started.ok) return;
    expect(started.mediaToken).toBeTruthy();
    const hist = await listCalls(a);
    expect(hist.find((c) => c.id === started.call.id)).not.toHaveProperty("mediaSecret");
    expect((hist.find((c) => c.id === started.call.id) as { mediaToken?: string } | undefined)?.mediaToken).toBeUndefined();

    const incoming = (await listCalls(b, "incoming"))[0]!;
    const accepted = await actOnCall(b, incoming.id, "accept");
    expect(accepted.ok).toBe(true);
    if (!accepted.ok) return;
    expect(accepted.mediaToken).toBe(started.mediaToken);
    const missing = await postCallSignal(b, incoming.id, { type: "answer", body: "v=0\r\no=- nixo answer" });
    expect(missing.ok).toBe(false);
    const ok = await postCallSignal(b, incoming.id, {
      type: "answer",
      body: "v=0\r\no=- nixo answer",
      token: accepted.mediaToken ?? undefined,
    });
    expect(ok.ok).toBe(true);
    await actOnCall(a, started.call.id, "end");
    const after = await postCallSignal(b, incoming.id, {
      type: "offer",
      body: "v=0\r\no=- nixo",
      token: accepted.mediaToken ?? undefined,
    });
    expect(after.ok).toBe(false);
  });

  it("exposes peer mute without copying mute onto both records", async () => {
    const a = await activeUser("call_mute_peer_a");
    const b = await activeUser("call_mute_peer_b");
    const opened = await openDm(a, b);
    expect(opened.ok).toBe(true);
    if (!opened.ok) return;
    const started = await startOutgoing(a, opened.thread.id, "voice");
    expect(started.ok).toBe(true);
    if (!started.ok) return;
    const incoming = (await listCalls(b, "incoming"))[0]!;
    await actOnCall(b, incoming.id, "accept");
    const muted = await actOnCall(a, started.call.id, "mute");
    expect(muted.ok).toBe(true);
    if (!muted.ok) return;
    expect(muted.call.micMuted).toBe(true);
    expect(muted.call.peerMicMuted).toBe(false);
    const peerView = await actOnCall(b, incoming.id, "unmute");
    expect(peerView.ok).toBe(true);
    if (!peerView.ok) return;
    expect(peerView.call.micMuted).toBe(false);
    expect(peerView.call.peerMicMuted).toBe(true);
  });

  it("lets a participant report a call and hides the call id from strangers", async () => {
    const a = await activeUser("call_rep_a");
    const b = await activeUser("call_rep_b");
    const stranger = await activeUser("call_rep_s");
    const opened = await openDm(a, b);
    expect(opened.ok).toBe(true);
    if (!opened.ok) return;
    const started = await startOutgoing(a, opened.thread.id, "voice");
    expect(started.ok).toBe(true);
    if (!started.ok) return;
    const mine = await fileReport(a, {
      targetKind: "call",
      targetKey: started.call.id,
      category: "harassment",
      details: "مزاحمت تماس",
    });
    expect(mine.ok).toBe(true);
    const stolen = await fileReport(stranger, {
      targetKind: "call",
      targetKey: started.call.id,
      category: "spam",
      details: "idor",
    });
    expect(stolen.ok).toBe(false);
    if (!stolen.ok) expect(stolen.status).toBe(404);
  });
});
