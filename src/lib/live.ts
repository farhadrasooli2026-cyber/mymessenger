import "server-only";
import { randomId, signPayload, verifyPayload } from "@/lib/crypto-utils";
import { hitRateLimit } from "@/lib/rate-limit";
import { mutateStore, readStoreSnapshot, type StoreData } from "@/lib/store";
import {
  DEFAULT_LIVE_PREFS,
  LIVE_ACCESS_TTL_MS,
  LIVE_CATEGORIES,
  LIVE_CHAT_MAX,
  LIVE_CHAT_PER_MIN,
  LIVE_CREATE_MAX,
  LIVE_CREATE_WINDOW_MS,
  LIVE_GUEST_REQ_PER_MIN,
  LIVE_INVITE_TTL_MS,
  LIVE_JOIN_PER_MIN,
  LIVE_MAX_VIEWERS_HARD,
  LIVE_REACT_PER_MIN,
  type LiveCategory,
  type LivePrefs,
  type LiveQuality,
  type LiveRecordingMeta,
  type LiveRole,
  type LiveScope,
  type LiveStream,
  type LiveVisibility,
} from "@/lib/live-types";
import { emitNotification } from "@/lib/notify";
import { pairBlocked } from "@/lib/privacy";

export function livePrefsOf(data: StoreData, userId: string): LivePrefs {
  data.livePrefs ??= [];
  let row = data.livePrefs.find((p) => p.userId === userId);
  if (!row) {
    row = DEFAULT_LIVE_PREFS(userId);
    data.livePrefs.push(row);
  }
  return row;
}

function liveParts(live: LiveStream) {
  return live.participants.filter((p) => !p.leftAt && !p.kicked && !p.banned);
}

function nameOf(data: StoreData, userId: string) {
  const u = data.users.find((x) => x.id === userId);
  return u?.displayName || u?.username || "کاربر";
}

function memberOfGroup(data: StoreData, groupId: string, userId: string) {
  const g = data.groups.find((x) => x.id === groupId && !x.deletedAt);
  if (!g) return null;
  const m = g.members.find((x) => x.key === userId && !x.leftAt);
  return m ? { group: g, member: m } : null;
}

function memberOfChannel(data: StoreData, channelId: string, userId: string) {
  const c = data.pubChannels.find((x) => x.id === channelId && !x.deletedAt);
  if (!c) return null;
  const staff = c.staff.find((s) => s.userId === userId);
  const sub = c.subscribers.find((s) => s.userId === userId && !s.leftAt);
  return { channel: c, staff, sub };
}

export function canWatchLive(data: StoreData, userId: string, live: LiveStream, inviteToken?: string | null): { ok: boolean; error?: string; status?: number } {
  if (live.emergencyStopped) return { ok: false, error: "این پخش به‌خاطر ایمنی متوقف شده است.", status: 403 };
  if (pairBlocked(data, userId, live.hostUserId)) return { ok: false, error: "دسترسی مسدود است.", status: 403 };
  const me = live.participants.find((p) => p.userId === userId);
  if (me?.banned) return { ok: false, error: "از این Live بن شده‌ای.", status: 403 };
  if (live.ageRestricted) {
    const prefs = livePrefsOf(data, userId);
    if (!prefs.adultConfirmed && userId !== live.hostUserId) {
      return { ok: false, error: "این Live محدودیت سنی دارد. ابتدا در Settings → Live تأیید کن.", status: 403 };
    }
  }
  if (live.geoHint) {
    const prefs = livePrefsOf(data, userId);
    if (prefs.region && prefs.region !== live.geoHint && userId !== live.hostUserId) {
      return { ok: false, error: "این پخش برای منطقهٔ اعلام‌شده محدود است.", status: 403 };
    }
  }
  if (live.visibility === "public") return { ok: true };
  if (userId === live.hostUserId) return { ok: true };
  if (live.allowIds.includes(userId)) return { ok: true };
  if (live.visibility === "private") return { ok: false, error: "این Live خصوصی است.", status: 403 };
  if (live.visibility === "members") {
    if (live.groupId && memberOfGroup(data, live.groupId, userId)) return { ok: true };
    if (live.channelId && memberOfChannel(data, live.channelId, userId)?.sub) return { ok: true };
    if (live.channelId && memberOfChannel(data, live.channelId, userId)?.staff) return { ok: true };
    return { ok: false, error: "فقط اعضای این فضا می‌توانند ببینند.", status: 403 };
  }
  if (live.visibility === "invite") {
    if (inviteToken && live.inviteToken && inviteToken === live.inviteToken) {
      if (live.inviteExpiresAt && live.inviteExpiresAt < Date.now()) return { ok: false, error: "لینک دعوت منقضی شده.", status: 410 };
      return { ok: true };
    }
    if (me && (me.role === "cohost" || me.role === "guest" || me.role === "moderator")) return { ok: true };
    return { ok: false, error: "برای ورود لینک دعوت معتبر لازم است.", status: 403 };
  }
  return { ok: false, error: "اجازه نداری.", status: 403 };
}

function issueAccess(userId: string, liveId: string) {
  const exp = Date.now() + LIVE_ACCESS_TTL_MS;
  return signPayload({ v: 1, liveId, userId, exp });
}

export function verifyLiveAccess(token: string, userId: string, liveId: string) {
  const p = verifyPayload<{ v?: number; liveId?: string; userId?: string; exp?: number }>(token);
  if (!p || p.liveId !== liveId || p.userId !== userId) return false;
  if (typeof p.exp !== "number" || p.exp < Date.now()) return false;
  return true;
}

function roleOf(live: LiveStream, userId: string): LiveRole | null {
  if (live.hostUserId === userId) return "host";
  const p = live.participants.find((x) => x.userId === userId && !x.leftAt);
  return p?.role ?? null;
}

function canHost(live: LiveStream, userId: string) {
  const r = roleOf(live, userId);
  return r === "host" || r === "cohost";
}

function canMod(live: LiveStream, userId: string) {
  const r = roleOf(live, userId);
  return r === "host" || r === "cohost" || r === "moderator";
}

function logMod(live: LiveStream, actorId: string, action: string, targetId?: string) {
  live.modLog = [{ id: randomId(), actorId, action, targetId, at: Date.now() }, ...live.modLog].slice(0, 200);
}

export function publicLive(live: LiveStream, userId: string, data: StoreData, opts?: { inviteToken?: string | null; withAccess?: boolean }) {
  const watch = canWatchLive(data, userId, live, opts?.inviteToken);
  const hostish = canHost(live, userId);
  const viewers = liveParts(live);
  const durationMs = live.startedAt ? (live.endedAt ?? Date.now()) - live.startedAt : 0;
  return {
    id: live.id,
    hostUserId: live.hostUserId,
    hostName: live.hostName,
    scope: live.scope,
    groupId: live.groupId,
    channelId: live.channelId,
    title: live.title,
    description: live.description,
    thumbDataUrl: live.thumbDataUrl,
    visibility: live.visibility,
    status: live.status,
    scheduledAt: live.scheduledAt,
    startedAt: live.startedAt,
    endedAt: live.endedAt,
    audioOnly: live.audioOnly,
    quality: live.quality,
    chatEnabled: live.chatEnabled,
    slowModeMs: live.slowModeMs,
    reactionsEnabled: live.reactionsEnabled,
    guestRequestsEnabled: live.guestRequestsEnabled,
    recordEnabled: live.recordEnabled,
    maxViewers: live.maxViewers,
    ageRestricted: live.ageRestricted,
    geoHint: live.geoHint,
    category: live.category,
    tags: live.tags,
    viewerCount: viewers.length,
    durationMs,
    copyrightFlag: live.copyrightFlag,
    emergencyStopped: live.emergencyStopped,
    recordingId: live.recordingId && watch.ok ? live.recordingId : null,
    hasReplay: Boolean(live.recordingId) && watch.ok && live.status === "ended",
    inviteLink: hostish && live.inviteToken ? `/join/live/${live.inviteToken}` : null,
    myRole: roleOf(live, userId),
    iAmHost: live.hostUserId === userId,
    canModerate: canMod(live, userId),
    canWatch: watch.ok,
    watchError: watch.ok ? null : watch.error,
    accessToken: watch.ok && opts?.withAccess ? issueAccess(userId, live.id) : null,
    reminderOn: live.reminders.some((r) => r.userId === userId),
    analytics: hostish
      ? {
          peakViewers: live.peakViewers,
          totalViewers: live.uniqueJoins.length,
          durationMs,
          engagement: live.chat.filter((c) => !c.deleted).length + live.reactionCount,
        }
      : null,
    participants: hostish
      ? viewers.map((p) => ({
          userId: p.userId,
          name: p.name,
          role: p.role,
          me: p.userId === userId,
          mutedChat: Boolean(p.mutedChatUntil && p.mutedChatUntil > Date.now()),
          guestPerms: p.guestPerms,
        }))
      : viewers.map((p) => ({
          userId: p.userId === userId || hostish ? p.userId : "",
          name: p.name,
          role: p.role,
          me: p.userId === userId,
          mutedChat: p.userId === userId ? Boolean(p.mutedChatUntil && p.mutedChatUntil > Date.now()) : false,
          guestPerms: p.userId === userId ? p.guestPerms : { camera: false, mic: false, screen: false },
        })),
    guestQueue: hostish ? live.guestQueue : live.guestQueue.filter((g) => g.userId === userId),
    chat: watch.ok
      ? live.chat.filter((c) => !c.deleted).slice(-80).map((c) => ({ id: c.id, name: c.name, body: c.body, createdAt: c.createdAt, mine: c.userId === userId }))
      : [],
    createdAt: live.createdAt,
  };
}

function notifyAudience(data: StoreData, live: LiveStream, kind: "start" | "scheduled") {
  const prefsHide = (uid: string) => livePrefsOf(data, uid).hideLiveOnLockScreen || !livePrefsOf(data, uid).notifyLive;
  const privateLive = live.visibility !== "public";
  const send = (uid: string) => {
    if (uid === live.hostUserId) return;
    if (!livePrefsOf(data, uid).notifyLive) return;
    emitNotification(data, {
      userId: uid,
      category: "lives",
      kind,
      title: kind === "start" ? "پخش زنده شروع شد" : "پخش زنده زمان‌بندی شد",
      body: privateLive || prefsHide(uid) ? "یک Live مجاز برای تو آماده است." : live.title,
      senderName: live.hostName,
      e2ee: privateLive,
      sourceId: live.id,
      target: { type: "live", id: live.id, href: `/app/live/${live.id}` },
      muteType: live.groupId ? "group" : live.channelId ? "channel" : undefined,
      muteId: live.groupId ?? live.channelId ?? undefined,
    });
  };
  if (live.visibility === "public") {
    for (const u of data.users.filter((x) => x.status === "active")) send(u.id);
    return;
  }
  const ids = new Set<string>(live.allowIds);
  if (live.groupId) {
    const g = data.groups.find((x) => x.id === live.groupId);
    g?.members.filter((m) => !m.leftAt).forEach((m) => ids.add(m.key));
  }
  if (live.channelId) {
    const c = data.pubChannels.find((x) => x.id === live.channelId);
    c?.subscribers.filter((s) => !s.leftAt).forEach((s) => ids.add(s.userId));
    c?.staff.forEach((s) => ids.add(s.userId));
  }
  ids.forEach(send);
}

function ensureCanCreate(data: StoreData, userId: string, scope: LiveScope, groupId?: string | null, channelId?: string | null) {
  if (scope === "group") {
    if (!groupId) return { ok: false as const, error: "گروه مشخص نیست.", status: 400 };
    const ctx = memberOfGroup(data, groupId, userId);
    if (!ctx) return { ok: false as const, error: "عضو این گروه نیستی.", status: 403 };
    if (ctx.member.role !== "owner" && ctx.member.role !== "admin" && !ctx.group.perms.startCalls) {
      return { ok: false as const, error: "طبق مجوز گروه اجازهٔ Live نداری.", status: 403 };
    }
  }
  if (scope === "channel") {
    if (!channelId) return { ok: false as const, error: "کانال مشخص نیست.", status: 400 };
    const ctx = memberOfChannel(data, channelId, userId);
    if (!ctx?.staff) return { ok: false as const, error: "فقط کارکنان کانال می‌توانند Live بسازند.", status: 403 };
  }
  return { ok: true as const };
}

function attachHost(live: LiveStream, userId: string, name: string, now: number) {
  live.participants.push({
    userId,
    name,
    role: "host",
    joinedAt: now,
    leftAt: null,
    mutedChatUntil: null,
    kicked: false,
    banned: false,
    camera: true,
    mic: true,
    guestPerms: { camera: true, mic: true, screen: true },
    joinCount: 1,
  });
  live.uniqueJoins = [userId];
  live.peakViewers = 1;
}

export function insertLive(
  data: StoreData,
  userId: string,
  input: {
    title: string;
    description?: string;
    thumbDataUrl?: string;
    visibility?: LiveVisibility;
    allowIds?: string[];
    scope?: LiveScope;
    groupId?: string | null;
    channelId?: string | null;
    scheduledAt?: number | null;
    audioOnly?: boolean;
    maxViewers?: number;
    category?: string;
    tags?: string[];
    ageRestricted?: boolean;
    geoHint?: string;
    chatEnabled?: boolean;
    reactionsEnabled?: boolean;
    guestRequestsEnabled?: boolean;
    recordEnabled?: boolean;
    quality?: LiveQuality;
  },
) {
  const flood = hitRateLimit(data, `live:create:${userId}`, LIVE_CREATE_WINDOW_MS, LIVE_CREATE_MAX);
  if (!flood.allowed) return { ok: false as const, error: "ساخت Live پیاپی محدود شد.", status: 429 };
  const scope: LiveScope = input.scope === "group" || input.scope === "channel" ? input.scope : "solo";
  const gate = ensureCanCreate(data, userId, scope, input.groupId, input.channelId);
  if (!gate.ok) return gate;
  const vis: LiveVisibility =
    input.visibility === "private" || input.visibility === "members" || input.visibility === "invite" ? input.visibility : "public";
  if ((scope === "group" || scope === "channel") && vis === "public" && scope === "group") {
    /* group lives default members unless host picks public */
  }
  const cat = LIVE_CATEGORIES.includes((input.category ?? "talk") as LiveCategory) ? (input.category as LiveCategory) : "talk";
  const now = Date.now();
  const scheduled = typeof input.scheduledAt === "number" && input.scheduledAt > now + 30_000;
  const live: LiveStream = {
    id: randomId(),
    hostUserId: userId,
    hostName: nameOf(data, userId),
    scope,
    groupId: scope === "group" ? input.groupId ?? null : null,
    channelId: scope === "channel" ? input.channelId ?? null : null,
    title: input.title.trim().slice(0, 80) || "پخش نیکسو",
    description: (input.description ?? "").trim().slice(0, 500),
    thumbDataUrl: (input.thumbDataUrl ?? "").startsWith("data:image/") ? input.thumbDataUrl!.slice(0, 120_000) : "",
    visibility: vis === "members" && scope === "solo" ? "private" : vis,
    allowIds: Array.isArray(input.allowIds) ? input.allowIds.slice(0, 80) : [],
    status: scheduled ? "scheduled" : "starting",
    scheduledAt: scheduled ? input.scheduledAt! : null,
    startedAt: null,
    endedAt: null,
    pausedAt: null,
    audioOnly: Boolean(input.audioOnly),
    quality: input.quality === "low" || input.quality === "medium" || input.quality === "high" ? input.quality : "auto",
    chatEnabled: input.chatEnabled !== false,
    slowModeMs: 0,
    reactionsEnabled: input.reactionsEnabled !== false,
    guestRequestsEnabled: Boolean(input.guestRequestsEnabled),
    recordEnabled: Boolean(input.recordEnabled),
    maxViewers: Math.min(LIVE_MAX_VIEWERS_HARD, Math.max(2, Math.floor(input.maxViewers ?? 64))),
    ageRestricted: Boolean(input.ageRestricted),
    geoHint: (input.geoHint ?? "").slice(0, 32),
    category: cat,
    tags: (input.tags ?? []).map((t) => t.replace(/^#/, "").slice(0, 24)).filter(Boolean).slice(0, 8),
    inviteToken: vis === "invite" || vis === "private" ? randomId() : randomId(),
    inviteExpiresAt: Date.now() + LIVE_INVITE_TTL_MS,
    copyrightFlag: false,
    emergencyStopped: false,
    peakViewers: 0,
    uniqueJoins: [],
    chat: [],
    participants: [],
    guestQueue: [],
    reminders: [],
    reactionCount: 0,
    modLog: [],
    recordingId: null,
    createdAt: now,
  };
  attachHost(live, userId, live.hostName, now);
  data.lives = [live, ...(data.lives ?? [])].slice(0, 800);
  if (scope === "channel" && live.channelId) {
    const ch = data.pubChannels.find((c) => c.id === live.channelId);
    if (ch) {
      ch.liveActive = !scheduled;
      ch.liveTitle = live.title;
      ch.liveStreamId = live.id;
    }
  }
  if (scheduled) notifyAudience(data, live, "scheduled");
  logMod(live, userId, "create");
  return { ok: true as const, live };
}

export async function createLive(userId: string, input: Parameters<typeof insertLive>[2]) {
  return mutateStore((data) => {
    const r = insertLive(data, userId, input);
    if (!r.ok) return r;
    return { ok: true as const, live: publicLive(r.live, userId, data, { withAccess: true }) };
  });
}

export async function listLives(userId: string, mode: "discovery" | "mine" | "trending" | "export") {
  const data = await readStoreSnapshot();
  const prefs = livePrefsOf(data, userId);
  const rows = data.lives ?? [];
  if (mode === "export") {
    return {
      ok: true as const,
      prefs,
      items: rows
        .filter((l) => l.hostUserId === userId)
        .map((l) => ({
          id: l.id,
          title: l.title,
          status: l.status,
          createdAt: l.createdAt,
          visibility: l.visibility,
          durationMs: l.startedAt ? (l.endedAt ?? Date.now()) - l.startedAt : 0,
          recordingId: l.recordingId,
        })),
    };
  }
  const visible = rows.filter((l) => {
    if (mode === "mine") return l.hostUserId === userId || l.participants.some((p) => p.userId === userId);
    if (l.visibility !== "public") return false;
    if (l.emergencyStopped) return false;
    if (mode === "discovery" || mode === "trending") return l.status === "live" || l.status === "scheduled" || l.status === "paused" || l.status === "starting";
    return false;
  });
  const scored = visible.map((l) => {
    const ageH = (Date.now() - l.createdAt) / 3_600_000;
    const trend = l.uniqueJoins.length * 2 + l.reactionCount * 0.2 + l.chat.length * 0.1 - ageH;
    return { live: l, trend };
  });
  if (mode === "trending") scored.sort((a, b) => b.trend - a.trend);
  else scored.sort((a, b) => (b.live.startedAt ?? b.live.scheduledAt ?? b.live.createdAt) - (a.live.startedAt ?? a.live.scheduledAt ?? a.live.createdAt));
  return {
    ok: true as const,
    prefs,
    items: scored.slice(0, 80).map((s) => publicLive(s.live, userId, data)),
  };
}

export async function getLive(userId: string, liveId: string, inviteToken?: string | null) {
  return mutateStore((data) => {
    const live = (data.lives ?? []).find((l) => l.id === liveId);
    if (!live) return { ok: false as const, error: "Live یافت نشد.", status: 404 };
    const watch = canWatchLive(data, userId, live, inviteToken);
    if (!watch.ok && live.visibility !== "public") return { ok: false as const, error: watch.error ?? "اجازه نداری.", status: watch.status ?? 403 };
    return { ok: true as const, live: publicLive(live, userId, data, { inviteToken, withAccess: true }) };
  });
}

export async function actLive(
  userId: string,
  liveId: string,
  action: string,
  body: Record<string, unknown> = {},
) {
  return mutateStore((data) => {
    const live = (data.lives ?? []).find((l) => l.id === liveId);
    if (!live) return { ok: false as const, error: "Live یافت نشد.", status: 404 };
    const now = Date.now();
    const invite = typeof body.inviteToken === "string" ? body.inviteToken : null;

    if (action === "start") {
      if (live.hostUserId !== userId) return { ok: false as const, error: "فقط Host می‌تواند شروع کند.", status: 403 };
      if (live.status === "ended" || live.emergencyStopped) return { ok: false as const, error: "این Live تمام شده است.", status: 409 };
      live.status = "live";
      live.startedAt = live.startedAt ?? now;
      live.pausedAt = null;
      if (live.channelId) {
        const ch = data.pubChannels.find((c) => c.id === live.channelId);
        if (ch) {
          ch.liveActive = true;
          ch.liveTitle = live.title;
          ch.liveStreamId = live.id;
        }
      }
      notifyAudience(data, live, "start");
      logMod(live, userId, "start");
      return { ok: true as const, live: publicLive(live, userId, data, { withAccess: true }) };
    }
    if (action === "pause") {
      if (!canHost(live, userId)) return { ok: false as const, error: "اجازه نداری.", status: 403 };
      if (live.status !== "live") return { ok: false as const, error: "الان Live نیست.", status: 409 };
      live.status = "paused";
      live.pausedAt = now;
      logMod(live, userId, "pause");
      return { ok: true as const, live: publicLive(live, userId, data, { withAccess: true }) };
    }
    if (action === "end") {
      if (!canHost(live, userId)) return { ok: false as const, error: "اجازه نداری.", status: 403 };
      live.status = "ended";
      live.endedAt = now;
      live.participants.forEach((p) => {
        if (!p.leftAt) p.leftAt = now;
      });
      if (live.channelId) {
        const ch = data.pubChannels.find((c) => c.id === live.channelId);
        if (ch && ch.liveStreamId === live.id) {
          ch.liveActive = false;
          ch.liveChat = [];
        }
      }
      logMod(live, userId, "end");
      return { ok: true as const, live: publicLive(live, userId, data, { withAccess: true }) };
    }
    if (action === "emergency") {
      if (!canHost(live, userId) && !memberOfChannel(data, live.channelId ?? "", userId)?.staff) {
        return { ok: false as const, error: "اجازهٔ توقف اضطراری نداری.", status: 403 };
      }
      live.emergencyStopped = true;
      live.status = "ended";
      live.endedAt = now;
      live.participants.forEach((p) => {
        if (!p.leftAt) p.leftAt = now;
      });
      logMod(live, userId, "emergency");
      return { ok: true as const, live: publicLive(live, userId, data, { withAccess: true }) };
    }
    if (action === "join") {
      const watch = canWatchLive(data, userId, live, invite);
      if (!watch.ok) return { ok: false as const, error: watch.error ?? "اجازه نداری.", status: watch.status ?? 403 };
      if (live.status === "ended" || live.emergencyStopped) return { ok: false as const, error: "این Live تمام شده است.", status: 410 };
      if (live.status === "scheduled") return { ok: false as const, error: "هنوز شروع نشده. Reminder بگذار.", status: 409 };
      const jlim = hitRateLimit(data, `live:join:${userId}`, 60_000, LIVE_JOIN_PER_MIN);
      if (!jlim.allowed) return { ok: false as const, error: "ورود پیاپی محدود شد.", status: 429 };
      const churn = hitRateLimit(data, `live:churn:${live.id}:${userId}`, 30_000, 8);
      if (!churn.allowed) return { ok: false as const, error: "رفتار ورود/خروج غیرعادی محدود شد.", status: 429 };
      let p = live.participants.find((x) => x.userId === userId);
      if (p?.banned) return { ok: false as const, error: "بن شده‌ای.", status: 403 };
      const online = liveParts(live).length;
      if (!p || p.leftAt) {
        if (online >= live.maxViewers && userId !== live.hostUserId) {
          return { ok: false as const, error: "ظرفیت بیننده پر است.", status: 409 };
        }
      }
      if (!p) {
        p = {
          userId,
          name: nameOf(data, userId),
          role: userId === live.hostUserId ? "host" : "viewer",
          joinedAt: now,
          leftAt: null,
          mutedChatUntil: null,
          kicked: false,
          banned: false,
          camera: false,
          mic: false,
          guestPerms: { camera: false, mic: false, screen: false },
          joinCount: 1,
        };
        live.participants.push(p);
      } else {
        p.leftAt = null;
        p.kicked = false;
        p.joinedAt = now;
        p.joinCount += 1;
        p.name = nameOf(data, userId);
      }
      if (!live.uniqueJoins.includes(userId)) live.uniqueJoins.push(userId);
      const n = liveParts(live).length;
      if (n > live.peakViewers) live.peakViewers = n;
      return { ok: true as const, live: publicLive(live, userId, data, { inviteToken: invite, withAccess: true }) };
    }
    if (action === "leave") {
      const p = live.participants.find((x) => x.userId === userId);
      if (p && !p.leftAt) p.leftAt = now;
      return { ok: true as const, live: publicLive(live, userId, data, { withAccess: true }) };
    }
    if (action === "heartbeat") {
      const watch = canWatchLive(data, userId, live, invite);
      if (!watch.ok) return { ok: false as const, error: watch.error ?? "اجازه نداری.", status: watch.status ?? 403 };
      return { ok: true as const, live: publicLive(live, userId, data, { withAccess: true }) };
    }
    if (action === "chat") {
      const watch = canWatchLive(data, userId, live);
      if (!watch.ok) return { ok: false as const, error: watch.error ?? "اجازه نداری.", status: watch.status ?? 403 };
      if (!live.chatEnabled) return { ok: false as const, error: "چت Live خاموش است.", status: 403 };
      if (live.status !== "live" && live.status !== "paused") return { ok: false as const, error: "چت فقط هنگام پخش فعال است.", status: 409 };
      const p = live.participants.find((x) => x.userId === userId && !x.leftAt);
      if (!p) return { ok: false as const, error: "اول Join کن.", status: 403 };
      if (p.mutedChatUntil && p.mutedChatUntil > now) return { ok: false as const, error: "در چت Mute هستی.", status: 403 };
      const text = String(body.body ?? "").trim().slice(0, 280);
      if (!text) return { ok: false as const, error: "پیام خالی است.", status: 400 };
      const clim = hitRateLimit(data, `live:chat:${live.id}:${userId}`, 60_000, LIVE_CHAT_PER_MIN);
      if (!clim.allowed) return { ok: false as const, error: "پیام پیاپی محدود شد.", status: 429 };
      if (live.slowModeMs > 0) {
        const last = [...live.chat].reverse().find((c) => c.userId === userId);
        if (last && now - last.createdAt < live.slowModeMs) {
          return { ok: false as const, error: "Slow Mode فعال است.", status: 429 };
        }
      }
      live.chat.push({ id: randomId(), userId, name: nameOf(data, userId), body: text, createdAt: now, deleted: false });
      live.chat = live.chat.slice(-LIVE_CHAT_MAX);
      return { ok: true as const, live: publicLive(live, userId, data, { withAccess: true }) };
    }
    if (action === "react") {
      const watch = canWatchLive(data, userId, live);
      if (!watch.ok) return { ok: false as const, error: watch.error ?? "اجازه نداری.", status: watch.status ?? 403 };
      if (!live.reactionsEnabled) return { ok: false as const, error: "واکنش خاموش است.", status: 403 };
      const rlim = hitRateLimit(data, `live:react:${live.id}:${userId}`, 60_000, LIVE_REACT_PER_MIN);
      if (!rlim.allowed) return { ok: false as const, error: "واکنش پیاپی محدود شد.", status: 429 };
      live.reactionCount += 1;
      return { ok: true as const, live: publicLive(live, userId, data, { withAccess: true }) };
    }
    if (action === "settings") {
      if (!canHost(live, userId)) return { ok: false as const, error: "اجازه نداری.", status: 403 };
      if (typeof body.chatEnabled === "boolean") live.chatEnabled = body.chatEnabled;
      if (typeof body.reactionsEnabled === "boolean") live.reactionsEnabled = body.reactionsEnabled;
      if (typeof body.slowModeMs === "number") live.slowModeMs = Math.max(0, Math.min(60_000, Math.floor(body.slowModeMs)));
      if (typeof body.maxViewers === "number") live.maxViewers = Math.min(LIVE_MAX_VIEWERS_HARD, Math.max(2, Math.floor(body.maxViewers)));
      if (typeof body.guestRequestsEnabled === "boolean") live.guestRequestsEnabled = body.guestRequestsEnabled;
      if (body.quality === "auto" || body.quality === "low" || body.quality === "medium" || body.quality === "high") live.quality = body.quality;
      if (typeof body.audioOnly === "boolean") live.audioOnly = body.audioOnly;
      if (typeof body.title === "string") live.title = body.title.trim().slice(0, 80) || live.title;
      if (typeof body.description === "string") live.description = body.description.trim().slice(0, 500);
      logMod(live, userId, "settings");
      return { ok: true as const, live: publicLive(live, userId, data, { withAccess: true }) };
    }
    if (action === "cohost") {
      if (live.hostUserId !== userId) return { ok: false as const, error: "فقط Host.", status: 403 };
      const target = String(body.targetUserId ?? "");
      const p = live.participants.find((x) => x.userId === target);
      if (!p) return { ok: false as const, error: "بیننده نیست.", status: 404 };
      p.role = "cohost";
      p.leftAt = null;
      logMod(live, userId, "cohost", target);
      return { ok: true as const, live: publicLive(live, userId, data, { withAccess: true }) };
    }
    if (action === "remove-cohost") {
      if (live.hostUserId !== userId) return { ok: false as const, error: "فقط Host.", status: 403 };
      const target = String(body.targetUserId ?? "");
      const p = live.participants.find((x) => x.userId === target);
      if (p && p.role === "cohost") p.role = "viewer";
      logMod(live, userId, "remove-cohost", target);
      return { ok: true as const, live: publicLive(live, userId, data, { withAccess: true }) };
    }
    if (action === "guest-request") {
      const watch = canWatchLive(data, userId, live);
      if (!watch.ok) return { ok: false as const, error: watch.error ?? "اجازه نداری.", status: watch.status ?? 403 };
      if (!live.guestRequestsEnabled) return { ok: false as const, error: "درخواست Guest خاموش است.", status: 403 };
      const glim = hitRateLimit(data, `live:guest:${live.id}:${userId}`, 60_000, LIVE_GUEST_REQ_PER_MIN);
      if (!glim.allowed) return { ok: false as const, error: "درخواست پیاپی محدود شد.", status: 429 };
      if (!live.guestQueue.some((g) => g.userId === userId)) {
        live.guestQueue.push({ userId, name: nameOf(data, userId), at: now });
      }
      return { ok: true as const, live: publicLive(live, userId, data, { withAccess: true }) };
    }
    if (action === "guest-decide") {
      if (!canHost(live, userId)) return { ok: false as const, error: "اجازه نداری.", status: 403 };
      const target = String(body.targetUserId ?? "");
      const accept = Boolean(body.accept);
      live.guestQueue = live.guestQueue.filter((g) => g.userId !== target);
      const p = live.participants.find((x) => x.userId === target);
      if (accept && p) {
        p.role = "guest";
        p.guestPerms = {
          camera: body.camera !== false,
          mic: body.mic !== false,
          screen: Boolean(body.screen),
        };
        p.leftAt = null;
      }
      logMod(live, userId, accept ? "guest-ok" : "guest-no", target);
      return { ok: true as const, live: publicLive(live, userId, data, { withAccess: true }) };
    }
    if (action === "remove-guest") {
      if (!canHost(live, userId)) return { ok: false as const, error: "اجازه نداری.", status: 403 };
      const target = String(body.targetUserId ?? "");
      const p = live.participants.find((x) => x.userId === target);
      if (p && p.role === "guest") {
        p.role = "viewer";
        p.guestPerms = { camera: false, mic: false, screen: false };
      }
      logMod(live, userId, "remove-guest", target);
      return { ok: true as const, live: publicLive(live, userId, data, { withAccess: true }) };
    }
    if (action === "kick" || action === "ban" || action === "mute" || action === "unmute" || action === "delete-chat") {
      if (!canMod(live, userId)) return { ok: false as const, error: "اجازهٔ مدیریت نداری.", status: 403 };
      if (action === "delete-chat") {
        const mid = String(body.messageId ?? "");
        const msg = live.chat.find((c) => c.id === mid);
        if (msg) msg.deleted = true;
        logMod(live, userId, "delete-chat", mid);
        return { ok: true as const, live: publicLive(live, userId, data, { withAccess: true }) };
      }
      const target = String(body.targetUserId ?? "");
      if (target === live.hostUserId) return { ok: false as const, error: "Host قابل Kick نیست.", status: 400 };
      const p = live.participants.find((x) => x.userId === target);
      if (!p) return { ok: false as const, error: "کاربر در Live نیست.", status: 404 };
      if (action === "kick") {
        p.kicked = true;
        p.leftAt = now;
      }
      if (action === "ban") {
        p.banned = true;
        p.kicked = true;
        p.leftAt = now;
      }
      if (action === "mute") p.mutedChatUntil = now + 60 * 60_000;
      if (action === "unmute") p.mutedChatUntil = null;
      logMod(live, userId, action, target);
      return { ok: true as const, live: publicLive(live, userId, data, { withAccess: true }) };
    }
    if (action === "reminder") {
      const watch = canWatchLive(data, userId, live, invite);
      if (!watch.ok) return { ok: false as const, error: watch.error ?? "اجازه نداری.", status: watch.status ?? 403 };
      const on = body.on !== false;
      live.reminders = live.reminders.filter((r) => r.userId !== userId);
      if (on) live.reminders.push({ userId, at: now });
      return { ok: true as const, live: publicLive(live, userId, data, { withAccess: true }) };
    }
    if (action === "rotate-link") {
      if (!canHost(live, userId)) return { ok: false as const, error: "اجازه نداری.", status: 403 };
      live.inviteToken = randomId();
      live.inviteExpiresAt = now + LIVE_INVITE_TTL_MS;
      logMod(live, userId, "rotate-link");
      return { ok: true as const, live: publicLive(live, userId, data, { withAccess: true }) };
    }
    if (action === "copyright") {
      if (!canHost(live, userId)) return { ok: false as const, error: "اجازه نداری.", status: 403 };
      live.copyrightFlag = true;
      logMod(live, userId, "copyright");
      return { ok: true as const, live: publicLive(live, userId, data, { withAccess: true }) };
    }
    if (action === "block-host") {
      const me = data.users.find((u) => u.id === userId);
      if (me && !me.blockedPeerKeys.includes(live.hostUserId)) me.blockedPeerKeys.push(live.hostUserId);
      const p = live.participants.find((x) => x.userId === userId);
      if (p) p.leftAt = now;
      return { ok: true as const, live: publicLive(live, userId, data, { withAccess: true }) };
    }
    return { ok: false as const, error: "عملیات نامعتبر است.", status: 400 };
  });
}

export async function peekLiveInvite(userId: string | null, token: string) {
  const data = await readStoreSnapshot();
  const live = (data.lives ?? []).find((l) => l.inviteToken === token);
  if (!live) return { ok: false as const, error: "لینک نامعتبر است.", status: 404 };
  if (live.inviteExpiresAt && live.inviteExpiresAt < Date.now()) return { ok: false as const, error: "لینک منقضی شده.", status: 410 };
  if (!userId) return { ok: false as const, error: "برای ورود باید وارد حساب NIXO شوی.", status: 401 };
  const watch = canWatchLive(data, userId, live, token);
  return {
    ok: true as const,
    peek: {
      title: live.visibility === "public" || watch.ok ? live.title : "Live خصوصی نیکسو",
      hostName: live.hostName,
      status: live.status,
      live: live.status === "live" || live.status === "paused" || live.status === "starting",
      visibility: live.visibility,
    },
    canJoin: watch.ok,
    error: watch.ok ? null : watch.error,
  };
}

export async function joinLiveInvite(userId: string, token: string) {
  const data = await readStoreSnapshot();
  const live = (data.lives ?? []).find((l) => l.inviteToken === token);
  if (!live) return { ok: false as const, error: "لینک نامعتبر است.", status: 404 };
  return actLive(userId, live.id, "join", { inviteToken: token });
}

export async function saveRecordingMeta(userId: string, liveId: string, rec: { id: string; size: number; durationMs: number; mime: string }) {
  return mutateStore((data) => {
    const live = (data.lives ?? []).find((l) => l.id === liveId);
    if (!live) return { ok: false as const, error: "Live یافت نشد.", status: 404 };
    if (live.hostUserId !== userId) return { ok: false as const, error: "فقط Host می‌تواند Recording ذخیره کند.", status: 403 };
    if (!live.recordEnabled) return { ok: false as const, error: "Recording برای این Live فعال نبود.", status: 403 };
    data.liveRecordings = data.liveRecordings ?? [];
    const row: LiveRecordingMeta = {
      id: rec.id,
      liveId,
      hostUserId: userId,
      createdAt: Date.now(),
      size: rec.size,
      durationMs: rec.durationMs,
      mime: rec.mime,
      deletedAt: null,
    };
    data.liveRecordings.push(row);
    live.recordingId = rec.id;
    logMod(live, userId, "record-save");
    return { ok: true as const, recordingId: rec.id };
  });
}

export async function deleteRecording(userId: string, liveId: string) {
  return mutateStore((data) => {
    const live = (data.lives ?? []).find((l) => l.id === liveId);
    if (!live || !live.recordingId) return { ok: false as const, error: "Recording نیست.", status: 404 };
    const staff = live.channelId ? memberOfChannel(data, live.channelId, userId)?.staff : null;
    if (live.hostUserId !== userId && !staff) return { ok: false as const, error: "اجازه نداری.", status: 403 };
    const rec = (data.liveRecordings ?? []).find((r) => r.id === live.recordingId);
    if (rec) rec.deletedAt = Date.now();
    const id = live.recordingId;
    live.recordingId = null;
    logMod(live, userId, "record-del");
    return { ok: true as const, hostUserId: live.hostUserId, recordingId: id };
  });
}

export async function getRecordingForUser(userId: string, liveId: string) {
  const data = await readStoreSnapshot();
  const live = (data.lives ?? []).find((l) => l.id === liveId);
  if (!live) return { ok: false as const, error: "Live یافت نشد.", status: 404 };
  const watch = canWatchLive(data, userId, live);
  if (!watch.ok) return { ok: false as const, error: watch.error ?? "اجازه نداری.", status: watch.status ?? 403 };
  if (!live.recordingId) return { ok: false as const, error: "Replay موجود نیست.", status: 404 };
  const rec = (data.liveRecordings ?? []).find((r) => r.id === live.recordingId && !r.deletedAt);
  if (!rec) return { ok: false as const, error: "Replay موجود نیست.", status: 404 };
  return { ok: true as const, live, rec };
}

export async function updateLivePrefs(userId: string, patch: Partial<LivePrefs>) {
  return mutateStore((data) => {
    const row = livePrefsOf(data, userId);
    if (typeof patch.notifyLive === "boolean") row.notifyLive = patch.notifyLive;
    if (typeof patch.hideLiveOnLockScreen === "boolean") row.hideLiveOnLockScreen = patch.hideLiveOnLockScreen;
    if (typeof patch.adultConfirmed === "boolean") row.adultConfirmed = patch.adultConfirmed;
    if (typeof patch.region === "string") row.region = patch.region.slice(0, 32);
    return { ok: true as const, prefs: row };
  });
}

export function searchLiveHits(data: StoreData, userId: string, q: string) {
  const needle = q.trim().toLowerCase();
  if (needle.length < 2) return [];
  return (data.lives ?? [])
    .filter((l) => l.visibility === "public" && !l.emergencyStopped)
    .filter((l) => `${l.title} ${l.description} ${l.tags.join(" ")} ${l.category} ${l.hostName}`.toLowerCase().includes(needle))
    .slice(0, 20)
    .map((l) => ({
      id: `live:${l.id}`,
      scope: "live" as const,
      title: l.title,
      preview: l.status === "live" ? "🔴 Live" : l.status,
      sender: l.hostName,
      chatName: "Live",
      date: l.startedAt ?? l.createdAt,
      kind: "live",
      category: l.category,
      target: { type: "live" as const, id: l.id },
    }));
}
