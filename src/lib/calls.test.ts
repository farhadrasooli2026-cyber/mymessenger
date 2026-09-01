import { afterEach, describe, expect, it } from "vitest";
import { hashIp } from "./crypto-utils";
import { completeProfile } from "./profile";
import { ackHumanChallenge, issueHumanChallenge, startRegistration, verifyOtp } from "./registration";
import { getOutbox } from "./outbox";
import { listMessages, listThreads, openDm } from "./chat";
import { setBlocked } from "./safety";
import { resetStoreForTests } from "./store";
import { actOnCall, deleteCallHistory, listCalls, refuseCallRecording, startIncomingDemo, startOutgoing, updateCallSettings } from "./calls";
import { searchCallHistory, requestCallRecording } from "./call-center";
import { mintTurnCredential } from "./ice";
import { setMutedPeer } from "./privacy";

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
});
