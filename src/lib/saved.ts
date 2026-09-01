import "server-only";
import { createHmac, timingSafeEqual } from "node:crypto";
import { decryptText, encryptText, randomId } from "@/lib/crypto-utils";
import { config } from "@/lib/config";
import { canSeeChat } from "@/lib/inbox";
import { hitRateLimit } from "@/lib/rate-limit";
import { mutateStore, readStoreSnapshot } from "@/lib/store";
import type { SavedFolder, SavedItem, StoreData } from "@/lib/store";
import {
  BOOKMARK_PRESETS,
  SAVED_FOLDER_MAX,
  SAVED_KINDS,
  SAVED_MAX_MEDIA,
  SAVED_MEDIA_TOKEN_MS,
  SAVED_NAME_MAX,
  SAVED_PIN_MAX,
  SAVED_TAGS,
  SAVED_TRASH_MS,
  type SavedKind,
  type SavedSort,
} from "@/lib/saved-types";

function ensure(data: StoreData) {
  data.savedItems ??= [];
  data.savedFolders ??= [];
}

function secret(s: string) {
  if (!s) return "";
  try {
    return decryptText(s);
  } catch {
    return "";
  }
}

export function signSavedMedia(id: string, userId: string, exp = Date.now() + SAVED_MEDIA_TOKEN_MS) {
  const sig = createHmac("sha256", config.pepper).update(`saved.${id}.${userId}.${exp}`).digest("hex").slice(0, 32);
  return `${exp}.${sig}`;
}

export function verifySavedMedia(id: string, userId: string, token: string) {
  const [expRaw, sig] = token.split(".");
  const exp = Number(expRaw);
  if (!exp || !sig || Date.now() > exp) return false;
  const expected = signSavedMedia(id, userId, exp);
  const a = Buffer.from(expected);
  const b = Buffer.from(`${exp}.${sig}`);
  return a.length === b.length && timingSafeEqual(a, b);
}

function linkHost(url: string) {
  try {
    const u = new URL(url);
    if (u.protocol !== "http:" && u.protocol !== "https:") return "";
    return u.host;
  } catch {
    return "";
  }
}

export function originalStatus(data: StoreData, userId: string, source: SavedItem["source"]) {
  if (!source || source.type === "manual") {
    return { canOpen: false as const, status: "manual" as const, label: "ذخیرهٔ دستی" };
  }
  if (source.type === "chat") {
    const thread = data.threads.find((t) => t.id === source.id && t.ownerUserId === userId);
    if (!thread) return { canOpen: false as const, status: "no-permission" as const, label: "دسترسی به گفتگوی اصلی نیست" };
    if (!source.messageId) return { canOpen: true as const, status: "ok" as const, label: thread.peerName };
    const msg = data.messages.find((m) => m.id === source.messageId && m.threadId === source.id && m.ownerUserId === userId);
    if (!msg || msg.hiddenFor?.includes(userId) || msg.deletedEverywhere) {
      return { canOpen: false as const, status: "deleted" as const, label: "پیام اصلی حذف شده است" };
    }
    return { canOpen: true as const, status: "ok" as const, label: thread.peerName };
  }
  if (source.type === "group") {
    if (!canSeeChat(data, userId, "group", source.id)) {
      return { canOpen: false as const, status: "no-permission" as const, label: "دیگر به این گروه دسترسی نداری" };
    }
    if (!source.messageId) return { canOpen: true as const, status: "ok" as const, label: source.name };
    const msg = (data.groupMessages ?? []).find((m) => m.id === source.messageId && m.groupId === source.id);
    if (!msg || msg.deleted) return { canOpen: false as const, status: "deleted" as const, label: "پیام اصلی حذف شده است" };
    return { canOpen: true as const, status: "ok" as const, label: source.name };
  }
  if (source.type === "channel") {
    if (!canSeeChat(data, userId, "channel", source.id)) {
      return { canOpen: false as const, status: "no-permission" as const, label: "دیگر به این کانال دسترسی نداری" };
    }
    if (!source.messageId) return { canOpen: true as const, status: "ok" as const, label: source.name };
    const post = (data.channelPosts ?? []).find((p) => p.id === source.messageId && p.channelId === source.id);
    if (!post || post.deleted) return { canOpen: false as const, status: "deleted" as const, label: "پست اصلی حذف شده است" };
    return { canOpen: true as const, status: "ok" as const, label: source.name };
  }
  if (source.type === "community") {
    if (!canSeeChat(data, userId, "community", source.id)) {
      return { canOpen: false as const, status: "no-permission" as const, label: "دیگر به این جامعه دسترسی نداری" };
    }
    return { canOpen: true as const, status: "ok" as const, label: source.name };
  }
  return { canOpen: false as const, status: "no-permission" as const, label: "نامشخص" };
}

function publicSaved(data: StoreData, userId: string, item: SavedItem) {
  const body = item.bodyCipher ? secret(item.bodyCipher) : item.body;
  const notes = secret(item.notesCipher);
  const media = item.mediaCipher ? secret(item.mediaCipher) : item.media;
  const orig = originalStatus(data, userId, item.source);
  const sourceName = orig.status === "no-permission" ? "گفتگوی خصوصی" : orig.label;
  return {
    id: item.id,
    kind: item.kind,
    body,
    notes,
    linkUrl: item.linkUrl,
    linkHost: item.linkUrl ? linkHost(item.linkUrl) : "",
    fileName: item.fileName,
    fileType: item.fileType,
    fileSize: item.fileSize,
    hasMedia: Boolean(media),
    mediaUrl: media ? `/api/saved/${item.id}/media?t=${signSavedMedia(item.id, userId)}` : "",
    tag: item.tag,
    tags: item.tags,
    folderId: item.folderId,
    bookmarked: item.bookmarked,
    favorite: item.favorite,
    pinned: item.pinned,
    source: item.source
      ? {
          type: item.source.type,
          id: orig.canOpen ? item.source.id : "",
          name: sourceName,
          messageId: orig.canOpen ? item.source.messageId : undefined,
        }
      : null,
    original: orig,
    createdAt: item.createdAt,
    updatedAt: item.updatedAt,
    inTrash: Boolean(item.deletedAt),
    copyrightNote: "ذخیره مالکیت محتوا را منتقل نمی‌کند و Forward طبق سیاست حق نشر نیکسو است.",
  };
}

function sweepTrash(data: StoreData, userId: string, now: number) {
  for (const s of data.savedItems) {
    if (s.ownerUserId !== userId || s.purgedAt) continue;
    if (s.deletedAt && now - s.deletedAt > SAVED_TRASH_MS) s.purgedAt = now;
  }
}

function parseKind(raw: unknown): SavedKind | null {
  const k = String(raw ?? "");
  return (SAVED_KINDS as readonly string[]).includes(k) ? (k as SavedKind) : null;
}

function viewMatch(view: string, item: SavedItem) {
  if (view === "all" || !view) return true;
  if (view === "media") return ["photo", "video", "audio", "voice", "sticker"].includes(item.kind);
  if (view === "bookmarks") return item.bookmarked;
  if (view === "trash") return Boolean(item.deletedAt);
  return item.kind === view;
}

export async function listSaved(
  userId: string,
  opts?: {
    q?: string;
    kind?: string;
    tag?: string;
    folder?: string;
    chatId?: string;
    fromDate?: number;
    toDate?: number;
    sort?: SavedSort;
    trash?: boolean;
    offset?: number;
    limit?: number;
  },
) {
  return mutateStore((data) => {
    ensure(data);
    const now = Date.now();
    const flood = hitRateLimit(data, `saved-list:${userId}`, 60_000, 80, now);
    if (!flood.allowed) {
      return {
        ok: false as const,
        error: "جستجو محدود شد.",
        status: 429,
        items: [],
        hasMore: false,
        nextOffset: 0,
        folders: [],
        storageBytes: 0,
        pinMax: SAVED_PIN_MAX,
        trashDays: 14,
      };
    }
    sweepTrash(data, userId, now);
    const q = (opts?.q ?? "").trim().toLowerCase();
    const offset = Math.max(0, opts?.offset ?? 0);
    const limit = Math.min(50, Math.max(1, opts?.limit ?? 40));
    const trash = Boolean(opts?.trash) || opts?.kind === "trash";
    const sort: SavedSort =
      opts?.sort === "oldest" || opts?.sort === "saved" || opts?.sort === "type" || opts?.sort === "chat" ? opts.sort : "newest";
    let items = data.savedItems.filter((s) => s.ownerUserId === userId && !s.purgedAt);
    items = items.filter((s) => (trash ? Boolean(s.deletedAt) : !s.deletedAt));
    items = items.filter((s) => viewMatch(opts?.kind ?? "all", s));
    if (opts?.tag) items = items.filter((s) => s.tag === opts.tag || s.tags.includes(opts.tag!));
    if (opts?.folder) {
      const preset = BOOKMARK_PRESETS.find((p) => p.id === opts.folder);
      items = items.filter(
        (s) => s.folderId === opts.folder || (preset && (s.tag === preset.name || s.tags.includes(preset.name))),
      );
    }
    if (opts?.chatId) items = items.filter((s) => s.source?.id === opts.chatId);
    if (opts?.fromDate) items = items.filter((s) => s.createdAt >= Number(opts.fromDate));
    if (opts?.toDate) items = items.filter((s) => s.createdAt <= Number(opts.toDate));
    if (q) {
      items = items.filter((s) => {
        const body = s.bodyCipher ? secret(s.bodyCipher) : s.body;
        const notes = secret(s.notesCipher);
        return `${body} ${notes} ${s.linkUrl} ${s.fileName} ${s.tag} ${s.tags.join(" ")} ${s.kind}`.toLowerCase().includes(q);
      });
    }
    items.sort((a, b) => {
      if (a.pinned !== b.pinned) return a.pinned ? -1 : 1;
      if (sort === "oldest") return a.createdAt - b.createdAt;
      if (sort === "type") return a.kind.localeCompare(b.kind) || b.createdAt - a.createdAt;
      if (sort === "chat") return (a.source?.name ?? "").localeCompare(b.source?.name ?? "", "fa") || b.createdAt - a.createdAt;
      return b.createdAt - a.createdAt;
    });
    const folders = [
      ...BOOKMARK_PRESETS.map((p, i) => ({
        id: p.id,
        name: p.name,
        icon: p.icon,
        builtin: true,
        sort: i,
      })),
      ...data.savedFolders
        .filter((f) => f.ownerUserId === userId)
        .sort((a, b) => a.sort - b.sort)
        .map((f) => ({ id: f.id, name: f.name, icon: f.icon, builtin: false, sort: f.sort })),
    ];
    const bytes = data.savedItems
      .filter((s) => s.ownerUserId === userId && !s.purgedAt && !s.deletedAt)
      .reduce((n, s) => n + (s.fileSize || (s.mediaCipher || s.media).length), 0);
    return {
      ok: true as const,
      items: items.slice(offset, offset + limit).map((s) => publicSaved(data, userId, s)),
      hasMore: offset + limit < items.length,
      nextOffset: offset + Math.min(limit, items.length - offset),
      folders,
      storageBytes: bytes,
      pinMax: SAVED_PIN_MAX,
      trashDays: 14,
    };
  });
}

export async function saveItem(
  userId: string,
  input: Partial<SavedItem> & { kind: SavedKind; notes?: string; bookmark?: boolean },
) {
  return mutateStore((data) => {
    ensure(data);
    const now = Date.now();
    const flood = hitRateLimit(data, `saved:${userId}`, 60_000, 40, now);
    if (!flood.allowed) return { ok: false as const, error: "ذخیره محدود شد.", status: 429 };
    const media = typeof input.media === "string" ? input.media : "";
    if (media.length > SAVED_MAX_MEDIA) return { ok: false as const, error: "حجم رسانه زیاد است.", status: 413 };
    const kind = parseKind(input.kind) ?? "text";
    const tag = SAVED_TAGS.includes(input.tag as (typeof SAVED_TAGS)[number]) ? (input.tag as string) : (input.tag ?? "").slice(0, 24);
    const body = (input.body ?? "").slice(0, 2000);
    const notes = (input.notes ?? "").slice(0, 2000);
    const item: SavedItem = {
      id: randomId(),
      ownerUserId: userId,
      kind,
      body: "",
      bodyCipher: body ? encryptText(body) : "",
      notesCipher: notes ? encryptText(notes) : "",
      linkUrl: /^https?:\/\//i.test(input.linkUrl ?? "") ? (input.linkUrl ?? "").slice(0, 400) : "",
      fileName: (input.fileName ?? "").slice(0, 120),
      fileType: (input.fileType ?? "").slice(0, 40),
      fileSize: Math.max(0, Number(input.fileSize) || 0),
      media: "",
      mediaCipher: media ? encryptText(media) : "",
      tag,
      tags: Array.isArray(input.tags) ? input.tags.map(String).slice(0, 12) : tag ? [tag] : [],
      folderId: input.folderId ?? null,
      bookmarked: Boolean(input.bookmark ?? input.bookmarked),
      favorite: Boolean(input.favorite),
      pinned: Boolean(input.pinned),
      source: input.source ?? null,
      createdAt: now,
      updatedAt: now,
      deviceStamp: "",
      deletedAt: null,
      purgedAt: null,
    };
    if (item.pinned) {
      const pins = data.savedItems.filter((s) => s.ownerUserId === userId && s.pinned && !s.deletedAt && !s.purgedAt).length;
      if (pins >= SAVED_PIN_MAX) item.pinned = false;
    }
    data.savedItems.push(item);
    return { ok: true as const, item: publicSaved(data, userId, item) };
  });
}

export async function patchSaved(userId: string, id: string, patch: Record<string, unknown>) {
  return mutateStore((data) => {
    ensure(data);
    const item = data.savedItems.find((s) => s.id === id && s.ownerUserId === userId && !s.purgedAt);
    if (!item) return { ok: false as const, error: "یافت نشد.", status: 404 };
    if (!patch.force && typeof patch.updatedAt === "number" && patch.updatedAt < item.updatedAt) {
      return { ok: false as const, error: "تداخل همگام‌سازی.", status: 409, item: publicSaved(data, userId, item) };
    }
    if (typeof patch.tag === "string") {
      item.tag = patch.tag.slice(0, 24);
      if (!item.tags.includes(item.tag) && item.tag) item.tags = [...item.tags, item.tag].slice(0, 12);
    }
    if (Array.isArray(patch.tags)) item.tags = patch.tags.map(String).slice(0, 12);
    if (typeof patch.pinned === "boolean") {
      if (patch.pinned) {
        const pins = data.savedItems.filter((s) => s.ownerUserId === userId && s.pinned && !s.deletedAt && s.id !== id).length;
        if (pins >= SAVED_PIN_MAX) return { ok: false as const, error: `حداکثر ${SAVED_PIN_MAX} پین.`, status: 400 };
      }
      item.pinned = patch.pinned;
    }
    if (typeof patch.favorite === "boolean") item.favorite = patch.favorite;
    if (typeof patch.bookmarked === "boolean") item.bookmarked = patch.bookmarked;
    if (typeof patch.folderId === "string" || patch.folderId === null) {
      const fid = patch.folderId ? String(patch.folderId) : null;
      if (fid && !BOOKMARK_PRESETS.some((p) => p.id === fid) && !data.savedFolders.some((f) => f.id === fid && f.ownerUserId === userId)) {
        return { ok: false as const, error: "پوشه یافت نشد.", status: 404 };
      }
      item.folderId = fid;
      if (fid) item.bookmarked = true;
    }
    if (typeof patch.notes === "string") item.notesCipher = patch.notes ? encryptText(patch.notes.slice(0, 2000)) : "";
    item.updatedAt = Date.now();
    item.deviceStamp = String(patch.deviceStamp ?? "").slice(0, 80);
    return { ok: true as const, item: publicSaved(data, userId, item) };
  });
}

export async function deleteSaved(userId: string, ids: string[], mode: "trash" | "permanent" = "trash") {
  return mutateStore((data) => {
    ensure(data);
    const now = Date.now();
    let n = 0;
    for (const id of ids.slice(0, 80)) {
      const item = data.savedItems.find((s) => s.id === id && s.ownerUserId === userId && !s.purgedAt);
      if (!item) continue;
      if (mode === "permanent") item.purgedAt = now;
      else item.deletedAt = now;
      item.updatedAt = now;
      n += 1;
    }
    return { ok: true as const, removed: n, originalKept: true };
  });
}

export async function restoreSaved(userId: string, ids: string[]) {
  return mutateStore((data) => {
    const now = Date.now();
    let n = 0;
    for (const id of ids.slice(0, 80)) {
      const item = data.savedItems.find((s) => s.id === id && s.ownerUserId === userId && !s.purgedAt);
      if (!item) continue;
      item.deletedAt = null;
      item.updatedAt = now;
      n += 1;
    }
    return { ok: true as const, restored: n };
  });
}

export async function deleteAllSaved(userId: string, confirm: string) {
  if (confirm !== "حذف همه") return { ok: false as const, error: "عبارت تأیید نادرست است.", status: 400 };
  return mutateStore((data) => {
    const now = Date.now();
    let n = 0;
    for (const s of data.savedItems) {
      if (s.ownerUserId !== userId || s.purgedAt) continue;
      s.deletedAt = now;
      n += 1;
    }
    return { ok: true as const, removed: n };
  });
}

export async function getSaved(userId: string, id: string) {
  const data = await readStoreSnapshot();
  const item = data.savedItems.find((s) => s.id === id && s.ownerUserId === userId && !s.purgedAt);
  if (!item) return null;
  return publicSaved(data, userId, item);
}

export async function readSavedMedia(userId: string, id: string) {
  const data = await readStoreSnapshot();
  const item = data.savedItems.find((s) => s.id === id && s.ownerUserId === userId && !s.purgedAt && !s.deletedAt);
  if (!item) return null;
  const media = item.mediaCipher ? secret(item.mediaCipher) : item.media;
  return media || null;
}

export async function saveFolder(userId: string, patch: Record<string, unknown>) {
  return mutateStore((data) => {
    ensure(data);
    const now = Date.now();
    const flood = hitRateLimit(data, `saved-folder:${userId}`, 60_000, 20, now);
    if (!flood.allowed) return { ok: false as const, error: "ذخیره پوشه محدود شد.", status: 429 };
    const name = String(patch.name ?? "").trim().slice(0, SAVED_NAME_MAX);
    if (patch.id) {
      if (BOOKMARK_PRESETS.some((p) => p.id === patch.id)) return { ok: false as const, error: "پوشهٔ آماده تغییر نام ندارد.", status: 400 };
      const row = data.savedFolders.find((f) => f.id === patch.id && f.ownerUserId === userId);
      if (!row) return { ok: false as const, error: "پوشه یافت نشد.", status: 404 };
      if (!patch.force && typeof patch.updatedAt === "number" && patch.updatedAt < row.updatedAt) {
        return { ok: false as const, error: "تداخل همگام‌سازی پوشه.", status: 409 };
      }
      if (name) row.name = name;
      if (typeof patch.icon === "string") row.icon = patch.icon.slice(0, 8);
      row.updatedAt = now;
      return { ok: true as const, folder: row };
    }
    if (!name || name === "." || name === "..") return { ok: false as const, error: "نام پوشه نامعتبر است.", status: 400 };
    const mine = data.savedFolders.filter((f) => f.ownerUserId === userId);
    if (mine.length >= SAVED_FOLDER_MAX) return { ok: false as const, error: "سقف پوشه پر است.", status: 400 };
    const row: SavedFolder = {
      id: randomId(),
      ownerUserId: userId,
      name,
      icon: typeof patch.icon === "string" ? patch.icon.slice(0, 8) : "📁",
      sort: mine.length + 10,
      updatedAt: now,
      deviceStamp: "",
    };
    data.savedFolders.push(row);
    return { ok: true as const, folder: row };
  });
}

export async function deleteFolder(userId: string, folderId: string) {
  return mutateStore((data) => {
    if (BOOKMARK_PRESETS.some((p) => p.id === folderId)) return { ok: false as const, error: "پوشهٔ آماده حذف نمی‌شود.", status: 400 };
    const before = data.savedFolders.length;
    data.savedFolders = (data.savedFolders ?? []).filter((f) => !(f.id === folderId && f.ownerUserId === userId));
    if (data.savedFolders.length === before) return { ok: false as const, error: "پوشه یافت نشد.", status: 404 };
    for (const s of data.savedItems) {
      if (s.ownerUserId === userId && s.folderId === folderId) s.folderId = null;
    }
    return { ok: true as const, itemsKept: true };
  });
}

export async function bulkMove(userId: string, ids: string[], folderId: string | null) {
  let n = 0;
  for (const id of ids.slice(0, 40)) {
    const r = await patchSaved(userId, id, { folderId, bookmarked: true });
    if (r.ok) n += 1;
  }
  return { ok: true as const, count: n };
}

export async function exportSaved(userId: string) {
  let page = await listSaved(userId, { limit: 50, offset: 0 });
  if (!page.ok) return { ok: false as const, error: page.error, status: page.status };
  const all = [...page.items];
  while (page.hasMore && all.length < 500) {
    const next = await listSaved(userId, { limit: 50, offset: page.nextOffset });
    if (!next.ok) break;
    all.push(...next.items);
    page = next;
  }
  return {
    ok: true as const,
    bundle: {
      exportedAt: Date.now(),
      items: all.map((i) => ({
        kind: i.kind,
        body: i.body,
        notes: i.notes,
        linkUrl: i.linkUrl,
        fileName: i.fileName,
        tag: i.tag,
        tags: i.tags,
        bookmarked: i.bookmarked,
        favorite: i.favorite,
      })),
    },
  };
}

export async function restoreBackup(userId: string, bundle: { items?: unknown[] }) {
  const rows = Array.isArray(bundle.items) ? bundle.items : [];
  let n = 0;
  for (const raw of rows.slice(0, 400)) {
    const row = raw as Record<string, unknown>;
    const kind = parseKind(row.kind) ?? "text";
    const r = await saveItem(userId, {
      kind,
      body: String(row.body ?? ""),
      notes: String(row.notes ?? ""),
      linkUrl: String(row.linkUrl ?? ""),
      fileName: String(row.fileName ?? ""),
      tag: String(row.tag ?? ""),
      tags: Array.isArray(row.tags) ? row.tags.map(String) : [],
      bookmarked: Boolean(row.bookmarked),
      favorite: Boolean(row.favorite),
    });
    if (r.ok) n += 1;
  }
  return { ok: true as const, restored: n };
}

export async function reportSaved(userId: string, id: string, category: string) {
  return mutateStore((data) => {
    const item = data.savedItems.find((s) => s.id === id && s.ownerUserId === userId && !s.purgedAt);
    if (!item) return { ok: false as const, error: "یافت نشد.", status: 404 };
    const flood = hitRateLimit(data, `report:${userId}`, 60 * 60 * 1000, 8);
    if (!flood.allowed) return { ok: false as const, error: "تعداد گزارش در این ساعت به سقف رسیده است.", status: 429 };
    const cat =
      category === "spam" || category === "abuse" || category === "fake" || category === "harassment" ? category : "other";
    data.reports.push({
      id: randomId(),
      reporterId: userId,
      targetKind: "user",
      targetKey: userId,
      messageIds: [id],
      category: cat,
      details: `saved:${id} copyright-or-abuse`,
      createdAt: Date.now(),
    });
    return { ok: true as const };
  });
}

export { SAVED_TAGS, SAVED_MAX_MEDIA };
