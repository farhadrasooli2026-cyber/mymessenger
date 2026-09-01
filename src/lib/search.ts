import "server-only";
import { hitRateLimit } from "@/lib/rate-limit";
import { mutateStore, readStoreSnapshot, type StoreData } from "@/lib/store";
import type { ChannelPost, CommunityRecord, GroupRecord, PubChannelRecord, UserStory } from "@/lib/store";
import { publicProfile } from "@/lib/profile";
import { hmacIdentifier, randomId } from "@/lib/crypto-utils";
import { SYNONYM_VERSION, blobMatches, booleanMatches, exactPhraseMatches, foldText, highlightText, hybridOverlap, matchScore, recencyBoost, sanitizeSearchSnippet, suggestTerms } from "@/lib/search-match";
import {
  SEARCH_CACHE_TTL_MS,
  SEARCH_FLOOD_MAX,
  SEARCH_FLOOD_WINDOW_MS,
  SEARCH_HISTORY_MAX,
  SEARCH_INDEX_RETRY_MAX,
  SEARCH_INDEX_VERSION,
  SEARCH_PAGE,
  type SearchDoc,
  type SearchHit,
  type SearchIndexJob,
  type SearchKind,
} from "@/lib/search-types";
import { percentile } from "@/lib/edge-policy";
import { experimentBucket } from "@/lib/ai-privacy";
import { SEARCH_EVAL_CASES, SEARCH_EVAL_VERSION, scoreEvalHits } from "@/lib/search-eval";
import { normalizeEmail, normalizePhone } from "@/lib/identifiers";
import { audienceAllows, canFindByUsername, pairBlocked } from "@/lib/privacy";
import { canSeePack, ensureOfficialPacks } from "@/lib/stickers";
import { searchEmoji } from "@/lib/emoji-data";
import {
  extractHashtags,
  extractMentions,
  normalizeHashtag,
  parseSearchQuery,
  SEARCH_BUDGET_MS,
  SEARCH_HIT_CAP,
  SEARCH_QUERY_MIN,
  validateSearchQuery,
  type SearchBool,
  type SearchFeed,
  type SearchHasFilter,
  type SearchRanking,
  type SearchSort,
} from "@/lib/search-query";

function liveMember<T extends { key: string; leftAt?: number | null }>(m: T, userId: string) {
  return m.key === userId && !m.leftAt;
}

function liveSub(s: { userId: string; leftAt?: number | null }) {
  return !s.leftAt;
}

function canSeeGroup(group: GroupRecord, userId: string) {
  if (group.deletedAt) return false;
  if (group.bans.some((b) => b.key === userId && (!b.until || b.until > Date.now()))) return false;
  if (group.members.some((m) => liveMember(m, userId))) return true;
  return group.joinMode === "open" && group.searchVisible !== false;
}

function canSeeCommunity(community: CommunityRecord, userId: string) {
  if (community.deletedAt) return false;
  if (community.bans.some((b) => b.key === userId && (!b.until || b.until > Date.now()))) return false;
  if (community.members.some((m) => liveMember(m, userId))) return true;
  return community.joinMode === "open" && community.searchVisible !== false;
}

function canSeeChannel(channel: PubChannelRecord, userId: string) {
  if (channel.deletedAt || channel.status === "deleted") return false;
  const staff = channel.ownerUserId === userId || channel.staff.some((s) => s.userId === userId);
  if (channel.status === "suspended" && !staff) return false;
  if (channel.bans.some((b) => b.key === userId)) return false;
  const sub = channel.subscribers.some((s) => s.userId === userId && liveSub(s));
  if (staff || sub) return true;
  return channel.visibility === "public" && channel.status !== "restricted";
}

function canReadVaultInSearch(data: StoreData, userId: string, obj: StoreData["vaultObjects"][number]) {
  if (obj.status === "deleted" || obj.deletedAt) return false;
  if (obj.ownerUserId === userId) return true;
  if (obj.status !== "ready" || obj.scan !== "clean") return false;
  if (pairBlocked(data, userId, obj.ownerUserId)) return false;
  if ((obj.allowIds ?? []).includes(userId)) return true;
  if (obj.privacy === "public") return true;
  if (obj.scope === "group") {
    const group = data.groups.find((g) => g.id === obj.scopeId && !g.deletedAt);
    return Boolean(group?.members.some((m) => liveMember(m, userId)));
  }
  if (obj.scope === "channel") {
    const channel = data.pubChannels.find((c) => c.id === obj.scopeId && !c.deletedAt);
    if (!channel) return false;
    return channel.staff.some((s) => s.userId === userId) || channel.subscribers.some((s) => s.userId === userId && liveSub(s));
  }
  return false;
}

function isPublicLiveStory(story: UserStory, now: number) {
  return !story.deletedAt && !story.draft && story.visibility === "everyone" && now <= story.expiresAt;
}

function canOpenPublicStory(data: StoreData, story: UserStory, userId: string, now: number) {
  if (!isPublicLiveStory(story, now)) return false;
  const owner = data.users.find((u) => u.id === story.ownerUserId);
  if (!owner || owner.status !== "active") return false;
  if (owner.accountStatus && owner.accountStatus !== "active") return false;
  if (pairBlocked(data, userId, story.ownerUserId)) return false;
  if (story.hideFromIds.includes(userId)) return false;
  return true;
}

function storySearchBlob(story: UserStory) {
  return `${story.caption} ${story.body} ${story.location} ${story.kind} ${story.overlay}`;
}

export function enqueueSearchIndexSync(data: StoreData, reason = "sync") {
  data.searchIndexJobs ??= [];
  const key = `sync:${reason}`;
  if (data.searchIndexJobs.some((j) => j.idempotencyKey === key && (j.status === "queued" || j.status === "running"))) return;
  const job: SearchIndexJob = {
    id: randomId(),
    idempotencyKey: key,
    kind: "sync",
    status: "queued",
    attempts: 0,
    createdAt: Date.now(),
  };
  data.searchIndexJobs.push(job);
}

function writeIndexMeta(data: StoreData, bump: boolean) {
  const gen = bump ? (data.searchIndex?.gen ?? 0) + 1 : (data.searchIndex?.gen ?? 0);
  data.searchIndex = { gen, rebuiltAt: Date.now(), version: SEARCH_INDEX_VERSION };
  if (bump) data.searchQueryCache = [];
}

export function enqueueSearchTombstone(data: StoreData, docId: string, reason: string) {
  const id = docId.trim().slice(0, 80);
  if (!id) return;
  data.searchTombstones ??= [];
  if (!data.searchTombstones.some((t) => t.docId === id)) {
    data.searchTombstones.unshift({ id: randomId(), docId: id, reason: reason.slice(0, 80), at: Date.now() });
    data.searchTombstones = data.searchTombstones.slice(0, 2000);
  }
  data.searchDocs = (data.searchDocs ?? []).filter((d) => d.id !== id);
  writeIndexMeta(data, true);
  enqueueSearchIndexSync(data, `tombstone:${id.slice(0, 24)}`);
}

function publicIndexFingerprint(docs: SearchDoc[]) {
  return docs
    .map((d) => `${d.id}:${d.updatedAt}:${d.title}:${d.preview}`)
    .sort()
    .join("|");
}

export function syncPublicSearchIndex(data: StoreData) {
  ensureOfficialPacks(data);
  const docs: SearchDoc[] = [];
  for (const u of data.users) {
    if (u.status !== "active" || (u.accountStatus && u.accountStatus !== "active")) continue;
    if (!u.username || u.privacyFindUsername !== "everyone") continue;
    docs.push({
      id: `user:${u.id}`,
      kind: "user",
      entityId: u.id,
      title: `${u.displayName || u.firstName || ""} ${u.username}`.trim(),
      preview: `@${u.username}`,
      tags: [],
      public: true,
      updatedAt: u.activatedAt ?? u.createdAt,
    });
  }
  for (const g of data.groups) {
    if (g.deletedAt || g.joinMode !== "open" || g.searchVisible === false) continue;
    docs.push({
      id: `group:${g.id}`,
      kind: "group",
      entityId: g.id,
      title: g.name,
      preview: g.username ? `@${g.username}` : g.description.slice(0, 80),
      tags: [...(g.tags ?? []), g.category ?? ""].filter(Boolean),
      public: true,
      updatedAt: g.updatedAt,
    });
  }
  for (const c of data.pubChannels) {
    if (c.deletedAt || c.visibility !== "public" || c.status !== "active") continue;
    docs.push({
      id: `channel:${c.id}`,
      kind: "channel",
      entityId: c.id,
      title: c.name,
      preview: c.username ? `@${c.username}` : c.description.slice(0, 80),
      tags: [c.purpose ?? ""],
      public: true,
      updatedAt: c.updatedAt,
    });
    for (const p of data.channelPosts) {
      if (p.channelId !== c.id || p.deleted || p.status !== "published") continue;
      docs.push({
        id: `post:${p.id}`,
        kind: "post",
        entityId: p.id,
        parentId: c.id,
        title: c.name,
        preview: sanitizeSearchSnippet(p.caption || p.body || p.fileName || p.kind, 120),
        tags: [p.kind],
        public: true,
        updatedAt: p.publishedAt ?? p.createdAt,
      });
    }
  }
  for (const pack of data.stickerPacks ?? []) {
    if (!pack.official && pack.privacy !== "public") continue;
    if (pack.deletedAt) continue;
    docs.push({
      id: `pack:${pack.id}`,
      kind: "sticker",
      entityId: pack.id,
      title: pack.name,
      preview: pack.description.slice(0, 80) || "sticker",
      tags: pack.official ? ["official"] : ["public"],
      public: true,
      updatedAt: pack.createdAt,
    });
  }
  const now = Date.now();
  for (const s of data.userStories ?? []) {
    if (!isPublicLiveStory(s, now)) continue;
    const owner = data.users.find((u) => u.id === s.ownerUserId);
    if (!owner || owner.status !== "active") continue;
    if (owner.accountStatus && owner.accountStatus !== "active") continue;
    const blob = sanitizeSearchSnippet(storySearchBlob(s), 120);
    docs.push({
      id: `story:${s.id}`,
      kind: "story",
      entityId: s.id,
      title: blob || "استوری عمومی",
      preview: "استوری عمومی",
      tags: extractHashtags(storySearchBlob(s)),
      public: true,
      updatedAt: s.createdAt,
    });
  }
  for (const o of data.vaultObjects ?? []) {
    if (o.deletedAt || o.status !== "ready" || o.scan !== "clean" || o.privacy !== "public") continue;
    docs.push({
      id: `vault:${o.id}`,
      kind: "file",
      entityId: o.id,
      title: o.originalName,
      preview: o.kind,
      tags: [o.kind, o.mime],
      public: true,
      updatedAt: o.updatedAt,
    });
  }
  const dead = new Set((data.searchTombstones ?? []).map((t) => t.docId));
  const next = docs.filter((d) => !dead.has(d.id));
  const fp = publicIndexFingerprint(next);
  const prev = (data.searchDocs ?? []).length ? publicIndexFingerprint(data.searchDocs) : "";
  data.searchDocs = next;
  writeIndexMeta(data, fp !== prev);
}

export function drainSearchIndexJobs(data: StoreData, now = Date.now()) {
  data.searchIndexJobs ??= [];
  for (const job of data.searchIndexJobs) {
    if (job.status === "done") continue;
    if (job.status === "failed" && (job.attempts >= SEARCH_INDEX_RETRY_MAX || (job.nextAt && job.nextAt > now))) continue;
    job.status = "running";
    try {
      syncPublicSearchIndex(data);
      job.status = "done";
    } catch (err) {
      job.attempts += 1;
      job.lastError = err instanceof Error ? err.message : "index";
      if (job.attempts >= SEARCH_INDEX_RETRY_MAX) job.status = "failed";
      else {
        job.status = "queued";
        job.nextAt = now + Math.min(60_000, 1000 * 2 ** job.attempts);
      }
    }
  }
  data.searchIndexJobs = data.searchIndexJobs.filter((j) => j.status !== "done" || now - j.createdAt < 86_400_000).slice(-80);
}

function needleOf(q: string) {
  return q.trim().replace(/^@/, "").toLowerCase();
}

function isMediaKind(kind: SearchKind) {
  return (
    kind === "media" ||
    kind === "photos" ||
    kind === "images" ||
    kind === "videos" ||
    kind === "gifs" ||
    kind === "voice" ||
    kind === "audio" ||
    kind === "music"
  );
}

function canonicalKind(kind: SearchKind): SearchKind {
  if (kind === "images") return "photos";
  if (kind === "audio") return "voice";
  return kind;
}

function matchesKind(kind: SearchKind, itemKind: string) {
  const k = canonicalKind(kind);
  if (k === "all" || k === "users" || k === "friends" || k === "groups" || k === "channels" || k === "communities" || k === "chats" || k === "posts" || k === "stories") {
    return true;
  }
  if (k === "messages" || k === "hashtags" || k === "mentions") {
    return itemKind === "text" || itemKind === "message" || itemKind === "link" || itemKind === "poll" || itemKind === "file";
  }
  if (k === "photos" || k === "gifs") return itemKind === "photo" || itemKind === "gif";
  if (k === "videos") return itemKind === "video";
  if (k === "files") return itemKind === "file" || itemKind === "pdf" || itemKind === "zip" || itemKind === "doc" || itemKind === "audio";
  if (k === "links") return itemKind === "link" || itemKind === "text";
  if (k === "voice" || k === "music") return itemKind === "voice" || itemKind === "music" || itemKind === "audio";
  if (k === "media") return ["photo", "gif", "video", "voice", "file", "audio", "sticker"].includes(itemKind);
  if (k === "stickers") return itemKind === "sticker";
  return true;
}

function hasKindOk(has: SearchHasFilter | undefined, itemKind: string, blob: string) {
  if (!has) return true;
  if (has === "link") return /https?:\/\//i.test(blob);
  if (has === "file") return itemKind === "file" || itemKind === "pdf" || itemKind === "zip" || itemKind === "doc";
  if (has === "image") return itemKind === "photo" || itemKind === "gif";
  if (has === "video") return itemKind === "video";
  if (has === "audio") return itemKind === "voice" || itemKind === "audio" || itemKind === "music";
  if (has === "media") return ["photo", "gif", "video", "voice", "file", "audio", "sticker"].includes(itemKind);
  if (has === "mention") return extractMentions(blob).length > 0;
  if (has === "hashtag") return extractHashtags(blob).length > 0;
  if (has === "document") return itemKind === "file" || itemKind === "pdf" || itemKind === "doc" || itemKind === "zip";
  return true;
}

function sizeOk(bytes: number | undefined, min?: number, max?: number) {
  if (min == null && max == null) return true;
  if (bytes == null || bytes <= 0) return false;
  if (min != null && bytes < min) return false;
  if (max != null && bytes > max) return false;
  return true;
}

function fileTypeOk(fileType: string | undefined, kind: string, fileName: string, blob: string) {
  if (!fileType) return true;
  const ft = fileType.replace(/^\./, "").toLowerCase();
  const hay = foldText(`${kind} ${fileName} ${blob}`);
  return hay.includes(foldText(ft)) || foldText(fileName).endsWith(foldText(`.${ft}`));
}

function inRange(at: number, from?: number, to?: number) {
  if (from && at < from) return false;
  if (to && at > to) return false;
  return true;
}

function senderOk(name: string, username: string | null | undefined, from?: string) {
  if (!from) return true;
  const f = from.replace(/^@/, "").toLowerCase();
  return name.toLowerCase().includes(f) || (username ?? "").toLowerCase().includes(f);
}

export type SearchQuery = {
  q: string;
  kind?: SearchKind;
  from?: string;
  fromDate?: number;
  toDate?: number;
  offset?: number;
  limit?: number;
  minPrice?: number;
  maxPrice?: number;
  category?: string;
  recordHistory?: boolean;
  chatId?: string;
  groupId?: string;
  channelId?: string;
  fileType?: string;
  exact?: boolean;
  sort?: SearchSort;
  feed?: SearchFeed;
  cursor?: string;
  minSize?: number;
  maxSize?: number;
  has?: SearchHasFilter;
  semantic?: boolean;
  ranking?: SearchRanking;
};

function contentMatches(blob: string, q: string, exactPhrase: string | null, kind: SearchKind, bool?: SearchBool) {
  if (bool) return booleanMatches(blob, bool);
  if (exactPhrase) return exactPhraseMatches(blob, exactPhrase);
  if (kind === "hashtags") {
    const tags = extractHashtags(blob).map((t) => foldText(t));
    const n = foldText(q.replace(/^#/, ""));
    return tags.some((t) => t.includes(n) || n.includes(t));
  }
  if (kind === "mentions") {
    const mentions = extractMentions(blob);
    const n = foldText(q.replace(/^@/, ""));
    return mentions.some((m) => foldText(m).includes(n));
  }
  if (kind === "links") return /https?:\/\//i.test(blob) && (blobMatches(blob, q) || foldText(blob).includes(foldText(q)));
  return blobMatches(blob, q);
}

function sortHits(hits: SearchHit[], sort: SearchSort | undefined) {
  if (sort === "newest") return hits.sort((a, b) => b.date - a.date || (b.score ?? 0) - (a.score ?? 0));
  if (sort === "oldest") return hits.sort((a, b) => a.date - b.date || (b.score ?? 0) - (a.score ?? 0));
  if (sort === "popular") return hits.sort((a, b) => (b.members ?? 0) - (a.members ?? 0) || b.date - a.date);
  return hits.sort((a, b) => (b.score ?? 0) - (a.score ?? 0) || b.date - a.date);
}

function uniqueViewCount(post: ChannelPost) {
  return post.views?.length ?? 0;
}

function resolveAuthorizedEntity(data: StoreData, userId: string, id: string, hint: string): SearchHit | null {
  const channel = data.pubChannels.find((c) => c.id === id);
  if (channel && (hint === "channel" || hint === "unknown")) {
    if (!canSeeChannel(channel, userId)) return null;
    const subs = channel.subscribers.filter(liveSub).length;
    return {
      id: `channel:${channel.id}`,
      scope: "channel",
      title: channel.name,
      preview: channel.username ? `@${channel.username}` : "کانال",
      sender: "",
      chatName: "کانال‌ها",
      date: channel.updatedAt,
      kind: "channel",
      members: subs,
      visibility: channel.visibility,
      username: channel.username,
      target: { type: "channel", id: channel.id },
    };
  }
  const group = data.groups.find((g) => g.id === id);
  if (group && (hint === "group" || hint === "unknown")) {
    if (!canSeeGroup(group, userId)) return null;
    return {
      id: `group:${group.id}`,
      scope: "group",
      title: group.name,
      preview: group.username ? `@${group.username}` : "گروه",
      sender: "",
      chatName: "گروه‌ها",
      date: group.updatedAt,
      kind: "group",
      members: group.members.filter((m) => !m.leftAt).length,
      target: { type: "group", id: group.id },
    };
  }
  const community = data.communities.find((c) => c.id === id);
  if (community && (hint === "community" || hint === "unknown")) {
    if (!canSeeCommunity(community, userId)) return null;
    return {
      id: `community:${community.id}`,
      scope: "community",
      title: community.name,
      preview: community.username ? `@${community.username}` : "جامعه",
      sender: "",
      chatName: "جامعه‌ها",
      date: community.updatedAt,
      kind: "community",
      target: { type: "community", id: community.id },
    };
  }
  const thread = data.threads.find((t) => t.id === id && t.ownerUserId === userId);
  if (thread && (hint === "chat" || hint === "unknown")) {
    return {
      id: `chatmeta:${thread.id}`,
      scope: "chat",
      title: thread.peerName,
      preview: "گفتگوی خصوصی",
      sender: thread.peerName,
      chatName: "چت‌ها",
      date: thread.updatedAt,
      kind: "chat",
      target: { type: "chat", id: thread.id },
    };
  }
  const live = data.lives?.find((l) => l.id === id);
  if (live && (hint === "live" || hint === "unknown")) {
    if (live.visibility !== "public" || live.emergencyStopped) return null;
    return {
      id: `live:${live.id}`,
      scope: "live",
      title: live.title,
      preview: live.status,
      sender: live.hostName,
      chatName: "Live",
      date: live.startedAt ?? live.createdAt,
      kind: "live",
      target: { type: "live", id: live.id },
    };
  }
  const user = data.users.find((u) => u.id === id);
  if (user && (hint === "user" || hint === "unknown")) {
    if (user.id === userId || !user.username) return null;
    if (!canFindByUsername(data, user, userId)) return null;
    const view = publicProfile(user, userId);
    return {
      id: `user:${user.id}`,
      scope: "user",
      title: view.displayName || user.username,
      preview: `@${user.username}`,
      sender: view.displayName,
      chatName: "افراد",
      date: user.activatedAt ?? user.createdAt,
      kind: "user",
      username: user.username,
      target: { type: "user", id: user.id },
    };
  }
  const post = data.channelPosts.find((p) => p.id === id && !p.deleted);
  if (post) {
    const channel = data.pubChannels.find((c) => c.id === post.channelId);
    if (!channel || !canSeeChannel(channel, userId)) return null;
    if (post.status !== "published" && channel.ownerUserId !== userId && !channel.staff.some((s) => s.userId === userId)) return null;
    return {
      id: `cpost:${post.id}`,
      scope: "channelPost",
      title: channel.name,
      preview: sanitizeSearchSnippet(post.caption || post.body || post.fileName || post.kind, 140),
      sender: post.authorName,
      chatName: channel.name,
      date: post.publishedAt ?? post.createdAt,
      kind: post.kind,
      target: { type: "channel", id: channel.id, messageId: post.id },
    };
  }
  const gmsg = data.groupMessages.find((m) => m.id === id && !m.deleted);
  if (gmsg) {
    const group = data.groups.find((g) => g.id === gmsg.groupId && !g.deletedAt);
    if (!group || !group.members.some((m) => liveMember(m, userId))) return null;
    return {
      id: `gmsg:${gmsg.id}`,
      scope: "group",
      title: group.name,
      preview: gmsg.enc === "e2ee-v1" ? "پیام گروه · متن روی دستگاه است" : sanitizeSearchSnippet(gmsg.bodyFa || gmsg.kind, 140),
      sender: gmsg.senderName,
      chatName: group.name,
      date: gmsg.createdAt,
      kind: gmsg.kind,
      target: { type: "group", id: group.id, messageId: gmsg.id },
    };
  }
  const pack = (data.stickerPacks ?? []).find((p) => p.id === id && !p.deletedAt);
  if (pack && canSeePack(pack, userId, data)) {
    return {
      id: `sticker:${pack.id}`,
      scope: "sticker",
      title: pack.name,
      preview: pack.description.slice(0, 80),
      sender: "",
      chatName: "استیکر",
      date: pack.createdAt,
      kind: "sticker",
      target: { type: "sticker", id: pack.id },
    };
  }
  const story = data.userStories?.find((s) => s.id === id);
  if (story && (hint === "story" || hint === "unknown")) {
    if (!canOpenPublicStory(data, story, userId, Date.now())) return null;
    const owner = data.users.find((u) => u.id === story.ownerUserId);
    return {
      id: `story:${story.id}`,
      scope: "story",
      title: sanitizeSearchSnippet(story.caption || story.body || "استوری", 80),
      preview: "استوری عمومی",
      sender: owner?.displayName || owner?.username || "",
      chatName: "استوری",
      date: story.createdAt,
      kind: "story",
      target: { type: "story", id: story.id },
    };
  }
  const vault = (data.vaultObjects ?? []).find((o) => o.id === id);
  if (vault && (hint === "file" || hint === "vault" || hint === "unknown")) {
    if (!canReadVaultInSearch(data, userId, vault)) return null;
    return {
      id: `vault:${vault.id}`,
      scope: "vault",
      title: vault.originalName,
      preview: vault.kind,
      sender: "",
      chatName: "فایل",
      date: vault.updatedAt,
      kind: vault.kind,
      fileName: vault.originalName,
      target: { type: "file", id: vault.id },
    };
  }
  const hl = (data.storyHighlights ?? []).find((h) => h.id === id);
  if (hl && highlightVisible(data, hl, userId)) {
    return {
      id: `highlight:${hl.id}`,
      scope: "highlight",
      title: hl.name,
      preview: "هایلایت",
      sender: "",
      chatName: "هایلایت",
      date: hl.updatedAt,
      kind: "highlight",
      target: { type: "highlight", id: hl.id },
    };
  }
  return null;
}

function highlightVisible(data: StoreData, hl: StoreData["storyHighlights"][number], viewerId: string) {
  if (hl.ownerUserId === viewerId) return true;
  if (hl.hideFromIds?.includes(viewerId)) return false;
  const owner = data.users.find((u) => u.id === hl.ownerUserId);
  const viewer = data.users.find((u) => u.id === viewerId);
  if (owner?.blockedPeerKeys.includes(viewerId) || viewer?.blockedPeerKeys.includes(hl.ownerUserId)) return false;
  if (hl.visibility === "nobody") return false;
  if (hl.visibility === "everyone") return true;
  if (hl.visibility === "friends") return Boolean(owner?.friendIds?.includes(viewerId));
  if (hl.visibility === "closeFriends") return Boolean(owner?.closeFriendIds?.includes(viewerId));
  if (hl.visibility === "selected") return hl.allowIds.includes(viewerId);
  return false;
}

function diversifyHits(hits: SearchHit[], cap: number) {
  const buckets = new Map<string, SearchHit[]>();
  for (const h of hits) {
    const k = h.scope;
    if (!buckets.has(k)) buckets.set(k, []);
    buckets.get(k)!.push(h);
  }
  const out: SearchHit[] = [];
  let round = 0;
  while (out.length < cap) {
    let added = false;
    for (const arr of buckets.values()) {
      if (round < arr.length) {
        out.push(arr[round]!);
        added = true;
        if (out.length >= cap) break;
      }
    }
    if (!added) break;
    round += 1;
  }
  return out;
}

function bumpPublicHashtagPopularity(data: StoreData, query: string, userId: string) {
  const tags = extractHashtags(query).map((t) => normalizeHashtag(t)).filter((t) => t.length >= 2);
  if (!tags.length) return;
  data.searchPopular ??= {};
  const now = Date.now();
  for (const t of tags) {
    const flood = hitRateLimit(data, `trend-tag:${userId}:${t}`, 60_000, 4, now);
    if (!flood.allowed) continue;
    data.searchPopular[t] = Math.min(10_000, (data.searchPopular[t] ?? 0) + 1);
  }
}

function collectDiscoveryHits(data: StoreData, userId: string, input: SearchQuery): SearchHit[] {
  const hits: SearchHit[] = [];
  const q = needleOf(input.q);
  const trending = input.feed === "trending";
  const hidden = new Set(data.users.find((u) => u.id === userId)?.searchHideIds ?? []);
  const tomb = new Set((data.searchTombstones ?? []).map((t) => t.docId));
  const me = data.users.find((u) => u.id === userId);
  const muted = new Set(me?.mutedPeerKeys ?? []);
  const contactIds = new Set(
    (data.contacts ?? []).filter((c) => c.ownerUserId === userId && c.nixoUserId).map((c) => c.nixoUserId as string),
  );
  for (const c of data.pubChannels) {
    if (hidden.has(c.id)) continue;
    if (c.visibility !== "public" || c.status !== "active") continue;
    if (!canSeeChannel(c, userId)) continue;
    if (q.length >= 2 && !blobMatches(`${c.name} ${c.username ?? ""} ${c.description}`, q)) continue;
    const posts = data.channelPosts.filter((p) => p.channelId === c.id && !p.deleted && p.status === "published");
    const unique = posts.reduce((n, p) => n + uniqueViewCount(p), 0);
    const subs = c.subscribers.filter(liveSub).length;
    hits.push(
      rank(
        {
          id: `channel:${c.id}`,
          scope: "channel",
          title: `${c.name}${c.verified ? " ✓" : ""}`,
          preview: "Discovery · کانال عمومی",
          sender: "",
          chatName: trending ? "Trending" : "Discovery",
          date: c.updatedAt,
          kind: "channel",
          members: unique + subs,
          visibility: "public",
          username: c.username,
          target: { type: "channel", id: c.id },
        },
        q || c.name,
        unique / 4,
      ),
    );
  }
  for (const g of data.groups) {
    if (hidden.has(g.id)) continue;
    if (g.deletedAt || g.joinMode !== "open" || g.searchVisible === false) continue;
    if (!canSeeGroup(g, userId)) continue;
    if (q.length >= 2 && !blobMatches(`${g.name} ${g.username ?? ""} ${g.description} ${(g.tags ?? []).join(" ")} ${g.category ?? ""}`, q)) continue;
    const members = g.members.filter((m) => !m.leftAt).length;
    hits.push(
      rank(
        {
          id: `group:${g.id}`,
          scope: "group",
          title: g.name,
          preview: "Discovery · گروه عمومی",
          sender: "",
          chatName: trending ? "Trending" : "Discovery",
          date: g.updatedAt,
          kind: "group",
          members,
          visibility: "public",
          username: g.username,
          target: { type: "group", id: g.id },
        },
        q || g.name,
        members / 8,
      ),
    );
  }
  for (const l of data.lives ?? []) {
    if (l.visibility !== "public" || l.emergencyStopped) continue;
    if (q.length >= 2 && !blobMatches(`${l.title} ${l.description} ${l.tags.join(" ")}`, q)) continue;
    hits.push(
      rank(
        {
          id: `live:${l.id}`,
          scope: "live",
          title: l.title,
          preview: l.status === "live" ? "🔴 Live" : l.status,
          sender: l.hostName,
          chatName: trending ? "Trending" : "Discovery",
          date: l.startedAt ?? l.createdAt,
          kind: "live",
          members: l.uniqueJoins?.length ?? 0,
          target: { type: "live", id: l.id },
        },
        q || l.title,
        (l.uniqueJoins?.length ?? 0) / 4,
      ),
    );
  }
  if (!trending) {
    for (const u of data.users) {
      if (u.id === userId || !u.username) continue;
      if (hidden.has(u.id) || muted.has(u.id)) continue;
      if (!canFindByUsername(data, u, userId)) continue;
      if (q.length >= 2 && !blobMatches(`${u.username} ${u.displayName}`, q)) continue;
      const view = publicProfile(u, userId);
      hits.push(
        rank(
          {
            id: `user:${u.id}`,
            scope: "user",
            title: view.displayName || u.username,
            preview: "Discovery · پیشنهاد کاربر عمومی",
            sender: view.displayName,
            chatName: "Discovery",
            date: u.activatedAt ?? u.createdAt,
            kind: "user",
            username: u.username,
            photoUrl: view.photoHidden ? null : view.photoUrl,
            target: { type: "user", id: u.id },
          },
          q || u.username,
          (contactIds.has(u.id) ? 20 : 0) + (u.friendIds?.includes(userId) ? 10 : 0),
        ),
      );
    }
  }
  const nowStories = Date.now();
  for (const s of data.userStories ?? []) {
    if (!canOpenPublicStory(data, s, userId, nowStories)) continue;
    if (hidden.has(s.id) || hidden.has(s.ownerUserId) || muted.has(s.ownerUserId)) continue;
    const blob = storySearchBlob(s);
    if (q.length >= 2 && !blobMatches(blob, q)) continue;
    const owner = data.users.find((u) => u.id === s.ownerUserId);
    hits.push(
      rank(
        {
          id: `story:${s.id}`,
          scope: "story",
          title: sanitizeSearchSnippet(s.caption || s.body || "استوری", 80),
          preview: "Discovery · استوری عمومی",
          sender: owner?.displayName || owner?.username || "",
          chatName: trending ? "Trending" : "Discovery",
          date: s.createdAt,
          kind: "story",
          target: { type: "story", id: s.id },
        },
        q || s.caption || s.body || s.kind,
        recencyBoost(s.createdAt),
      ),
    );
  }
  if (trending) {
    const popular = Object.entries(data.searchPopular ?? {}).sort((a, b) => b[1] - a[1]).slice(0, 16);
    for (const [tag, n] of popular) {
      if (q.length >= 2 && !blobMatches(tag, q)) continue;
      hits.push(
        rank(
          {
            id: `hashtag:${tag}`,
            scope: "hashtag",
            title: `#${tag}`,
            preview: "هشتگ عمومی",
            sender: "",
            chatName: "Trending",
            date: nowStories,
            kind: "hashtag",
            members: n,
            target: { type: "hashtag", id: tag },
          },
          q || tag,
          n / 2,
        ),
      );
    }
  }
  sortHits(hits, trending ? "popular" : input.sort ?? "popular");
  return diversifyHits(hits.filter((h) => !tomb.has(h.id)), SEARCH_HIT_CAP);
}

function rank(hit: SearchHit, needle: string, extra = 0) {
  hit.title = sanitizeSearchSnippet(hit.title, 80);
  hit.preview = sanitizeSearchSnippet(hit.preview, 160);
  const base = Math.max(matchScore(hit.title, needle), matchScore(`${hit.title} ${hit.preview}`, needle));
  hit.score = base + recencyBoost(hit.date) + extra;
  if (needle.length >= 2) hit.highlight = highlightText(hit.preview, needle);
  return hit;
}

export function collectSearchHits(data: StoreData, userId: string, input: SearchQuery): SearchHit[] {
  drainSearchIndexJobs(data);
  const parsed = parseSearchQuery(input.q);
  const q = parsed.needle;
  const exactPhrase = input.exact ? q : parsed.exact;
  const kind = canonicalKind(input.kind && input.kind.length ? input.kind : "all");
  const me = data.users.find((u) => u.id === userId);
  if (!me) return [];
  const from = input.from || parsed.from;
  const fromDate = input.fromDate ?? parsed.after;
  const toDate = input.toDate ?? parsed.before;
  const fileType = input.fileType || parsed.typeHint;
  const minSize = input.minSize ?? parsed.minSize;
  const maxSize = input.maxSize ?? parsed.maxSize;
  const has = input.has ?? parsed.has;
  const bool = parsed.bool;
  const matchBlob = (blob: string, k: SearchKind = "all") => contentMatches(blob, q, exactPhrase, k, bool);
  let chatId = input.chatId;
  let groupId = input.groupId;
  let channelId = input.channelId;
  if (parsed.inId) {
    const g = data.groups.find((x) => x.id === parsed.inId || x.username === parsed.inId);
    const c = data.pubChannels.find((x) => x.id === parsed.inId || x.username === parsed.inId);
    const t = data.threads.find((x) => x.id === parsed.inId && x.ownerUserId === userId);
    if (g && canSeeGroup(g, userId)) groupId = g.id;
    else if (c && canSeeChannel(c, userId)) channelId = c.id;
    else if (t) chatId = t.id;
    else return [];
  }
  const scoped = Boolean(chatId || groupId || channelId);
  const allowShort = Boolean(input.feed || parsed.entityHint || exactPhrase || kind === "emoji" || parsed.has || parsed.from || parsed.inId || parsed.bool);
  if (!allowShort && q.length < SEARCH_QUERY_MIN) return [];

  const started = Date.now();
  const hits: SearchHit[] = [];
  const contactIds = new Set(
    (data.contacts ?? []).filter((c) => c.ownerUserId === userId && c.nixoUserId).map((c) => c.nixoUserId as string),
  );
  const wantPeople = !scoped && (kind === "all" || kind === "users" || kind === "people");
  const wantFriends = !scoped && kind === "friends";
  const wantChats = !groupId && !channelId && (kind === "all" || kind === "chats");
  const wantBots = !scoped && (kind === "all" || kind === "bots" || kind === "users");
  const wantMini = !scoped && (kind === "all" || kind === "mini");
  const wantBiz = !scoped && (kind === "all" || kind === "business");
  const wantProducts = !scoped && (kind === "all" || kind === "products");
  const wantGroups = !channelId && !chatId && (kind === "all" || kind === "groups" || kind === "chats");
  const wantChannels = !groupId && !chatId && (kind === "all" || kind === "channels" || kind === "chats");
  const wantCommunities = !scoped && (kind === "all" || kind === "communities");
  const wantLive = !scoped && (kind === "all" || kind === "live");
  const wantStickers = !scoped && (kind === "all" || kind === "stickers");
  const wantEmoji = kind === "emoji" || kind === "all";
  const wantHighlights = !scoped && (kind === "all" || kind === "highlights");
  const wantStories = !scoped && (kind === "all" || kind === "stories");
  const wantVault = !scoped && (kind === "all" || kind === "files" || kind === "media");
  const wantMembers = kind === "members" || Boolean(groupId && kind === "all");
  const wantSubscribers = kind === "subscribers";
  const wantContent =
    kind === "all" ||
    kind === "messages" ||
    kind === "photos" ||
    kind === "videos" ||
    kind === "gifs" ||
    kind === "files" ||
    kind === "links" ||
    kind === "voice" ||
    kind === "music" ||
    kind === "media" ||
    kind === "hashtags" ||
    kind === "mentions" ||
    kind === "stickers" ||
    kind === "posts";

  const pushHit = (hit: SearchHit, extra = 0) => {
    if (hits.length >= SEARCH_HIT_CAP) return;
    if (Date.now() - started > SEARCH_BUDGET_MS) return;
    hits.push(rank(hit, q || hit.title, extra));
  };

  if (parsed.entityHint) {
    const idHit = resolveAuthorizedEntity(data, userId, parsed.entityHint.id, parsed.entityHint.type);
    if (idHit) pushHit(idHit, 80);
  }

  if (input.feed === "discovery" || input.feed === "trending") {
    return collectDiscoveryHits(data, userId, input);
  }

  if (wantPeople) {
    const phone = normalizePhone(input.q);
    const email = normalizeEmail(input.q);
    if (phone || email) {
      const floodId = hitRateLimit(data, `findid:${userId}`, 60_000, 20, Date.now());
      if (floodId.allowed) {
        const hash = hmacIdentifier((phone ?? email)!);
        const found = data.users.find((u) => u.status === "active" && u.identifierHash === hash);
        if (
          found &&
          found.id !== userId &&
          (!found.accountStatus || found.accountStatus === "active") &&
          !pairBlocked(data, userId, found.id)
        ) {
          const vis = phone ? found.privacyFindPhone : found.privacyEmail;
          const allow = phone ? found.findPhoneAllowIds : found.emailAllowIds;
          if (audienceAllows(vis, found.contactIds, allow, userId)) {
            const view = publicProfile(found, userId);
            hits.push(
              rank(
                {
                  id: `user:${found.id}`,
                  scope: "user",
                  title: view.displayName || found.username || "کاربر",
                  preview: found.username ? `@${found.username}` : "حساب نیکسو",
                  sender: view.displayName,
                  chatName: "افراد",
                  date: found.activatedAt ?? found.createdAt,
                  kind: "user",
                  photoUrl: view.photoHidden ? null : view.photoUrl,
                  verified: Boolean(found.officialVerified),
                  username: found.username,
                  target: { type: "user", id: found.id },
                },
                q,
                40,
              ),
            );
          }
        }
      }
    } else {
      const allowList = q.length >= 3 || input.q.trim().startsWith("@");
      if (allowList) {
        const byUsername = new Map<string, (typeof data.users)[number]>();
        for (const u of data.users) {
          if (u.username) byUsername.set(u.username, u);
        }
        const exact = byUsername.get(q);
        const pool = exact ? [exact, ...data.users.filter((u) => u.id !== exact.id)] : data.users;
        for (const u of pool) {
          if (u.id === userId || !u.username) continue;
          if (!canFindByUsername(data, u, userId)) continue;
          const view = publicProfile(u, userId);
          const blob = `${u.username} ${view.displayName}`;
          const isExact = u.username === q;
          if (!isExact && !blobMatches(blob, q) && !blobMatches(view.displayName, q)) continue;
          hits.push(
            rank(
              {
                id: `user:${u.id}`,
                scope: "user",
                title: view.displayName || u.username,
                preview: `@${u.username}${view.bio ? ` · ${view.bio.slice(0, 80)}` : ""}`,
                sender: view.displayName,
                chatName: "افراد",
                date: u.activatedAt ?? u.createdAt,
                kind: "user",
                photoUrl: view.photoHidden ? null : view.photoUrl,
                verified: Boolean(u.officialVerified),
                username: u.username,
                target: { type: "user", id: u.id },
              },
              q,
              (isExact ? 36 : 0) + (u.officialVerified ? 10 : 0) + (contactIds.has(u.id) ? 18 : 0) + (u.friendIds?.includes(userId) ? 8 : 0),
            ),
          );
        }
      }
    }
  }

  if (wantFriends) {
    for (const fid of me.friendIds ?? []) {
      const u = data.users.find((x) => x.id === fid);
      if (!u || u.id === userId || !u.username) continue;
      if (!canFindByUsername(data, u, userId)) continue;
      const view = publicProfile(u, userId);
      const blob = `${u.username} ${view.displayName}`;
      const isExact = u.username === q;
      if (q.length >= SEARCH_QUERY_MIN && !isExact && !blobMatches(blob, q) && !blobMatches(view.displayName, q)) continue;
      pushHit(
        {
          id: `user:${u.id}`,
          scope: "friend",
          title: view.displayName || u.username,
          preview: `@${u.username}`,
          sender: view.displayName,
          chatName: "دوستان",
          date: u.activatedAt ?? u.createdAt,
          kind: "friend",
          photoUrl: view.photoHidden ? null : view.photoUrl,
          username: u.username,
          target: { type: "user", id: u.id },
        },
        (isExact ? 40 : 12) + (contactIds.has(u.id) ? 8 : 0),
      );
    }
  }

  if (wantChats) {
    for (const t of data.threads) {
      if (t.ownerUserId !== userId) continue;
      if (chatId && t.id !== chatId) continue;
      if (q.length >= 2 && !matchBlob(`${t.peerName} ${t.peerKey}`, kind)) continue;
      if (q.length < 2 && !chatId) continue;
      hits.push(
        rank(
          {
            id: `chatmeta:${t.id}`,
            scope: "chat",
            title: t.peerName,
            preview: "گفتگوی خصوصی · متن پیام روی دستگاه است",
            sender: t.peerName,
            chatName: "چت‌ها",
            date: t.updatedAt,
            kind: "chat",
            target: { type: "chat", id: t.id },
          },
          q,
        ),
      );
    }
  }

  if (wantBots) {
    for (const b of data.bots ?? []) {
      if (b.status !== "active") continue;
      if (!blobMatches(`${b.username} ${b.name} ${b.description}`, q)) continue;
      hits.push(
        rank(
          {
            id: `bot:${b.id}`,
            scope: "bot",
            title: `${b.name}${b.verified ? " ✓" : ""}`,
            preview: `@${b.username} · ربات`,
            sender: b.name,
            chatName: "ربات‌ها",
            date: b.createdAt,
            kind: "bot",
            verified: b.verified,
            target: { type: "bot", id: b.id },
          },
          q,
          b.verified ? 8 : 0,
        ),
      );
    }
  }

  if (wantMini) {
    for (const m of data.miniApps ?? []) {
      if (!blobMatches(`${m.title} ${m.description} ${m.category}`, q)) continue;
      hits.push(
        rank(
          {
            id: `mini:${m.id}`,
            scope: "mini",
            title: m.title,
            preview: m.description.slice(0, 120),
            sender: m.category,
            chatName: "مینی‌اپ",
            date: m.createdAt,
            kind: "mini",
            category: m.category,
            target: { type: "mini", id: m.id },
          },
          q,
        ),
      );
    }
  }

  if (wantBiz) {
    for (const b of data.businesses ?? []) {
      if (!blobMatches(`${b.username} ${b.name} ${b.description} ${b.category} ${b.address}`, q)) continue;
      hits.push(
        rank(
          {
            id: `biz:${b.id}`,
            scope: "business",
            title: `${b.name}${b.verified ? " ✓" : ""}`,
            preview: `@${b.username} · ${b.category}`,
            sender: b.name,
            chatName: "کسب‌وکار",
            date: b.createdAt,
            kind: "business",
            verified: b.verified,
            category: b.category,
            location: b.address || null,
            photoUrl: b.logoKind === "upload" ? `/api/media/photo/${b.id}` : null,
            target: { type: "business", id: b.id },
          },
          q,
          b.verified ? 8 : Math.min(10, b.views / 20),
        ),
      );
    }
  }

  if (wantProducts) {
    for (const p of data.bizProducts ?? []) {
      if (input.category && p.category !== input.category) continue;
      if (typeof input.minPrice === "number" && p.price < input.minPrice) continue;
      if (typeof input.maxPrice === "number" && p.price > input.maxPrice) continue;
      const biz = data.businesses.find((b) => b.id === p.businessId);
      if (!blobMatches(`${p.name} ${p.description} ${p.code} ${p.category} ${biz?.name ?? ""}`, q) && q !== "product") continue;
      hits.push(
        rank(
          {
            id: `prod:${p.id}`,
            scope: "product",
            title: p.name,
            preview: `${p.price} ${p.currency} · ${biz?.name ?? "فروشگاه"}`,
            sender: biz?.name ?? "",
            chatName: "محصولات",
            date: p.createdAt,
            kind: "product",
            price: p.price,
            currency: p.currency,
            category: p.category,
            photoUrl: p.photoKind === "upload" ? `/api/media/photo/${p.id}` : null,
            target: { type: "product", id: p.id, businessId: p.businessId },
          },
          q,
          Math.min(8, p.views / 10),
        ),
      );
    }
  }

  if (wantGroups) {
    for (const g of data.groups) {
      if (groupId && g.id !== groupId) continue;
      if (!canSeeGroup(g, userId)) continue;
      if (q.length >= 2 && !matchBlob(`${g.name} ${g.username ?? ""} ${g.description} ${(g.tags ?? []).join(" ")}`, kind)) continue;
      if (q.length < 2) continue;
      const members = g.members.filter((m) => !m.leftAt).length;
      hits.push(
        rank(
          {
            id: `group:${g.id}`,
            scope: "group",
            title: g.name,
            preview: `${g.username ? `@${g.username} · ` : ""}${g.joinMode === "open" ? "Public" : "Private"} · ${members} عضو`,
            sender: "",
            chatName: "گروه‌ها",
            date: g.updatedAt,
            kind: "group",
            members,
            visibility: g.joinMode === "open" ? "public" : "private",
            target: { type: "group", id: g.id },
          },
          q,
        ),
      );
    }
  }

  if (wantChannels) {
    for (const c of data.pubChannels) {
      if (channelId && c.id !== channelId) continue;
      if (!canSeeChannel(c, userId)) continue;
      if (q.length >= 2 && !matchBlob(`${c.name} ${c.username ?? ""} ${c.description}`, kind)) continue;
      if (q.length < 2) continue;
      const subs = c.subscribers.filter(liveSub).length;
      hits.push(
        rank(
          {
            id: `channel:${c.id}`,
            scope: "channel",
            title: `${c.name}${c.verified ? " ✓" : ""}`,
            preview: `${c.username ? `@${c.username} · ` : ""}${subs} دنبال‌کننده`,
            sender: "",
            chatName: "کانال‌ها",
            date: c.updatedAt,
            kind: "channel",
            verified: Boolean(c.verified),
            members: subs,
            visibility: c.visibility,
            target: { type: "channel", id: c.id },
          },
          q,
          c.verified ? 8 : 0,
        ),
      );
    }
  }

  if (wantCommunities) {
    for (const c of data.communities) {
      if (!canSeeCommunity(c, userId)) continue;
      if (!blobMatches(`${c.name} ${c.username ?? ""} ${c.description}`, q)) continue;
      hits.push(
        rank(
          {
            id: `community:${c.id}`,
            scope: "community",
            title: c.name,
            preview: c.username ? `@${c.username}` : c.description.slice(0, 80),
            sender: "",
            chatName: "جامعه‌ها",
            date: c.updatedAt,
            kind: "community",
            members: c.members.filter((m) => !m.leftAt).length,
            target: { type: "community", id: c.id },
          },
          q,
        ),
      );
    }
  }

  if (wantContent) {
    const postsByChannel = new Map<string, ChannelPost[]>();
    for (const p of data.channelPosts) {
      if (p.deleted) continue;
      const list = postsByChannel.get(p.channelId) ?? [];
      list.push(p);
      postsByChannel.set(p.channelId, list);
    }
    for (const c of data.pubChannels) {
      if (channelId && c.id !== channelId) continue;
      if (groupId || chatId) continue;
      if (!canSeeChannel(c, userId)) continue;
      const staff = c.ownerUserId === userId || c.staff.some((s) => s.userId === userId);
      for (const p of postsByChannel.get(c.id) ?? []) {
        if (p.status !== "published" && !staff) continue;
        if (!matchesKind(kind, p.kind) && kind !== "hashtags" && kind !== "mentions") continue;
        if (!inRange(p.publishedAt ?? p.createdAt, fromDate, toDate)) continue;
        if (!senderOk(p.authorName, null, from)) continue;
        const fileName = p.fileName ?? "";
        const blob = `${p.body} ${p.caption} ${p.kind} ${fileName} ${p.poll?.question ?? ""}`;
        if (!fileTypeOk(fileType, p.kind, fileName, blob)) continue;
        if (!hasKindOk(has, p.kind, blob)) continue;
        const tagHit = kind === "hashtags" || parsed.hashtags.length > 0;
        const menHit = kind === "mentions" || parsed.mentions.length > 0;
        let ok = matchBlob(blob, kind === "hashtags" || kind === "mentions" ? kind : "all");
        if (kind === "links" && !/https?:\/\//i.test(blob)) ok = false;
        if (tagHit && kind === "hashtags") ok = matchBlob(blob, "hashtags");
        if (menHit && kind === "mentions") ok = matchBlob(blob, "mentions");
        if (!ok && q !== p.kind && !blobMatches(fileName, q)) continue;
        if (kind === "files" && !blobMatches(`${fileName} ${p.caption}`, q) && q !== p.kind && !matchBlob(blob, kind)) continue;
        hits.push(
          rank(
            {
              id: `cpost:${p.id}`,
              scope: "channelPost",
              title: c.name,
              preview: (p.caption || p.body || fileName || p.kind).slice(0, 140),
              sender: p.authorName,
              chatName: c.name,
              date: p.publishedAt ?? p.createdAt,
              kind: p.kind,
              fileName: fileName || undefined,
              fileKind: p.kind,
              members: uniqueViewCount(p),
              target: { type: "channel", id: c.id, messageId: p.id },
            },
            q,
            uniqueViewCount(p) / 8,
          ),
        );
      }
    }
    for (const c of data.communities) {
      if (channelId || chatId) continue;
      if (groupId) continue;
      if (!c.members.some((m) => liveMember(m, userId))) continue;
      for (const p of c.posts) {
        if (p.deleted) continue;
        if (!matchesKind(kind, p.kind) && kind !== "hashtags" && kind !== "mentions") continue;
        if (!inRange(p.createdAt, fromDate, toDate)) continue;
        if (!senderOk(p.authorName, null, from)) continue;
        const blob = `${p.body} ${p.kind}`;
        if (!hasKindOk(has, p.kind, blob)) continue;
        if (!matchBlob(blob, kind === "hashtags" || kind === "mentions" ? kind : "all") && q !== p.kind) continue;
        hits.push(
          rank(
            {
              id: `cmpost:${p.id}`,
              scope: "communityPost",
              title: c.name,
              preview: p.body.slice(0, 140) || p.kind,
              sender: p.authorName,
              chatName: c.name,
              date: p.createdAt,
              kind: p.kind,
              target: { type: "community", id: c.id, messageId: p.id },
            },
            q,
          ),
        );
      }
    }
    for (const g of data.groups) {
      if (kind === "posts") continue;
      if (channelId || chatId) continue;
      if (groupId && g.id !== groupId) continue;
      if (!g.members.some((m) => liveMember(m, userId))) continue;
      for (const m of data.groupMessages ?? []) {
        if (m.groupId !== g.id || m.deleted) continue;
        if (m.enc === "e2ee-v1") {
          if (!isMediaKind(kind) && kind !== "files" && kind !== "all" && kind !== "messages") continue;
          if (m.kind === "text") continue;
        }
        if (!matchesKind(kind === "all" ? "media" : kind, m.kind) && m.kind !== "system" && m.kind !== "poll" && kind !== "hashtags" && kind !== "mentions") continue;
        if (!inRange(m.createdAt, fromDate, toDate)) continue;
        if (!senderOk(m.senderName, null, from)) continue;
        const fileName = m.fileName ?? "";
        const blob = `${m.kind} ${m.bodyFa ?? ""} ${m.poll?.question ?? ""} ${fileName}`;
        if (!fileTypeOk(fileType, m.kind, fileName, blob)) continue;
        if (!hasKindOk(has, m.kind, blob)) continue;
        if (!sizeOk(m.byteLength, minSize, maxSize)) continue;
        if (m.enc === "e2ee-v1" && m.kind === "text") continue;
        if (!matchBlob(blob, kind === "hashtags" || kind === "mentions" ? kind : "all") && q !== m.kind && !blobMatches(fileName, q)) continue;
        hits.push(
          rank(
            {
              id: `gmsg:${m.id}`,
              scope: "group",
              title: g.name,
              preview: m.kind === "system" || m.kind === "poll" ? (m.bodyFa || m.poll?.question || m.kind) : `${m.kind} · متن E2EE روی دستگاه است`,
              sender: m.senderName,
              chatName: g.name,
              date: m.createdAt,
              kind: m.kind,
              fileName: fileName || undefined,
              fileKind: m.kind,
              target: { type: "group", id: g.id, messageId: m.id },
            },
            q,
          ),
        );
      }
    }
  }

  if (wantLive) {
    for (const l of data.lives ?? []) {
      if (l.visibility !== "public" || l.emergencyStopped) continue;
      if (!inRange(l.createdAt, fromDate, toDate)) continue;
      const blob = `${l.title} ${l.description} ${l.tags.join(" ")} ${l.category} ${l.hostName}`;
      if (!blobMatches(blob, q)) continue;
      hits.push(
        rank(
          {
            id: `live:${l.id}`,
            scope: "live",
            title: l.title,
            preview: l.status === "live" ? "🔴 Live" : l.status,
            sender: l.hostName,
            chatName: "Live",
            date: l.startedAt ?? l.createdAt,
            kind: "live",
            category: l.category,
            target: { type: "live", id: l.id },
          },
          q,
        ),
      );
    }
  }

  if (wantStickers) {
    ensureOfficialPacks(data);
    for (const pack of data.stickerPacks ?? []) {
      if (pack.deletedAt || !canSeePack(pack, userId, data)) continue;
      const items = (data.stickers ?? []).filter((s) => s.packId === pack.id && !s.deletedAt);
      const blob = `${pack.name} ${pack.description} ${items.map((s) => `${s.name} ${s.emoji} ${s.tags.join(" ")}`).join(" ")}`;
      if (q.length >= 2 && !blobMatches(blob, q)) continue;
      if ((minSize != null || maxSize != null) && !items.some((s) => sizeOk(s.bytes, minSize, maxSize))) continue;
      hits.push(
        rank(
          {
            id: `sticker:${pack.id}`,
            scope: "sticker",
            title: pack.name,
            preview: pack.official ? "بستهٔ رسمی" : pack.description.slice(0, 80),
            sender: "",
            chatName: "استیکر",
            date: pack.createdAt,
            kind: "sticker",
            target: { type: "sticker", id: pack.id },
          },
          q,
          pack.official ? 6 : 0,
        ),
      );
    }
  }

  if (wantEmoji && q.length >= 2) {
    for (const item of searchEmoji(q).slice(0, 12)) {
      hits.push(
        rank(
          {
            id: `emoji:${item.e}`,
            scope: "emoji",
            title: `${item.e} ${item.n}`,
            preview: item.k.slice(0, 4).join(" · "),
            sender: "",
            chatName: "ایموجی",
            date: 0,
            kind: "emoji",
            target: { type: "hashtag", id: item.e },
          },
          q,
        ),
      );
    }
  }

  if (wantStories) {
    const now = Date.now();
    for (const s of data.userStories ?? []) {
      if (!canOpenPublicStory(data, s, userId, now)) continue;
      if (!inRange(s.createdAt, fromDate, toDate)) continue;
      const blob = storySearchBlob(s);
      if (q.length >= SEARCH_QUERY_MIN && !matchBlob(blob, "all")) continue;
      const owner = data.users.find((u) => u.id === s.ownerUserId);
      pushHit(
        {
          id: `story:${s.id}`,
          scope: "story",
          title: sanitizeSearchSnippet(s.caption || s.body || "استوری", 80),
          preview: "استوری عمومی",
          sender: owner?.displayName || owner?.username || "",
          chatName: "استوری",
          date: s.createdAt,
          kind: "story",
          target: { type: "story", id: s.id },
        },
        6,
      );
    }
  }

  if (wantVault) {
    for (const o of data.vaultObjects ?? []) {
      if (!canReadVaultInSearch(data, userId, o)) continue;
      const blob = `${o.originalName} ${o.kind} ${o.mime}`;
      if (q.length >= SEARCH_QUERY_MIN && !blobMatches(blob, q)) continue;
      pushHit(
        {
          id: `vault:${o.id}`,
          scope: "vault",
          title: o.originalName,
          preview: o.kind,
          sender: "",
          chatName: "فایل‌ها",
          date: o.updatedAt,
          kind: o.kind,
          fileName: o.originalName,
          fileKind: o.kind,
          target: { type: "file", id: o.id },
        },
        o.ownerUserId === userId ? 8 : 0,
      );
    }
  }

  if (wantHighlights) {
    for (const hl of data.storyHighlights ?? []) {
      if (!highlightVisible(data, hl, userId)) continue;
      if (q.length >= 2 && !blobMatches(hl.name, q)) continue;
      hits.push(
        rank(
          {
            id: `highlight:${hl.id}`,
            scope: "highlight",
            title: hl.name,
            preview: "هایلایت عمومی مجاز",
            sender: "",
            chatName: "هایلایت",
            date: hl.updatedAt,
            kind: "highlight",
            target: { type: "highlight", id: hl.id },
          },
          q,
        ),
      );
    }
  }

  if (wantMembers) {
    const groups = data.groups.filter((g) => {
      if (groupId && g.id !== groupId) return false;
      return g.members.some((m) => liveMember(m, userId));
    });
    for (const g of groups) {
      for (const m of g.members.filter((row) => !row.leftAt)) {
        if (q.length >= 2 && !blobMatches(`${m.name} ${m.key}`, q)) continue;
        hits.push(
          rank(
            {
              id: `member:${g.id}:${m.key}`,
              scope: "member",
              title: m.name,
              preview: `عضو ${g.name}`,
              sender: m.name,
              chatName: g.name,
              date: m.joinedAt ?? g.updatedAt,
              kind: "member",
              target: { type: "group", id: g.id },
            },
            q,
          ),
        );
      }
    }
  }

  if (wantSubscribers) {
    for (const c of data.pubChannels) {
      if (channelId && c.id !== channelId) continue;
      const staff = c.ownerUserId === userId || c.staff.some((s) => s.userId === userId);
      if (!staff) continue;
      for (const s of c.subscribers.filter(liveSub)) {
        const u = data.users.find((x) => x.id === s.userId);
        const label = u?.username ? `@${u.username}` : s.userId.slice(0, 8);
        if (q.length >= 2 && !blobMatches(`${label} ${u?.displayName ?? ""}`, q)) continue;
        hits.push(
          rank(
            {
              id: `sub:${c.id}:${s.userId}`,
              scope: "subscriber",
              title: u?.displayName || label,
              preview: `مشترک ${c.name}`,
              sender: label,
              chatName: c.name,
              date: c.updatedAt,
              kind: "subscriber",
              target: { type: "channel", id: c.id },
            },
            q,
          ),
        );
      }
    }
  }

  hits.sort((a, b) => (b.score ?? 0) - (a.score ?? 0) || b.date - a.date);
  if (me.searchPersonalize !== false) {
    const hist = (me.searchHistory ?? []).map((h) => foldText(h)).filter((h) => h.length >= 2);
    for (const hit of hits) {
      if (hist.some((h) => foldText(hit.title).includes(h))) hit.score = (hit.score ?? 0) + 4;
    }
  }
  const ranking = input.ranking ?? "relevance";
  for (const hit of hits) {
    if (ranking === "freshness") hit.score = (hit.score ?? 0) + recencyBoost(hit.date) * 2;
    if (ranking === "popularity") hit.score = (hit.score ?? 0) + (hit.members ?? 0) / 3;
    if (input.semantic) {
      hit.score = (hit.score ?? 0) + hybridOverlap(`${hit.title} ${hit.preview}`, input.q) * 18;
    }
  }
  const hidden = new Set(me.searchHideIds ?? []);
  const tomb = new Set((data.searchTombstones ?? []).map((t) => t.docId));
  const visible = hits.filter((h) => !hidden.has(h.target.id) && !tomb.has(h.id));
  sortHits(visible, input.sort);
  return visible.slice(0, SEARCH_HIT_CAP);
}

export async function globalSearch(userId: string, input: SearchQuery) {
  const check = validateSearchQuery(input.q ?? "");
  if (!check.ok) return { ok: false as const, error: check.error, status: 400 };
  const q = needleOf(input.q);
  const offset = Math.max(0, input.offset ?? 0);
  const limit = Math.min(50, Math.max(1, input.limit ?? SEARCH_PAGE));
  const record = input.recordHistory !== false;
  const sensitive = Boolean(normalizePhone(input.q) || normalizeEmail(input.q));
  const feed = input.feed;
  try {
  return mutateStore((data) => {
    data.searchMetrics ??= { queries: 0, errors: 0, cacheHits: 0, lastLatencyMs: 0, emptyResults: 0, opens: 0 };
    const now = Date.now();
    const flood = hitRateLimit(data, `search:${userId}`, SEARCH_FLOOD_WINDOW_MS, SEARCH_FLOOD_MAX, now);
    if (!flood.allowed) {
      data.audit = [
        { id: `srch-${now}`, userId, kind: "suspicious" as const, createdAt: now, detail: "search-flood" },
        ...(data.audit ?? []),
      ].slice(0, 400);
      return { ok: false as const, error: "جستجو موقتاً محدود شد.", status: 429, retryAfterSec: flood.retryAfterSec };
    }
    const me = data.users.find((u) => u.id === userId);
    if (!me) return { ok: false as const, error: "حساب فعال نیست.", status: 401 };
    if (record && q.length >= SEARCH_QUERY_MIN && !sensitive && !feed) {
      me.searchHistory = [input.q.trim().slice(0, 80), ...me.searchHistory.filter((h) => h !== input.q.trim())].slice(
        0,
        SEARCH_HISTORY_MAX,
      );
      bumpPublicHashtagPopularity(data, input.q, userId);
    }
    if (!feed && q.length < SEARCH_QUERY_MIN && !parseSearchQuery(input.q).entityHint && !input.exact && !parseSearchQuery(input.q).has && !parseSearchQuery(input.q).from && !parseSearchQuery(input.q).inId && !parseSearchQuery(input.q).bool) {
      return {
        ok: true as const,
        hits: [] as SearchHit[],
        hasMore: false,
        nextOffset: 0,
        nextCursor: null as string | null,
        history: me.searchHistory,
        suggestions: suggestTerms(input.q, me.searchHistory),
        note: "حداقل دو نویسه لازم است. متن گفتگوی خصوصی E2EE روی دستگاه جستجو می‌شود.",
      };
    }

    if (!(data.searchDocs ?? []).length) enqueueSearchIndexSync(data, "bootstrap");
    if ((data.searchIndex?.version ?? 0) < SEARCH_INDEX_VERSION) enqueueSearchIndexSync(data, "migrate");
    drainSearchIndexJobs(data);
    data.searchMetrics ??= { queries: 0, errors: 0, cacheHits: 0, lastLatencyMs: 0, emptyResults: 0, opens: 0, latencySamples: [] };
    const ranking = input.ranking ?? (experimentBucket(userId, "search-rank-v1", 0) === "b" ? "freshness" : "relevance");
    const cacheKey = `${userId}|${input.kind ?? "all"}|${input.sort ?? ""}|${input.feed ?? ""}|${foldText(check.q)}|${input.channelId ?? ""}|${input.groupId ?? ""}|${input.chatId ?? ""}|${input.from ?? ""}|${input.fileType ?? ""}|${input.has ?? ""}|${input.minSize ?? ""}|${input.maxSize ?? ""}|${input.semantic ? 1 : 0}|${ranking}`;
    const gen = data.searchIndex?.gen ?? 0;
    data.searchQueryCache ??= [];
    const cached = data.searchQueryCache.find((c) => c.key === cacheKey && c.gen === gen && Date.now() - c.at < SEARCH_CACHE_TTL_MS && c.userId === userId);
    let hits: SearchHit[] = [];
    try {
      hits = collectSearchHits(data, userId, { ...input, q: check.q, ranking });
    } catch {
      data.searchMetrics.errors += 1;
      data.searchMetrics.lastError = "collect";
      return {
        ok: true as const,
        hits: [] as SearchHit[],
        hasMore: false,
        nextOffset: 0,
        nextCursor: null as string | null,
        history: me.searchHistory,
        suggestions: [] as string[],
        note: "جستجو موقتاً در دسترس نیست. بقیهٔ نیکسو کار می‌کند.",
        degraded: true as const,
      };
    }
    if (cached) {
      data.searchMetrics.cacheHits += 1;
    } else {
      data.searchQueryCache = [{ key: cacheKey, gen, at: Date.now(), userId, hitIds: hits.map((h) => h.id) }, ...data.searchQueryCache.filter((c) => Date.now() - c.at < SEARCH_CACHE_TTL_MS && c.userId === userId)].slice(0, 40);
    }
    const start = input.cursor ? Math.max(0, hits.findIndex((h) => h.id === input.cursor) + 1) : offset;
    const page = hits.slice(start, start + limit);
    const last = page[page.length - 1];
    const titles = hits.map((h) => h.title);
    data.searchMetrics.queries += 1;
    data.searchMetrics.lastLatencyMs = Date.now() - now;
    data.searchMetrics.latencySamples = [...(data.searchMetrics.latencySamples ?? []), data.searchMetrics.lastLatencyMs].slice(-200);
    data.searchMetrics.resultHits = (data.searchMetrics.resultHits ?? 0) + page.length;
    if (page.length === 0) data.searchMetrics.emptyResults = (data.searchMetrics.emptyResults ?? 0) + 1;
    const samples = data.searchMetrics.latencySamples ?? [];
    const successRate =
      data.searchMetrics.queries === 0 ? 1 : 1 - (data.searchMetrics.emptyResults ?? 0) / Math.max(1, data.searchMetrics.queries);
    return {
      ok: true as const,
      hits: page,
      hasMore: start + page.length < hits.length,
      nextOffset: start + page.length,
      nextCursor: page.length === limit && last ? last.id : null,
      history: me.searchHistory,
      suggestions: suggestTerms(input.q, [...titles, ...me.searchHistory]),
      noResultHints: page.length === 0 ? suggestTerms(input.q, me.searchHistory).slice(0, 5) : [],
      note: "متن گفتگوی خصوصی E2EE روی سرور جستجو نمی‌شود؛ روی دستگاه ادغام می‌شود. نتایج فقط پس از Authentication، Authorization، Membership و Block در لحظهٔ درخواست است. کش جستجو per-user است.",
      indexGen: data.searchIndex?.gen ?? 0,
      indexVersion: data.searchIndex?.version ?? SEARCH_INDEX_VERSION,
      ranking,
      personalize: me.searchPersonalize !== false,
      metrics: {
        latencyMs: data.searchMetrics.lastLatencyMs,
        p50: percentile(samples, 50),
        p95: percentile(samples, 95),
        p99: percentile(samples, 99),
        cacheHit: Boolean(cached),
        successRate,
        resultCount: page.length,
        queryCount: data.searchMetrics.queries,
        errorRate:
          data.searchMetrics.queries === 0 ? 0 : (data.searchMetrics.errors ?? 0) / data.searchMetrics.queries,
        zeroResultRate:
          data.searchMetrics.queries === 0 ? 0 : (data.searchMetrics.emptyResults ?? 0) / data.searchMetrics.queries,
        rankingVariant: ranking,
        ab: experimentBucket(userId, "search-rank-v1", 0),
      },
    };
  });
  } catch {
    return {
      ok: true as const,
      hits: [] as SearchHit[],
      hasMore: false,
      nextOffset: 0,
      nextCursor: null as string | null,
      history: [] as string[],
      suggestions: [] as string[],
      note: "جستجو موقتاً در دسترس نیست. بقیهٔ نیکسو کار می‌کند.",
      degraded: true as const,
    };
  }
}

export async function suggestSearch(userId: string, q: string) {
  const check = validateSearchQuery(q);
  if (!check.ok) return { ok: false as const, status: 400, error: check.error, suggestions: [] as string[] };
  return mutateStore((data) => {
    const flood = hitRateLimit(data, `search-suggest:${userId}`, 10_000, 20);
    if (!flood.allowed) return { ok: false as const, status: 429, error: "پیشنهاد محدود شد.", suggestions: [] as string[] };
    const me = data.users.find((u) => u.id === userId);
    if (!me) return { ok: false as const, status: 401, error: "حساب فعال نیست.", suggestions: [] as string[] };
    const extra =
      needleOf(q).length >= SEARCH_QUERY_MIN
        ? collectSearchHits(data, userId, { q, kind: "all" })
            .slice(0, 12)
            .map((h) => h.title)
        : me.searchHistory;
    return { ok: true as const, suggestions: suggestTerms(q, extra) };
  });
}

export async function exportSearchHistory(userId: string) {
  const data = await readStoreSnapshot();
  const me = data.users.find((u) => u.id === userId);
  if (!me) return { ok: false as const, error: "حساب فعال نیست.", status: 401 };
  return {
    ok: true as const,
    export: {
      kind: "nixo-search-history",
      exportedAt: Date.now(),
      queries: [...(me.searchHistory ?? [])],
    },
  };
}

export async function rebuildSearchIndex(userId: string) {
  return mutateStore((data) => {
    const me = data.users.find((u) => u.id === userId);
    const handle = (me?.username ?? "").toLowerCase();
    if (handle !== "nixo" && handle !== "nixo_ops") {
      return { ok: false as const, error: "فقط ایمنی نیکسو.", status: 403 };
    }
    syncPublicSearchIndex(data);
    data.audit = [
      { id: `sidx-${Date.now()}`, userId, kind: "suspicious" as const, createdAt: Date.now(), detail: "search-reindex" },
      ...(data.audit ?? []),
    ].slice(0, 400);
    return { ok: true as const, searchIndex: data.searchIndex, docs: (data.searchDocs ?? []).length };
  });
}

function isSearchOps(data: StoreData, userId: string) {
  const me = data.users.find((u) => u.id === userId);
  const handle = (me?.username ?? "").toLowerCase();
  return handle === "nixo" || handle === "nixo_ops";
}

export async function reindexSearchScope(userId: string, scope: string) {
  return mutateStore((data) => {
    if (!isSearchOps(data, userId)) return { ok: false as const, error: "فقط ایمنی نیکسو.", status: 403 };
    const id = scope.trim().slice(0, 80);
    if (!id) return { ok: false as const, error: "محدوده نامعتبر است.", status: 400 };
    data.searchIndexJobs ??= [];
    data.searchIndexJobs.push({
      id: randomId(),
      idempotencyKey: `reindex:${id}:${Date.now()}`,
      kind: "reindex_scope",
      status: "queued",
      attempts: 0,
      createdAt: Date.now(),
      scope: id,
    });
    syncPublicSearchIndex(data);
    return { ok: true as const, searchIndex: data.searchIndex, scope: id };
  });
}

export async function tombstoneSearchDoc(userId: string, docId: string, reason = "ops") {
  return mutateStore((data) => {
    if (!isSearchOps(data, userId)) return { ok: false as const, error: "فقط ایمنی نیکسو.", status: 403 };
    enqueueSearchTombstone(data, docId, reason);
    drainSearchIndexJobs(data);
    return { ok: true as const, tombstones: (data.searchTombstones ?? []).length };
  });
}

export async function setSearchPersonalize(userId: string, on: boolean) {
  return mutateStore((data) => {
    const me = data.users.find((u) => u.id === userId);
    if (!me) return { ok: false as const, error: "حساب فعال نیست.", status: 401 };
    me.searchPersonalize = on;
    data.searchQueryCache = (data.searchQueryCache ?? []).filter((c) => c.userId !== userId);
    return { ok: true as const, personalize: me.searchPersonalize };
  });
}

export async function evaluateSearchQuality(userId: string) {
  return mutateStore((data) => {
    if (!isSearchOps(data, userId)) return { ok: false as const, error: "فقط ایمنی نیکسو.", status: 403 };
    const cases = SEARCH_EVAL_CASES.map((c) => {
      const hits = collectSearchHits(data, userId, { q: c.q, kind: c.kind, recordHistory: false });
      const score = scoreEvalHits(hits, c.forbidTitleIncludes);
      return { id: c.id, qLength: c.q.length, ...score };
    });
    const leaked = cases.reduce((n, c) => n + c.leaked, 0);
    const avgPrecision = cases.reduce((n, c) => n + c.precision, 0) / Math.max(1, cases.length);
    return { ok: true as const, version: SEARCH_EVAL_VERSION, leaked, avgPrecision, cases };
  });
}

export async function getSearchHistory(userId: string) {
  const data = await readStoreSnapshot();
  const me = data.users.find((u) => u.id === userId);
  return me?.searchHistory ?? [];
}

export async function removeSearchHistoryItem(userId: string, term: string) {
  return mutateStore((data) => {
    const me = data.users.find((u) => u.id === userId);
    if (!me) return { ok: false as const, error: "حساب فعال نیست.", status: 401 };
    me.searchHistory = me.searchHistory.filter((h) => h !== term);
    return { ok: true as const, history: me.searchHistory };
  });
}

export async function clearSearchHistory(userId: string) {
  return mutateStore((data) => {
    const me = data.users.find((u) => u.id === userId);
    if (!me) return { ok: false as const, error: "حساب فعال نیست.", status: 401 };
    me.searchHistory = [];
    return { ok: true as const };
  });
}

export async function hideSearchRecommendation(userId: string, entityId: string) {
  return mutateStore((data) => {
    const me = data.users.find((u) => u.id === userId);
    if (!me) return { ok: false as const, error: "حساب فعال نیست.", status: 401 };
    const id = entityId.trim().slice(0, 80);
    if (!id) return { ok: false as const, error: "شناسه نامعتبر است.", status: 400 };
    me.searchHideIds = [id, ...(me.searchHideIds ?? []).filter((x) => x !== id)].slice(0, 80);
    data.searchQueryCache = (data.searchQueryCache ?? []).filter((c) => c.userId !== userId);
    return { ok: true as const, hideIds: me.searchHideIds };
  });
}

export async function openSearchResult(userId: string, hitId: string) {
  return mutateStore((data) => {
    const id = hitId.trim();
    const parts = id.split(":");
    const scope = parts[0] ?? "";
    const entity = parts[1] ?? "";
    const extra = parts.slice(2).join(":") || undefined;
    const hint =
      scope === "user" ||
      scope === "group" ||
      scope === "channel" ||
      scope === "community" ||
      scope === "chat" ||
      scope === "live" ||
      scope === "story" ||
      scope === "vault" ||
      scope === "file"
        ? scope === "file"
          ? "file"
          : scope === "vault"
            ? "file"
            : scope
        : scope === "cpost" || scope === "post"
          ? "channel"
          : "unknown";
    const lookup = scope === "cpost" || scope === "post" ? extra || entity : entity;
    const hit = resolveAuthorizedEntity(data, userId, lookup ?? "", hint);
    if (!hit && (scope === "cpost" || scope === "post")) {
      const post = data.channelPosts.find((p) => p.id === lookup && !p.deleted);
      if (!post) return { ok: false as const, error: "یافت نشد.", status: 404 as const };
      const channel = data.pubChannels.find((c) => c.id === post.channelId);
      if (!channel || !canSeeChannel(channel, userId)) {
        return { ok: false as const, error: "یافت نشد.", status: 404 as const };
      }
      return { ok: true as const, href: "/app", target: { type: "channel" as const, id: post.channelId, messageId: post.id } };
    }
    if (!hit) return { ok: false as const, error: "یافت نشد.", status: 404 as const };
    data.searchMetrics ??= { queries: 0, errors: 0, cacheHits: 0, lastLatencyMs: 0, emptyResults: 0, opens: 0 };
    data.searchMetrics.opens = (data.searchMetrics.opens ?? 0) + 1;
    const href =
      hit.target.type === "sticker"
        ? "/app/stickers"
        : hit.target.type === "highlight" || hit.target.type === "story"
          ? "/app/stories"
        : hit.target.type === "file"
          ? "/app/storage"
          : "/app";
    return { ok: true as const, href, target: hit.target };
  });
}

export async function searchHealth() {
  const data = await readStoreSnapshot();
  return {
    ok: true as const,
    indexGen: data.searchIndex?.gen ?? 0,
    docs: (data.searchDocs ?? []).length,
    jobsQueued: (data.searchIndexJobs ?? []).filter((j) => j.status === "queued").length,
    jobsFailed: (data.searchIndexJobs ?? []).filter((j) => j.status === "failed").length,
    latencyMs: data.searchMetrics?.lastLatencyMs ?? 0,
    queries: data.searchMetrics?.queries ?? 0,
    errors: data.searchMetrics?.errors ?? 0,
    emptyResults: data.searchMetrics?.emptyResults ?? 0,
    opens: data.searchMetrics?.opens ?? 0,
    resultHits: data.searchMetrics?.resultHits ?? 0,
    errorRate:
      (data.searchMetrics?.queries ?? 0) === 0 ? 0 : (data.searchMetrics?.errors ?? 0) / (data.searchMetrics?.queries ?? 1),
    zeroResultRate:
      (data.searchMetrics?.queries ?? 0) === 0
        ? 0
        : (data.searchMetrics?.emptyResults ?? 0) / (data.searchMetrics?.queries ?? 1),
    popularPublicTags: Object.keys(data.searchPopular ?? {}).length,
    indexVersion: data.searchIndex?.version ?? 0,
    tombstones: (data.searchTombstones ?? []).length,
    p50: percentile(data.searchMetrics?.latencySamples ?? [], 50),
    p95: percentile(data.searchMetrics?.latencySamples ?? [], 95),
    p99: percentile(data.searchMetrics?.latencySamples ?? [], 99),
    synonymVersion: SYNONYM_VERSION,
    evalVersion: SEARCH_EVAL_VERSION,
  };
}
