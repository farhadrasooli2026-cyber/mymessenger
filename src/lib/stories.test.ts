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

  it("enforces friends and nobody audiences and highlight IDOR", async () => {
    const owner = await activeUser("st_fr");
    const pal = await activeUser("st_frp");
    const stranger = await activeUser("st_frs");
    await mutateStore((data) => {
      const me = data.users.find((u) => u.id === owner);
      if (me) me.friendIds = [pal];
    });
    const friendsOnly = await createStory(owner, { kind: "text", body: "فقط دوستان", visibility: "friends" });
    expect(friendsOnly.ok).toBe(true);
    if (!friendsOnly.ok) return;
    const palFeed = await listStoryFeed(pal);
    expect(palFeed.rings.some((r) => r.items.some((s) => s.id === friendsOnly.story.id))).toBe(true);
    const strangerFeed = await listStoryFeed(stranger);
    expect(strangerFeed.rings.some((r) => r.items.some((s) => s.id === friendsOnly.story.id))).toBe(false);
    const hidden = await createStory(owner, { kind: "text", body: "فقط خودم", visibility: "nobody" });
    expect(hidden.ok).toBe(true);
    if (!hidden.ok) return;
    expect((await listStoryFeed(pal)).rings.some((r) => r.items.some((s) => s.id === hidden.story.id))).toBe(false);
    const { upsertHighlight, listHighlights, deleteHighlight } = await import("./stories");
    const hl = await upsertHighlight(owner, { name: "سفر", storyIds: [friendsOnly.story.id], visibility: "nobody" });
    expect(hl.ok).toBe(true);
    if (!hl.ok) return;
    const stolen = await listHighlights(stranger, owner);
    expect(stolen.some((h) => h.id === hl.highlight.id)).toBe(false);
    const del = await deleteHighlight(stranger, hl.highlight.id);
    expect(del.ok).toBe(false);
  });

  it("does not count the owner as a viewer and toggles story reactions", async () => {
    const owner = await activeUser("st_vw");
    const viewer = await activeUser("st_vwv");
    const created = await createStory(owner, { kind: "text", body: "بازدید" });
    expect(created.ok).toBe(true);
    if (!created.ok) return;
    await viewUserStory(owner, created.story.id);
    const { listViewers, reactStory } = await import("./stories");
    const mine = await listViewers(owner, created.story.id);
    expect(mine.ok && mine.viewers.length).toBe(0);
    const seen = await viewUserStory(viewer, created.story.id);
    expect(seen.ok).toBe(true);
    const again = await viewUserStory(viewer, created.story.id);
    expect(again.ok).toBe(true);
    const listed = await listViewers(owner, created.story.id);
    expect(listed.ok && listed.viewers.length).toBe(1);
    const add = await reactStory(viewer, created.story.id, "🔥");
    expect(add.ok).toBe(true);
    const rm = await reactStory(viewer, created.story.id, "🔥");
    expect(rm.ok && rm.action).toBe("remove");
  });

  it("rejects javascript story links", async () => {
    const owner = await activeUser("st_js");
    const bad = await createStory(owner, { kind: "text", body: "لینک", linkUrl: "javascript:alert(1)" });
    expect(bad.ok).toBe(false);
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

  it("rejects invalid media MIME, oversized text, and duplicate publish", async () => {
    const owner = await activeUser("st_mime");
    const badPhoto = await createStory(owner, { kind: "photo", media: "data:video/mp4;base64,AAAA" });
    expect(badPhoto.ok).toBe(false);
    const badAudio = await createStory(owner, { kind: "audio", media: "data:image/png;base64,iVBORw0KGgo=" });
    expect(badAudio.ok).toBe(false);
    const long = await createStory(owner, { kind: "text", body: "س".repeat(401) });
    expect(long.ok).toBe(false);
    const audio = await createStory(owner, {
      kind: "audio",
      media: "data:audio/webm;base64,GkXfo59ChoEBQveBAULygQRC84EIQoKEd2VibUKHgQRChYECGFOAZwEAAAAAAAHTEU2bdLpNu4tTq4QVSalmU6yBoU27i1OrhBZUqWZTr4GhTbuLU6uEElSpZlOvg6FNu4tTq4QWSalmU6+EoU27i1OrhBhUqWZTr4WhTbuLU6uEGFSpZlOv",
    });
    expect(audio.ok).toBe(true);
    const first = await createStory(owner, { kind: "text", body: "تکراری-یکسان" });
    expect(first.ok).toBe(true);
    const dup = await createStory(owner, { kind: "text", body: "تکراری-یکسان" });
    expect(dup.ok).toBe(false);
    if (!dup.ok) expect(dup.status).toBe(429);
  });

  it("does not leak private stories via share token, discovery, or muted feed", async () => {
    const owner = await activeUser("st_tok");
    const friend = await activeUser("st_tokf");
    const stranger = await activeUser("st_toks");
    await updateStorySettings(owner, { closeFriendIds: [friend] });
    const priv = await createStory(owner, { kind: "text", body: "نزدیکان", visibility: "closeFriends", allowShare: true });
    expect(priv.ok).toBe(true);
    if (!priv.ok) return;
    const token = priv.story.shareUrl.split("st=")[1] ?? "";
    expect(token.length).toBeGreaterThan(8);
    const { peekStoryShare, listDiscovery, muteAuthor, editStory, restoreStory, forwardStory, reactStory } = await import("./stories");
    const stolen = await peekStoryShare(stranger, token);
    expect(stolen.ok).toBe(false);
    const friendPeek = await peekStoryShare(friend, token);
    expect(friendPeek.ok).toBe(true);
    const pub = await createStory(owner, { kind: "text", body: "عمومی کشف", visibility: "everyone" });
    expect(pub.ok).toBe(true);
    if (!pub.ok) return;
    const disco = await listDiscovery(stranger);
    expect(disco.items.some((s) => s.id === pub.story.id)).toBe(true);
    expect(disco.items.some((s) => s.id === priv.story.id)).toBe(false);
    const fwd = await forwardStory(stranger, priv.story.id, friend);
    expect(fwd.ok).toBe(false);
    await muteAuthor(stranger, owner, true);
    const mutedFeed = await listStoryFeed(stranger);
    expect(mutedFeed.rings.some((r) => r.ownerId === owner)).toBe(false);
    const withMuted = await listStoryFeed(stranger, undefined, { includeMuted: true });
    expect(withMuted.rings.some((r) => r.ownerId === owner && r.muted)).toBe(true);
    const hijack = await editStory(stranger, pub.story.id, { caption: "hack" });
    expect(hijack.ok).toBe(false);
    if (!hijack.ok) expect(hijack.status).toBe(403);
    const closed = await createStory(owner, { kind: "text", body: "بدون واکنش", allowReactions: false });
    expect(closed.ok).toBe(true);
    if (!closed.ok) return;
    const react = await reactStory(friend, closed.story.id, "🔥");
    expect(react.ok).toBe(false);
    await mutateStore((data) => {
      const story = data.userStories.find((s) => s.id === pub.story.id);
      if (story) story.expiresAt = Date.now() - 1;
    });
    const restored = await restoreStory(owner, pub.story.id);
    expect(restored.ok).toBe(true);
    const live = await listStoryFeed(friend);
    expect(live.rings.some((r) => r.items.some((s) => s.id === pub.story.id))).toBe(true);
  });

  it("drops mentions that are outside the story audience", async () => {
    const owner = await activeUser("st_men");
    const inside = await activeUser("st_meni");
    const outside = await activeUser("st_meno");
    await updateStorySettings(owner, { closeFriendIds: [inside] });
    const created = await createStory(owner, {
      kind: "text",
      body: `سلام @st_meni و @st_meno`,
      visibility: "closeFriends",
    });
    expect(created.ok).toBe(true);
    if (!created.ok) return;
    expect(created.story.mentions).toContain(inside);
    expect(created.story.mentions).not.toContain(outside);
  });
});
