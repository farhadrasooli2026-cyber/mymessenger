import "server-only";
import { hitRateLimit } from "@/lib/rate-limit";
import { mutateStore, readStoreSnapshot, type StoreData } from "@/lib/store";
import type { ChannelPost, CommunityRecord, GroupRecord, PubChannelRecord } from "@/lib/store";
import { publicProfile } from "@/lib/profile";
import { blobMatches, exactPhraseMatches, foldText, matchScore, recencyBoost, suggestTerms } from "@/lib/search-match";
import { SEARCH_FLOOD_MAX, SEARCH_FLOOD_WINDOW_MS, SEARCH_HISTORY_MAX, SEARCH_PAGE, type SearchHit, type SearchKind } from "@/lib/search-types";
import { hmacIdentifier } from "@/lib/crypto-utils";
import { normalizeEmail, normalizePhone } from "@/lib/identifiers";
import { audienceAllows, canFindByUsername, pairBlocked } from "@/lib/privacy";
import {
  extractHashtags,
  extractMentions,
  parseSearchQuery,
  SEARCH_BUDGET_MS,
  SEARCH_HIT_CAP,
  validateSearchQuery,
  type SearchFeed,
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
  if (group.bans.some((b) => b.key === userId)) return false;
  if (group.members.some((m) => liveMember(m, userId))) return true;
  if (group.joinMode === "open") return true;
  return Boolean(group.username);
}

function canSeeCommunity(community: CommunityRecord, userId: string) {
  if (community.deletedAt) return false;
  if (community.bans.some((b) => b.key === userId)) return false;
  if (community.members.some((m) => liveMember(m, userId))) return true;
  if (community.joinMode === "open") return true;
  return Boolean(community.username);
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

function needleOf(q: string) {
  return q.trim().replace(/^@/, "").toLowerCase();
}

function isMediaKind(kind: SearchKind) {
  return kind === "media" || kind === "photos" || kind === "videos" || kind === "gifs" || kind === "voice" || kind === "music";
}

function matchesKind(kind: SearchKind, itemKind: string) {
  if (kind === "all" || kind === "users" || kind === "groups" || kind === "channels" || kind === "communities" || kind === "chats") {
    return true;
  }
  if (kind === "messages" || kind === "hashtags" || kind === "mentions") {
    return itemKind === "text" || itemKind === "message" || itemKind === "link" || itemKind === "poll" || itemKind === "file";
  }
  if (kind === "photos" || kind === "gifs") return itemKind === "photo" || itemKind === "gif";
  if (kind === "videos") return itemKind === "video";
  if (kind === "files") return itemKind === "file" || itemKind === "pdf" || itemKind === "zip" || itemKind === "doc" || itemKind === "audio";
  if (kind === "links") return itemKind === "link" || itemKind === "text";
  if (kind === "voice" || kind === "music") return itemKind === "voice" || itemKind === "music" || itemKind === "audio";
  if (kind === "media") return ["photo", "gif", "video", "voice", "file", "audio"].includes(itemKind);
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
};

function contentMatches(blob: string, q: string, exactPhrase: string | null, kind: SearchKind) {
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
  return null;
}

function collectDiscoveryHits(data: StoreData, userId: string, input: SearchQuery): SearchHit[] {
  const hits: SearchHit[] = [];
  const q = needleOf(input.q);
  const trending = input.feed === "trending";
  for (const c of data.pubChannels) {
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
    if (g.deletedAt || g.joinMode !== "open" || !g.username) continue;
    if (!canSeeGroup(g, userId)) continue;
    if (q.length >= 2 && !blobMatches(`${g.name} ${g.username} ${g.description}`, q)) continue;
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
  sortHits(hits, trending ? "popular" : input.sort ?? "popular");
  return hits.slice(0, SEARCH_HIT_CAP);
}

function rank(hit: SearchHit, needle: string, extra = 0) {
  const base = Math.max(matchScore(hit.title, needle), matchScore(`${hit.title} ${hit.preview}`, needle));
  hit.score = base + recencyBoost(hit.date) + extra;
  return hit;
}

export function collectSearchHits(data: StoreData, userId: string, input: SearchQuery): SearchHit[] {
  const parsed = parseSearchQuery(input.q);
  const q = parsed.needle;
  const exactPhrase = input.exact ? q : parsed.exact;
  const kind = input.kind && input.kind.length ? input.kind : "all";
  const me = data.users.find((u) => u.id === userId);
  if (!me) return [];
  const scoped = Boolean(input.chatId || input.groupId || input.channelId);
  const allowShort = Boolean(input.feed || parsed.entityHint || exactPhrase);
  if (!allowShort && q.length < 2) return [];

  const started = Date.now();
  const hits: SearchHit[] = [];
  const wantPeople = !scoped && (kind === "all" || kind === "users" || kind === "people");
  const wantChats = (!input.groupId && !input.channelId) && (kind === "all" || kind === "chats");
  const wantBots = !scoped && (kind === "all" || kind === "bots" || kind === "users");
  const wantMini = !scoped && (kind === "all" || kind === "mini");
  const wantBiz = !scoped && (kind === "all" || kind === "business");
  const wantProducts = !scoped && (kind === "all" || kind === "products");
  const wantGroups = !input.channelId && !input.chatId && (kind === "all" || kind === "groups" || kind === "chats");
  const wantChannels = !input.groupId && !input.chatId && (kind === "all" || kind === "channels" || kind === "chats");
  const wantCommunities = !scoped && (kind === "all" || kind === "communities");
  const wantLive = !scoped && (kind === "all" || kind === "live");
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
    kind === "mentions";

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
              (isExact ? 36 : 0) + (u.officialVerified ? 10 : 0),
            ),
          );
        }
      }
    }
  }

  if (wantChats) {
    for (const t of data.threads) {
      if (t.ownerUserId !== userId) continue;
      if (input.chatId && t.id !== input.chatId) continue;
      if (q.length >= 2 && !contentMatches(`${t.peerName} ${t.peerKey}`, q, exactPhrase, kind)) continue;
      if (q.length < 2 && !input.chatId) continue;
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
      if (input.groupId && g.id !== input.groupId) continue;
      if (!canSeeGroup(g, userId)) continue;
      if (q.length >= 2 && !contentMatches(`${g.name} ${g.username ?? ""} ${g.description}`, q, exactPhrase, kind)) continue;
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
      if (input.channelId && c.id !== input.channelId) continue;
      if (!canSeeChannel(c, userId)) continue;
      if (q.length >= 2 && !contentMatches(`${c.name} ${c.username ?? ""} ${c.description}`, q, exactPhrase, kind)) continue;
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
      if (input.channelId && c.id !== input.channelId) continue;
      if (input.groupId || input.chatId) continue;
      if (!canSeeChannel(c, userId)) continue;
      const staff = c.ownerUserId === userId || c.staff.some((s) => s.userId === userId);
      for (const p of postsByChannel.get(c.id) ?? []) {
        if (p.status !== "published" && !staff) continue;
        if (!matchesKind(kind, p.kind) && kind !== "hashtags" && kind !== "mentions") continue;
        if (!inRange(p.publishedAt ?? p.createdAt, input.fromDate, input.toDate)) continue;
        if (!senderOk(p.authorName, null, input.from)) continue;
        const fileName = p.fileName ?? "";
        const blob = `${p.body} ${p.caption} ${p.kind} ${fileName} ${p.poll?.question ?? ""}`;
        if (!fileTypeOk(input.fileType, p.kind, fileName, blob)) continue;
        const tagHit = kind === "hashtags" || parsed.hashtags.length > 0;
        const menHit = kind === "mentions" || parsed.mentions.length > 0;
        let ok = contentMatches(blob, q, exactPhrase, kind === "hashtags" || kind === "mentions" ? kind : "all");
        if (kind === "links" && !/https?:\/\//i.test(blob)) ok = false;
        if (tagHit && kind === "hashtags") ok = contentMatches(blob, q.replace(/^#/, ""), exactPhrase, "hashtags");
        if (menHit && kind === "mentions") ok = contentMatches(blob, q.replace(/^@/, ""), exactPhrase, "mentions");
        if (!ok && q !== p.kind && !blobMatches(fileName, q)) continue;
        if (kind === "files" && !blobMatches(`${fileName} ${p.caption}`, q) && q !== p.kind && !contentMatches(blob, q, exactPhrase, kind)) continue;
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
      if (input.channelId || input.chatId) continue;
      if (input.groupId) continue;
      if (!c.members.some((m) => liveMember(m, userId))) continue;
      for (const p of c.posts) {
        if (p.deleted) continue;
        if (!matchesKind(kind, p.kind) && kind !== "hashtags" && kind !== "mentions") continue;
        if (!inRange(p.createdAt, input.fromDate, input.toDate)) continue;
        if (!senderOk(p.authorName, null, input.from)) continue;
        const blob = `${p.body} ${p.kind}`;
        if (!contentMatches(blob, q, exactPhrase, kind === "hashtags" || kind === "mentions" ? kind : "all") && q !== p.kind) continue;
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
      if (input.channelId || input.chatId) continue;
      if (input.groupId && g.id !== input.groupId) continue;
      if (!g.members.some((m) => liveMember(m, userId))) continue;
      for (const m of data.groupMessages ?? []) {
        if (m.groupId !== g.id || m.deleted) continue;
        if (m.enc === "e2ee-v1") {
          if (!isMediaKind(kind) && kind !== "files" && kind !== "all" && kind !== "messages") continue;
          if (m.kind === "text") continue;
        }
        if (!matchesKind(kind === "all" ? "media" : kind, m.kind) && m.kind !== "system" && m.kind !== "poll" && kind !== "hashtags" && kind !== "mentions") continue;
        if (!inRange(m.createdAt, input.fromDate, input.toDate)) continue;
        if (!senderOk(m.senderName, null, input.from)) continue;
        const fileName = m.fileName ?? "";
        const blob = `${m.kind} ${m.bodyFa ?? ""} ${m.poll?.question ?? ""} ${fileName}`;
        if (!fileTypeOk(input.fileType, m.kind, fileName, blob)) continue;
        if (m.enc === "e2ee-v1" && m.kind === "text") continue;
        if (!contentMatches(blob, q, exactPhrase, kind === "hashtags" || kind === "mentions" ? kind : "all") && q !== m.kind && !blobMatches(fileName, q)) continue;
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
      if (!inRange(l.createdAt, input.fromDate, input.toDate)) continue;
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

  hits.sort((a, b) => (b.score ?? 0) - (a.score ?? 0) || b.date - a.date);
  sortHits(hits, input.sort);
  return hits.slice(0, SEARCH_HIT_CAP);
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

  return mutateStore((data) => {
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
    if (record && q.length >= 2 && !sensitive && !feed) {
      me.searchHistory = [input.q.trim().slice(0, 80), ...me.searchHistory.filter((h) => h !== input.q.trim())].slice(
        0,
        SEARCH_HISTORY_MAX,
      );
    }
    if (!feed && q.length < 2 && !parseSearchQuery(input.q).entityHint && !input.exact) {
      return {
        ok: true as const,
        hits: [] as SearchHit[],
        hasMore: false,
        nextOffset: 0,
        history: me.searchHistory,
        suggestions: suggestTerms(input.q, me.searchHistory),
        note: "حداقل دو نویسه لازم است. متن گفتگوی خصوصی E2EE روی دستگاه جستجو می‌شود.",
      };
    }

    const hits = collectSearchHits(data, userId, { ...input, q: check.q });
    const page = hits.slice(offset, offset + limit);
    const titles = hits.map((h) => h.title);
    return {
      ok: true as const,
      hits: page,
      hasMore: offset + limit < hits.length,
      nextOffset: offset + page.length,
      history: me.searchHistory,
      suggestions: suggestTerms(input.q, [...titles, ...me.searchHistory]),
      noResultHints: page.length === 0 ? suggestTerms(input.q, me.searchHistory).slice(0, 5) : [],
      note: "متن گفتگوی خصوصی E2EE روی سرور جستجو نمی‌شود؛ روی دستگاه ادغام می‌شود. نتایج فقط پس از Authentication، Authorization، Membership و Block در لحظهٔ درخواست است.",
      indexGen: data.searchIndex?.gen ?? 0,
    };
  });
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
      needleOf(q).length >= 2
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
    data.searchIndex = { gen: (data.searchIndex?.gen ?? 0) + 1, rebuiltAt: Date.now() };
    data.audit = [
      { id: `sidx-${Date.now()}`, userId, kind: "suspicious" as const, createdAt: Date.now(), detail: "search-reindex" },
      ...(data.audit ?? []),
    ].slice(0, 400);
    return { ok: true as const, searchIndex: data.searchIndex };
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
