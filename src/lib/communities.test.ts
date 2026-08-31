import { afterEach, describe, expect, it } from "vitest";
import { hashIp } from "./crypto-utils";
import { completeProfile } from "./profile";
import { ackHumanChallenge, issueHumanChallenge, startRegistration, verifyOtp } from "./registration";
import { getOutbox } from "./outbox";
import { resetStoreForTests } from "./store";
import { createGroup } from "./groups";
import {
  addChannel,
  attachGroup,
  createCommunity,
  deleteCommunity,
  joinByToken,
  moderateMember,
  publishAnnouncement,
  publishPost,
} from "./communities";

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
    firstName: "جامعه",
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

describe("NIXO communities", () => {
  afterEach(async () => {
    await resetStoreForTests();
  });

  it("creates a community, attaches an owned group, and hosts a channel", async () => {
    const owner = await activeUser("com_own");
    const group = await createGroup(owner, { name: "عمومی" });
    expect(group.ok).toBe(true);
    if (!group.ok) return;
    const created = await createCommunity(owner, {
      name: "استودیو نیکسو",
      description: "جمع تیم",
      groupIds: [group.group.id],
      channelNames: ["اطلاعیه‌ها"],
      joinMode: "open",
    });
    expect(created.ok).toBe(true);
    if (!created.ok) return;
    expect(created.community.groups.some((g) => g.id === group.group.id)).toBe(true);
    expect(created.community.channels.some((c) => c.name === "اطلاعیه‌ها")).toBe(true);
    expect(created.community.myRole).toBe("owner");
  });

  it("blocks self-promotion and lets members join by invite", async () => {
    const owner = await activeUser("com_inv");
    const joiner = await activeUser("com_join");
    const created = await createCommunity(owner, { name: "باز", joinMode: "open" });
    expect(created.ok).toBe(true);
    if (!created.ok) return;
    const joined = await joinByToken(joiner, created.community.inviteToken!);
    expect(joined.ok).toBe(true);
    const promote = await moderateMember(joiner, created.community.id, owner, "role", { role: "admin" });
    expect(promote.ok).toBe(false);
    if (!promote.ok) expect(promote.status).toBe(403);
    const asAdmin = await moderateMember(owner, created.community.id, joiner, "role", { role: "admin" });
    expect(asAdmin.ok).toBe(true);
  });

  it("publishes announcements and channel posts for staff, not random members", async () => {
    const owner = await activeUser("com_post");
    const member = await activeUser("com_mem");
    const created = await createCommunity(owner, { name: "خبر", joinMode: "open", channelNames: ["اخبار"] });
    expect(created.ok).toBe(true);
    if (!created.ok) return;
    await joinByToken(member, created.community.inviteToken!);
    const note = await publishAnnouncement(owner, created.community.id, "جلسه فردا");
    expect(note.ok).toBe(true);
    const denied = await publishAnnouncement(member, created.community.id, "اسپم");
    expect(denied.ok).toBe(false);
    const channelId = created.community.channels[0]!.id;
    const post = await publishPost(owner, created.community.id, channelId, { body: "نسخه جدید" });
    expect(post.ok).toBe(true);
    const memberPost = await publishPost(member, created.community.id, channelId, { body: "من هم پست" });
    expect(memberPost.ok).toBe(false);
  });

  it("bans rejoin and only owner deletes", async () => {
    const owner = await activeUser("com_del");
    const other = await activeUser("com_ban");
    const created = await createCommunity(owner, { name: "امن", joinMode: "open" });
    expect(created.ok).toBe(true);
    if (!created.ok) return;
    await joinByToken(other, created.community.inviteToken!);
    const banned = await moderateMember(owner, created.community.id, other, "ban");
    expect(banned.ok).toBe(true);
    const again = await joinByToken(other, created.community.inviteToken!);
    expect(again.ok).toBe(false);
    const outsider = await deleteCommunity(other, created.community.id);
    expect(outsider.ok).toBe(false);
    const gone = await deleteCommunity(owner, created.community.id);
    expect(gone.ok).toBe(true);
  });

  it("refuses attaching someone else's group", async () => {
    const a = await activeUser("com_ga");
    const b = await activeUser("com_gb");
    const group = await createGroup(b, { name: "مال ب" });
    expect(group.ok).toBe(true);
    if (!group.ok) return;
    const community = await createCommunity(a, { name: "مال آ" });
    expect(community.ok).toBe(true);
    if (!community.ok) return;
    const extra = await addChannel(a, community.community.id, "پشتیبانی");
    expect(extra.ok).toBe(true);
    const stolen = await attachGroup(a, community.community.id, group.group.id);
    expect(stolen.ok).toBe(false);
  });
});
