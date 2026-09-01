import "server-only";
import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import { randomId } from "@/lib/crypto-utils";
import { config } from "@/lib/config";
import { postingBlocked } from "@/lib/account-gate";
import { hitRateLimit } from "@/lib/rate-limit";
import { mutateStore, readStoreSnapshot } from "@/lib/store";
import type { StoreData, StoryHighlight, UserStory } from "@/lib/store";
import { emitNotification } from "@/lib/notify";
import { inspectLink, inspectTextLinks } from "@/lib/link-safety";
import { audienceAllows } from "@/lib/privacy";
import { enqueueSearchIndexSync } from "@/lib/search";
import { storyDailyCap } from "@/lib/billing-access";
import { isLikelyEmoji } from "@/lib/emoji-data";
import {
  STORY_CAPTION_MAX,
  STORY_DUP_WINDOW_MS,
  STORY_MAX_MEDIA,
  STORY_MEDIA_TOKEN_MS,
  STORY_TEXT_MAX,
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
  if (story.visibility === "nobody") return false;
  if (story.visibility === "everyone") return true;
  if (story.visibility === "contacts") return isContact(data, story.ownerUserId, viewerId);
  if (story.visibility === "friends") {
    const owner = data.users.find((u) => u.id === story.ownerUserId);
    return Boolean(owner?.friendIds?.includes(viewerId));
  }
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
  if (owner.statusExpiresAt && owner.statusExpiresAt < Date.now()) return false;
  if (blocked(data, ownerId, viewerId)) return false;
  if (owner.statusPrivacy === "nobody") return false;
  if (owner.statusPrivacy === "everyone") return true;
  if (owner.statusPrivacy === "friends") return Boolean(owner.friendIds?.includes(viewerId));
  if (owner.statusPrivacy === "contacts") return isContact(data, ownerId, viewerId);
  return owner.statusAllowIds.includes(viewerId);
}

function bumpStoryCache(data: StoreData) {
  data.storyCacheGen = (data.storyCacheGen ?? 0) + 1;
}

function bumpStorySearch(data: StoreData) {
  bumpStoryCache(data);
  enqueueSearchIndexSync(data, "story");
}

function sweepStories(data: StoreData) {
  const now = Date.now();
  data.userStories ??= [];
  data.storyJobs ??= [];
  for (const story of data.userStories) {
    if (story.deletedAt && now - story.deletedAt > 14 * 24 * 60 * 60_000) {
      story.media = "";
      story.thumbnail = "";
      story.shareToken = "";
      story.shareExpiresAt = 0;
    }
    if (!story.deletedAt && now > story.expiresAt) {
      story.shareToken = "";
      story.shareExpiresAt = 0;
      const owner = data.users.find((u) => u.id === story.ownerUserId);
      if (owner && owner.storyArchiveEnabled === false) {
        story.deletedAt = now;
        story.media = "";
        story.thumbnail = "";
        bumpStoryCache(data);
      }
    }
  }
  for (const job of data.storyJobs) {
    if (job.status !== "pending") continue;
    const story = data.userStories.find((s) => s.id === job.storyId);
    if (!story || story.deletedAt) {
      job.status = "failed";
      job.error = "استوری نیست.";
      continue;
    }
    if (!story.media && (story.kind === "photo" || story.kind === "video" || story.kind === "gif" || story.kind === "audio")) {
      job.retries += 1;
      if (job.retries > 3) {
        job.status = "failed";
        job.error = "پردازش رسانه ناموفق بود.";
        story.processStatus = "failed";
        story.processError = job.error;
      }
      continue;
    }
    story.processStatus = "ready";
    story.processError = "";
    if (story.kind === "photo" || story.kind === "gif") story.thumbnail = story.media;
    if (story.kind === "video" && story.media && !story.thumbnail) story.thumbnail = "";
    job.status = "done";
  }
}

function pushStoryAudit(data: StoreData, actorUserId: string, action: string, storyId: string) {
  data.storyAudit ??= [];
  data.storyAudit = [{ id: randomId(), actorUserId, action, storyId, at: Date.now() }, ...data.storyAudit].slice(0, 400);
}

function fingerprintStory(kind: StoryKind, body: string, caption: string, media: string) {
  return createHash("sha256")
    .update(`${kind}|${body}|${caption}|${media.length}|${media.slice(0, 96)}`)
    .digest("hex")
    .slice(0, 32);
}

function mediaMimeOk(kind: StoryKind, media: string) {
  if (!media) return kind !== "photo" && kind !== "video" && kind !== "audio" && kind !== "gif";
  if (kind === "photo") return /^data:image\//i.test(media);
  if (kind === "gif") return /^data:image\/(gif|webp|png|jpeg)/i.test(media);
  if (kind === "video") return /^data:video\/(mp4|webm|quicktime)/i.test(media);
  if (kind === "audio") return /^data:audio\/(webm|mp4|mpeg|ogg|aac|wav|x-m4a)/i.test(media);
  return true;
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
    allowReactions: story.allowReactions !== false,
    purpose: story.purpose,
    source: story.source,
    draft: story.draft,
    createdAt: story.createdAt,
    expiresAt: story.expiresAt,
    processStatus: story.processStatus ?? "ready",
    processError: story.processError ?? "",
    thumbnailUrl: story.thumbnail && story.media ? `/api/stories/${story.id}/media?t=${token}&thumb=1` : "",
    cropX: story.cropX ?? 50,
    cropY: story.cropY ?? 50,
    shareUrl:
      story.ownerUserId === viewerId && story.shareToken && story.allowShare
        ? `/app?story=${story.id}&st=${story.shareToken}`
        : "",
    ...extra,
  };
}

export async function listStoryFeed(userId: string, cursor?: string, opts?: { includeMuted?: boolean }) {
  return mutateStore((data) => {
    sweepStories(data);
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
    if (muted.has(ownerId) && ownerId !== userId && !opts?.includeMuted) continue;
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
        allowReactions: false,
        purpose: "announcement" as const,
        source: "channel" as const,
        draft: false,
        createdAt: s.createdAt,
        expiresAt: s.expiresAt,
        processStatus: "ready" as const,
        processError: "",
        thumbnailUrl: "",
        cropX: 50,
        cropY: 50,
        shareUrl: "",
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

  const PAGE = 32;
  let page = rings;
  if (cursor) {
    const idx = rings.findIndex((r) => r.ownerId === cursor);
    page = idx >= 0 ? rings.slice(idx + 1) : rings;
  }
  const more = page.length > PAGE;
  const slice = page.slice(0, PAGE);
  const statusLive = !me?.statusExpiresAt || me.statusExpiresAt > now;
  return {
    rings: slice,
    nextCursor: more ? slice.at(-1)?.ownerId ?? null : null,
    cacheGen: data.storyCacheGen ?? 0,
    myStatus: {
      preset: me?.statusPreset ?? "",
      text: statusLive || me?.id === userId ? (me?.statusText ?? "") : "",
      expiresAt: me?.statusExpiresAt ?? null,
    },
  };
  });
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

function resolveMentions(data: StoreData, actorId: string, raw: string[]) {
  const ids: string[] = [];
  for (const item of raw.slice(0, 8)) {
    const needle = item.replace(/^@/, "").toLowerCase();
    const user = data.users.find((u) => u.id === item || u.username === needle);
    if (!user || user.id === actorId) continue;
    if (blocked(data, actorId, user.id)) continue;
    const ok = audienceAllows(
      user.privacyStoryMentions ?? user.privacyMentions ?? "everyone",
      user.contactIds,
      user.storyMentionAllowIds ?? [],
      actorId,
      user.friendIds,
    );
    if (!ok) continue;
    ids.push(user.id);
  }
  return [...new Set(ids)];
}

export async function createStory(userId: string, input: Partial<UserStory> & { kind: StoryKind }) {
  const user = (await readStoreSnapshot()).users.find((u) => u.id === userId);
  if (!user) return { ok: false as const, error: "حساب فعال نیست.", status: 401 };
  const gated = postingBlocked(user);
  if (gated.blocked) return { ok: false as const, error: gated.error, status: 403 };
  return mutateStore((data) => {
    const now = Date.now();
    const flood = hitRateLimit(data, `story:${userId}`, 60_000, 8, now);
    if (!flood.allowed) return { ok: false as const, error: "انتشار استوری محدود شد.", status: 429 };
    const cap = storyDailyCap(data, userId);
    const postedToday = (data.userStories ?? []).filter((s) => s.ownerUserId === userId && now - s.createdAt < 24 * 60 * 60_000 && !s.deletedAt).length;
    if (postedToday >= cap) {
      return { ok: false as const, error: "سقف روزانهٔ استوری این پلن تمام شد.", status: 403 };
    }
    const kind = input.kind;
    const media = typeof input.media === "string" ? input.media : "";
    const bodyText = (input.body ?? "").toString();
    const captionText = (input.caption ?? "").toString();
    if (bodyText.length > STORY_TEXT_MAX) return { ok: false as const, error: "متن استوری بیش از حد مجاز است.", status: 400 };
    if (captionText.length > STORY_CAPTION_MAX) return { ok: false as const, error: "کپشن بیش از حد مجاز است.", status: 400 };
    const needsMedia = kind === "photo" || kind === "video" || kind === "gif" || kind === "audio";
    if (needsMedia) {
      const uploads = hitRateLimit(data, `storyupload:${userId}`, 60 * 60_000, 24, now);
      if (!uploads.allowed) return { ok: false as const, error: "آپلود استوری محدود شد.", status: 429 };
    }
    if (needsMedia && media.length > STORY_MAX_MEDIA) {
      return { ok: false as const, error: "حجم رسانه برای استوری زیاد است. فشرده کن.", status: 413 };
    }
    if (needsMedia && media.length < 20) {
      return { ok: false as const, error: "رسانه ناقص است.", status: 400 };
    }
    if (!mediaMimeOk(kind, media)) {
      return { ok: false as const, error: "نوع فایل استوری مجاز نیست.", status: 400 };
    }
    if (kind === "video") {
      const dur = Number(input.videoDurationMs) || 0;
      if (dur > STORY_VIDEO_MAX_MS) return { ok: false as const, error: "ویدیو استوری حداکثر ۱۵ ثانیه است.", status: 400 };
    }
    if (kind === "text" && !bodyText.trim() && !(input.overlay ?? "").trim()) {
      return { ok: false as const, error: "متن استوری خالی است.", status: 400 };
    }
    const linkRaw = (input.linkUrl ?? "").trim();
    if (linkRaw) {
      const unsafe = inspectLink(linkRaw);
      if (unsafe.warn || !/^https:\/\//i.test(linkRaw)) {
        return { ok: false as const, error: unsafe.reason ?? "لینک استوری مجاز نیست.", status: 400 };
      }
    }
    const textUnsafe = inspectTextLinks(`${bodyText} ${captionText} ${input.overlay ?? ""}`);
    if (textUnsafe.warn) return { ok: false as const, error: textUnsafe.reason ?? "لینک متن ناامن است.", status: 400 };
    const visRaw = input.visibility ?? user.defaultStoryPrivacy ?? "everyone";
    const visibility: StoryVisibility =
      visRaw === "contacts" ||
      visRaw === "friends" ||
      visRaw === "closeFriends" ||
      visRaw === "selected" ||
      visRaw === "nobody" ||
      visRaw === "everyone"
        ? visRaw
        : "everyone";
    if (kind === "location" && !(input.location ?? bodyText).trim()) {
      return { ok: false as const, error: "موقعیت خالی است.", status: 400 };
    }
    if (kind === "sticker" && !(input.overlay ?? "").trim() && !(input.stickers ?? []).length) {
      return { ok: false as const, error: "استیکر انتخاب نشده.", status: 400 };
    }
    const hash = fingerprintStory(kind, bodyText, captionText, media);
    if (!input.draft) {
      const recentDup = data.userStories.some(
        (s) =>
          s.ownerUserId === userId &&
          !s.deletedAt &&
          !s.draft &&
          s.contentHash === hash &&
          now - s.createdAt < STORY_DUP_WINDOW_MS,
      );
      if (recentDup) return { ok: false as const, error: "استوری تکراری در بازهٔ کوتاه رد شد.", status: 429 };
    }
    const mentionRaw = [
      ...(Array.isArray(input.mentions) ? input.mentions.map(String) : []),
      ...(bodyText.match(/@([A-Za-z0-9_]{3,24})/g) ?? []),
    ];
    if (mentionRaw.length > 8) return { ok: false as const, error: "تعداد منشن بیش از حد است.", status: 400 };
    if (mentionRaw.length) {
      const mentionFlood = hitRateLimit(data, `storymention:${userId}`, 60 * 60_000, 20, now);
      if (!mentionFlood.allowed) return { ok: false as const, error: "منشن استوری محدود شد.", status: 429 };
    }
    const hideFrom = [
      ...(Array.isArray(input.hideFromIds) ? input.hideFromIds : []),
      ...(user.defaultHideFromIds ?? []),
    ];
    const expiresAt = now + STORY_TTL_MS;
    const allowShare = input.allowShare !== false && user.storyAllowShare !== false;
    const story: UserStory = {
      id: randomId(),
      ownerUserId: userId,
      kind,
      body: bodyText.slice(0, STORY_TEXT_MAX),
      caption: captionText.slice(0, STORY_CAPTION_MAX),
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
      linkUrl: linkRaw.slice(0, 300),
      mentions: [],
      allowShare,
      allowReplies: input.allowReplies !== false && user.storyAllowReplies !== false,
      allowReactions: input.allowReactions !== false,
      shareToken: allowShare ? randomId() : "",
      shareExpiresAt: allowShare ? expiresAt : 0,
      contentHash: hash,
      visibility,
      allowIds: Array.isArray(input.allowIds) ? input.allowIds.slice(0, 40) : [],
      hideFromIds: [...new Set(hideFrom)].slice(0, 40),
      purpose: (input.purpose as StoryPurpose) || "general",
      source: input.source === "business" || input.source === "channel" ? input.source : "user",
      sourceId: input.sourceId ?? null,
      draft: Boolean(input.draft),
      videoDurationMs: Number(input.videoDurationMs) || 0,
      createdAt: now,
      expiresAt,
      deletedAt: null,
      processStatus: needsMedia ? "processing" : "ready",
      processError: "",
      thumbnail: kind === "photo" || kind === "gif" ? media : "",
      cropX: Math.min(100, Math.max(0, Number(input.cropX) || 50)),
      cropY: Math.min(100, Math.max(0, Number(input.cropY) || 50)),
    };
    story.mentions = resolveMentions(data, userId, mentionRaw).filter((id) => canViewStory(data, story, id, now));
    data.userStories.push(story);
    if (needsMedia) {
      data.storyJobs ??= [];
      data.storyJobs.push({
        id: randomId(),
        storyId: story.id,
        ownerUserId: userId,
        status: "pending",
        retries: 0,
        error: "",
        at: now,
      });
      sweepStories(data);
    }
    bumpStorySearch(data);
    pushStoryAudit(data, userId, story.draft ? "draft" : "create", story.id);
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
    if (story.allowShare) {
      story.shareToken = randomId();
      story.shareExpiresAt = story.expiresAt;
    }
    bumpStorySearch(data);
    pushStoryAudit(data, userId, "publish", story.id);
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
    story.thumbnail = "";
    story.shareToken = "";
    story.shareExpiresAt = 0;
    bumpStorySearch(data);
    pushStoryAudit(data, userId, "delete", story.id);
    return { ok: true as const };
  });
}

export async function viewUserStory(userId: string, storyId: string, opts?: { completed?: boolean }) {
  return mutateStore((data) => {
    const now = Date.now();
    const flood = hitRateLimit(data, `storyview:${userId}`, 10_000, 40, now);
    if (!flood.allowed) return { ok: false as const, error: "بازدید محدود شد.", status: 429 };
    const story = data.userStories.find((s) => s.id === storyId);
    if (!story || !canViewStory(data, story, userId, now, { archive: story.ownerUserId === userId })) {
      return { ok: false as const, error: "استوری در دسترس نیست.", status: 404 };
    }
    if (story.ownerUserId === userId) return { ok: true as const };
    const existing = data.storyWatches.find((w) => w.storyId === storyId && w.viewerId === userId);
    if (existing) {
      if (opts?.completed) existing.completed = true;
      return { ok: true as const };
    }
    const user = data.users.find((u) => u.id === userId);
    data.storyWatches.push({
      storyId,
      viewerId: userId,
      viewerName: user?.displayName || user?.username || "بیننده",
      viewedAt: now,
      completed: Boolean(opts?.completed),
    });
    return { ok: true as const };
  });
}

export async function getStoryMedia(userId: string, storyId: string, token: string, thumb?: boolean) {
  const data = await readStoreSnapshot();
  const now = Date.now();
  const story = data.userStories.find((s) => s.id === storyId);
  if (!story || !(thumb ? story.thumbnail || story.media : story.media)) return { ok: false as const, error: "رسانه نیست.", status: 404 };
  if (!canViewStory(data, story, userId, now, { archive: story.ownerUserId === userId })) {
    return { ok: false as const, error: "اجازه نداری.", status: 403 };
  }
  if (!verifyStoryMedia(storyId, userId, token)) {
    return { ok: false as const, error: "لینک رسانه منقضی یا نامعتبر است.", status: 403 };
  }
  return { ok: true as const, media: thumb && story.thumbnail ? story.thumbnail : story.media };
}

export async function listViewers(userId: string, storyId: string) {
  const data = await readStoreSnapshot();
  const story = data.userStories.find((s) => s.id === storyId && s.ownerUserId === userId && !s.deletedAt);
  if (!story) return { ok: false as const, error: "استوری یافت نشد.", status: 404 };
  const viewers = data.storyWatches.filter((w) => w.storyId === storyId && w.viewerId !== userId);
  const reactions = data.storyReactions.filter((r) => r.storyId === storyId);
  const replies = data.storyReplies.filter((r) => r.storyId === storyId);
  const completed = viewers.filter((v) => v.completed).length;
  return {
    ok: true as const,
    viewers: viewers.map((v) => ({ viewerName: v.viewerName, viewedAt: v.viewedAt })),
    reactions: reactions.map((r) => ({ emoji: r.emoji, at: r.at })),
    replies,
    analytics: {
      views: viewers.length,
      reach: new Set(viewers.map((v) => v.viewerId)).size,
      reactions: reactions.length,
      replies: replies.length,
      engagement: reactions.length + replies.length,
      completionRate: viewers.length ? Math.round((completed / viewers.length) * 100) : 0,
    },
  };
}

export async function reactStory(userId: string, storyId: string, emoji: string) {
  const safe = emoji.trim();
  return mutateStore((data) => {
    const now = Date.now();
    const flood = hitRateLimit(data, `storyreact:${userId}`, 60_000, 40, now);
    if (!flood.allowed) return { ok: false as const, error: "واکنش محدود شد.", status: 429 };
    const story = data.userStories.find((s) => s.id === storyId);
    if (!story || !canViewStory(data, story, userId, now)) {
      return { ok: false as const, error: "استوری در دسترس نیست.", status: 404 };
    }
    if (story.allowReactions === false) return { ok: false as const, error: "واکنش برای این استوری بسته است.", status: 403 };
    const existing = data.storyReactions.find((r) => r.storyId === storyId && r.userId === userId);
    if (!safe || existing?.emoji === safe) {
      data.storyReactions = data.storyReactions.filter((r) => !(r.storyId === storyId && r.userId === userId));
      return { ok: true as const, action: "remove" as const };
    }
    if (!isLikelyEmoji(safe)) return { ok: false as const, error: "ایموجی نامعتبر است.", status: 400 };
    data.storyReactions = data.storyReactions.filter((r) => !(r.storyId === storyId && r.userId === userId));
    data.storyReactions.push({ id: randomId(), storyId, userId, emoji: safe.slice(0, 24), at: now });
    if (story.ownerUserId !== userId) {
      emitNotification(data, {
        userId: story.ownerUserId,
        category: "stories",
        kind: "reaction",
        title: "واکنش به استوری",
        senderName: data.users.find((u) => u.id === userId)?.displayName || "کاربر",
        body: "واکنش جدید",
        sourceId: `sreact:${storyId}`,
        muteType: "user",
        muteId: userId,
        target: { type: "story", id: storyId },
      });
    }
    return { ok: true as const, action: "add" as const };
  });
}

export async function replyStory(userId: string, storyId: string, body: string) {
  const text = body.trim().slice(0, 400);
  if (!text) return { ok: false as const, error: "پاسخ خالی است.", status: 400 };
  return mutateStore((data) => {
    const now = Date.now();
    const flood = hitRateLimit(data, `storyreply:${userId}`, 60_000, 20, now);
    if (!flood.allowed) return { ok: false as const, error: "پاسخ استوری محدود شد.", status: 429 };
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
    const ownerThread = data.threads.find((t) => t.ownerUserId === story.ownerUserId && t.peerKey === userId);
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
      target: ownerThread ? { type: "chat", id: ownerThread.id } : { type: "story", id: storyId },
    });
    return { ok: true as const, routedChat: Boolean(ownerThread) };
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
    statusExpiresAt: me.statusExpiresAt,
    statusHistory: (me.statusHistory ?? []).slice(-12),
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
    statusPrivacy: "everyone" | "contacts" | "friends" | "nobody" | "selected";
    statusAllowIds: string[];
    defaultStoryPrivacy: StoryVisibility;
    storyAllowReplies: boolean;
    storyAllowShare: boolean;
    storyArchiveEnabled: boolean;
    statusExpiresAt: number | null;
  }>,
) {
  return mutateStore((data) => {
    const me = data.users.find((u) => u.id === userId);
    if (!me) return { ok: false as const, error: "حساب فعال نیست.", status: 401 };
    if (Array.isArray(patch.closeFriendIds)) me.closeFriendIds = patch.closeFriendIds.slice(0, 80);
    if (Array.isArray(patch.storyNotifyOffIds)) me.storyNotifyOffIds = patch.storyNotifyOffIds.slice(0, 80);
    if (Array.isArray(patch.defaultHideFromIds)) me.defaultHideFromIds = patch.defaultHideFromIds.slice(0, 80);
    if (patch.statusPreset !== undefined || typeof patch.statusText === "string") {
      me.statusHistory = [
        ...(me.statusHistory ?? []),
        { at: Date.now(), preset: me.statusPreset, text: me.statusText },
      ].slice(-20);
    }
    if (patch.statusPreset !== undefined) me.statusPreset = patch.statusPreset;
    if (typeof patch.statusText === "string") me.statusText = patch.statusText.slice(0, 40);
    if (patch.statusPrivacy) me.statusPrivacy = patch.statusPrivacy;
    if (Array.isArray(patch.statusAllowIds)) me.statusAllowIds = patch.statusAllowIds.slice(0, 80);
    if (patch.defaultStoryPrivacy) me.defaultStoryPrivacy = patch.defaultStoryPrivacy;
    if (typeof patch.storyAllowReplies === "boolean") me.storyAllowReplies = patch.storyAllowReplies;
    if (typeof patch.storyAllowShare === "boolean") me.storyAllowShare = patch.storyAllowShare;
    if (typeof patch.storyArchiveEnabled === "boolean") me.storyArchiveEnabled = patch.storyArchiveEnabled;
    if (patch.statusExpiresAt === null) me.statusExpiresAt = null;
    if (typeof patch.statusExpiresAt === "number") {
      me.statusExpiresAt = patch.statusExpiresAt > Date.now() ? patch.statusExpiresAt : Date.now() + 60_000;
    }
    return { ok: true as const };
  });
}

function canViewHighlight(data: StoreData, hl: StoryHighlight, viewerId: string) {
  if (hl.ownerUserId === viewerId) return true;
  if (blocked(data, hl.ownerUserId, viewerId)) return false;
  if (hl.hideFromIds.includes(viewerId)) return false;
  if (hl.visibility === "nobody") return false;
  if (hl.visibility === "everyone") return true;
  if (hl.visibility === "contacts") return isContact(data, hl.ownerUserId, viewerId);
  if (hl.visibility === "friends") {
    return Boolean(data.users.find((u) => u.id === hl.ownerUserId)?.friendIds?.includes(viewerId));
  }
  if (hl.visibility === "closeFriends") {
    return Boolean(data.users.find((u) => u.id === hl.ownerUserId)?.closeFriendIds.includes(viewerId));
  }
  return hl.allowIds.includes(viewerId);
}

export async function listHighlights(viewerId: string, ownerId: string) {
  const data = await readStoreSnapshot();
  return (data.storyHighlights ?? [])
    .filter((h) => h.ownerUserId === ownerId && canViewHighlight(data, h, viewerId))
    .map((h) => ({
      id: h.id,
      name: h.name,
      coverStoryId: h.coverStoryId,
      storyIds: h.storyIds.filter((id) => {
        const s = data.userStories.find((x) => x.id === id && x.ownerUserId === ownerId && !x.deletedAt);
        if (!s) return false;
        if (h.ownerUserId === viewerId) return true;
        return !s.hideFromIds.includes(viewerId);
      }),
      visibility: h.visibility,
      owner: h.ownerUserId === viewerId,
    }));
}

export async function upsertHighlight(
  userId: string,
  input: { id?: string; name: string; storyIds: string[]; coverStoryId?: string | null; visibility?: StoryVisibility; allowIds?: string[]; hideFromIds?: string[] },
) {
  return mutateStore((data) => {
    const name = input.name.trim().slice(0, 40);
    if (name.length < 1) return { ok: false as const, error: "نام هایلایت لازم است.", status: 400 };
    const owned = data.userStories.filter((s) => s.ownerUserId === userId && !s.deletedAt).map((s) => s.id);
    const storyIds = input.storyIds.filter((id) => owned.includes(id)).slice(0, 40);
    const vis = input.visibility ?? "everyone";
    const visibility: StoryVisibility =
      vis === "contacts" || vis === "friends" || vis === "closeFriends" || vis === "selected" || vis === "nobody" || vis === "everyone"
        ? vis
        : "everyone";
    if (input.id) {
      const hl = (data.storyHighlights ?? []).find((h) => h.id === input.id);
      if (!hl || hl.ownerUserId !== userId) return { ok: false as const, error: "هایلایت یافت نشد.", status: 404 };
      hl.name = name;
      hl.storyIds = storyIds;
      hl.coverStoryId = input.coverStoryId && storyIds.includes(input.coverStoryId) ? input.coverStoryId : storyIds[0] ?? null;
      hl.visibility = visibility;
      if (Array.isArray(input.allowIds)) hl.allowIds = input.allowIds.slice(0, 40);
      if (Array.isArray(input.hideFromIds)) hl.hideFromIds = input.hideFromIds.slice(0, 40);
      hl.updatedAt = Date.now();
      bumpStoryCache(data);
      return { ok: true as const, highlight: hl };
    }
    const hl: StoryHighlight = {
      id: randomId(),
      ownerUserId: userId,
      name,
      coverStoryId: input.coverStoryId && storyIds.includes(input.coverStoryId) ? input.coverStoryId : storyIds[0] ?? null,
      storyIds,
      visibility,
      allowIds: (input.allowIds ?? []).slice(0, 40),
      hideFromIds: (input.hideFromIds ?? []).slice(0, 40),
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };
    data.storyHighlights ??= [];
    if (data.storyHighlights.filter((h) => h.ownerUserId === userId).length >= 20) {
      return { ok: false as const, error: "سقف هایلایت پر است.", status: 413 };
    }
    data.storyHighlights.push(hl);
    bumpStoryCache(data);
    return { ok: true as const, highlight: hl };
  });
}

export async function deleteHighlight(userId: string, highlightId: string) {
  return mutateStore((data) => {
    const hl = (data.storyHighlights ?? []).find((h) => h.id === highlightId);
    if (!hl) return { ok: false as const, error: "هایلایت یافت نشد.", status: 404 };
    if (hl.ownerUserId !== userId) return { ok: false as const, error: "اجازه نداری.", status: 403 };
    data.storyHighlights = data.storyHighlights.filter((h) => h.id !== highlightId);
    bumpStoryCache(data);
    return { ok: true as const };
  });
}

export async function retryStoryProcess(userId: string, storyId: string) {
  return mutateStore((data) => {
    const story = data.userStories.find((s) => s.id === storyId && s.ownerUserId === userId && !s.deletedAt);
    if (!story) return { ok: false as const, error: "استوری یافت نشد.", status: 404 };
    data.storyJobs ??= [];
    data.storyJobs.push({
      id: randomId(),
      storyId,
      ownerUserId: userId,
      status: "pending",
      retries: 0,
      error: "",
      at: Date.now(),
    });
    story.processStatus = "processing";
    story.processError = "";
    sweepStories(data);
    return { ok: true as const, processStatus: story.processStatus, processError: story.processError };
  });
}

function parseVisibility(raw: unknown, fallback: StoryVisibility): StoryVisibility {
  return raw === "contacts" ||
    raw === "friends" ||
    raw === "closeFriends" ||
    raw === "selected" ||
    raw === "nobody" ||
    raw === "everyone"
    ? raw
    : fallback;
}

export async function editStory(
  userId: string,
  storyId: string,
  patch: Partial<{
    caption: string;
    body: string;
    visibility: StoryVisibility;
    allowShare: boolean;
    allowReplies: boolean;
    allowReactions: boolean;
    hideFromIds: string[];
    allowIds: string[];
  }>,
) {
  return mutateStore((data) => {
    const now = Date.now();
    const story = data.userStories.find((s) => s.id === storyId);
    if (!story || story.deletedAt) return { ok: false as const, error: "استوری یافت نشد.", status: 404 };
    if (story.ownerUserId !== userId) return { ok: false as const, error: "فقط صاحب می‌تواند ویرایش کند.", status: 403 };
    if (now > story.expiresAt) return { ok: false as const, error: "استوری منقضی قابل ویرایش نیست.", status: 403 };
    if (typeof patch.body === "string") {
      if (patch.body.length > STORY_TEXT_MAX) return { ok: false as const, error: "متن استوری بیش از حد مجاز است.", status: 400 };
      story.body = patch.body.slice(0, STORY_TEXT_MAX);
    }
    if (typeof patch.caption === "string") {
      if (patch.caption.length > STORY_CAPTION_MAX) return { ok: false as const, error: "کپشن بیش از حد مجاز است.", status: 400 };
      story.caption = patch.caption.slice(0, STORY_CAPTION_MAX);
    }
    if (patch.visibility) story.visibility = parseVisibility(patch.visibility, story.visibility);
    if (typeof patch.allowShare === "boolean") {
      story.allowShare = patch.allowShare;
      if (!patch.allowShare) {
        story.shareToken = "";
        story.shareExpiresAt = 0;
      } else if (!story.shareToken) {
        story.shareToken = randomId();
        story.shareExpiresAt = story.expiresAt;
      }
    }
    if (typeof patch.allowReplies === "boolean") story.allowReplies = patch.allowReplies;
    if (typeof patch.allowReactions === "boolean") story.allowReactions = patch.allowReactions;
    if (Array.isArray(patch.hideFromIds)) story.hideFromIds = patch.hideFromIds.slice(0, 40);
    if (Array.isArray(patch.allowIds)) story.allowIds = patch.allowIds.slice(0, 40);
    bumpStorySearch(data);
    pushStoryAudit(data, userId, "edit", story.id);
    return { ok: true as const, story: publicStory(story, userId) };
  });
}

export async function restoreStory(userId: string, storyId: string) {
  return mutateStore((data) => {
    const now = Date.now();
    const owner = data.users.find((u) => u.id === userId);
    if (owner && owner.storyArchiveEnabled === false) {
      return { ok: false as const, error: "آرشیو استوری خاموش است.", status: 403 };
    }
    const story = data.userStories.find((s) => s.id === storyId);
    if (!story || story.deletedAt) return { ok: false as const, error: "استوری یافت نشد.", status: 404 };
    if (story.ownerUserId !== userId) return { ok: false as const, error: "فقط صاحب می‌تواند بازیابی کند.", status: 403 };
    if (now <= story.expiresAt) return { ok: false as const, error: "استوری هنوز زنده است.", status: 400 };
    story.expiresAt = now + STORY_TTL_MS;
    if (story.allowShare) {
      story.shareToken = randomId();
      story.shareExpiresAt = story.expiresAt;
    }
    bumpStorySearch(data);
    pushStoryAudit(data, userId, "restore", story.id);
    return { ok: true as const, story: publicStory(story, userId) };
  });
}

export async function peekStoryShare(userId: string, token: string) {
  const data = await readStoreSnapshot();
  const now = Date.now();
  const needle = token.trim();
  if (!needle || needle.length < 16) return { ok: false as const, error: "لینک نامعتبر است.", status: 404 };
  const story = data.userStories.find((s) => s.shareToken && s.shareToken === needle && !s.deletedAt);
  if (!story || !story.shareExpiresAt || now > story.shareExpiresAt) {
    return { ok: false as const, error: "لینک استوری منقضی یا نامعتبر است.", status: 404 };
  }
  if (!canViewStory(data, story, userId, now)) {
    return { ok: false as const, error: "لینک استوری منقضی یا نامعتبر است.", status: 404 };
  }
  return { ok: true as const, story: publicStory(story, userId, { reactions: countReactions(data, story.id) }) };
}

export async function forwardStory(userId: string, storyId: string, toUserId: string) {
  return mutateStore((data) => {
    const now = Date.now();
    const flood = hitRateLimit(data, `storyfwd:${userId}`, 60_000, 12, now);
    if (!flood.allowed) return { ok: false as const, error: "هدایت استوری محدود شد.", status: 429 };
    if (!toUserId || toUserId === userId) return { ok: false as const, error: "گیرنده نامعتبر است.", status: 400 };
    const story = data.userStories.find((s) => s.id === storyId);
    if (!story || !canViewStory(data, story, userId, now)) {
      return { ok: false as const, error: "استوری در دسترس نیست.", status: 404 };
    }
    if (!story.allowShare || story.visibility !== "everyone") {
      return { ok: false as const, error: "این استوری قابل هدایت نیست.", status: 403 };
    }
    if (blocked(data, userId, toUserId) || blocked(data, story.ownerUserId, toUserId)) {
      return { ok: false as const, error: "هدایت مجاز نیست.", status: 403 };
    }
    if (!canViewStory(data, story, toUserId, now)) {
      return { ok: false as const, error: "گیرنده اجازهٔ دیدن این استوری را ندارد.", status: 403 };
    }
    const sender = data.users.find((u) => u.id === userId);
    emitNotification(data, {
      userId: toUserId,
      category: "stories",
      kind: "story",
      title: sender?.displayName || "استوری",
      senderName: sender?.displayName || "",
      body: "استوری عمومی برایت فرستاده شد",
      sourceId: `story-fwd:${story.id}`,
      muteType: "user",
      muteId: userId,
      target: { type: "story", id: story.id },
    });
    pushStoryAudit(data, userId, "forward", story.id);
    return { ok: true as const };
  });
}

export async function listDiscovery(userId: string) {
  return mutateStore((data) => {
    sweepStories(data);
    const now = Date.now();
    const items = data.userStories
      .filter((s) => !s.draft && !s.deletedAt && s.visibility === "everyone" && canViewStory(data, s, userId, now))
      .sort((a, b) => b.createdAt - a.createdAt)
      .slice(0, 40)
      .map((s) => publicStory(s, userId, { reactions: countReactions(data, s.id) }));
    return { items };
  });
}
