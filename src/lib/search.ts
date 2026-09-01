import "server-only";
import { hitRateLimit } from "@/lib/rate-limit";
import { mutateStore, readStoreSnapshot, type StoreData } from "@/lib/store";
import type { ChannelPost, CommunityRecord, GroupRecord, PubChannelRecord } from "@/lib/store";
import { publicProfile } from "@/lib/profile";
import { blobMatches, matchScore, recencyBoost, suggestTerms } from "@/lib/search-match";
import { SEARCH_FLOOD_MAX, SEARCH_FLOOD_WINDOW_MS, SEARCH_HISTORY_MAX, SEARCH_PAGE, type SearchHit, type SearchKind } from "@/lib/search-types";
import { hmacIdentifier } from "@/lib/crypto-utils";
import { normalizeEmail, normalizePhone } from "@/lib/identifiers";
import { audienceAllows, canFindByUsername, pairBlocked } from "@/lib/privacy";

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
  if (channel.deletedAt) return false;
  if (channel.bans.some((b) => b.key === userId)) return false;
  const staff = channel.ownerUserId === userId || channel.staff.some((s) => s.userId === userId);
  const sub = channel.subscribers.some((s) => s.userId === userId && liveSub(s));
  if (staff || sub) return true;
  return channel.visibility === "public";
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
  if (kind === "messages") return itemKind === "text" || itemKind === "message" || itemKind === "link" || itemKind === "poll";
  if (kind === "photos" || kind === "gifs") return itemKind === "photo" || itemKind === "gif";
  if (kind === "videos") return itemKind === "video";
  if (kind === "files") return itemKind === "file" || itemKind === "pdf" || itemKind === "zip" || itemKind === "doc";
  if (kind === "links") return itemKind === "link";
  if (kind === "voice" || kind === "music") return itemKind === "voice" || itemKind === "music";
  if (kind === "media") return ["photo", "gif", "video", "voice", "file"].includes(itemKind);
  return true;
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
};

function rank(hit: SearchHit, needle: string, extra = 0) {
  const base = Math.max(matchScore(hit.title, needle), matchScore(`${hit.title} ${hit.preview}`, needle));
  hit.score = base + recencyBoost(hit.date) + extra;
  return hit;
}

export function collectSearchHits(data: StoreData, userId: string, input: SearchQuery): SearchHit[] {
  const q = needleOf(input.q);
  const kind = input.kind && input.kind.length ? input.kind : "all";
  const me = data.users.find((u) => u.id === userId);
  if (!me || q.length < 2) return [];

  const hits: SearchHit[] = [];
  const wantPeople = kind === "all" || kind === "users" || kind === "people";
  const wantChats = kind === "all" || kind === "chats";
  const wantBots = kind === "all" || kind === "bots" || kind === "users";
  const wantMini = kind === "all" || kind === "mini";
  const wantBiz = kind === "all" || kind === "business";
  const wantProducts = kind === "all" || kind === "products";
  const wantGroups = kind === "all" || kind === "groups" || kind === "chats";
  const wantChannels = kind === "all" || kind === "channels" || kind === "chats";
  const wantCommunities = kind === "all" || kind === "communities";
  const wantLive = kind === "all" || kind === "live";
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
    kind === "media";

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
      if (!blobMatches(`${t.peerName} ${t.peerKey}`, q)) continue;
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
      if (!canSeeGroup(g, userId)) continue;
      if (!blobMatches(`${g.name} ${g.username ?? ""} ${g.description}`, q)) continue;
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
      if (!canSeeChannel(c, userId)) continue;
      if (!blobMatches(`${c.name} ${c.username ?? ""} ${c.description}`, q)) continue;
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
      if (!canSeeChannel(c, userId)) continue;
      const staff = c.ownerUserId === userId || c.staff.some((s) => s.userId === userId);
      for (const p of postsByChannel.get(c.id) ?? []) {
        if (p.status !== "published" && !staff) continue;
        if (!matchesKind(kind, p.kind)) continue;
        if (!inRange(p.publishedAt ?? p.createdAt, input.fromDate, input.toDate)) continue;
        if (!senderOk(p.authorName, null, input.from)) continue;
        const blob = `${p.body} ${p.caption} ${p.kind} ${p.poll?.question ?? ""}`;
        if (!blobMatches(blob, q) && q !== p.kind) continue;
        hits.push(
          rank(
            {
              id: `cpost:${p.id}`,
              scope: "channelPost",
              title: c.name,
              preview: (p.caption || p.body || p.kind).slice(0, 140),
              sender: p.authorName,
              chatName: c.name,
              date: p.publishedAt ?? p.createdAt,
              kind: p.kind,
              target: { type: "channel", id: c.id, messageId: p.id },
            },
            q,
          ),
        );
      }
    }
    for (const c of data.communities) {
      if (!c.members.some((m) => liveMember(m, userId))) continue;
      for (const p of c.posts) {
        if (p.deleted) continue;
        if (!matchesKind(kind, p.kind)) continue;
        if (!inRange(p.createdAt, input.fromDate, input.toDate)) continue;
        if (!senderOk(p.authorName, null, input.from)) continue;
        const blob = `${p.body} ${p.kind}`;
        if (!blobMatches(blob, q) && q !== p.kind) continue;
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
      if (!g.members.some((m) => liveMember(m, userId))) continue;
      for (const m of data.groupMessages ?? []) {
        if (m.groupId !== g.id || m.deleted) continue;
        if (m.enc === "e2ee-v1") {
          if (!isMediaKind(kind) && kind !== "files" && kind !== "all" && kind !== "messages") continue;
          if (m.kind === "text") continue;
        }
        if (!matchesKind(kind === "all" ? "media" : kind, m.kind) && m.kind !== "system" && m.kind !== "poll") continue;
        if (!inRange(m.createdAt, input.fromDate, input.toDate)) continue;
        if (!senderOk(m.senderName, null, input.from)) continue;
        const blob = `${m.kind} ${m.bodyFa ?? ""} ${m.poll?.question ?? ""}`;
        if (m.enc === "e2ee-v1" && m.kind === "text") continue;
        if (!blobMatches(blob, q) && q !== m.kind) continue;
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
  return hits;
}

export async function globalSearch(userId: string, input: SearchQuery) {
  const q = needleOf(input.q);
  const offset = Math.max(0, input.offset ?? 0);
  const limit = Math.min(50, Math.max(1, input.limit ?? SEARCH_PAGE));
  const record = input.recordHistory !== false;

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
    if (record && q.length >= 2) {
      me.searchHistory = [input.q.trim().slice(0, 80), ...me.searchHistory.filter((h) => h !== input.q.trim())].slice(
        0,
        SEARCH_HISTORY_MAX,
      );
    }
    if (q.length < 2) {
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

    const hits = collectSearchHits(data, userId, input);
    const page = hits.slice(offset, offset + limit);
    const titles = hits.map((h) => h.title);
    return {
      ok: true as const,
      hits: page,
      hasMore: offset + limit < hits.length,
      nextOffset: offset + page.length,
      history: me.searchHistory,
      suggestions: suggestTerms(input.q, [...titles, ...me.searchHistory]),
      note: "متن گفتگوی خصوصی E2EE روی سرور جستجو نمی‌شود؛ روی دستگاه ادغام می‌شود. نتایج فقط با مجوز سمت سرور است.",
    };
  });
}

export async function suggestSearch(userId: string, q: string) {
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
