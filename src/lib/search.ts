import "server-only";
import { hitRateLimit } from "@/lib/rate-limit";
import { mutateStore, readStoreSnapshot } from "@/lib/store";
import type { ChannelPost, CommunityRecord, GroupRecord, PubChannelRecord } from "@/lib/store";
import { SEARCH_FLOOD_MAX, SEARCH_FLOOD_WINDOW_MS, SEARCH_HISTORY_MAX, SEARCH_PAGE, type SearchHit, type SearchKind } from "@/lib/search-types";

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

function matchesKind(kind: SearchKind, itemKind: string) {
  if (kind === "all" || kind === "users" || kind === "groups" || kind === "channels" || kind === "communities") return true;
  if (kind === "messages") return itemKind === "text" || itemKind === "message" || itemKind === "link";
  if (kind === "photos") return itemKind === "photo";
  if (kind === "videos") return itemKind === "video";
  if (kind === "files") return itemKind === "file";
  if (kind === "links") return itemKind === "link";
  if (kind === "voice") return itemKind === "voice";
  if (kind === "music") return itemKind === "voice" || itemKind === "music";
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
};

export async function globalSearch(userId: string, input: SearchQuery) {
  const q = needleOf(input.q);
  const kind = input.kind && input.kind.length ? input.kind : "all";
  const offset = Math.max(0, input.offset ?? 0);
  const limit = Math.min(50, Math.max(1, input.limit ?? SEARCH_PAGE));

  return mutateStore((data) => {
    const now = Date.now();
    const flood = hitRateLimit(data, `search:${userId}`, SEARCH_FLOOD_WINDOW_MS, SEARCH_FLOOD_MAX, now);
    if (!flood.allowed) {
      return { ok: false as const, error: "جستجو موقتاً محدود شد.", status: 429, retryAfterSec: flood.retryAfterSec };
    }
    const me = data.users.find((u) => u.id === userId);
    if (!me) return { ok: false as const, error: "حساب فعال نیست.", status: 401 };
    if (q.length >= 2) {
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
        note: "حداقل دو نویسه لازم است. متن گفتگوی خصوصی روی دستگاه جستجو می‌شود.",
      };
    }

    const hits: SearchHit[] = [];
    const wantPeople = kind === "all" || kind === "users";
    const wantBots = kind === "all" || kind === "bots" || kind === "users";
    const wantBiz = kind === "all" || kind === "business";
    const wantGroups = kind === "all" || kind === "groups";
    const wantChannels = kind === "all" || kind === "channels";
    const wantCommunities = kind === "all" || kind === "communities";
    const wantContent =
      kind === "all" ||
      kind === "messages" ||
      kind === "photos" ||
      kind === "videos" ||
      kind === "files" ||
      kind === "links" ||
      kind === "voice" ||
      kind === "music";

    if (wantPeople) {
      for (const u of data.users) {
        if (u.status !== "active" || !u.username || u.id === userId) continue;
        if (me.blockedPeerKeys.includes(u.id) || u.blockedPeerKeys.includes(userId)) continue;
        const blob = `${u.username} ${u.displayName ?? ""} ${u.firstName ?? ""} ${u.lastName ?? ""}`.toLowerCase();
        if (!blob.includes(q)) continue;
        hits.push({
          id: `user:${u.id}`,
          scope: "user",
          title: u.displayName || u.username,
          preview: `@${u.username}`,
          sender: u.displayName || u.username,
          chatName: "کاربران",
          date: u.activatedAt ?? u.createdAt,
          kind: "user",
          target: { type: "user", id: u.id },
        });
      }
    }

    if (wantBots) {
      for (const b of data.bots ?? []) {
        if (b.status !== "active") continue;
        const blob = `${b.username} ${b.name} ${b.description}`.toLowerCase();
        if (!blob.includes(q)) continue;
        hits.push({
          id: `bot:${b.id}`,
          scope: "bot",
          title: `${b.name}${b.verified ? " ✓" : ""}`,
          preview: `@${b.username} · ربات`,
          sender: b.name,
          chatName: "ربات‌ها",
          date: b.createdAt,
          kind: "bot",
          target: { type: "bot", id: b.id },
        });
      }
    }

    if (wantBiz) {
      for (const b of data.businesses ?? []) {
        const blob = `${b.username} ${b.name} ${b.description} ${b.category}`.toLowerCase();
        if (!blob.includes(q)) continue;
        hits.push({
          id: `biz:${b.id}`,
          scope: "business",
          title: `${b.name}${b.verified ? " ✓" : ""}`,
          preview: `@${b.username} · کسب‌وکار`,
          sender: b.name,
          chatName: "کسب‌وکار",
          date: b.createdAt,
          kind: "business",
          target: { type: "business", id: b.id },
        });
      }
    }

    if (wantGroups) {
      for (const g of data.groups) {
        if (!canSeeGroup(g, userId)) continue;
        const blob = `${g.name} ${g.username ?? ""} ${g.description}`.toLowerCase();
        if (!blob.includes(q)) continue;
        hits.push({
          id: `group:${g.id}`,
          scope: "group",
          title: g.name,
          preview: g.username ? `@${g.username}` : g.description.slice(0, 80),
          sender: "",
          chatName: "گروه‌ها",
          date: g.updatedAt,
          kind: "group",
          target: { type: "group", id: g.id },
        });
      }
    }

    if (wantChannels) {
      for (const c of data.pubChannels) {
        if (!canSeeChannel(c, userId)) continue;
        const blob = `${c.name} ${c.username ?? ""} ${c.description}`.toLowerCase();
        if (!blob.includes(q)) continue;
        hits.push({
          id: `channel:${c.id}`,
          scope: "channel",
          title: c.name,
          preview: c.username ? `@${c.username}` : c.description.slice(0, 80),
          sender: "",
          chatName: "کانال‌ها",
          date: c.updatedAt,
          kind: "channel",
          target: { type: "channel", id: c.id },
        });
      }
    }

    if (wantCommunities) {
      for (const c of data.communities) {
        if (!canSeeCommunity(c, userId)) continue;
        const blob = `${c.name} ${c.username ?? ""} ${c.description}`.toLowerCase();
        if (!blob.includes(q)) continue;
        hits.push({
          id: `community:${c.id}`,
          scope: "community",
          title: c.name,
          preview: c.username ? `@${c.username}` : c.description.slice(0, 80),
          sender: "",
          chatName: "جامعه‌ها",
          date: c.updatedAt,
          kind: "community",
          target: { type: "community", id: c.id },
        });
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
          const blob = `${p.body} ${p.caption} ${p.kind} ${p.poll?.question ?? ""}`.toLowerCase();
          if (!blob.includes(q) && q !== p.kind) continue;
          hits.push({
            id: `cpost:${p.id}`,
            scope: "channelPost",
            title: c.name,
            preview: (p.caption || p.body || p.kind).slice(0, 140),
            sender: p.authorName,
            chatName: c.name,
            date: p.publishedAt ?? p.createdAt,
            kind: p.kind,
            target: { type: "channel", id: c.id, messageId: p.id },
          });
        }
      }
      for (const c of data.communities) {
        if (!c.members.some((m) => liveMember(m, userId))) continue;
        for (const p of c.posts) {
          if (p.deleted) continue;
          if (!matchesKind(kind, p.kind)) continue;
          if (!inRange(p.createdAt, input.fromDate, input.toDate)) continue;
          if (!senderOk(p.authorName, null, input.from)) continue;
          const blob = `${p.body} ${p.kind}`.toLowerCase();
          if (!blob.includes(q) && q !== p.kind) continue;
          hits.push({
            id: `cmpost:${p.id}`,
            scope: "communityPost",
            title: c.name,
            preview: p.body.slice(0, 140) || p.kind,
            sender: p.authorName,
            chatName: c.name,
            date: p.createdAt,
            kind: p.kind,
            target: { type: "community", id: c.id, messageId: p.id },
          });
        }
      }
      for (const s of data.savedItems) {
        if (s.ownerUserId !== userId || s.deletedAt) continue;
        if (!matchesKind(kind, s.kind === "message" ? "text" : s.kind)) continue;
        if (!inRange(s.createdAt, input.fromDate, input.toDate)) continue;
        const blob = `${s.body} ${s.linkUrl} ${s.fileName} ${s.tag}`.toLowerCase();
        if (!blob.includes(q)) continue;
        hits.push({
          id: `saved:${s.id}`,
          scope: "saved",
          title: "پیام‌های ذخیره‌شده",
          preview: (s.body || s.fileName || s.linkUrl || s.kind).slice(0, 140),
          sender: "من",
          chatName: "Saved Messages",
          date: s.createdAt,
          kind: s.kind,
          target: { type: "saved", id: s.id },
        });
      }
    }

    hits.sort((a, b) => b.date - a.date);
    const page = hits.slice(offset, offset + limit);
    return {
      ok: true as const,
      hits: page,
      hasMore: offset + limit < hits.length,
      nextOffset: offset + page.length,
      history: me.searchHistory,
      note: "متن گفتگوی خصوصی E2EE روی سرور جستجو نمی‌شود؛ روی دستگاه ادغام می‌شود.",
    };
  });
}

export async function getSearchHistory(userId: string) {
  const data = await readStoreSnapshot();
  const me = data.users.find((u) => u.id === userId);
  return me?.searchHistory ?? [];
}

export async function clearSearchHistory(userId: string) {
  return mutateStore((data) => {
    const me = data.users.find((u) => u.id === userId);
    if (!me) return { ok: false as const, error: "حساب فعال نیست.", status: 401 };
    me.searchHistory = [];
    return { ok: true as const };
  });
}
