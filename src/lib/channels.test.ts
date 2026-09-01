import { afterEach, describe, expect, it } from "vitest";
import { hashIp } from "./crypto-utils";
import { completeProfile } from "./profile";
import { ackHumanChallenge, issueHumanChallenge, startRegistration, verifyOtp } from "./registration";
import { getOutbox } from "./outbox";
import { resetStoreForTests } from "./store";
import {
  createChannel,
  createPost,
  deleteChannel,
  deletePost,
  getChannel,
  joinByToken,
  recordPostView,
  searchPublicChannels,
  setStaff,
  subscribe,
  transferChannelOwner,
  moderateJoinRequest,
  cancelScheduledPost,
  listChannelDiscovery,
  exportChannelData,
  adminChannelLifecycle,
} from "./channels";

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
    firstName: "کانال",
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

describe("NIXO channels", () => {
  afterEach(async () => {
    await resetStoreForTests();
  });

  it("creates a public channel with unique username and publishes posts", async () => {
    const owner = await activeUser("ch_own");
    const created = await createChannel(owner, {
      name: "اخبار نیکسو",
      username: "nixo_news",
      visibility: "public",
      description: "به‌روز",
    });
    expect(created.ok).toBe(true);
    if (!created.ok) return;
    expect(created.channel.username).toBe("nixo_news");
    const post = await createPost(owner, created.channel.id, { body: "نسخه جدید آمد", kind: "text" });
    expect(post.ok).toBe(true);
    const clash = await createChannel(await activeUser("ch_two"), {
      name: "دیگر",
      username: "nixo_news",
      visibility: "public",
    });
    expect(clash.ok).toBe(false);
  });

  it("hides private channels from public search and allows invite join", async () => {
    const owner = await activeUser("ch_priv");
    const other = await activeUser("ch_fan");
    const created = await createChannel(owner, { name: "داخلی", visibility: "private" });
    expect(created.ok).toBe(true);
    if (!created.ok) return;
    const found = await searchPublicChannels("داخلی", other);
    expect(found.some((c) => c.id === created.channel.id)).toBe(false);
    const open = await subscribe(other, created.channel.id);
    expect(open.ok).toBe(false);
    const joined = await joinByToken(other, created.channel.inviteToken!);
    expect(joined.ok).toBe(true);
  });

  it("rejects subscriber posts and self-promotion", async () => {
    const owner = await activeUser("ch_mod");
    const fan = await activeUser("ch_sub");
    const created = await createChannel(owner, { name: "آموزش", username: "nixo_learn", visibility: "public" });
    expect(created.ok).toBe(true);
    if (!created.ok) return;
    await subscribe(fan, created.channel.id);
    const fake = await createPost(fan, created.channel.id, { body: "اسپم" });
    expect(fake.ok).toBe(false);
    if (!fake.ok) expect(fake.status).toBe(403);
    const promote = await setStaff(fan, created.channel.id, fan, "admin");
    expect(promote.ok).toBe(false);
    const post = await createPost(owner, created.channel.id, { body: "درس یک" });
    expect(post.ok).toBe(true);
    if (!post.ok) return;
    const gone = await deletePost(fan, created.channel.id, post.post.id);
    expect(gone.ok).toBe(false);
  });

  it("only owner deletes the channel", async () => {
    const owner = await activeUser("ch_del");
    const other = await activeUser("ch_x");
    const created = await createChannel(owner, { name: "موقت", username: "nixo_tmp", visibility: "public" });
    expect(created.ok).toBe(true);
    if (!created.ok) return;
    const blocked = await deleteChannel(other, created.channel.id, { confirm: "DELETE" });
    expect(blocked.ok).toBe(false);
    const missing = await deleteChannel(owner, created.channel.id);
    expect(missing.ok).toBe(false);
    const ok = await deleteChannel(owner, created.channel.id, { confirm: "DELETE" });
    expect(ok.ok).toBe(true);
  });

  it("counts views server-side and requires TRANSFER confirmation for ownership", async () => {
    const owner = await activeUser("ch_own2");
    const fan = await activeUser("ch_fan2");
    const created = await createChannel(owner, { name: "آمار", username: "nixo_stats", visibility: "public" });
    expect(created.ok).toBe(true);
    if (!created.ok) return;
    const post = await createPost(owner, created.channel.id, { body: "پست آمار", kind: "text" });
    expect(post.ok).toBe(true);
    if (!post.ok) return;
    await subscribe(fan, created.channel.id);
    const viewed = await recordPostView(fan, created.channel.id, post.post.id);
    expect(viewed.ok).toBe(true);
    if (viewed.ok) expect(viewed.views).toBeGreaterThanOrEqual(1);
    const noConfirm = await transferChannelOwner(owner, created.channel.id, fan, "nope");
    expect(noConfirm.ok).toBe(false);
    const moved = await transferChannelOwner(owner, created.channel.id, fan, "TRANSFER");
    expect(moved.ok).toBe(true);
  });

  it("keeps subscriber lists off the public payload and publishes quizzes", async () => {
    const owner = await activeUser("ch_own3");
    const fan = await activeUser("ch_fan3");
    const created = await createChannel(owner, { name: "عمومی", username: "nixo_pubq", visibility: "public" });
    expect(created.ok).toBe(true);
    if (!created.ok) return;
    await subscribe(fan, created.channel.id);
    const asFan = await getChannel(fan, created.channel.id);
    expect(asFan?.channel.subscribers).toEqual([]);
    const quiz = await createPost(owner, created.channel.id, {
      kind: "quiz",
      poll: { question: "پایتخت؟", options: ["تهران", "اصفهان"], quiz: true, correctIndex: 0 },
    });
    expect(quiz.ok).toBe(true);
    if (!quiz.ok) return;
    expect(quiz.post.kind).toBe("quiz");
  });

  it("handles join requests, schedule cancel, unique views, and hides deleted channels", async () => {
    const owner = await activeUser("ch_join_o");
    const fan = await activeUser("ch_join_f");
    const created = await createChannel(owner, { name: "خصوصی درخواست", visibility: "private", joinMode: "request" });
    expect(created.ok).toBe(true);
    if (!created.ok) return;
    const asked = await subscribe(fan, created.channel.id);
    expect(asked.ok).toBe(true);
    if (asked.ok) expect(asked.requested).toBe(true);
    const before = await getChannel(fan, created.channel.id);
    expect(before).toBeNull();
    const okJoin = await moderateJoinRequest(owner, created.channel.id, fan, true);
    expect(okJoin.ok).toBe(true);
    expect((await getChannel(fan, created.channel.id))?.channel.subscribed).toBe(true);

    const sched = await createPost(owner, created.channel.id, {
      body: "بعداً",
      status: "scheduled",
      scheduledAt: Date.now() + 60_000 * 60,
    });
    expect(sched.ok).toBe(true);
    if (!sched.ok) return;
    const cancelled = await cancelScheduledPost(owner, created.channel.id, sched.post.id);
    expect(cancelled.ok).toBe(true);

    const pub = await createChannel(owner, { name: "کشف", username: "nixo_disc1", visibility: "public" });
    expect(pub.ok).toBe(true);
    if (!pub.ok) return;
    const post = await createPost(owner, pub.channel.id, { body: "عمومی" });
    expect(post.ok).toBe(true);
    if (!post.ok) return;
    await recordPostView(fan, pub.channel.id, post.post.id);
    await recordPostView(fan, pub.channel.id, post.post.id);
    const disc = await listChannelDiscovery(fan, "trending");
    expect(disc.ok).toBe(true);
    if (disc.ok) expect(disc.channels.some((c) => c.id === pub.channel.id)).toBe(true);
    expect(disc.ok && disc.channels.some((c) => c.id === created.channel.id)).toBe(false);

    const dumped = await exportChannelData(fan, pub.channel.id);
    expect(dumped.ok).toBe(false);
    const mine = await exportChannelData(owner, pub.channel.id);
    expect(mine.ok).toBe(true);

    await deleteChannel(owner, pub.channel.id, { confirm: "DELETE" });
    expect(await getChannel(fan, pub.channel.id)).toBeNull();
    expect((await searchPublicChannels("کشف", fan)).some((c) => c.id === pub.channel.id)).toBe(false);
  });

  it("rejects IDOR on private posts and platform suspend", async () => {
    const owner = await activeUser("ch_idor_o");
    const stranger = await activeUser("ch_idor_s");
    const ops = await activeUser("nixo_ops");
    const created = await createChannel(owner, { name: "محرمانه", visibility: "private" });
    expect(created.ok).toBe(true);
    if (!created.ok) return;
    const post = await createPost(owner, created.channel.id, { body: "مخفی" });
    expect(post.ok).toBe(true);
    if (!post.ok) return;
    expect(await getChannel(stranger, created.channel.id)).toBeNull();
    const view = await recordPostView(stranger, created.channel.id, post.post.id);
    expect(view.ok).toBe(false);
    const blocked = await adminChannelLifecycle(stranger, created.channel.id, "suspended");
    expect(blocked.ok).toBe(false);
    const frozen = await adminChannelLifecycle(ops, created.channel.id, "suspended");
    expect(frozen.ok).toBe(true);
  });

  it("lets editors post, rejects script payloads, and paginates subscribers for staff only", async () => {
    const owner = await activeUser("ch_ed_o");
    const editor = await activeUser("ch_ed_e");
    const stranger = await activeUser("ch_ed_s");
    const created = await createChannel(owner, { name: "سردبیر", username: "nixo_edch", visibility: "public" });
    expect(created.ok).toBe(true);
    if (!created.ok) return;
    await subscribe(editor, created.channel.id);
    const asEd = await setStaff(owner, created.channel.id, editor, "editor");
    expect(asEd.ok).toBe(true);
    const posted = await createPost(editor, created.channel.id, { body: "پیش‌نویس سردبیر", kind: "text", clientNonce: "n1" });
    expect(posted.ok).toBe(true);
    const dup = await createPost(editor, created.channel.id, { body: "دیگر", kind: "text", clientNonce: "n1" });
    expect(dup.ok).toBe(true);
    if (posted.ok && dup.ok) expect(dup.post.id).toBe(posted.post.id);
    const xss = await createPost(owner, created.channel.id, { body: '<script>alert(1)</script>سلام', kind: "text" });
    expect(xss.ok).toBe(true);
    if (xss.ok) expect(xss.post.body.toLowerCase()).not.toContain("<script");
    const stealRole = await setStaff(stranger, created.channel.id, editor, "admin");
    expect(stealRole.ok).toBe(false);
    const { listChannelSubscribers, listChannelPosts } = await import("./channels");
    const subs = await listChannelSubscribers(stranger, created.channel.id);
    expect(subs && "ok" in subs && subs.ok === false).toBe(true);
    const ownerSubs = await listChannelSubscribers(owner, created.channel.id);
    expect(ownerSubs && "ok" in ownerSubs && ownerSubs.ok && ownerSubs.subscribers.some((s) => s.id)).toBe(true);
    const page = await listChannelPosts(stranger, created.channel.id);
    expect(page?.posts.some((p) => p.id === (posted.ok ? posted.post.id : ""))).toBe(true);
    const priv = await createChannel(owner, { name: "خصوصی دوم", visibility: "private" });
    expect(priv.ok).toBe(true);
    if (!priv.ok) return;
    const hidden = await listChannelPosts(stranger, priv.channel.id);
    expect(hidden).toBeNull();
  });
});
