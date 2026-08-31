import "server-only";
import { randomId } from "@/lib/crypto-utils";
import { hitRateLimit } from "@/lib/rate-limit";
import { mutateStore, readStoreSnapshot } from "@/lib/store";
import type { StoreData, UserStory } from "@/lib/store";
import { emitNotification } from "@/lib/notify";
import { STORY_MAX_MEDIA, STORY_TTL_MS } from "@/lib/story-types";

function blocked(data: StoreData, a: string, b: string) {
  const ua = data.users.find((u) => u.id === a);
  const ub = data.users.find((u) => u.id === b);
  return Boolean(ua?.blockedPeerKeys.includes(b) || ub?.blockedPeerKeys.includes(a));
}

function isContact(data: StoreData, ownerId: string, viewerId: string) {
  const owner = data.users.find((u) => u.id === ownerId);
  const viewer = data.users.find((u) => u.id === viewerId);
  return Boolean(owner?.contactIds.includes(viewerId) || viewer?.contactIds.includes(ownerId));
}

export function canViewStory(data: StoreData, story: UserStory, viewerId: string, now: number, opts?: { archive?: boolean }) {
  if (story.deletedAt) return false;
  if (story.ownerUserId === viewerId) {
    if (opts?.archive) return true;
    return now <= story.expiresAt;
  }
  if (now > story.expiresAt) return false;
  if (blocked(data, story.ownerUserId, viewerId)) return false;
  if (story.hideFromIds.includes(viewerId)) return false;
  if (story.visibility === "everyone") return true;
  if (story.visibility === "contacts") return isContact(data, story.ownerUserId, viewerId);
  if (story.visibility === "closeFriends") {
    const owner = data.users.find((u) => u.id === story.ownerUserId);
    return Boolean(owner?.closeFriendIds.includes(viewerId));
  }
  return story.allowIds.includes(viewerId);
}

function canSeeStatus(data: StoreData, ownerId: string, viewerId: string) {
  const owner = data.users.find((u) => u.id === ownerId);
  if (!owner) return false;
  if (ownerId === viewerId) return true;
  if (blocked(data, ownerId, viewerId)) return false;
  if (owner.statusPrivacy === "nobody") return false;
  if (owner.statusPrivacy === "everyone") return true;
  if (owner.statusPrivacy === "contacts") return isContact(data, ownerId, viewerId);
  return owner.statusAllowIds.includes(viewerId);
}

function publicStory(story: UserStory, extra?: { viewed?: boolean; reactions?: { emoji: string; count: number }[]; expired?: boolean }) {
  return {
    id: story.id,
    ownerUserId: story.ownerUserId,
    kind: story.kind,
    body: story.body,
    caption: story.caption,
    bg: story.bg,
    font: story.font,
    align: story.align,
    filter: story.filter,
    rotate: story.rotate,
    zoom: story.zoom,
    overlay: story.overlay,
    media: story.media,
    musicId: story.musicId,
    linkUrl: story.linkUrl,
    mentions: story.mentions,
    allowShare: story.allowShare,
    createdAt: story.createdAt,
    expiresAt: story.expiresAt,
    ...extra,
  };
}

export async function listStoryFeed(userId: string) {
  const data = await readStoreSnapshot();
  const now = Date.now();
  const me = data.users.find((u) => u.id === userId);
  const muted = new Set(me?.mutedStoryUserIds ?? []);
  const rings: {
    ownerId: string;
    name: string;
    username: string | null;
    muted: boolean;
    viewedAll: boolean;
    status: { preset: string; text: string } | null;
    items: ReturnType<typeof publicStory>[];
  }[] = [];

  const byOwner = new Map<string, UserStory[]>();
  for (const story of data.userStories) {
    if (!canViewStory(data, story, userId, now)) continue;
    const list = byOwner.get(story.ownerUserId) ?? [];
    list.push(story);
    byOwner.set(story.ownerUserId, list);
  }

  for (const [ownerId, items] of byOwner) {
    const owner = data.users.find((u) => u.id === ownerId);
    const sorted = items.sort((a, b) => a.createdAt - b.createdAt);
    const viewedAll = sorted.every((s) => data.storyWatches.some((w) => w.storyId === s.id && w.viewerId === userId));
    rings.push({
      ownerId,
      name: owner?.displayName || owner?.username || "کاربر",
      username: owner?.username ?? null,
      muted: muted.has(ownerId),
      viewedAll,
      status: canSeeStatus(data, ownerId, userId)
        ? { preset: owner?.statusPreset ?? "", text: owner?.statusText ?? "" }
        : null,
      items: sorted.map((s) =>
        publicStory(s, {
          viewed: data.storyWatches.some((w) => w.storyId === s.id && w.viewerId === userId),
          reactions: countReactions(data, s.id),
        }),
      ),
    });
  }

  rings.sort((a, b) => {
    if (a.ownerId === userId) return -1;
    if (b.ownerId === userId) return 1;
    if (a.muted !== b.muted) return a.muted ? 1 : -1;
    if (a.viewedAll !== b.viewedAll) return a.viewedAll ? 1 : -1;
    return (b.items.at(-1)?.createdAt ?? 0) - (a.items.at(-1)?.createdAt ?? 0);
  });

  return { rings, myStatus: { preset: me?.statusPreset ?? "", text: me?.statusText ?? "" } };
}

function countReactions(data: StoreData, storyId: string) {
  const map = new Map<string, number>();
  for (const r of data.storyReactions.filter((x) => x.storyId === storyId)) {
    map.set(r.emoji, (map.get(r.emoji) ?? 0) + 1);
  }
  return [...map.entries()].map(([emoji, count]) => ({ emoji, count }));
}

export async function listArchive(userId: string) {
  const data = await readStoreSnapshot();
  const now = Date.now();
  return data.userStories
    .filter((s) => s.ownerUserId === userId && !s.deletedAt)
    .sort((a, b) => b.createdAt - a.createdAt)
    .map((s) => publicStory(s, { viewed: true, reactions: countReactions(data, s.id), expired: now > s.expiresAt }));
}

export async function createStory(
  userId: string,
  input: Partial<UserStory> & { kind: UserStory["kind"] },
) {
  const user = (await readStoreSnapshot()).users.find((u) => u.id === userId);
  if (!user) return { ok: false as const, error: "حساب فعال نیست.", status: 401 };
  return mutateStore((data) => {
    const now = Date.now();
    const flood = hitRateLimit(data, `story:${userId}`, 60_000, 8, now);
    if (!flood.allowed) return { ok: false as const, error: "انتشار استوری محدود شد.", status: 429 };
    const kind = input.kind;
    const media = typeof input.media === "string" ? input.media : "";
    if ((kind === "photo" || kind === "video") && media.length > STORY_MAX_MEDIA) {
      return { ok: false as const, error: "حجم رسانه برای استوری زیاد است. فشرده کن.", status: 413 };
    }
    if (kind === "text" && !(input.body ?? "").trim()) {
      return { ok: false as const, error: "متن استوری خالی است.", status: 400 };
    }
    if ((kind === "photo" || kind === "video") && media.length < 20) {
      return { ok: false as const, error: "رسانه ناقص است.", status: 400 };
    }
    const visibility = input.visibility ?? user.defaultStoryPrivacy ?? "everyone";
    const story: UserStory = {
      id: randomId(),
      ownerUserId: userId,
      kind,
      body: (input.body ?? "").slice(0, 400),
      caption: (input.caption ?? "").slice(0, 200),
      bg: input.bg || "#102824",
      font: input.font || "vazir",
      align: input.align === "left" || input.align === "center" ? input.align : "right",
      filter: input.filter || "none",
      rotate: Number(input.rotate) || 0,
      zoom: Math.min(2, Math.max(1, Number(input.zoom) || 1)),
      overlay: (input.overlay ?? "").slice(0, 80),
      media,
      musicId: input.musicId ?? null,
      linkUrl: /^https?:\/\//i.test(input.linkUrl ?? "") ? (input.linkUrl ?? "").slice(0, 300) : "",
      mentions: Array.isArray(input.mentions) ? input.mentions.slice(0, 8).map(String) : [],
      allowShare: input.allowShare !== false,
      visibility,
      allowIds: Array.isArray(input.allowIds) ? input.allowIds.slice(0, 40) : [],
      hideFromIds: Array.isArray(input.hideFromIds) ? input.hideFromIds.slice(0, 40) : [],
      createdAt: now,
      expiresAt: now + STORY_TTL_MS,
      deletedAt: null,
    };
    data.userStories.push(story);
    const owner = data.users.find((u) => u.id === userId);
    const candidates = new Set([...(owner?.contactIds ?? []), ...story.allowIds, ...story.mentions]);
    for (const vid of candidates) {
      if (vid === userId) continue;
      const viewer = data.users.find((u) => u.id === vid && u.status === "active");
      if (!viewer) continue;
      if (viewer.mutedStoryUserIds.includes(userId) || viewer.storyNotifyOffIds.includes(userId)) continue;
      if (!canViewStory(data, story, vid, now)) continue;
      emitNotification(data, {
        userId: vid,
        category: "stories",
        kind: story.mentions.includes(vid) ? "mention" : "story",
        title: owner?.displayName || owner?.username || "استوری",
        senderName: owner?.displayName || "",
        body: "استوری جدید",
        mention: story.mentions.includes(vid),
        sourceId: `story:${userId}`,
        muteType: "user",
        muteId: userId,
        target: { type: "story", id: story.id },
      });
    }
    return { ok: true as const, story: publicStory(story) };
  });
}

export async function deleteStory(userId: string, storyId: string) {
  return mutateStore((data) => {
    const story = data.userStories.find((s) => s.id === storyId);
    if (!story || story.deletedAt) return { ok: false as const, error: "استوری یافت نشد.", status: 404 };
    if (story.ownerUserId !== userId) return { ok: false as const, error: "فقط صاحب می‌تواند حذف کند.", status: 403 };
    story.deletedAt = Date.now();
    return { ok: true as const };
  });
}

export async function viewUserStory(userId: string, storyId: string) {
  return mutateStore((data) => {
    const now = Date.now();
    const story = data.userStories.find((s) => s.id === storyId);
    if (!story || !canViewStory(data, story, userId, now)) {
      return { ok: false as const, error: "استوری در دسترس نیست.", status: 404 };
    }
    const user = data.users.find((u) => u.id === userId);
    if (!data.storyWatches.some((w) => w.storyId === storyId && w.viewerId === userId)) {
      data.storyWatches.push({
        storyId,
        viewerId: userId,
        viewerName: user?.displayName || user?.username || "بیننده",
        viewedAt: now,
      });
    }
    return { ok: true as const };
  });
}

export async function listViewers(userId: string, storyId: string) {
  const data = await readStoreSnapshot();
  const story = data.userStories.find((s) => s.id === storyId && s.ownerUserId === userId && !s.deletedAt);
  if (!story) return { ok: false as const, error: "استوری یافت نشد.", status: 404 };
  const viewers = data.storyWatches.filter((w) => w.storyId === storyId && w.viewerId !== userId);
  const reactions = data.storyReactions.filter((r) => r.storyId === storyId);
  const replies = data.storyReplies.filter((r) => r.storyId === storyId);
  return { ok: true as const, viewers, reactions, replies };
}

export async function reactStory(userId: string, storyId: string, emoji: string) {
  const safe = emoji.slice(0, 8);
  return mutateStore((data) => {
    const now = Date.now();
    const story = data.userStories.find((s) => s.id === storyId);
    if (!story || !canViewStory(data, story, userId, now)) {
      return { ok: false as const, error: "استوری در دسترس نیست.", status: 404 };
    }
    data.storyReactions = data.storyReactions.filter((r) => !(r.storyId === storyId && r.userId === userId));
    data.storyReactions.push({ storyId, userId, emoji: safe, at: now });
    return { ok: true as const };
  });
}

export async function replyStory(userId: string, storyId: string, body: string) {
  const text = body.trim().slice(0, 400);
  if (!text) return { ok: false as const, error: "پاسخ خالی است.", status: 400 };
  return mutateStore((data) => {
    const now = Date.now();
    const story = data.userStories.find((s) => s.id === storyId);
    if (!story || !canViewStory(data, story, userId, now)) {
      return { ok: false as const, error: "استوری در دسترس نیست.", status: 404 };
    }
    const user = data.users.find((u) => u.id === userId);
    data.storyReplies.push({
      id: randomId(),
      storyId,
      fromId: userId,
      fromName: user?.displayName || "کاربر",
      body: text,
      createdAt: now,
    });
    return { ok: true as const };
  });
}

export async function muteAuthor(userId: string, authorId: string, muted: boolean) {
  return mutateStore((data) => {
    const me = data.users.find((u) => u.id === userId);
    if (!me) return { ok: false as const, error: "حساب فعال نیست.", status: 401 };
    me.mutedStoryUserIds = me.mutedStoryUserIds.filter((id) => id !== authorId);
    if (muted) me.mutedStoryUserIds.push(authorId);
    return { ok: true as const, mutedStoryUserIds: me.mutedStoryUserIds };
  });
}

export async function getStorySettings(userId: string) {
  const data = await readStoreSnapshot();
  const me = data.users.find((u) => u.id === userId);
  if (!me) return null;
  const people = data.users
    .filter((u) => u.id !== userId && u.status === "active")
    .map((u) => ({ id: u.id, name: u.displayName || u.username || "کاربر", username: u.username ?? null }));
  return {
    closeFriendIds: me.closeFriendIds,
    mutedStoryUserIds: me.mutedStoryUserIds,
    storyNotifyOffIds: me.storyNotifyOffIds,
    statusPreset: me.statusPreset,
    statusText: me.statusText,
    statusPrivacy: me.statusPrivacy,
    statusAllowIds: me.statusAllowIds,
    defaultStoryPrivacy: me.defaultStoryPrivacy,
    people,
  };
}

export async function updateStorySettings(
  userId: string,
  patch: Partial<{
    closeFriendIds: string[];
    storyNotifyOffIds: string[];
    statusPreset: "" | "available" | "busy" | "work" | "away" | "custom";
    statusText: string;
    statusPrivacy: "everyone" | "contacts" | "nobody" | "selected";
    statusAllowIds: string[];
    defaultStoryPrivacy: "everyone" | "contacts" | "closeFriends" | "selected";
  }>,
) {
  return mutateStore((data) => {
    const me = data.users.find((u) => u.id === userId);
    if (!me) return { ok: false as const, error: "حساب فعال نیست.", status: 401 };
    if (Array.isArray(patch.closeFriendIds)) me.closeFriendIds = patch.closeFriendIds.slice(0, 80);
    if (Array.isArray(patch.storyNotifyOffIds)) me.storyNotifyOffIds = patch.storyNotifyOffIds.slice(0, 80);
    if (patch.statusPreset !== undefined) me.statusPreset = patch.statusPreset;
    if (typeof patch.statusText === "string") me.statusText = patch.statusText.slice(0, 40);
    if (patch.statusPrivacy) me.statusPrivacy = patch.statusPrivacy;
    if (Array.isArray(patch.statusAllowIds)) me.statusAllowIds = patch.statusAllowIds.slice(0, 80);
    if (patch.defaultStoryPrivacy) me.defaultStoryPrivacy = patch.defaultStoryPrivacy;
    return { ok: true as const };
  });
}
