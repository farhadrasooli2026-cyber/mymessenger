import "server-only";
import { createHmac, timingSafeEqual } from "node:crypto";
import { randomId } from "@/lib/crypto-utils";
import { config } from "@/lib/config";
import { hitRateLimit } from "@/lib/rate-limit";
import { mutateStore, readStoreSnapshot } from "@/lib/store";
import type { StoreData, UserStory } from "@/lib/store";
import { emitNotification } from "@/lib/notify";
import {
  STORY_MAX_MEDIA,
  STORY_MEDIA_TOKEN_MS,
  STORY_TTL_MS,
  STORY_VIDEO_MAX_MS,
  type StoryKind,
  type StoryPurpose,
  type StoryVisibility,
} from "@/lib/story-types";

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
  if (story.draft && story.ownerUserId !== viewerId) return false;
  if (story.ownerUserId === viewerId) {
    if (opts?.archive || story.draft) return true;
    return now <= story.expiresAt;
  }
  if (story.draft) return false;
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

export function signStoryMedia(storyId: string, viewerId: string, exp = Date.now() + STORY_MEDIA_TOKEN_MS) {
  const sig = createHmac("sha256", config.pepper).update(`${storyId}.${viewerId}.${exp}`).digest("hex").slice(0, 32);
  return `${exp}.${sig}`;
}

export function verifyStoryMedia(storyId: string, viewerId: string, token: string) {
  const [expRaw, sig] = token.split(".");
  const exp = Number(expRaw);
  if (!exp || !sig || Date.now() > exp) return false;
  const expected = signStoryMedia(storyId, viewerId, exp);
  try {
    return timingSafeEqual(Buffer.from(expected), Buffer.from(`${exp}.${sig}`));
  } catch {
    return false;
  }
}

function publicStory(
  story: UserStory,
  viewerId: string,
  extra?: { viewed?: boolean; reactions?: { emoji: string; count: number }[]; expired?: boolean },
) {
  const token = story.media ? signStoryMedia(story.id, viewerId) : "";
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
    textSize: story.textSize,
    textX: story.textX,
    textY: story.textY,
    blur: story.blur,
    drawData: story.drawData,
    stickers: story.stickers,
    location: story.location,
    media: "",
    mediaUrl: story.media ? `/api/stories/${story.id}/media?t=${token}` : "",
    musicId: story.musicId,
    linkUrl: story.linkUrl,
    mentions: story.mentions,
    allowShare: story.allowShare,
    allowReplies: story.allowReplies,
    purpose: story.purpose,
    source: story.source,
    draft: story.draft,
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
    source: "user" | "channel";
    items: ReturnType<typeof publicStory>[];
  }[] = [];

  const byOwner = new Map<string, UserStory[]>();
  for (const story of data.userStories) {
    if (story.draft) continue;
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
      source: "user",
      status: canSeeStatus(data, ownerId, userId)
        ? { preset: owner?.statusPreset ?? "", text: owner?.statusText ?? "" }
        : null,
      items: sorted.map((s) =>
        publicStory(s, userId, {
          viewed: data.storyWatches.some((w) => w.storyId === s.id && w.viewerId === userId),
          reactions: countReactions(data, s.id),
        }),
      ),
    });
  }

  for (const channel of data.pubChannels) {
    if (channel.deletedAt) continue;
    const sub = channel.subscribers.some((s) => s.userId === userId && !s.leftAt);
    const staff = channel.staff.some((s) => s.userId === userId);
    if (!sub && !staff && channel.visibility !== "public") continue;
    const live = (channel.stories ?? []).filter((s) => s.expiresAt > now);
    if (!live.length) continue;
    rings.push({
      ownerId: `channel:${channel.id}`,
      name: channel.name,
      username: channel.username,
      muted: false,
      viewedAll: live.every((s) => s.views.includes(userId)),
      source: "channel",
      status: null,
      items: live.map((s) => ({
        id: s.id,
        ownerUserId: `channel:${channel.id}`,
        kind: (s.photoDataUrl ? "photo" : "text") as StoryKind,
        body: s.body,
        caption: "",
        bg: channel.color,
        font: "vazir",
        align: "right" as const,
        filter: "none",
        rotate: 0,
        zoom: 1,
        overlay: "",
        textSize: 22,
        textX: 50,
        textY: 50,
        blur: 0,
        drawData: "",
        stickers: [] as { emoji: string; x: number; y: number }[],
        location: "",
        media: "",
        mediaUrl: s.photoDataUrl ? s.photoDataUrl : "",
        musicId: null,
        linkUrl: "",
        mentions: [] as string[],
        allowShare: false,
        allowReplies: false,
        purpose: "announcement" as const,
        source: "channel" as const,
        draft: false,
        createdAt: s.createdAt,
        expiresAt: s.expiresAt,
        viewed: s.views.includes(userId),
        reactions: [],
      })),
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
  const me = data.users.find((u) => u.id === userId);
  if (me && me.storyArchiveEnabled === false) return [];
  const now = Date.now();
  return data.userStories
    .filter((s) => s.ownerUserId === userId && !s.deletedAt && !s.draft)
    .sort((a, b) => b.createdAt - a.createdAt)
    .map((s) => publicStory(s, userId, { viewed: true, reactions: countReactions(data, s.id), expired: now > s.expiresAt }));
}

export async function listDrafts(userId: string) {
  const data = await readStoreSnapshot();
  return data.userStories
    .filter((s) => s.ownerUserId === userId && !s.deletedAt && s.draft)
    .sort((a, b) => b.createdAt - a.createdAt)
    .map((s) => publicStory(s, userId, { viewed: true }));
}

function resolveMentions(data: StoreData, raw: string[]) {
  const ids: string[] = [];
  for (const item of raw.slice(0, 8)) {
    const needle = item.replace(/^@/, "").toLowerCase();
    const user = data.users.find((u) => u.id === item || u.username === needle);
    if (user) ids.push(user.id);
  }
  return [...new Set(ids)];
}

export async function createStory(userId: string, input: Partial<UserStory> & { kind: StoryKind }) {
  const user = (await readStoreSnapshot()).users.find((u) => u.id === userId);
  if (!user) return { ok: false as const, error: "حساب فعال نیست.", status: 401 };
  return mutateStore((data) => {
    const now = Date.now();
    const flood = hitRateLimit(data, `story:${userId}`, 60_000, 8, now);
    if (!flood.allowed) return { ok: false as const, error: "انتشار استوری محدود شد.", status: 429 };
    const kind = input.kind;
    const media = typeof input.media === "string" ? input.media : "";
    const needsMedia = kind === "photo" || kind === "video" || kind === "gif";
    if (needsMedia && media.length > STORY_MAX_MEDIA) {
      return { ok: false as const, error: "حجم رسانه برای استوری زیاد است. فشرده کن.", status: 413 };
    }
    if (kind === "video") {
      const dur = Number(input.videoDurationMs) || 0;
      if (dur > STORY_VIDEO_MAX_MS) return { ok: false as const, error: "ویدیو استوری حداکثر ۱۵ ثانیه است.", status: 400 };
      if (media && !/^data:video\/(mp4|webm|quicktime)/i.test(media)) {
        return { ok: false as const, error: "فرمت ویدیو پشتیبانی نمی‌شود (mp4/webm).", status: 400 };
      }
    }
    if (kind === "text" && !(input.body ?? "").trim() && !(input.overlay ?? "").trim()) {
      return { ok: false as const, error: "متن استوری خالی است.", status: 400 };
    }
    if (kind === "location" && !(input.location ?? input.body ?? "").trim()) {
      return { ok: false as const, error: "موقعیت خالی است.", status: 400 };
    }
    if (kind === "sticker" && !(input.overlay ?? "").trim() && !(input.stickers ?? []).length) {
      return { ok: false as const, error: "استیکر انتخاب نشده.", status: 400 };
    }
    if (needsMedia && media.length < 20) {
      return { ok: false as const, error: "رسانه ناقص است.", status: 400 };
    }
    const visibility = (input.visibility ?? user.defaultStoryPrivacy ?? "everyone") as StoryVisibility;
    const hideFrom = [
      ...(Array.isArray(input.hideFromIds) ? input.hideFromIds : []),
      ...(user.defaultHideFromIds ?? []),
    ];
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
      textSize: Math.min(48, Math.max(14, Number(input.textSize) || 22)),
      textX: Math.min(100, Math.max(0, Number(input.textX) || 50)),
      textY: Math.min(100, Math.max(0, Number(input.textY) || 50)),
      blur: Math.min(12, Math.max(0, Number(input.blur) || 0)),
      drawData: (input.drawData ?? "").slice(0, 12_000),
      stickers: Array.isArray(input.stickers) ? input.stickers.slice(0, 8) : [],
      location: (input.location ?? "").slice(0, 80),
      media,
      musicId: input.musicId ?? null,
      linkUrl: /^https?:\/\//i.test(input.linkUrl ?? "") ? (input.linkUrl ?? "").slice(0, 300) : "",
      mentions: resolveMentions(data, Array.isArray(input.mentions) ? input.mentions.map(String) : []),
      allowShare: input.allowShare !== false && user.storyAllowShare !== false,
      allowReplies: input.allowReplies !== false && user.storyAllowReplies !== false,
      visibility,
      allowIds: Array.isArray(input.allowIds) ? input.allowIds.slice(0, 40) : [],
      hideFromIds: [...new Set(hideFrom)].slice(0, 40),
      purpose: (input.purpose as StoryPurpose) || "general",
      source: input.source === "business" || input.source === "channel" ? input.source : "user",
      sourceId: input.sourceId ?? null,
      draft: Boolean(input.draft),
      videoDurationMs: Number(input.videoDurationMs) || 0,
      createdAt: now,
      expiresAt: now + STORY_TTL_MS,
      deletedAt: null,
    };
    data.userStories.push(story);
    if (!story.draft) notifyStory(data, story, userId, now);
    return { ok: true as const, story: publicStory(story, userId) };
  });
}

function notifyStory(data: StoreData, story: UserStory, userId: string, now: number) {
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
}

export async function publishDraft(userId: string, storyId: string) {
  return mutateStore((data) => {
    const story = data.userStories.find((s) => s.id === storyId && s.ownerUserId === userId && !s.deletedAt);
    if (!story) return { ok: false as const, error: "پیش‌نویس یافت نشد.", status: 404 };
    if (!story.draft) return { ok: false as const, error: "قبلاً منتشر شده.", status: 400 };
    const now = Date.now();
    story.draft = false;
    story.createdAt = now;
    story.expiresAt = now + STORY_TTL_MS;
    notifyStory(data, story, userId, now);
    return { ok: true as const, story: publicStory(story, userId) };
  });
}

export async function deleteStory(userId: string, storyId: string) {
  return mutateStore((data) => {
    const story = data.userStories.find((s) => s.id === storyId);
    if (!story || story.deletedAt) return { ok: false as const, error: "استوری یافت نشد.", status: 404 };
    if (story.ownerUserId !== userId) return { ok: false as const, error: "فقط صاحب می‌تواند حذف کند.", status: 403 };
    story.deletedAt = Date.now();
    story.media = "";
    return { ok: true as const };
  });
}

export async function viewUserStory(userId: string, storyId: string) {
  return mutateStore((data) => {
    const now = Date.now();
    const story = data.userStories.find((s) => s.id === storyId);
    if (!story || !canViewStory(data, story, userId, now, { archive: story.ownerUserId === userId })) {
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

export async function getStoryMedia(userId: string, storyId: string, token: string) {
  const data = await readStoreSnapshot();
  const now = Date.now();
  const story = data.userStories.find((s) => s.id === storyId);
  if (!story || !story.media) return { ok: false as const, error: "رسانه نیست.", status: 404 };
  if (!canViewStory(data, story, userId, now, { archive: story.ownerUserId === userId })) {
    return { ok: false as const, error: "اجازه نداری.", status: 403 };
  }
  if (!verifyStoryMedia(storyId, userId, token)) {
    return { ok: false as const, error: "لینک رسانه منقضی یا نامعتبر است.", status: 403 };
  }
  return { ok: true as const, media: story.media };
}

export async function listViewers(userId: string, storyId: string) {
  const data = await readStoreSnapshot();
  const story = data.userStories.find((s) => s.id === storyId && s.ownerUserId === userId && !s.deletedAt);
  if (!story) return { ok: false as const, error: "استوری یافت نشد.", status: 404 };
  const viewers = data.storyWatches.filter((w) => w.storyId === storyId && w.viewerId !== userId);
  const reactions = data.storyReactions.filter((r) => r.storyId === storyId);
  const replies = data.storyReplies.filter((r) => r.storyId === storyId);
  return {
    ok: true as const,
    viewers,
    reactions,
    replies,
    analytics: {
      views: viewers.length,
      reach: new Set(viewers.map((v) => v.viewerId)).size,
      reactions: reactions.length,
      replies: replies.length,
      engagement: reactions.length + replies.length,
    },
  };
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
    if (!story.allowReplies) return { ok: false as const, error: "پاسخ برای این استوری بسته است.", status: 403 };
    const user = data.users.find((u) => u.id === userId);
    data.storyReplies.push({
      id: randomId(),
      storyId,
      fromId: userId,
      fromName: user?.displayName || "کاربر",
      body: text,
      createdAt: now,
    });
    emitNotification(data, {
      userId: story.ownerUserId,
      category: "messages",
      kind: "story_reply",
      title: user?.displayName || "پاسخ استوری",
      senderName: user?.displayName || "",
      body: "به استوری‌ات پاسخ داد (صندوق استوری؛ متن داخل پاکت E2EE چت نیست).",
      sourceId: `story-reply:${storyId}`,
      muteType: "user",
      muteId: userId,
      target: { type: "story", id: storyId },
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
    defaultHideFromIds: me.defaultHideFromIds ?? [],
    storyAllowReplies: me.storyAllowReplies !== false,
    storyAllowShare: me.storyAllowShare !== false,
    storyArchiveEnabled: me.storyArchiveEnabled !== false,
    people,
  };
}

export async function updateStorySettings(
  userId: string,
  patch: Partial<{
    closeFriendIds: string[];
    storyNotifyOffIds: string[];
    defaultHideFromIds: string[];
    statusPreset: "" | "available" | "busy" | "work" | "away" | "custom";
    statusText: string;
    statusPrivacy: "everyone" | "contacts" | "nobody" | "selected";
    statusAllowIds: string[];
    defaultStoryPrivacy: StoryVisibility;
    storyAllowReplies: boolean;
    storyAllowShare: boolean;
    storyArchiveEnabled: boolean;
  }>,
) {
  return mutateStore((data) => {
    const me = data.users.find((u) => u.id === userId);
    if (!me) return { ok: false as const, error: "حساب فعال نیست.", status: 401 };
    if (Array.isArray(patch.closeFriendIds)) me.closeFriendIds = patch.closeFriendIds.slice(0, 80);
    if (Array.isArray(patch.storyNotifyOffIds)) me.storyNotifyOffIds = patch.storyNotifyOffIds.slice(0, 80);
    if (Array.isArray(patch.defaultHideFromIds)) me.defaultHideFromIds = patch.defaultHideFromIds.slice(0, 80);
    if (patch.statusPreset !== undefined) me.statusPreset = patch.statusPreset;
    if (typeof patch.statusText === "string") me.statusText = patch.statusText.slice(0, 40);
    if (patch.statusPrivacy) me.statusPrivacy = patch.statusPrivacy;
    if (Array.isArray(patch.statusAllowIds)) me.statusAllowIds = patch.statusAllowIds.slice(0, 80);
    if (patch.defaultStoryPrivacy) me.defaultStoryPrivacy = patch.defaultStoryPrivacy;
    if (typeof patch.storyAllowReplies === "boolean") me.storyAllowReplies = patch.storyAllowReplies;
    if (typeof patch.storyAllowShare === "boolean") me.storyAllowShare = patch.storyAllowShare;
    if (typeof patch.storyArchiveEnabled === "boolean") me.storyArchiveEnabled = patch.storyArchiveEnabled;
    return { ok: true as const };
  });
}
