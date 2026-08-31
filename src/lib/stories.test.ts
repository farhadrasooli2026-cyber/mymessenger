import { afterEach, describe, expect, it } from "vitest";
import { hashIp } from "./crypto-utils";
import { completeProfile } from "./profile";
import { ackHumanChallenge, issueHumanChallenge, startRegistration, verifyOtp } from "./registration";
import { getOutbox } from "./outbox";
import { mutateStore, resetStoreForTests } from "./store";
import {
  createStory,
  deleteStory,
  getStoryMedia,
  listArchive,
  listStoryFeed,
  updateStorySettings,
  viewUserStory,
} from "./stories";

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
    firstName: "استوری",
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

describe("NIXO stories", () => {
  afterEach(async () => {
    await resetStoreForTests();
  });

  it("creates a text story that others can see", async () => {
    const owner = await activeUser("st_own");
    const viewer = await activeUser("st_see");
    const created = await createStory(owner, { kind: "text", body: "سلام نیکسو @st_see" });
    expect(created.ok).toBe(true);
    if (!created.ok) return;
    const feed = await listStoryFeed(viewer);
    expect(feed.rings.some((r) => r.items.some((s) => s.id === created.story.id))).toBe(true);
  });

  it("hides expired stories from others and keeps them in the owner archive", async () => {
    const owner = await activeUser("st_exp");
    const viewer = await activeUser("st_expv");
    const created = await createStory(owner, { kind: "text", body: "موقت" });
    expect(created.ok).toBe(true);
    if (!created.ok) return;
    await mutateStore((data) => {
      const story = data.userStories.find((s) => s.id === created.story.id);
      if (story) story.expiresAt = Date.now() - 1;
    });
    const otherFeed = await listStoryFeed(viewer);
    expect(otherFeed.rings.some((r) => r.items.some((s) => s.id === created.story.id))).toBe(false);
    const ownFeed = await listStoryFeed(owner);
    expect(ownFeed.rings.some((r) => r.items.some((s) => s.id === created.story.id))).toBe(false);
    const archive = await listArchive(owner);
    expect(archive.some((s) => s.id === created.story.id)).toBe(true);
  });

  it("enforces close friends on the server", async () => {
    const owner = await activeUser("st_cf");
    const friend = await activeUser("st_cff");
    const stranger = await activeUser("st_cfs");
    await updateStorySettings(owner, { closeFriendIds: [friend] });
    const created = await createStory(owner, { kind: "text", body: "نزدیک", visibility: "closeFriends" });
    expect(created.ok).toBe(true);
    if (!created.ok) return;
    const friendFeed = await listStoryFeed(friend);
    expect(friendFeed.rings.some((r) => r.items.some((s) => s.id === created.story.id))).toBe(true);
    const strangerFeed = await listStoryFeed(stranger);
    expect(strangerFeed.rings.some((r) => r.items.some((s) => s.id === created.story.id))).toBe(false);
    const peek = await viewUserStory(stranger, created.story.id);
    expect(peek.ok).toBe(false);
  });

  it("hides a story from selected users and blocked accounts", async () => {
    const owner = await activeUser("st_hid");
    const hidden = await activeUser("st_hidx");
    const blocked = await activeUser("st_blk");
    const created = await createStory(owner, {
      kind: "text",
      body: "خصوصی",
      hideFromIds: [hidden],
    });
    expect(created.ok).toBe(true);
    if (!created.ok) return;
    const hiddenFeed = await listStoryFeed(hidden);
    expect(hiddenFeed.rings.some((r) => r.items.some((s) => s.id === created.story.id))).toBe(false);
    await mutateStore((data) => {
      const me = data.users.find((u) => u.id === owner);
      me?.blockedPeerKeys.push(blocked);
    });
    const blockedFeed = await listStoryFeed(blocked);
    expect(blockedFeed.rings.some((r) => r.items.some((s) => s.id === created.story.id))).toBe(false);
    const peek = await viewUserStory(blocked, created.story.id);
    expect(peek.ok).toBe(false);
  });

  it("lets only the owner delete a live story", async () => {
    const owner = await activeUser("st_del");
    const other = await activeUser("st_delo");
    const created = await createStory(owner, { kind: "text", body: "حذف" });
    expect(created.ok).toBe(true);
    if (!created.ok) return;
    const denied = await deleteStory(other, created.story.id);
    expect(denied.ok).toBe(false);
    if (!denied.ok) expect(denied.status).toBe(403);
    const ok = await deleteStory(owner, created.story.id);
    expect(ok.ok).toBe(true);
    const feed = await listStoryFeed(other);
    expect(feed.rings.some((r) => r.items.some((s) => s.id === created.story.id))).toBe(false);
  });

  it("keeps drafts off the public feed and signs media for authorized viewers only", async () => {
    const owner = await activeUser("st_dft");
    const other = await activeUser("st_dfo");
    const draft = await createStory(owner, { kind: "text", body: "پیش‌نویس", draft: true });
    expect(draft.ok).toBe(true);
    if (!draft.ok) return;
    const otherFeed = await listStoryFeed(other);
    expect(otherFeed.rings.some((r) => r.items.some((s) => s.id === draft.story.id))).toBe(false);
    const peek = await viewUserStory(other, draft.story.id);
    expect(peek.ok).toBe(false);
    const tiny = "data:image/jpeg;base64,/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRofHh0aHBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/2wBDAQkJCQwLDBgNDRgyIRwhMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjL/wAARCAABAAEDASIAAhEBAxEB/8QAFQABAQAAAAAAAAAAAAAAAAAAAAb/xAAUEAEAAAAAAAAAAAAAAAAAAAAA/8QAFQEBAQAAAAAAAAAAAAAAAAAAAAX/xAAUEQEAAAAAAAAAAAAAAAAAAAAA/9oADAMBAAIQAxAAAAGfAD/2Q==";
    const photo = await createStory(owner, { kind: "photo", media: tiny, visibility: "selected", allowIds: [] });
    expect(photo.ok).toBe(true);
    if (!photo.ok) return;
    const denied = await getStoryMedia(other, photo.story.id, "0.dead");
    expect(denied.ok).toBe(false);
    const selected = await createStory(owner, { kind: "text", body: "فقط تو", visibility: "selected", allowIds: [other] });
    expect(selected.ok).toBe(true);
    if (!selected.ok) return;
    const allowed = await listStoryFeed(other);
    expect(allowed.rings.some((r) => r.items.some((s) => s.id === selected.story.id))).toBe(true);
  });
});
