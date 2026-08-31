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
  joinByToken,
  searchPublicChannels,
  setStaff,
  subscribe,
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
    const blocked = await deleteChannel(other, created.channel.id);
    expect(blocked.ok).toBe(false);
    const ok = await deleteChannel(owner, created.channel.id);
    expect(ok.ok).toBe(true);
  });
});
