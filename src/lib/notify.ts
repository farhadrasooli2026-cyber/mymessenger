import "server-only";
import { randomId } from "@/lib/crypto-utils";
import { hitRateLimit } from "@/lib/rate-limit";
import { mutateStore, type StoreData } from "@/lib/store";
import {
  defaultNotifyPrefs,
  NOTIFY_FLOOD_PER_SOURCE,
  NOTIFY_FLOOD_PER_USER,
  NOTIFY_FLOOD_WINDOW_MS,
  NOTIFY_KEEP,
  type NotifyCategory,
  type NotifyPrefs,
  type NotifyRecord,
  type NotifyTarget,
} from "@/lib/notify-types";

export function prefsOf(data: StoreData, userId: string): NotifyPrefs {
  data.notifyPrefs ??= [];
  let row = data.notifyPrefs.find((p) => p.userId === userId);
  if (!row) {
    row = defaultNotifyPrefs(userId);
    data.notifyPrefs.push(row);
  }
  return row;
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
  priority?: "normal" | "high";
  e2ee?: boolean;
  sourceId: string;
  target: NotifyTarget;
  muteType?: NotifyPrefs["mutes"][number]["targetType"];
  muteId?: string;
  mention?: boolean;
  reply?: boolean;
  allowDuringDnd?: boolean;
  forceSuppress?: boolean;
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
  const prefs = prefsOf(data, input.userId);
  const now = Date.now();
  const security = input.category === "security" || input.priority === "high";

  if (!security && !categoryEnabled(prefs, input.category)) {
    return null;
  }
  if (input.mention && !prefs.mentions && !security) return null;
  if (input.reply && !prefs.replies && !security) return null;
  if (input.kind === "admin" && !prefs.groupAdmin && !security) return null;

  const ov = input.muteType && input.muteId ? overrideOf(prefs, input.muteType, input.muteId) : undefined;
  if (ov?.enabled === false && !security) return null;

  let suppressed = false;
  let reason: string | undefined;
  if (!security && input.forceSuppress) {
    suppressed = true;
    reason = "mute";
  }
  if (!security && input.muteType && input.muteId && muteActive(prefs, input.muteType, input.muteId, now)) {
    suppressed = true;
    reason = "mute";
  }
  if (!security && inDndWindow(prefs, new Date(now))) {
    const allowed = prefs.dndAllowIds.includes(input.sourceId) || (input.muteId && prefs.dndAllowIds.includes(input.muteId));
    if (!allowed && !input.allowDuringDnd) {
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

  const title =
    prefs.lockScreen === "hidden" && !security ? "NIXO" : input.title.slice(0, 80);
  const body = security ? (input.body || input.title).slice(0, 180) : previewBody(prefs, input);

  const rec: NotifyRecord = {
    id: randomId(),
    userId: input.userId,
    category: input.category,
    kind: input.kind.slice(0, 40),
    title,
    body,
    senderName: input.senderName?.slice(0, 80) || "",
    photoUrl: input.photoUrl ?? null,
    priority: security ? "high" : input.priority ?? "normal",
    e2ee: Boolean(input.e2ee),
    suppressed,
    reason,
    readAt: suppressed ? now : null,
    deletedAt: null,
    createdAt: now,
    sourceId: input.sourceId.slice(0, 80),
    target: input.target,
    pushState: suppressed ? "suppressed" : "push_unsupported",
  };

  data.notifications ??= [];
  const key = `${input.userId}:${input.kind}:${input.target.id}`;
  const recent = data.notifications.find((n) => n.userId === input.userId && n.deletedAt == null && `${n.userId}:${n.kind}:${n.target.id}` === key && now - n.createdAt < 8_000);
  if (recent && !security) {
    recent.createdAt = now;
    recent.body = rec.body;
    return recent;
  }
  data.notifications.unshift(rec);
  const mine = data.notifications.filter((n) => n.userId === input.userId);
  if (mine.length > NOTIFY_KEEP) {
    const drop = new Set(mine.slice(NOTIFY_KEEP).map((n) => n.id));
    data.notifications = data.notifications.filter((n) => n.userId !== input.userId || !drop.has(n.id));
  }
  return rec;
}

export function publicNotify(n: NotifyRecord) {
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
    createdAt: n.createdAt,
    target: n.target,
    pushState: n.pushState,
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

export async function listNotifications(userId: string, category: NotifyCategory = "all", offset = 0, limit = 40) {
  return mutateStore((data) => {
    const prefs = prefsOf(data, userId);
    const all = (data.notifications ?? [])
      .filter((n) => n.userId === userId && !n.deletedAt)
      .filter((n) => category === "all" || n.category === category);
    const slice = all.slice(offset, offset + Math.min(50, Math.max(1, limit)));
    return {
      ok: true as const,
      items: slice.map(publicNotify),
      hasMore: offset + slice.length < all.length,
      counts: countsOf(data, userId),
      prefs,
      note: "Push سیستم‌عامل در این برش وب به Notification API مرورگر محدود است؛ بدنهٔ E2EE هرگز روی سرور برای Push گذاشته نمی‌شود. اگر Push نرسد وضعیت جعلی ساخته نمی‌شود.",
    };
  });
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
    if (typeof patch.groupAdmin === "boolean") prefs.groupAdmin = patch.groupAdmin;
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
    const prefs = prefsOf(data, userId);
    return { ok: true as const, counts: countsOf(data, userId), prefs, devices: (data.devices ?? []).filter((d) => d.userId === userId && !d.revokedAt).length };
  });
}
