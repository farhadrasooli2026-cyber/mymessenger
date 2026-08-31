import { afterEach, describe, expect, it } from "vitest";
import { hashIp } from "./crypto-utils";
import { completeProfile } from "./profile";
import { ackHumanChallenge, issueHumanChallenge, startRegistration, verifyOtp } from "./registration";
import { getOutbox } from "./outbox";
import { resetStoreForTests } from "./store";
import {
  createGroup,
  deleteGroup,
  getGroup,
  joinByToken,
  listGroups,
  moderateMember,
  pinMessage,
  rotateInvite,
  sendGroupMessage,
} from "./groups";

const envelope = {
  enc: "e2ee-v1",
  ciphertext: "QUFBQUFBQUFBQUE=",
  nonce: "QkJCQkJCQkJCQkI=",
};

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
    firstName: "گروه",
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

describe("NIXO groups", () => {
  afterEach(async () => {
    await resetStoreForTests();
  });

  it("creates a group with seed members and stores E2EE text", async () => {
    const owner = await activeUser("grp_own");
    const created = await createGroup(owner, {
      name: "اتاق طراحی",
      description: "گفتگوی تیم",
      memberKeys: ["arya"],
      joinMode: "invite",
    });
    expect(created.ok).toBe(true);
    if (!created.ok) return;
    expect(created.group.members.some((m) => m.key === "seed:arya")).toBe(true);
    expect(created.group.myRole).toBe("owner");
    const sent = await sendGroupMessage(owner, created.group.id, { ...envelope, kind: "text" });
    expect(sent.ok).toBe(true);
    if (!sent.ok) return;
    expect(sent.message.enc).toBe("e2ee-v1");
    expect(sent.message.ciphertext.length).toBeGreaterThan(7);
    const listed = await listGroups(owner);
    expect(listed.some((g) => g.id === created.group.id)).toBe(true);
  });

  it("rejects plaintext and non-members", async () => {
    const owner = await activeUser("grp_plain");
    const outsider = await activeUser("grp_out");
    const created = await createGroup(owner, { name: "خصوصی" });
    expect(created.ok).toBe(true);
    if (!created.ok) return;
    const plain = await sendGroupMessage(owner, created.group.id, { enc: "none", ciphertext: "hello", nonce: "x" });
    expect(plain.ok).toBe(false);
    const blocked = await sendGroupMessage(outsider, created.group.id, { ...envelope, kind: "text" });
    expect(blocked.ok).toBe(false);
    if (!blocked.ok) expect(blocked.status).toBe(403);
  });

  it("lets a member join by invite, then refuses self-promotion", async () => {
    const owner = await activeUser("grp_inv");
    const joiner = await activeUser("grp_join");
    const created = await createGroup(owner, { name: "باز", joinMode: "open" });
    expect(created.ok).toBe(true);
    if (!created.ok) return;
    const token = created.group.inviteToken;
    expect(token).toBeTruthy();
    const joined = await joinByToken(joiner, token!);
    expect(joined.ok).toBe(true);
    const promote = await moderateMember(joiner, created.group.id, owner, "role", { role: "admin" });
    expect(promote.ok).toBe(false);
    if (!promote.ok) expect(promote.status).toBe(403);
    const asAdmin = await moderateMember(owner, created.group.id, joiner, "role", { role: "admin" });
    expect(asAdmin.ok).toBe(true);
  });

  it("mutes a member, pins, and records poll votes", async () => {
    const owner = await activeUser("grp_mod");
    const member = await activeUser("grp_mem");
    const created = await createGroup(owner, { name: "ناظم", joinMode: "open", memberKeys: [] });
    expect(created.ok).toBe(true);
    if (!created.ok) return;
    await joinByToken(member, created.group.inviteToken!);
    const muted = await moderateMember(owner, created.group.id, member, "mute", { ms: 60 * 60 * 1000 });
    expect(muted.ok).toBe(true);
    const silenced = await sendGroupMessage(member, created.group.id, { ...envelope, kind: "text" });
    expect(silenced.ok).toBe(false);
    const poll = await sendGroupMessage(owner, created.group.id, {
      kind: "poll",
      poll: { question: "زمان جلسه؟", options: ["صبح", "عصر"] },
    });
    expect(poll.ok).toBe(true);
    if (!poll.ok) return;
    const { votePoll } = await import("./groups");
    const voted = await votePoll(owner, created.group.id, poll.message.id, [0]);
    expect(voted.ok).toBe(true);
    const pinned = await pinMessage(owner, created.group.id, poll.message.id, true);
    expect(pinned.ok).toBe(true);
    if (pinned.ok) expect(pinned.pinIds).toContain(poll.message.id);
    const snapshot = await getGroup(owner, created.group.id);
    expect(snapshot?.group.pinIds.length).toBeGreaterThan(0);
  });

  it("rotates invite links, bans rejoin, and only owner deletes", async () => {
    const owner = await activeUser("grp_del");
    const other = await activeUser("grp_ban");
    const created = await createGroup(owner, { name: "امن", joinMode: "open" });
    expect(created.ok).toBe(true);
    if (!created.ok) return;
    const first = created.group.inviteToken!;
    await joinByToken(other, first);
    const banned = await moderateMember(owner, created.group.id, other, "ban");
    expect(banned.ok).toBe(true);
    const again = await joinByToken(other, first);
    expect(again.ok).toBe(false);
    const rotated = await rotateInvite(owner, created.group.id, "new");
    expect(rotated.ok).toBe(true);
    if (rotated.ok) expect(rotated.inviteToken).not.toBe(first);
    const revoked = await rotateInvite(owner, created.group.id, "revoke");
    expect(revoked.ok).toBe(true);
    const outsiderDelete = await deleteGroup(other, created.group.id);
    expect(outsiderDelete.ok).toBe(false);
    const gone = await deleteGroup(owner, created.group.id);
    expect(gone.ok).toBe(true);
    expect(await getGroup(owner, created.group.id)).toBeNull();
  });

  it("flood-mutes repeated sends", async () => {
    const owner = await activeUser("grp_flood");
    const created = await createGroup(owner, { name: "سیلاب" });
    expect(created.ok).toBe(true);
    if (!created.ok) return;
    let last: { ok: boolean; status?: number } = { ok: true };
    for (let i = 0; i < 11; i += 1) {
      last = await sendGroupMessage(owner, created.group.id, { ...envelope, kind: "text" });
    }
    expect(last.ok).toBe(false);
    if (!last.ok) expect(last.status).toBe(429);
  });
});
