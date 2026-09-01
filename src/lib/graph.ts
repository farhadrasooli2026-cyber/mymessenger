import "server-only";
import { randomId } from "@/lib/crypto-utils";
import { hitRateLimit } from "@/lib/rate-limit";
import { mutateStore, readStoreSnapshot, type StoreData } from "@/lib/store";
import { canFindByUsername, pairBlocked } from "@/lib/privacy";
import { publicProfile } from "@/lib/profile";
import { isPublicDiscoverableGroup } from "@/lib/group-discovery";
import { experimentBucket } from "@/lib/ai-privacy";
import { percentile } from "@/lib/edge-policy";
import {
  GRAPH_CACHE_TTL_MS,
  GRAPH_FEATURE_VERSION,
  GRAPH_MODEL_VERSION,
  GRAPH_PAGE,
  hydrateGraphPersist,
  pruneGraphPersist,
  type GraphPersist,
  type RecItem,
  type RecKind,
} from "@/lib/graph-types";

function liveMember(m: { key: string; leftAt?: number | null }, userId: string) {
  return m.key === userId && !m.leftAt;
}

function liveSub(s: { userId: string; leftAt?: number | null }) {
  return !s.leftAt;
}

function ensureGraph(data: StoreData): GraphPersist {
  data.graph = hydrateGraphPersist(data.graph);
  return data.graph;
}

export function enqueueGraphEvent(data: StoreData, kind: string, actorId: string, targetId?: string) {
  const g = ensureGraph(data);
  g.events.unshift({ id: randomId(), kind: kind.slice(0, 40), actorId, targetId, at: Date.now() });
  g.events = g.events.slice(0, 800);
  g.cache = g.cache.filter((c) => c.userId !== actorId && c.userId !== targetId);
  const actor = data.users.find((u) => u.id === actorId);
  if (actor) actor.relationshipRev = (actor.relationshipRev ?? 0) + 1;
  if (!g.jobs.some((j) => j.status === "queued" && j.kind === "drain")) {
    g.jobs.push({ id: randomId(), kind: "drain", status: "queued", attempts: 0, createdAt: Date.now() });
  }
}

export function drainGraphJobs(data: StoreData) {
  const g = ensureGraph(data);
  for (const job of g.jobs) {
    if (job.status === "done" || job.status === "failed") continue;
    job.status = "running";
    try {
      g.cache = [];
      job.status = "done";
    } catch (err) {
      job.attempts += 1;
      job.lastError = err instanceof Error ? err.message : "graph";
      job.status = job.attempts >= 5 ? "failed" : "queued";
    }
  }
}

function suspiciousAccount(data: StoreData, userId: string) {
  const u = data.users.find((x) => x.id === userId);
  if (!u) return true;
  if (u.status !== "active") return true;
  const st = u.accountStatus ?? "active";
  if (st !== "active") return true;
  const hour = Date.now() - 60 * 60_000;
  const follows = (data.follows ?? []).filter((f) => f.followerId === userId && f.createdAt > hour).length;
  return follows > 25;
}

function blockedOrRestricted(data: StoreData, a: string, b: string) {
  if (pairBlocked(data, a, b)) return true;
  const ua = data.users.find((u) => u.id === a);
  const ub = data.users.find((u) => u.id === b);
  if (ua?.restrictedPeerKeys?.includes(b) || ub?.restrictedPeerKeys?.includes(a)) return true;
  if (ua?.mutedPeerKeys?.includes(b)) return true;
  return false;
}

function diversify(items: RecItem[], cap: number) {
  const buckets = new Map<RecKind, RecItem[]>();
  for (const it of items) {
    const arr = buckets.get(it.kind) ?? [];
    arr.push(it);
    buckets.set(it.kind, arr);
  }
  const out: RecItem[] = [];
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

export function buildRecommendationFeed(data: StoreData, userId: string): RecItem[] {
  drainGraphJobs(data);
  const me = data.users.find((u) => u.id === userId);
  if (!me) return [];
  const g = ensureGraph(data);
  const personalize = me.recPersonalize !== false && !g.rolledBack;
  const hidden = new Set([
    ...(me.hideSuggestionIds ?? []),
    ...(me.notInterestedUserIds ?? []),
    ...(me.searchHideIds ?? []),
    ...g.feedback.filter((f) => f.userId === userId && (f.action === "hide" || f.action === "not-interested")).map((f) => f.targetId),
  ]);
  const friends = new Set(me.friendIds ?? []);
  const following = new Set((data.follows ?? []).filter((f) => f.followerId === userId && f.status === "active").map((f) => f.followeeId));
  const myGroups = (data.groups ?? []).filter((gr) => !gr.deletedAt && gr.members.some((m) => liveMember(m, userId)));
  const myGroupIds = new Set(myGroups.map((gr) => gr.id));
  const myChannels = (data.pubChannels ?? []).filter(
    (c) => !c.deletedAt && (c.ownerUserId === userId || c.subscribers.some((s) => s.userId === userId && liveSub(s))),
  );
  const myChannelIds = new Set(myChannels.map((c) => c.id));
  const lang = me.prefs?.locale;
  const items: RecItem[] = [];
  const baseline = g.rolledBack;

  if (personalize) {
    for (const u of data.users) {
      if (u.id === userId || hidden.has(u.id) || friends.has(u.id) || following.has(u.id)) continue;
      if (!canFindByUsername(data, u, userId)) continue;
      if (blockedOrRestricted(data, userId, u.id)) continue;
      if (suspiciousAccount(data, u.id)) continue;
      let score = 0;
      let reason = "public-discovery";
      const mutualF = (u.friendIds ?? []).filter((id) => friends.has(id)).length;
      if (mutualF > 0 && (u.privacyFriends === "everyone" || friends.has(u.id) || (u.friendIds ?? []).includes(userId))) {
        score += Math.min(4, mutualF) * (baseline ? 1 : 3);
        reason = "mutual-friends";
      }
      const sharedG = myGroups.some(
        (gr) => gr.joinMode === "open" && gr.members.some((m) => liveMember(m, u.id)),
      );
      if (sharedG) {
        score += baseline ? 1 : 4;
        reason = reason === "public-discovery" ? "mutual-groups" : reason;
      }
      const sharedC = myChannels.some(
        (c) => c.visibility === "public" && (c.subscribers.some((s) => s.userId === u.id && liveSub(s)) || c.ownerUserId === u.id),
      );
      if (sharedC) {
        score += 3;
        reason = reason === "public-discovery" ? "mutual-channels" : reason;
      }
      if (lang && u.prefs?.locale === lang) score += 1;
      const fresh = (u.activatedAt ?? u.createdAt) > Date.now() - 14 * 86_400_000;
      if (fresh) score += 2;
      if (score <= 0) continue;
      const view = publicProfile(u, userId);
      const kind: RecKind = mutualF > 0 ? "people" : "follow";
      items.push({
        kind,
        id: u.id,
        title: view.displayName || u.username || "کاربر",
        subtitle: u.username ? `@${u.username}` : "پیشنهاد ارتباط",
        reason,
        href: u.username ? `/app/u/${u.username}` : "/app/contacts",
        score,
        fresh,
      });
    }
  }

  for (const gr of data.groups ?? []) {
    if (!isPublicDiscoverableGroup(gr) || myGroupIds.has(gr.id) || hidden.has(gr.id)) continue;
    if (gr.bans.some((b) => b.key === userId && (!b.until || b.until > Date.now()))) continue;
    const members = gr.members.filter((m) => !m.leftAt).length;
    const overlap = personalize ? gr.members.filter((m) => !m.leftAt && friends.has(m.key)).length : 0;
    const fresh = gr.createdAt > Date.now() - 21 * 86_400_000;
    const pop = Math.min(12, Math.log2(1 + members) * 2);
    const score = pop + overlap * 3 + (fresh ? 4 : 0) + (myGroups.some((g0) => g0.category && g0.category === gr.category) && personalize ? 2 : 0);
    items.push({
      kind: "group",
      id: gr.id,
      title: gr.name,
      subtitle: gr.username ? `@${gr.username}` : "گروه عمومی",
      reason: overlap > 0 ? "mutual-groups" : fresh ? "new-public" : "public-discovery",
      href: `/app/spaces`,
      score,
      fresh,
    });
  }

  for (const c of data.pubChannels ?? []) {
    if (c.deletedAt || c.visibility !== "public" || c.status !== "active" || myChannelIds.has(c.id) || hidden.has(c.id)) continue;
    if (c.bans.some((b) => b.key === userId)) continue;
    const subs = c.subscribers.filter(liveSub).length;
    const overlap = personalize ? c.subscribers.filter((s) => liveSub(s) && friends.has(s.userId)).length : 0;
    const fresh = c.createdAt > Date.now() - 21 * 86_400_000;
    const pop = Math.min(10, Math.log2(1 + subs) * 1.8);
    items.push({
      kind: "channel",
      id: c.id,
      title: c.name,
      subtitle: c.username ? `@${c.username}` : "کانال عمومی",
      reason: overlap > 0 ? "mutual-channels" : fresh ? "new-public" : "public-discovery",
      href: `/app/spaces`,
      score: pop + overlap * 3 + (fresh ? 5 : 0),
      fresh,
    });
    const owner = data.users.find((u) => u.id === c.ownerUserId);
    if (
      owner &&
      owner.id !== userId &&
      !friends.has(owner.id) &&
      !hidden.has(owner.id) &&
      canFindByUsername(data, owner, userId) &&
      !blockedOrRestricted(data, userId, owner.id) &&
      !suspiciousAccount(data, owner.id)
    ) {
      const view = publicProfile(owner, userId);
      items.push({
        kind: "creator",
        id: owner.id,
        title: view.displayName || owner.username || c.name,
        subtitle: "سازندهٔ کانال عمومی",
        reason: fresh ? "new-creator" : "public-discovery",
        href: owner.username ? `/app/u/${owner.username}` : `/app/spaces`,
        score: 6 + (fresh ? 4 : 0) + Math.min(4, pop),
        fresh,
      });
    }
  }

  items.sort((a, b) => b.score - a.score || a.id.localeCompare(b.id));
  const seen = new Set<string>();
  const unique = items.filter((it) => {
    const k = `${it.kind}:${it.id}`;
    if (seen.has(k)) return false;
    if ((it.kind === "people" || it.kind === "follow" || it.kind === "creator") && (seen.has(`people:${it.id}`) || seen.has(`follow:${it.id}`) || seen.has(`creator:${it.id}`))) {
      return false;
    }
    seen.add(k);
    return true;
  });
  return diversify(unique, GRAPH_PAGE);
}

export async function recommendFeed(userId: string) {
  try {
    return mutateStore((data) => {
      const flood = hitRateLimit(data, `graph-rec:${userId}`, 60_000, 40);
      if (!flood.allowed) return { ok: false as const, error: "پیشنهاد موقتاً محدود شد.", status: 429 };
      const me = data.users.find((u) => u.id === userId);
      if (!me) return { ok: false as const, error: "حساب فعال نیست.", status: 401 };
      const g = ensureGraph(data);
      const now = Date.now();
      const gen = (me.relationshipRev ?? 0) + (g.rolledBack ? 1000 : 0) + g.modelVersion;
      const cached = g.cache.find((c) => c.userId === userId && c.gen === gen && now - c.at < GRAPH_CACHE_TTL_MS);
      const started = now;
      const items = buildRecommendationFeed(data, userId);
      g.metrics.queries += 1;
      g.metrics.lastLatencyMs = Date.now() - started;
      g.metrics.samples = [...g.metrics.samples, g.metrics.lastLatencyMs].slice(-200);
      if (!items.length) g.metrics.empty += 1;
      if (!cached) {
        g.cache = [{ userId, gen, at: now, itemIds: items.map((i) => i.id) }, ...g.cache.filter((c) => c.userId === userId || now - c.at < GRAPH_CACHE_TTL_MS)].slice(0, 80);
      }
      return {
        ok: true as const,
        items,
        personalize: me.recPersonalize !== false && !g.rolledBack,
        recNotify: Boolean(me.recNotify),
        modelVersion: g.rolledBack ? 0 : g.modelVersion,
        featureVersion: g.featureVersion,
        variant: experimentBucket(userId, "rec-model-v1", 0),
        cacheHit: Boolean(cached),
        note: "پیشنهاد فقط از دادهٔ مجاز. شماره، ایمیل و موقعیت دقیق در Graph نیست. Block همیشه اعمال می‌شود.",
      };
    });
  } catch {
    return {
      ok: true as const,
      items: [] as RecItem[],
      personalize: false,
      recNotify: false,
      modelVersion: GRAPH_MODEL_VERSION,
      featureVersion: GRAPH_FEATURE_VERSION,
      variant: "a" as const,
      cacheHit: false,
      degraded: true as const,
      note: "پیشنهاد موقتاً در دسترس نیست. بقیهٔ نیکسو کار می‌کند.",
    };
  }
}

export async function graphMutuals(viewerId: string, targetId: string) {
  return mutateStore((data) => {
    const flood = hitRateLimit(data, `graph-mut:${viewerId}`, 60_000, 40);
    if (!flood.allowed) return { ok: false as const, error: "محدود شد.", status: 429 };
    const tid = targetId.trim();
    if (!tid) return { ok: false as const, error: "یافت نشد.", status: 404 };
    const target = data.users.find((u) => u.id === tid && u.status === "active");
    const viewer = data.users.find((u) => u.id === viewerId);
    if (!target || !viewer) return { ok: false as const, error: "یافت نشد.", status: 404 };
    if (pairBlocked(data, viewerId, tid) && viewerId !== tid) {
      return { ok: false as const, error: "یافت نشد.", status: 404 };
    }
    if (!canFindByUsername(data, target, viewerId) && viewerId !== tid) {
      return { ok: false as const, error: "یافت نشد.", status: 404 };
    }
    const friendsOk = viewerId === tid || (target.privacyFriends ?? "friends") === "everyone" || (target.friendIds ?? []).includes(viewerId);
    const friends = friendsOk
      ? (target.friendIds ?? []).filter((id) => (viewer.friendIds ?? []).includes(id) && id !== viewerId && id !== tid && !pairBlocked(data, viewerId, id))
      : [];
    const groups = (data.groups ?? [])
      .filter((gr) => !gr.deletedAt && gr.members.some((m) => liveMember(m, viewerId)) && gr.members.some((m) => liveMember(m, tid)))
      .map((gr) => ({ id: gr.id, name: gr.name }));
    const channels = (data.pubChannels ?? [])
      .filter((c) => {
        if (c.deletedAt) return false;
        const a = c.ownerUserId === viewerId || c.subscribers.some((s) => s.userId === viewerId && liveSub(s));
        const b = c.ownerUserId === tid || c.subscribers.some((s) => s.userId === tid && liveSub(s));
        return a && b && (c.visibility === "public" || a);
      })
      .map((c) => ({ id: c.id, name: c.name }));
    return {
      ok: true as const,
      friends: friends.slice(0, 8).map((id) => {
        const u = data.users.find((x) => x.id === id);
        return u ? { id: u.id, username: u.username, displayName: u.displayName || u.username } : null;
      }).filter(Boolean),
      groups: groups.slice(0, 8),
      channels: channels.slice(0, 8),
    };
  });
}

type GraphFeedbackAction = "hide" | "not-interested" | "click" | "dismiss";

export async function recFeedback(userId: string, targetType: RecKind, targetId: string, action: GraphFeedbackAction) {
  return mutateStore((data) => {
    const me = data.users.find((u) => u.id === userId);
    if (!me) return { ok: false as const, error: "حساب فعال نیست.", status: 401 };
    const id = targetId.trim().slice(0, 80);
    if (!id) return { ok: false as const, error: "نامعتبر.", status: 400 };
    const g = ensureGraph(data);
    g.feedback.unshift({ id: randomId(), userId, targetType, targetId: id, action, at: Date.now() });
    g.feedback = g.feedback.slice(0, 800);
    g.cache = g.cache.filter((c) => c.userId !== userId);
    if (action === "click") g.metrics.clicks += 1;
    if (action === "hide") me.hideSuggestionIds = [id, ...(me.hideSuggestionIds ?? []).filter((x) => x !== id)].slice(0, 200);
    if (action === "not-interested") me.notInterestedUserIds = [id, ...(me.notInterestedUserIds ?? []).filter((x) => x !== id)].slice(0, 200);
    enqueueGraphEvent(data, `feedback:${action}`, userId, id);
    return { ok: true as const };
  });
}

export async function setRecPrefs(userId: string, patch: { personalize?: boolean; notify?: boolean }) {
  return mutateStore((data) => {
    const me = data.users.find((u) => u.id === userId);
    if (!me) return { ok: false as const, error: "حساب فعال نیست.", status: 401 };
    if (typeof patch.personalize === "boolean") me.recPersonalize = patch.personalize;
    if (typeof patch.notify === "boolean") me.recNotify = patch.notify;
    data.graph = ensureGraph(data);
    data.graph.cache = data.graph.cache.filter((c) => c.userId !== userId);
    return { ok: true as const, recPersonalize: me.recPersonalize !== false, recNotify: Boolean(me.recNotify) };
  });
}

export async function exportSocialGraph(userId: string) {
  const data = await readStoreSnapshot();
  const me = data.users.find((u) => u.id === userId);
  if (!me) return { ok: false as const, error: "حساب فعال نیست.", status: 401 as const };
  const friendNames = (me.friendIds ?? [])
    .map((id) => data.users.find((u) => u.id === id)?.username)
    .filter(Boolean);
  const following = (data.follows ?? [])
    .filter((f) => f.followerId === userId && f.status === "active")
    .map((f) => data.users.find((u) => u.id === f.followeeId)?.username)
    .filter(Boolean);
  return {
    ok: true as const,
    exportedAt: Date.now(),
    kind: "nixo-social-graph",
    friends: friendNames,
    following,
    note: "شماره، ایمیل و دفترچه مخاطب در این خروجی نیست.",
  };
}

export async function evaluateGraph(userId: string) {
  return mutateStore((data) => {
    const me = data.users.find((u) => u.id === userId);
    const handle = (me?.username ?? "").toLowerCase();
    if (handle !== "nixo" && handle !== "nixo_ops") return { ok: false as const, error: "فقط ایمنی نیکسو.", status: 403 };
    const items = buildRecommendationFeed(data, userId);
    const leakedPrivateGroup = items.some((i) => {
      if (i.kind !== "group") return false;
      const g = data.groups.find((x) => x.id === i.id);
      return Boolean(g && !isPublicDiscoverableGroup(g));
    });
    const leakedPrivateChannel = items.some((i) => {
      if (i.kind !== "channel") return false;
      const c = data.pubChannels.find((x) => x.id === i.id);
      return Boolean(c && c.visibility !== "public");
    });
    return {
      ok: true as const,
      leaked: leakedPrivateGroup || leakedPrivateChannel ? 1 : 0,
      count: items.length,
      kinds: [...new Set(items.map((i) => i.kind))],
      modelVersion: data.graph?.modelVersion ?? GRAPH_MODEL_VERSION,
    };
  });
}

export async function rollbackGraphModel(userId: string, on: boolean) {
  return mutateStore((data) => {
    const me = data.users.find((u) => u.id === userId);
    const handle = (me?.username ?? "").toLowerCase();
    if (handle !== "nixo" && handle !== "nixo_ops") return { ok: false as const, error: "فقط ایمنی نیکسو.", status: 403 };
    const g = ensureGraph(data);
    g.rolledBack = on;
    g.cache = [];
    return { ok: true as const, rolledBack: g.rolledBack, modelVersion: on ? 0 : GRAPH_MODEL_VERSION };
  });
}

export async function graphHealth() {
  const data = await readStoreSnapshot();
  const g = hydrateGraphPersist(data.graph);
  return {
    ok: true as const,
    modelVersion: g.rolledBack ? 0 : g.modelVersion,
    featureVersion: g.featureVersion,
    rolledBack: g.rolledBack,
    jobsQueued: g.jobs.filter((j) => j.status === "queued").length,
    events: g.events.length,
    p95: percentile(g.metrics.samples, 95),
    p99: percentile(g.metrics.samples, 99),
    queries: g.metrics.queries,
    errors: g.metrics.errors,
    emptyRate: g.metrics.queries === 0 ? 0 : g.metrics.empty / g.metrics.queries,
  };
}

export function aiSafeRecLines(data: StoreData, userId: string) {
  try {
    return buildRecommendationFeed(data, userId)
      .slice(0, 5)
      .map((i) => `${i.title} (${i.reason})`)
      .join("؛ ");
  } catch {
    return "";
  }
}

export { GRAPH_MODEL_VERSION, GRAPH_FEATURE_VERSION };
