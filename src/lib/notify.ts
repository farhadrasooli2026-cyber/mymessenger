import "server-only";
import { hmacIdentifier, randomId } from "@/lib/crypto-utils";
import { hitRateLimit } from "@/lib/rate-limit";
import { mutateStore, type StoreData } from "@/lib/store";
import {
  defaultNotifyPrefs,
  NOTIFY_FLOOD_PER_SOURCE,
  NOTIFY_FLOOD_PER_USER,
  NOTIFY_FLOOD_WINDOW_MS,
  NOTIFY_KEEP,
  NOTIFY_PAGE,
  NOTIFY_TEMPLATES,
  NOTIFY_TTL_MS,
  PUSH_KEEP_MS,
  PUSH_RETRY_MAX,
  type NotifyAudit,
  type NotifyCategory,
  type NotifyPrefs,
  type NotifyPriority,
  type NotifyRecord,
  type NotifyTarget,
  type PushJob,
  type PushPlatform,
  type PushToken,
} from "@/lib/notify-types";

export function prefsOf(data: StoreData, userId: string): NotifyPrefs {
  data.notifyPrefs ??= [];
  let row = data.notifyPrefs.find((p) => p.userId === userId);
  if (!row) {
    row = defaultNotifyPrefs(userId);
    data.notifyPrefs.push(row);
  }
  const base = defaultNotifyPrefs(userId);
  row.reactions = row.reactions !== false;
  row.globalEnabled = row.globalEnabled !== false;
  row.dndAllowCalls = row.dndAllowCalls !== false;
  row.locale = row.locale === "en" ? "en" : "fa";
  row.sounds = { ...base.sounds, ...row.sounds };
  row.enabled = { ...base.enabled, ...row.enabled };
  row.mutes = Array.isArray(row.mutes) ? row.mutes : [];
  row.overrides = Array.isArray(row.overrides) ? row.overrides : [];
  row.dndAllowIds = Array.isArray(row.dndAllowIds) ? row.dndAllowIds : [];
  return row;
}

function sanitizeNotifyText(text: string, max = 180) {
  return text
    .replace(/<\s*script[\s\S]*?>[\s\S]*?<\s*\/\s*script\s*>/gi, "")
    .replace(/on\w+\s*=/gi, "")
    .replace(/javascript:/gi, "")
    .replace(/[<>]/g, "")
    .slice(0, max);
}

function destinationAllowed(data: StoreData, input: EmitNotifyInput) {
  if (input.target.type === "chat") {
    const thread = data.threads.find((t) => t.id === input.target.id);
    if (thread && thread.ownerUserId !== input.userId) return false;
    if (thread) {
      const me = data.users.find((u) => u.id === input.userId);
      const peer = data.users.find((u) => u.id === thread.peerKey);
      if (me?.blockedPeerKeys.includes(thread.peerKey)) return false;
      if (peer?.blockedPeerKeys.includes(input.userId)) return false;
    }
  }
  if (input.target.type === "group") {
    const group = data.groups.find((g) => g.id === input.target.id && !g.deletedAt);
    if (group && !group.members.some((m) => m.key === input.userId && !m.leftAt)) return false;
  }
  if (input.target.type === "channel") {
    const channel = data.pubChannels.find((c) => c.id === input.target.id && !c.deletedAt);
    if (channel) {
      const staff = channel.staff.some((s) => s.userId === input.userId);
      const sub = channel.subscribers.some((s) => s.userId === input.userId && !s.leftAt);
      if (!staff && !sub) return false;
    }
  }
  if (input.target.type === "call") {
    const call = data.calls.find((c) => c.id === input.target.id);
    if (call && call.ownerUserId !== input.userId) return false;
  }
  return true;
}

export function authorizedNotifyHref(data: StoreData, userId: string, target: NotifyTarget): string | null {
  if (target.type === "security" || target.type === "system") return "/app/settings/security";
  if (target.type === "chat") {
    const thread = data.threads.find((t) => t.id === target.id);
    if (!thread) return "/app";
    return thread.ownerUserId === userId ? "/app" : null;
  }
  if (target.type === "group") {
    const group = data.groups.find((g) => g.id === target.id && !g.deletedAt);
    if (!group) return "/app";
    if (!group.members.some((m) => m.key === userId && !m.leftAt)) return null;
    return "/app";
  }
  if (target.type === "channel") {
    const channel = data.pubChannels.find((c) => c.id === target.id && !c.deletedAt);
    if (!channel) return "/app";
    const staff = channel.staff.some((s) => s.userId === userId);
    const sub = channel.subscribers.some((s) => s.userId === userId && !s.leftAt);
    if (!staff && !sub && channel.visibility !== "public") return null;
    return "/app";
  }
  if (target.type === "call") {
    const call = data.calls.find((c) => c.id === target.id);
    if (!call) return "/app";
    return call.ownerUserId === userId ? "/app" : null;
  }
  return target.href?.startsWith("/app") ? target.href : "/app";
}

function pushAudit(data: StoreData, userId: string, action: string, detail: string) {
  data.notifyAudit ??= [];
  const row: NotifyAudit = { id: randomId(), userId, action, detail: detail.slice(0, 200), at: Date.now() };
  data.notifyAudit = [row, ...data.notifyAudit].slice(0, 200);
}

export function drainPushJobs(data: StoreData, now = Date.now()) {
  data.pushJobs ??= [];
  data.pushTokens ??= [];
  const rank = (p: NotifyPriority) => (p === "high" ? 0 : p === "low" ? 2 : 1);
  const queued = data.pushJobs
    .filter((j) => j.status === "queued" || (j.status === "failed" && (j.attempts ?? 0) < PUSH_RETRY_MAX && (!j.nextAt || j.nextAt <= now)))
    .sort((a, b) => rank(a.priority) - rank(b.priority) || a.createdAt - b.createdAt);
  for (const job of queued.slice(0, 80)) {
    const rec = (data.notifications ?? []).find((n) => n.id === job.notificationId && n.userId === job.userId);
    const token = data.pushTokens.find((t) => t.id === job.tokenId && t.userId === job.userId && !t.revokedAt && !t.invalidAt);
    job.status = "running";
    if (rec) rec.state = "processing";
    const started = Date.now();
    if (!rec || rec.deletedAt || rec.suppressed) {
      job.status = "failed";
      job.lastError = "dropped";
      continue;
    }
    if (!token) {
      job.attempts = (job.attempts ?? 0) + 1;
      job.lastError = "token_missing";
      if (job.attempts >= PUSH_RETRY_MAX) {
        job.status = "failed";
        rec.state = "failed";
        rec.pushState = "failed";
      } else {
        job.status = "queued";
        job.nextAt = now + Math.min(60_000, 1000 * 2 ** job.attempts);
      }
      continue;
    }
    if (token.permission !== "granted") {
      job.status = "failed";
      job.lastError = "permission_denied";
      rec.pushState = "inapp";
      rec.state = rec.readAt ? "read" : "sent";
      continue;
    }
    job.latencyMs = Math.max(1, Date.now() - started);
    job.status = "delivered";
    rec.state = rec.readAt ? "read" : "delivered";
    rec.pushState = "delivered";
  }
  data.pushJobs = data.pushJobs.filter((j) => now - j.createdAt < PUSH_KEEP_MS).slice(-400);
}

function enqueuePushJobs(data: StoreData, rec: NotifyRecord) {
  if (rec.suppressed) return;
  data.pushTokens ??= [];
  data.pushJobs ??= [];
  const tokens = data.pushTokens.filter((t) => t.userId === rec.userId && !t.revokedAt && !t.invalidAt);
  if (tokens.length === 0) {
    rec.pushState = "push_unsupported";
    rec.state = rec.readAt ? "read" : "pending";
    return;
  }
  rec.pushState = "pending";
  rec.state = "pending";
  for (const token of tokens) {
    const idempotencyKey = `${rec.id}:${token.id}`;
    if (data.pushJobs.some((j) => j.idempotencyKey === idempotencyKey && j.status !== "failed")) continue;
    const job: PushJob = {
      id: randomId(),
      userId: rec.userId,
      notificationId: rec.id,
      tokenId: token.id,
      idempotencyKey,
      platform: token.platform,
      priority: rec.priority,
      status: "queued",
      attempts: 0,
      provider: "nixo-local",
      createdAt: Date.now(),
    };
    data.pushJobs.push(job);
  }
}

function cleanupNotify(data: StoreData, now: number) {
  const cutoff = now - NOTIFY_TTL_MS;
  data.notifications = (data.notifications ?? []).filter((n) => n.createdAt > cutoff);
  data.pushTokens = (data.pushTokens ?? []).filter((t) => !t.revokedAt || now - t.revokedAt < PUSH_KEEP_MS);
}

function parseHm(hm: string) {
  const [h, m] = hm.split(":").map(Number);
  return (h || 0) * 60 + (m || 0);
}

export function inDndWindow(prefs: NotifyPrefs, now = new Date()) {
  if (!prefs.dnd) return false;
  const cur = now.getUTCHours() * 60 + now.getUTCMinutes();
  const a = parseHm(prefs.dndStart || "23:00");
  const b = parseHm(prefs.dndEnd || "08:00");
  if (a === b) return true;
  if (a < b) return cur >= a && cur < b;
  return cur >= a || cur < b;
}

function muteActive(prefs: NotifyPrefs, type: NotifyPrefs["mutes"][number]["targetType"], id: string, now: number) {
  const row = prefs.mutes.find((m) => m.targetType === type && m.targetId === id);
  if (!row) return false;
  if (row.until == null) return true;
  return row.until > now;
}

function overrideOf(prefs: NotifyPrefs, type: NotifyPrefs["overrides"][number]["targetType"], id: string) {
  return prefs.overrides.find((o) => o.targetType === type && o.targetId === id);
}

function categoryEnabled(prefs: NotifyPrefs, category: NotifyRecord["category"]) {
  if (category === "security") return prefs.enabled.security !== false;
  const map = prefs.enabled as Record<string, boolean>;
  return map[category] !== false;
}

export type EmitNotifyInput = {
  userId: string;
  category: NotifyRecord["category"];
  kind: string;
  title: string;
  body?: string;
  senderName?: string;
  photoUrl?: string | null;
  priority?: NotifyPriority;
  e2ee?: boolean;
  sourceId: string;
  target: NotifyTarget;
  muteType?: NotifyPrefs["mutes"][number]["targetType"];
  muteId?: string;
  mention?: boolean;
  reply?: boolean;
  allowDuringDnd?: boolean;
  forceSuppress?: boolean;
  actorUserId?: string;
};

export function previewBody(prefs: NotifyPrefs, input: EmitNotifyInput) {
  const ov = input.muteType && input.muteId ? overrideOf(prefs, input.muteType, input.muteId) : undefined;
  const show = ov?.preview ?? prefs.showMessagePreview;
  if (prefs.lockScreen === "hidden") return "";
  if (input.e2ee || !show) {
    if (prefs.lockScreen === "sender" || input.e2ee) {
      return input.e2ee ? "پیام رمزنگاری‌شده جدید" : "پیام جدید";
    }
    return "اعلان جدید";
  }
  if (prefs.lockScreen === "sender") return `${input.senderName || input.title}`;
  return (input.body || "اعلان جدید").slice(0, 140);
}

export function emitNotification(data: StoreData, input: EmitNotifyInput): NotifyRecord | null {
  const me = data.users.find((u) => u.id === input.userId && u.status === "active");
  if (!me) return null;
  if (!destinationAllowed(data, input)) return null;
  if (
    input.actorUserId &&
    (me.mutedPeerKeys ?? []).includes(input.actorUserId) &&
    input.category !== "security" &&
    (input.category === "messages" || input.category === "calls")
  ) {
    return null;
  }
  const prefs = prefsOf(data, input.userId);
  const now = Date.now();
  const incomingCall = input.category === "calls" && input.kind.startsWith("incoming");
  const security = input.category === "security";
  const allowDnd = Boolean(input.allowDuringDnd || (incomingCall && prefs.dndAllowCalls) || security);

  if (!security && prefs.globalEnabled === false) return null;
  if (!security && !categoryEnabled(prefs, input.category)) {
    return null;
  }
  if (input.mention && !prefs.mentions && !security) return null;
  if (input.reply && !prefs.replies && !security) return null;
  if (input.kind === "reaction" && !prefs.reactions && !security) return null;
  if (input.kind === "admin" && !prefs.groupAdmin && !security) return null;

  const ov = input.muteType && input.muteId ? overrideOf(prefs, input.muteType, input.muteId) : undefined;
  if (ov?.enabled === false && !security) return null;

  let suppressed = false;
  let reason: string | undefined;
  if (!security && input.forceSuppress) {
    suppressed = true;
    reason = "mute";
  }
  if (!security && input.muteType && input.muteId && muteActive(prefs, input.muteType, input.muteId, now) && !incomingCall) {
    suppressed = true;
    reason = "mute";
  }
  if (!security && inDndWindow(prefs, new Date(now))) {
    const allowed = prefs.dndAllowIds.includes(input.sourceId) || (input.muteId && prefs.dndAllowIds.includes(input.muteId)) || allowDnd;
    if (!allowed) {
      suppressed = true;
      reason = reason ?? "dnd";
    }
  }

  const srcLimit = hitRateLimit(data, `notify:src:${input.sourceId}`, NOTIFY_FLOOD_WINDOW_MS, NOTIFY_FLOOD_PER_SOURCE, now);
  const userLimit = hitRateLimit(data, `notify:user:${input.userId}`, NOTIFY_FLOOD_WINDOW_MS, NOTIFY_FLOOD_PER_USER, now);
  if (!security && (!srcLimit.allowed || !userLimit.allowed)) {
    suppressed = true;
    reason = "flood";
  }

  const locale = prefs.locale === "en" ? "en" : "fa";
  const rawTitle = input.title.slice(0, 80);
  const title =
    prefs.lockScreen === "hidden" && !security
      ? "NIXO"
      : sanitizeNotifyText(locale === "en" ? NOTIFY_TEMPLATES.en[input.kind] || rawTitle : rawTitle, 80);
  const body = security ? sanitizeNotifyText(input.body || input.title, 180) : sanitizeNotifyText(previewBody(prefs, input), 140);

  const groupKey = `${input.userId}:${input.kind}:${input.target.type}:${input.target.id}`;
  data.notifications ??= [];
  const recent = data.notifications.find((n) => n.userId === input.userId && n.deletedAt == null && n.groupKey === groupKey && now - n.createdAt < 8_000);
  if (recent && !security) {
    recent.createdAt = now;
    recent.body = body;
    recent.collapsedCount = (recent.collapsedCount ?? 1) + 1;
    return recent;
  }

  const rec: NotifyRecord = {
    id: randomId(),
    userId: input.userId,
    category: input.category,
    kind: input.kind.slice(0, 40),
    title,
    body,
    senderName: sanitizeNotifyText(input.senderName || "", 80),
    photoUrl: input.photoUrl ?? null,
    priority: incomingCall || security ? "high" : input.priority ?? "normal",
    e2ee: Boolean(input.e2ee),
    suppressed,
    reason,
    readAt: suppressed ? now : null,
    dismissedAt: null,
    deletedAt: null,
    createdAt: now,
    sourceId: input.sourceId.slice(0, 80),
    target: { ...input.target, href: undefined },
    pushState: suppressed ? "suppressed" : "push_unsupported",
    state: suppressed ? "dismissed" : "pending",
    groupKey,
    collapsedCount: 1,
    locale,
  };

  data.notifications.unshift(rec);
  const mine = data.notifications.filter((n) => n.userId === input.userId);
  if (mine.length > NOTIFY_KEEP) {
    const drop = new Set(mine.slice(NOTIFY_KEEP).map((n) => n.id));
    data.notifications = data.notifications.filter((n) => n.userId !== input.userId || !drop.has(n.id));
  }
  enqueuePushJobs(data, rec);
  drainPushJobs(data, now);
  return rec;
}

export function publicNotify(n: NotifyRecord, data?: StoreData) {
  const href = data ? authorizedNotifyHref(data, n.userId, n.target) : n.target.href ?? "/app";
  return {
    id: n.id,
    category: n.category,
    kind: n.kind,
    title: n.title,
    body: n.body,
    senderName: n.senderName,
    photoUrl: n.photoUrl,
    priority: n.priority,
    e2ee: n.e2ee,
    suppressed: n.suppressed,
    read: Boolean(n.readAt),
    dismissed: Boolean(n.dismissedAt),
    createdAt: n.createdAt,
    target: { type: n.target.type, id: n.target.id, href: href ?? "/app" },
    pushState: n.pushState,
    state: n.state ?? (n.readAt ? "read" : n.suppressed ? "dismissed" : "pending"),
    collapsedCount: n.collapsedCount ?? 1,
  };
}

export function countsOf(data: StoreData, userId: string) {
  const rows = (data.notifications ?? []).filter((n) => n.userId === userId && !n.deletedAt && !n.suppressed && !n.readAt);
  const by = (c: NotifyRecord["category"]) => rows.filter((n) => n.category === c).length;
  return {
    total: rows.length,
    messages: by("messages"),
    mentions: rows.filter((n) => n.kind === "mention").length,
    calls: by("calls"),
    security: by("security"),
  };
}

export async function listNotifications(
  userId: string,
  category: NotifyCategory = "all",
  offset = 0,
  limit = NOTIFY_PAGE,
  extra?: { cursor?: string; q?: string; from?: number; to?: number; kind?: string },
) {
  return mutateStore((data) => {
    drainPushJobs(data);
    cleanupNotify(data, Date.now());
    const prefs = prefsOf(data, userId);
    const needle = (extra?.q ?? "").trim().toLowerCase();
    const all = (data.notifications ?? [])
      .filter((n) => n.userId === userId && !n.deletedAt)
      .filter((n) => category === "all" || n.category === category)
      .filter((n) => !extra?.kind || n.kind === extra.kind)
      .filter((n) => !extra?.from || n.createdAt >= extra.from)
      .filter((n) => !extra?.to || n.createdAt <= extra.to)
      .filter((n) => !needle || `${n.title} ${n.body} ${n.kind} ${n.senderName}`.toLowerCase().includes(needle));
    const pageSize = Math.min(50, Math.max(1, limit));
    const start = extra?.cursor ? Math.max(0, all.findIndex((n) => n.id === extra.cursor) + 1) : offset;
    const slice = all.slice(start, start + pageSize);
    const last = slice[slice.length - 1];
    return {
      ok: true as const,
      items: slice.map((n) => publicNotify(n, data)),
      hasMore: start + slice.length < all.length,
      nextCursor: slice.length === pageSize && last ? last.id : null,
      counts: countsOf(data, userId),
      prefs,
      metrics: pushMetrics(data, userId),
      note: "Push سیستم‌عامل در این برش وب به Notification API مرورگر و صف nixo-local محدود است؛ بدنهٔ E2EE هرگز روی سرور برای Push گذاشته نمی‌شود. اگر Push نرسد وضعیت جعلی ساخته نمی‌شود.",
    };
  });
}

function pushMetrics(data: StoreData, userId: string) {
  const jobs = (data.pushJobs ?? []).filter((j) => j.userId === userId);
  const sent = jobs.filter((j) => j.status === "sent" || j.status === "delivered").length;
  const failed = jobs.filter((j) => j.status === "failed").length;
  const queued = jobs.filter((j) => j.status === "queued" || j.status === "running").length;
  const lat = jobs.map((j) => j.latencyMs ?? 0).filter((n) => n > 0);
  return {
    queued,
    sent,
    failed,
    successRate: sent + failed === 0 ? 1 : sent / (sent + failed),
    avgLatencyMs: lat.length ? Math.round(lat.reduce((a, b) => a + b, 0) / lat.length) : 0,
    tokens: (data.pushTokens ?? []).filter((t) => t.userId === userId && !t.revokedAt && !t.invalidAt).length,
  };
}

export async function updateNotifyPrefs(userId: string, patch: Partial<NotifyPrefs>) {
  return mutateStore((data) => {
    const prefs = prefsOf(data, userId);
    if (typeof patch.showMessagePreview === "boolean") prefs.showMessagePreview = patch.showMessagePreview;
    if (patch.lockScreen === "full" || patch.lockScreen === "sender" || patch.lockScreen === "hidden") prefs.lockScreen = patch.lockScreen;
    if (typeof patch.vibration === "boolean") prefs.vibration = patch.vibration;
    if (typeof patch.badge === "boolean") prefs.badge = patch.badge;
    if (patch.sounds) prefs.sounds = { ...prefs.sounds, ...patch.sounds };
    if (patch.enabled) prefs.enabled = { ...prefs.enabled, ...patch.enabled };
    if (typeof patch.mentions === "boolean") prefs.mentions = patch.mentions;
    if (typeof patch.replies === "boolean") prefs.replies = patch.replies;
    if (typeof patch.reactions === "boolean") prefs.reactions = patch.reactions;
    if (typeof patch.groupAdmin === "boolean") prefs.groupAdmin = patch.groupAdmin;
    if (typeof patch.globalEnabled === "boolean") prefs.globalEnabled = patch.globalEnabled;
    if (typeof patch.dndAllowCalls === "boolean") prefs.dndAllowCalls = patch.dndAllowCalls;
    if (patch.locale === "en" || patch.locale === "fa") prefs.locale = patch.locale;
    if (typeof patch.dnd === "boolean") prefs.dnd = patch.dnd;
    if (typeof patch.dndStart === "string") prefs.dndStart = patch.dndStart.slice(0, 5);
    if (typeof patch.dndEnd === "string") prefs.dndEnd = patch.dndEnd.slice(0, 5);
    if (Array.isArray(patch.dndAllowIds)) prefs.dndAllowIds = patch.dndAllowIds.slice(0, 40);
    prefs.updatedAt = Date.now();
    return { ok: true as const, prefs };
  });
}

export async function muteTarget(
  userId: string,
  targetType: NotifyPrefs["mutes"][number]["targetType"],
  targetId: string,
  ms: number | null,
) {
  return mutateStore((data) => {
    const prefs = prefsOf(data, userId);
    prefs.mutes = prefs.mutes.filter((m) => !(m.targetType === targetType && m.targetId === targetId));
    if (ms !== 0) {
      prefs.mutes.push({ targetType, targetId, until: ms == null || ms < 0 ? null : Date.now() + ms });
    }
    if (targetType === "chat") {
      const t = data.threads.find((th) => th.id === targetId && th.ownerUserId === userId);
      if (t) t.muteUntil = ms === 0 ? null : ms == null || ms < 0 ? Number.MAX_SAFE_INTEGER : Date.now() + ms;
    }
    prefs.updatedAt = Date.now();
    return { ok: true as const, mutes: prefs.mutes };
  });
}

export async function setOverride(userId: string, row: NotifyPrefs["overrides"][number]) {
  return mutateStore((data) => {
    const prefs = prefsOf(data, userId);
    prefs.overrides = prefs.overrides.filter((o) => !(o.targetType === row.targetType && o.targetId === row.targetId));
    prefs.overrides.push(row);
    prefs.updatedAt = Date.now();
    return { ok: true as const, overrides: prefs.overrides };
  });
}

export async function markNotify(userId: string, ids: string[] | "all", read: boolean) {
  return mutateStore((data) => {
    const now = Date.now();
    for (const n of data.notifications ?? []) {
      if (n.userId !== userId || n.deletedAt) continue;
      if (ids !== "all" && !ids.includes(n.id)) continue;
      n.readAt = read ? now : null;
      if (read) n.state = "read";
      else if (n.state === "read") n.state = n.pushState === "delivered" ? "delivered" : "pending";
    }
    return { ok: true as const, counts: countsOf(data, userId) };
  });
}

export async function dismissNotify(userId: string, ids: string[] | "all") {
  return mutateStore((data) => {
    const now = Date.now();
    for (const n of data.notifications ?? []) {
      if (n.userId !== userId || n.deletedAt) continue;
      if (ids !== "all" && !ids.includes(n.id)) continue;
      n.dismissedAt = now;
      n.readAt = n.readAt ?? now;
      n.state = "dismissed";
    }
    return { ok: true as const, counts: countsOf(data, userId) };
  });
}

export async function deleteNotify(userId: string, ids: string[] | "all") {
  return mutateStore((data) => {
    const now = Date.now();
    if (ids === "all") {
      for (const n of data.notifications ?? []) {
        if (n.userId === userId) n.deletedAt = now;
      }
    } else {
      for (const n of data.notifications ?? []) {
        if (n.userId === userId && ids.includes(n.id)) n.deletedAt = now;
      }
    }
    return { ok: true as const, counts: countsOf(data, userId) };
  });
}

export async function getNotifySnapshot(userId: string) {
  return mutateStore((data) => {
    drainPushJobs(data);
    const prefs = prefsOf(data, userId);
    return {
      ok: true as const,
      counts: countsOf(data, userId),
      prefs,
      devices: (data.devices ?? []).filter((d) => d.userId === userId && !d.revokedAt).length,
      metrics: pushMetrics(data, userId),
      tokens: publicTokens(data, userId),
    };
  });
}

function publicTokens(data: StoreData, userId: string) {
  return (data.pushTokens ?? [])
    .filter((t) => t.userId === userId && !t.revokedAt)
    .map((t) => ({
      id: t.id,
      platform: t.platform,
      permission: t.permission,
      endpointTail: t.endpointTail,
      createdAt: t.createdAt,
      rotatedAt: t.rotatedAt,
      invalid: Boolean(t.invalidAt),
    }));
}

export async function openNotification(userId: string, notifyId: string) {
  return mutateStore((data) => {
    const n = (data.notifications ?? []).find((row) => row.id === notifyId && row.userId === userId && !row.deletedAt);
    if (!n) return { ok: false as const, error: "اعلان یافت نشد.", status: 404 as const };
    const href = authorizedNotifyHref(data, userId, n.target);
    if (!href) return { ok: false as const, error: "اعلان یافت نشد.", status: 404 as const };
    n.readAt = n.readAt ?? Date.now();
    n.state = "read";
    return { ok: true as const, href, target: { type: n.target.type, id: n.target.id } };
  });
}

export async function registerPushToken(
  userId: string,
  sessionId: string,
  input: { endpoint: string; platform?: PushPlatform; permission?: PushToken["permission"] },
) {
  const endpoint = input.endpoint.trim().slice(0, 2000);
  if (endpoint.length < 8) return { ok: false as const, error: "توکن نامعتبر است.", status: 400 };
  return mutateStore((data) => {
    const flood = hitRateLimit(data, `pushtoken:${userId}`, 60_000, 12);
    if (!flood.allowed) return { ok: false as const, error: "ثبت توکن محدود شد.", status: 429 };
    const device = (data.devices ?? []).find((d) => d.id === sessionId && d.userId === userId && !d.revokedAt);
    if (!device) return { ok: false as const, error: "نشست دستگاه معتبر نیست.", status: 403 };
    data.pushTokens ??= [];
    const hash = hmacIdentifier(`push:${endpoint}`);
    const existing = data.pushTokens.find((t) => t.userId === userId && t.endpointHash === hash && !t.revokedAt);
    const now = Date.now();
    const permission = input.permission === "denied" || input.permission === "default" ? input.permission : "granted";
    if (existing) {
      existing.rotatedAt = now;
      existing.deviceSessionId = sessionId;
      existing.permission = permission;
      existing.invalidAt = permission === "denied" ? now : null;
      existing.endpoint = endpoint;
      pushAudit(data, userId, "token_rotate", existing.id);
      return { ok: true as const, token: publicTokens(data, userId).find((t) => t.id === existing.id), rotated: true as const };
    }
    const token: PushToken = {
      id: randomId(),
      userId,
      deviceSessionId: sessionId,
      platform: input.platform === "mobile" || input.platform === "desktop" ? input.platform : "web",
      endpointHash: hash,
      endpointTail: endpoint.slice(-8),
      endpoint,
      permission,
      createdAt: now,
      rotatedAt: now,
      revokedAt: null,
      invalidAt: permission === "denied" ? now : null,
    };
    data.pushTokens.push(token);
    pushAudit(data, userId, "token_register", token.id);
    return { ok: true as const, token: publicTokens(data, userId).find((t) => t.id === token.id), rotated: false as const };
  });
}

export async function revokePushToken(userId: string, tokenId: string) {
  return mutateStore((data) => {
    const token = (data.pushTokens ?? []).find((t) => t.id === tokenId && t.userId === userId && !t.revokedAt);
    if (!token) return { ok: false as const, error: "توکن یافت نشد.", status: 404 };
    token.revokedAt = Date.now();
    token.endpoint = "";
    pushAudit(data, userId, "token_revoke", tokenId);
    return { ok: true as const, tokens: publicTokens(data, userId) };
  });
}

export async function listPushTokens(userId: string) {
  return mutateStore((data) => ({ ok: true as const, tokens: publicTokens(data, userId) }));
}
