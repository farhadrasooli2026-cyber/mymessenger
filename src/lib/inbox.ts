import "server-only";
import { decryptText, encryptText, randomId } from "@/lib/crypto-utils";
import { seedInbox } from "@/lib/chat";
import { muteTarget } from "@/lib/notify";
import { hitRateLimit } from "@/lib/rate-limit";
import { mutateStore, readStoreSnapshot } from "@/lib/store";
import type { ChatFolder, InboxMeta, StoreData } from "@/lib/store";
import {
  BUILTIN_FOLDERS,
  FOLDER_ICONS,
  INBOX_FOLDER_MAX,
  INBOX_NAME_MAX,
  INBOX_PIN_MAX,
  type ChatOrgSort,
  type InboxKind,
} from "@/lib/inbox-types";

export function inboxKey(kind: InboxKind, targetId: string) {
  return `${kind}:${targetId}`;
}

function ensure(data: StoreData) {
  data.inboxMetas ??= [];
  data.chatFolders ??= [];
}

function getMeta(data: StoreData, userId: string, kind: InboxKind, targetId: string, now: number): InboxMeta {
  ensure(data);
  const id = inboxKey(kind, targetId);
  let row = data.inboxMetas.find((m) => m.id === id && m.ownerUserId === userId);
  if (!row) {
    row = {
      id,
      ownerUserId: userId,
      kind,
      targetId,
      pinnedAt: null,
      archivedAt: null,
      lastReadAt: now,
      markedUnread: false,
      favorite: false,
      labels: [],
      notesCipher: "",
      draftCipher: "",
      hidden: false,
      updatedAt: now,
      deviceStamp: "",
    };
    data.inboxMetas.push(row);
  }
  return row;
}

function notesOf(row: InboxMeta) {
  if (!row.notesCipher) return "";
  try {
    return decryptText(row.notesCipher);
  } catch {
    return "";
  }
}

function draftOf(row: InboxMeta) {
  if (!row.draftCipher) return "";
  try {
    return decryptText(row.draftCipher);
  } catch {
    return "";
  }
}

function publicFolder(f: ChatFolder) {
  return {
    id: f.id,
    name: f.name,
    icon: f.icon,
    sort: f.sort,
    builtin: f.builtin,
    includeTypes: f.includeTypes,
    includeIds: f.includeIds,
    excludeIds: f.excludeIds,
    unreadOnly: f.unreadOnly,
    favoritesOnly: f.favoritesOnly,
    muted: f.muted,
    updatedAt: f.updatedAt,
  };
}

function builtinsFor(userId: string, now: number): ChatFolder[] {
  return BUILTIN_FOLDERS.map((b, i) => ({
    id: b.id,
    ownerUserId: userId,
    name: b.name,
    icon: b.icon,
    sort: i,
    builtin: b.id,
    includeTypes: [...b.includeTypes],
    includeIds: [],
    excludeIds: [],
    unreadOnly: "unreadOnly" in b && Boolean(b.unreadOnly),
    favoritesOnly: "favoritesOnly" in b && Boolean(b.favoritesOnly),
    muted: false,
    updatedAt: now,
    deviceStamp: "",
  }));
}

export type InboxItem = {
  key: string;
  kind: InboxKind;
  targetId: string;
  name: string;
  title: string;
  color: string;
  lastAt: number;
  lastPreview: string;
  unreadCount: number;
  mentionCount: number;
  replyFlag: boolean;
  pinned: boolean;
  archived: boolean;
  muted: boolean;
  favorite: boolean;
  draft: string;
  notes: string;
  labels: string[];
  e2ee: boolean;
  markedUnread: boolean;
  navId?: string;
  pinnedAt: number | null;
  lastAtLabel?: string;
};

function sortItems(items: InboxItem[], sort: ChatOrgSort) {
  items.sort((a, b) => {
    if (a.pinned !== b.pinned) return a.pinned ? -1 : 1;
    if (a.pinned && b.pinned) return (b.pinnedAt ?? 0) - (a.pinnedAt ?? 0);
    if (sort === "unread") return Number(b.unreadCount + Number(b.markedUnread)) - Number(a.unreadCount + Number(a.markedUnread)) || b.lastAt - a.lastAt;
    if (sort === "name") return a.name.localeCompare(b.name, "fa");
    if (sort === "favorites") return Number(b.favorite) - Number(a.favorite) || b.lastAt - a.lastAt;
    return b.lastAt - a.lastAt;
  });
}

export function folderNameOk(name: string) {
  const n = name.trim();
  if (!n || n.length > INBOX_NAME_MAX) return false;
  if (n === "." || n === "..") return false;
  if (/[\u0000-\u001f]/.test(n)) return false;
  return true;
}

function muteHit(data: StoreData, userId: string, type: string, id: string, now: number) {
  const prefs = data.notifyPrefs?.find((p) => p.userId === userId);
  const row = prefs?.mutes.find((m) => m.targetType === type && m.targetId === id);
  if (!row) return false;
  return row.until == null || row.until > now;
}

export function canSeeChat(data: StoreData, userId: string, kind: InboxKind, targetId: string) {
  if (kind === "dm") return data.threads.some((t) => t.id === targetId && t.ownerUserId === userId);
  if (kind === "group") {
    const g = (data.groups ?? []).find((x) => x.id === targetId && !x.deletedAt);
    return Boolean(g?.members.some((m) => m.key === userId && !m.leftAt));
  }
  if (kind === "community") {
    const c = (data.communities ?? []).find((x) => x.id === targetId && !x.deletedAt);
    return Boolean(c?.members.some((m) => m.key === userId && !m.leftAt));
  }
  if (kind === "channel") {
    const ch = (data.pubChannels ?? []).find((x) => x.id === targetId && !x.deletedAt);
    if (!ch) return false;
    return ch.ownerUserId === userId || ch.staff.some((s) => s.userId === userId) || ch.subscribers.some((s) => s.userId === userId && !s.leftAt);
  }
  if (kind === "bot") {
    const b = (data.bots ?? []).find((x) => x.id === targetId && x.status === "active");
    if (!b) return false;
    return b.ownerUserId === userId || (data.botChats ?? []).some((c) => c.userId === userId && c.botId === b.id);
  }
  if (kind === "business") {
    const th = (data.bizThreads ?? []).find((t) => t.id === targetId);
    if (!th) return false;
    const biz = data.businesses.find((x) => x.id === th.businessId);
    if (!biz) return false;
    return th.customerId === userId || biz.ownerUserId === userId || data.bizStaff.some((s) => s.businessId === biz.id && s.userId === userId);
  }
  return false;
}

function folderMatch(folder: ChatFolder, item: InboxItem, archivedFolder: boolean) {
  if (folder.excludeIds.includes(item.key)) return false;
  if (folder.includeIds.includes(item.key)) return true;
  if (!folder.includeTypes.includes(item.kind)) return false;
  if (folder.unreadOnly && item.unreadCount < 1 && !item.markedUnread) return false;
  if (folder.favoritesOnly && !item.favorite) return false;
  if (archivedFolder) return item.archived;
  return !item.archived;
}

function collectItems(data: StoreData, userId: string, now: number, showPreview: boolean): InboxItem[] {
  ensure(data);
  seedInbox(data, userId, now);
  const items: InboxItem[] = [];
  const me = data.users.find((u) => u.id === userId);

  for (const t of data.threads) {
    if (t.ownerUserId !== userId) continue;
    const meta = getMeta(data, userId, "dm", t.id, now);
    if (meta.hidden) continue;
    const msgs = data.messages.filter((m) => m.threadId === t.id && m.ownerUserId === userId && !m.hiddenFor?.includes(userId));
    const unread = msgs.filter((m) => m.sender === "peer" && m.createdAt > meta.lastReadAt).length;
    const last = msgs.sort((a, b) => a.createdAt - b.createdAt).at(-1);
    const muted = Boolean(t.muteUntil && t.muteUntil > now) || muteHit(data, userId, "chat", t.id, now);
    items.push({
      key: meta.id,
      kind: "dm",
      targetId: t.id,
      name: t.peerName,
      title: t.peerTitle,
      color: t.color,
      lastAt: last?.createdAt ?? t.updatedAt,
      lastPreview: showPreview ? (draftOf(meta) ? "Draft" : last?.kind === "text" && last.enc === "e2ee-v1" ? "پیام رمزنگاری‌شده" : last?.kind ?? "گفتگوی خصوصی") : "پیام جدید",
      unreadCount: meta.markedUnread ? Math.max(1, unread) : unread,
      mentionCount: 0,
      replyFlag: false,
      pinned: Boolean(meta.pinnedAt),
      pinnedAt: meta.pinnedAt,
      archived: Boolean(meta.archivedAt),
      muted,
      favorite: meta.favorite,
      draft: draftOf(meta),
      notes: notesOf(meta),
      labels: meta.labels,
      e2ee: true,
      markedUnread: meta.markedUnread,
    });
  }

  for (const g of data.groups ?? []) {
    if (g.deletedAt || !g.members.some((m) => m.key === userId && !m.leftAt)) continue;
    const meta = getMeta(data, userId, "group", g.id, now);
    if (meta.hidden) continue;
    const gmsgs = (data.groupMessages ?? []).filter((m) => m.groupId === g.id && !m.deleted);
    const mentionCount = gmsgs.filter((m) => m.createdAt > meta.lastReadAt && (m.mentions?.includes(userId) || (me?.username && (m.bodyFa ?? "").includes(`@${me.username}`)))).length;
    const replyFlag = gmsgs.some(
      (m) => m.createdAt > meta.lastReadAt && m.replyToId && gmsgs.some((orig) => orig.id === m.replyToId && orig.senderKey === userId),
    );
    items.push({
      key: meta.id,
      kind: "group",
      targetId: g.id,
      name: g.name,
      title: "گروه",
      color: g.color,
      lastAt: g.updatedAt,
      lastPreview: showPreview ? `${g.members.filter((m) => !m.leftAt).length} عضو` : "گروه",
      unreadCount: g.updatedAt > meta.lastReadAt || meta.markedUnread ? (meta.markedUnread ? 1 : g.updatedAt > meta.lastReadAt ? 1 : 0) : 0,
      mentionCount,
      replyFlag,
      pinned: Boolean(meta.pinnedAt),
      pinnedAt: meta.pinnedAt,
      archived: Boolean(meta.archivedAt),
      muted: muteHit(data, userId, "group", g.id, now) || Boolean(g.members.find((m) => m.key === userId)?.mutedUntil && (g.members.find((m) => m.key === userId)?.mutedUntil ?? 0) > now),
      favorite: meta.favorite,
      draft: draftOf(meta),
      notes: notesOf(meta),
      labels: meta.labels,
      e2ee: true,
      markedUnread: meta.markedUnread,
    });
  }

  for (const c of data.communities ?? []) {
    if (c.deletedAt || !c.members.some((m) => m.key === userId && !m.leftAt)) continue;
    const meta = getMeta(data, userId, "community", c.id, now);
    if (meta.hidden) continue;
    items.push({
      key: meta.id,
      kind: "community",
      targetId: c.id,
      name: c.name,
      title: "جامعه",
      color: c.color,
      lastAt: c.updatedAt,
      lastPreview: showPreview ? "جامعه" : "جامعه",
      unreadCount: meta.markedUnread ? 1 : 0,
      mentionCount: 0,
      replyFlag: false,
      pinned: Boolean(meta.pinnedAt),
      pinnedAt: meta.pinnedAt,
      archived: Boolean(meta.archivedAt),
      muted: false,
      favorite: meta.favorite,
      draft: draftOf(meta),
      notes: notesOf(meta),
      labels: meta.labels,
      e2ee: false,
      markedUnread: meta.markedUnread,
    });
  }

  for (const ch of data.pubChannels ?? []) {
    if (ch.deletedAt) continue;
    const inIt = ch.ownerUserId === userId || ch.staff.some((s) => s.userId === userId) || ch.subscribers.some((s) => s.userId === userId && !s.leftAt);
    if (!inIt) continue;
    const meta = getMeta(data, userId, "channel", ch.id, now);
    if (meta.hidden) continue;
    items.push({
      key: meta.id,
      kind: "channel",
      targetId: ch.id,
      name: ch.name,
      title: "کانال",
      color: ch.color,
      lastAt: ch.updatedAt,
      lastPreview: showPreview ? (ch.username ? `@${ch.username}` : "کانال") : "کانال",
      unreadCount: meta.markedUnread || ch.updatedAt > meta.lastReadAt ? 1 : 0,
      mentionCount: 0,
      replyFlag: false,
      pinned: Boolean(meta.pinnedAt),
      pinnedAt: meta.pinnedAt,
      archived: Boolean(meta.archivedAt),
      muted: muteHit(data, userId, "channel", ch.id, now),
      favorite: meta.favorite,
      draft: draftOf(meta),
      notes: notesOf(meta),
      labels: meta.labels,
      e2ee: false,
      markedUnread: meta.markedUnread,
    });
  }

  for (const b of data.bots ?? []) {
    if (b.status !== "active") continue;
    const chat = (data.botChats ?? []).find((c) => c.userId === userId && c.botId === b.id);
    if (!chat && b.ownerUserId !== userId) continue;
    const meta = getMeta(data, userId, "bot", b.id, now);
    if (meta.hidden) continue;
    items.push({
      key: meta.id,
      kind: "bot",
      targetId: b.id,
      name: b.name,
      title: `@${b.username}`,
      color: "#67e8f9",
      lastAt: chat?.updatedAt ?? b.createdAt,
      lastPreview: showPreview ? "ربات" : "ربات",
      unreadCount: meta.markedUnread ? 1 : 0,
      mentionCount: 0,
      replyFlag: false,
      pinned: Boolean(meta.pinnedAt),
      pinnedAt: meta.pinnedAt,
      archived: Boolean(meta.archivedAt),
      muted: muteHit(data, userId, "bot", b.id, now),
      favorite: meta.favorite,
      draft: draftOf(meta),
      notes: notesOf(meta),
      labels: meta.labels,
      e2ee: false,
      markedUnread: meta.markedUnread,
    });
  }

  for (const th of data.bizThreads ?? []) {
    const biz = data.businesses.find((b) => b.id === th.businessId);
    if (!biz) continue;
    const staff = data.bizStaff.some((s) => s.businessId === biz.id && s.userId === userId);
    if (th.customerId !== userId && biz.ownerUserId !== userId && !staff) continue;
    const meta = getMeta(data, userId, "business", th.id, now);
    if (meta.hidden) continue;
    items.push({
      key: meta.id,
      kind: "business",
      targetId: th.id,
      name: biz.name,
      title: "کسب‌وکار",
      color: "#fbbf24",
      lastAt: th.updatedAt,
      lastPreview: showPreview ? "گفتگوی کسب‌وکار" : "کسب‌وکار",
      unreadCount: th.unread || meta.markedUnread ? 1 : 0,
      mentionCount: 0,
      replyFlag: false,
      pinned: Boolean(meta.pinnedAt),
      pinnedAt: meta.pinnedAt,
      archived: Boolean(meta.archivedAt),
      muted: false,
      favorite: meta.favorite,
      draft: draftOf(meta),
      notes: notesOf(meta),
      labels: meta.labels,
      e2ee: false,
      markedUnread: meta.markedUnread,
      navId: biz.id,
    });
  }

  return items;
}

export async function listInbox(userId: string, folderId = "all", q = "", scope = "folder") {
  return mutateStore((data) => {
    const me = data.users.find((u) => u.id === userId);
    if (!me) return { ok: false as const, error: "حساب فعال نیست.", status: 401 };
    const now = Date.now();
    const all = collectItems(data, userId, now, me.listShowPreview);
    const folders = folderList(data, userId, now);
    const folder = folders.find((f) => f.id === folderId) ?? folders[0]!;
    const archivedFolder = folder.builtin === "archived";
    const needle = q.trim().toLowerCase();
    let items =
      scope === "all" && needle
        ? all.filter((it) => `${it.name} ${it.title} ${it.labels.join(" ")} ${it.notes}`.toLowerCase().includes(needle))
        : all.filter((it) => folderMatch(folder, it, archivedFolder));
    if (needle && !(scope === "all" && needle)) {
      items = items.filter((it) => `${it.name} ${it.title} ${it.labels.join(" ")}`.toLowerCase().includes(needle));
    }
    sortItems(items, me.chatOrgSort);
    return {
      ok: true as const,
      folders: folders.map(publicFolder),
      items: items.slice(0, 200),
      prefs: {
        sort: me.chatOrgSort,
        archiveUnarchiveOnNew: me.archiveUnarchiveOnNew,
        listShowPreview: me.listShowPreview,
        pinMax: INBOX_PIN_MAX,
      },
      archivedCount: all.filter((i) => i.archived).length,
    };
  });
}

function folderList(data: StoreData, userId: string, now: number) {
  ensure(data);
  const custom = data.chatFolders.filter((f) => f.ownerUserId === userId);
  const built = builtinsFor(userId, now);
  const me = data.users.find((u) => u.id === userId);
  const order = me?.folderOrder?.length ? me.folderOrder : [...built.map((b) => b.id), ...custom.map((c) => c.id)];
  const map = new Map([...built, ...custom].map((f) => [f.id, f]));
  const ordered: ChatFolder[] = [];
  for (const id of order) {
    const f = map.get(id);
    if (f) ordered.push(f);
    map.delete(id);
  }
  for (const f of map.values()) ordered.push(f);
  return ordered;
}

export async function saveFolder(userId: string, patch: Record<string, unknown>) {
  return mutateStore((data) => {
    const me = data.users.find((u) => u.id === userId);
    if (!me) return { ok: false as const, error: "حساب فعال نیست.", status: 401 };
    ensure(data);
    const flood = hitRateLimit(data, `folder:${userId}`, 60_000, 20);
    if (!flood.allowed) return { ok: false as const, error: "ذخیره پوشه محدود شد.", status: 429 };
    const now = Date.now();
    if (patch.id && BUILTIN_FOLDERS.some((b) => b.id === patch.id)) {
      return { ok: false as const, error: "پوشهٔ آماده فقط قابل بی‌صدا کردن است.", status: 400 };
    }
    const name = String(patch.name ?? "").trim().slice(0, INBOX_NAME_MAX);
    if (name && !folderNameOk(name)) return { ok: false as const, error: "نام پوشه نامعتبر است.", status: 400 };
    if (patch.id) {
      const row = data.chatFolders.find((f) => f.id === patch.id && f.ownerUserId === userId);
      if (!row) return { ok: false as const, error: "پوشه یافت نشد.", status: 404 };
      if (!patch.force && typeof patch.updatedAt === "number" && patch.updatedAt < row.updatedAt) {
        return { ok: false as const, error: "تداخل همگام‌سازی پوشه.", status: 409, folder: publicFolder(row) };
      }
      if (name) row.name = name;
      if (typeof patch.icon === "string" && (FOLDER_ICONS as readonly string[]).includes(patch.icon)) row.icon = patch.icon;
      if (Array.isArray(patch.includeTypes)) row.includeTypes = patch.includeTypes.map(String).filter((k) => ["dm", "group", "channel", "community", "bot", "business"].includes(k)) as InboxKind[];
      if (Array.isArray(patch.includeIds)) row.includeIds = patch.includeIds.map(String).slice(0, 200);
      if (Array.isArray(patch.excludeIds)) row.excludeIds = patch.excludeIds.map(String).slice(0, 200);
      if (typeof patch.unreadOnly === "boolean") row.unreadOnly = patch.unreadOnly;
      if (typeof patch.favoritesOnly === "boolean") row.favoritesOnly = patch.favoritesOnly;
      if (typeof patch.muted === "boolean") row.muted = patch.muted;
      if (typeof patch.sort === "number") row.sort = patch.sort;
      row.updatedAt = now;
      row.deviceStamp = String(patch.deviceStamp ?? "").slice(0, 80);
      return { ok: true as const, folder: publicFolder(row) };
    }
    if (!folderNameOk(name)) return { ok: false as const, error: "نام پوشه نامعتبر است.", status: 400 };
    const mine = data.chatFolders.filter((f) => f.ownerUserId === userId);
    if (mine.length >= INBOX_FOLDER_MAX) return { ok: false as const, error: "سقف پوشه پر است.", status: 400 };
    const row: ChatFolder = {
      id: randomId(),
      ownerUserId: userId,
      name,
      icon: typeof patch.icon === "string" && (FOLDER_ICONS as readonly string[]).includes(patch.icon) ? patch.icon : "📁",
      sort: mine.length + 10,
      builtin: null,
      includeTypes: Array.isArray(patch.includeTypes)
        ? (patch.includeTypes.map(String).filter((k) => ["dm", "group", "channel", "community", "bot", "business"].includes(k)) as InboxKind[])
        : ["dm"],
      includeIds: Array.isArray(patch.includeIds) ? patch.includeIds.map(String) : [],
      excludeIds: Array.isArray(patch.excludeIds) ? patch.excludeIds.map(String) : [],
      unreadOnly: Boolean(patch.unreadOnly),
      favoritesOnly: Boolean(patch.favoritesOnly),
      muted: false,
      updatedAt: now,
      deviceStamp: "",
    };
    data.chatFolders.push(row);
    me.folderOrder = [...folderList(data, userId, now).map((f) => f.id)];
    return { ok: true as const, folder: publicFolder(row) };
  });
}

export async function deleteFolder(userId: string, folderId: string) {
  return mutateStore((data) => {
    if (BUILTIN_FOLDERS.some((b) => b.id === folderId)) {
      return { ok: false as const, error: "پوشهٔ آماده حذف نمی‌شود.", status: 400 };
    }
    const before = data.chatFolders.length;
    data.chatFolders = (data.chatFolders ?? []).filter((f) => !(f.id === folderId && f.ownerUserId === userId));
    if (data.chatFolders.length === before) return { ok: false as const, error: "پوشه یافت نشد.", status: 404 };
    return { ok: true as const, chatsKept: true };
  });
}

export async function reorderFolders(userId: string, ids: string[]) {
  return mutateStore((data) => {
    const me = data.users.find((u) => u.id === userId);
    if (!me) return { ok: false as const, error: "حساب فعال نیست.", status: 401 };
    me.folderOrder = ids.map(String).slice(0, 40);
    return { ok: true as const, folderOrder: me.folderOrder };
  });
}

export async function setOrgPrefs(userId: string, patch: Record<string, unknown>) {
  return mutateStore((data) => {
    const me = data.users.find((u) => u.id === userId);
    if (!me) return { ok: false as const, error: "حساب فعال نیست.", status: 401 };
    if (patch.sort === "recent" || patch.sort === "unread" || patch.sort === "name" || patch.sort === "favorites") me.chatOrgSort = patch.sort;
    if (typeof patch.archiveUnarchiveOnNew === "boolean") me.archiveUnarchiveOnNew = patch.archiveUnarchiveOnNew;
    if (typeof patch.listShowPreview === "boolean") me.listShowPreview = patch.listShowPreview;
    return {
      ok: true as const,
      prefs: { sort: me.chatOrgSort, archiveUnarchiveOnNew: me.archiveUnarchiveOnNew, listShowPreview: me.listShowPreview },
    };
  });
}

export async function patchInbox(
  userId: string,
  key: string,
  action: string,
  extra: Record<string, unknown> = {},
) {
  const [kindRaw, ...rest] = key.split(":");
  const kind = kindRaw as InboxKind;
  const targetId = rest.join(":");
  if (!["dm", "group", "channel", "community", "bot", "business"].includes(kind) || !targetId) {
    return { ok: false as const, error: "گفتگو نامعتبر است.", status: 400 };
  }

  const snap = await readStoreSnapshot();
  if (!canSeeChat(snap, userId, kind, targetId)) {
    return { ok: false as const, error: "گفتگو در دسترس نیست.", status: 404 };
  }

  if (action === "mute" || action === "unmute") {
    const ms = extra.ms == null ? null : Number(extra.ms);
    const muteType = kind === "dm" ? "chat" : kind === "group" ? "group" : kind === "channel" ? "channel" : kind === "bot" ? "bot" : "chat";
    await muteTarget(userId, muteType, targetId, action === "unmute" || extra.unmute ? 0 : ms);
  }

  return mutateStore((data) => {
    const me = data.users.find((u) => u.id === userId);
    if (!me) return { ok: false as const, error: "حساب فعال نیست.", status: 401 };
    const now = Date.now();
    const meta = getMeta(data, userId, kind, targetId, now);
    if (action === "pin") {
      const pins = data.inboxMetas.filter((m) => m.ownerUserId === userId && m.pinnedAt).length;
      if (!meta.pinnedAt && pins >= INBOX_PIN_MAX) return { ok: false as const, error: `حداکثر ${INBOX_PIN_MAX} پین.`, status: 400 };
      meta.pinnedAt = now;
    } else if (action === "unpin") meta.pinnedAt = null;
    else if (action === "archive") meta.archivedAt = now;
    else if (action === "unarchive") meta.archivedAt = null;
    else if (action === "read") {
      meta.lastReadAt = now;
      meta.markedUnread = false;
    } else if (action === "unread") meta.markedUnread = true;
    else if (action === "favorite") meta.favorite = Boolean(extra.on);
    else if (action === "notes") meta.notesCipher = extra.notes ? encryptText(String(extra.notes).slice(0, 2000)) : "";
    else if (action === "draft") meta.draftCipher = extra.draft ? encryptText(String(extra.draft).slice(0, 2000)) : "";
    else if (action === "labels") meta.labels = Array.isArray(extra.labels) ? extra.labels.map(String).slice(0, 12) : meta.labels;
    else if (action === "delete") {
      meta.hidden = true;
      meta.pinnedAt = null;
      meta.archivedAt = null;
    } else if (action === "clear") {
      if (!extra.confirm) return { ok: false as const, error: "پاک‌سازی نیاز به تأیید دارد.", status: 400 };
      if (kind === "dm") {
        for (const m of data.messages) {
          if (m.threadId === targetId && m.ownerUserId === userId) {
            m.hiddenFor = [...(m.hiddenFor ?? []), userId];
          }
        }
      }
    } else if (action === "mute" || action === "unmute") {
      /* mute applied above */
    } else if (action === "move") {
      const folder = data.chatFolders.find((f) => f.id === extra.folderId && f.ownerUserId === userId);
      if (!folder) return { ok: false as const, error: "پوشه یافت نشد.", status: 404 };
      if (!folder.includeIds.includes(key)) folder.includeIds.push(key);
      folder.excludeIds = folder.excludeIds.filter((id) => id !== key);
    } else return { ok: false as const, error: "عملیات نامعتبر است.", status: 400 };
    meta.updatedAt = now;
    return { ok: true as const };
  });
}

export async function bulkInbox(userId: string, keys: string[], action: string, extra: Record<string, unknown> = {}) {
  if (action === "delete" && !extra.confirm) return { ok: false as const, error: "حذف گروهی نیاز به تأیید دارد.", status: 400 };
  let n = 0;
  for (const key of keys.slice(0, 40)) {
    const r = await patchInbox(userId, key, action, extra);
    if (r.ok) n += 1;
  }
  return { ok: true as const, count: n };
}

export function touchIncoming(data: StoreData, ownerUserId: string, kind: InboxKind, targetId: string, now: number) {
  const owner = data.users.find((u) => u.id === ownerUserId);
  const meta = getMeta(data, ownerUserId, kind, targetId, now);
  if (meta.archivedAt && owner?.archiveUnarchiveOnNew) meta.archivedAt = null;
  meta.updatedAt = now;
}

export { INBOX_PIN_MAX };
