import "server-only";
import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import { randomId, newSalt, hashOtp, otpHashesEqual } from "@/lib/crypto-utils";
import { config } from "@/lib/config";
import { hitRateLimit } from "@/lib/rate-limit";
import { mutateStore, readStoreSnapshot } from "@/lib/store";
import type { GalleryAlbum, GalleryItem, StoreData } from "@/lib/store";
import { sniffMagic } from "@/lib/media";
import { MEDIA_MAX_BYTES } from "@/lib/media";
import { writeGalleryBlob, readGalleryBlob, deleteGalleryBlob } from "@/lib/gallery-files";
import {
  DEFAULT_GALLERY_PREFS,
  GALLERY_CACHE_MAX,
  GALLERY_MAX_BYTES,
  GALLERY_SOFT_MS,
  GALLERY_TOKEN_MS,
  type GalleryKind,
  type GalleryPrefs,
  type GalleryPrivacy,
} from "@/lib/gallery-types";

function prefsOf(data: StoreData, userId: string): GalleryPrefs {
  data.galleryPrefs ??= [];
  let row = data.galleryPrefs.find((p) => p.userId === userId);
  if (!row) {
    row = { userId, ...DEFAULT_GALLERY_PREFS };
    data.galleryPrefs.push(row);
  }
  return row;
}

export function signGalleryMedia(itemId: string, userId: string, exp = Date.now() + GALLERY_TOKEN_MS) {
  const sig = createHmac("sha256", config.pepper).update(`g.${itemId}.${userId}.${exp}`).digest("hex").slice(0, 32);
  return `${exp}.${sig}`;
}

export function verifyGalleryMedia(itemId: string, userId: string, token: string) {
  const [expRaw, sig] = token.split(".");
  const exp = Number(expRaw);
  if (!exp || !sig || Date.now() > exp) return false;
  const expected = signGalleryMedia(itemId, userId, exp);
  try {
    return timingSafeEqual(Buffer.from(expected), Buffer.from(`${exp}.${sig}`));
  } catch {
    return false;
  }
}

function kindFrom(name: string, mime: string): GalleryKind {
  const n = name.toLowerCase();
  if (mime === "image/gif" || n.endsWith(".gif")) return "gif";
  if (mime.startsWith("image/")) return "photo";
  if (mime.startsWith("video/")) return "video";
  if (mime.startsWith("audio/") && /voice|ogg|m4a/.test(n + mime)) return n.includes("voice") ? "voice" : "audio";
  if (mime.startsWith("audio/")) return "audio";
  if (mime === "application/pdf" || /\.(pdf|docx?|xlsx?|pptx?)$/i.test(n)) return "document";
  if (/^https?:\/\//i.test(name)) return "link";
  return "file";
}

function publicItem(item: GalleryItem, userId: string) {
  return {
    id: item.id,
    kind: item.kind,
    name: item.name,
    mime: item.mime,
    size: item.size,
    caption: item.caption,
    privacy: item.privacy,
    sourceChat: item.sourceChat,
    albumIds: item.albumIds,
    cache: item.cache,
    createdAt: item.createdAt,
    deletedAt: item.deletedAt,
    thumb: item.thumb,
    mediaUrl: item.deletedAt ? "" : `/api/gallery/${item.id}/media?t=${signGalleryMedia(item.id, userId)}`,
    duplicateOf: item.duplicateOf,
  };
}

export async function listGallery(
  userId: string,
  opts?: { kind?: GalleryKind | "all"; q?: string; from?: number; to?: number; chat?: string; albumId?: string; trash?: boolean; pin?: string },
) {
  const data = await readStoreSnapshot();
  const prefs = data.galleryPrefs?.find((p) => p.userId === userId) ?? { userId, ...DEFAULT_GALLERY_PREFS };
  if (prefs.lockHash && Date.now() > (prefs.unlockedUntil ?? 0)) {
    if (!opts?.pin) {
      return {
        ok: true as const,
        locked: true,
        items: [] as ReturnType<typeof publicItem>[],
        albums: [] as { id: string; name: string; itemIds: string[]; createdAt: number }[],
        stats: null,
        chats: [] as string[],
        prefs: {
          autoWifi: prefs.autoWifi,
          autoMobile: prefs.autoMobile,
          autoRoaming: prefs.autoRoaming,
          autoSave: prefs.autoSave,
          uploadQuality: prefs.uploadQuality,
          downloadQuality: prefs.downloadQuality,
          lockEnabled: true,
        },
      };
    }
    if (!prefs.lockSalt || !otpHashesEqual(prefs.lockHash, hashOtp(opts.pin, prefs.lockSalt))) {
      return { ok: false as const, error: "قفل گالری نادرست است.", status: 403 };
    }
    await mutateStore((d) => {
      prefsOf(d, userId).unlockedUntil = Date.now() + 15 * 60_000;
    });
  }
  const now = Date.now();
  let items = data.galleryItems.filter((i) => i.ownerUserId === userId);
  if (opts?.trash) items = items.filter((i) => i.deletedAt && now - i.deletedAt < GALLERY_SOFT_MS);
  else items = items.filter((i) => !i.deletedAt);
  if (opts?.kind && opts.kind !== "all") items = items.filter((i) => i.kind === opts.kind);
  if (opts?.q) {
    const n = opts.q.toLowerCase();
    items = items.filter((i) => `${i.name} ${i.caption} ${i.sourceChat}`.toLowerCase().includes(n));
  }
  if (opts?.from) items = items.filter((i) => i.createdAt >= opts.from!);
  if (opts?.to) items = items.filter((i) => i.createdAt <= opts.to!);
  if (opts?.chat) items = items.filter((i) => i.sourceChat === opts.chat);
  if (opts?.albumId) items = items.filter((i) => i.albumIds.includes(opts.albumId!));
  items.sort((a, b) => b.createdAt - a.createdAt);
  const albums = data.galleryAlbums.filter((a) => a.ownerUserId === userId && !a.deletedAt);
  const live = data.galleryItems.filter((i) => i.ownerUserId === userId && !i.deletedAt);
  const stats = {
    photos: live.filter((i) => i.kind === "photo").reduce((n, i) => n + i.size, 0),
    videos: live.filter((i) => i.kind === "video").reduce((n, i) => n + i.size, 0),
    files: live.filter((i) => i.kind === "file" || i.kind === "document").reduce((n, i) => n + i.size, 0),
    documents: live.filter((i) => i.kind === "document").reduce((n, i) => n + i.size, 0),
    cache: live.filter((i) => i.cache).reduce((n, i) => n + i.size, 0),
    total: live.reduce((n, i) => n + i.size, 0),
    count: live.length,
  };
  const chats = [...new Set(live.map((i) => i.sourceChat).filter(Boolean))];
  return {
    ok: true as const,
    locked: false,
    items: items.slice(0, 120).map((i) => publicItem(i, userId)),
    albums: albums.map((a) => ({ id: a.id, name: a.name, itemIds: a.itemIds, createdAt: a.createdAt })),
    stats,
    chats,
    prefs: {
      autoWifi: prefs.autoWifi,
      autoMobile: prefs.autoMobile,
      autoRoaming: prefs.autoRoaming,
      autoSave: prefs.autoSave,
      uploadQuality: prefs.uploadQuality,
      downloadQuality: prefs.downloadQuality,
      lockEnabled: Boolean(prefs.lockHash),
    },
  };
}

export async function listChatMediaIndex(userId: string) {
  const data = await readStoreSnapshot();
  const threads = data.threads.filter((t) => t.ownerUserId === userId);
  const byId = new Map(threads.map((t) => [t.id, t]));
  return data.messages
    .filter((m) => m.ownerUserId === userId && !m.deletedEverywhere && (m.kind === "photo" || m.kind === "video" || m.kind === "file" || m.kind === "voice") && m.blobId)
    .slice(-80)
    .reverse()
    .map((m) => ({
      id: m.id,
      kind: m.kind,
      threadId: m.threadId,
      peerName: byId.get(m.threadId)?.peerName ?? "چت",
      createdAt: m.createdAt,
      size: m.byteLength ?? 0,
      e2ee: true,
    }));
}

export async function addGalleryItem(
  userId: string,
  input: {
    name: string;
    mime?: string;
    dataUrl?: string;
    linkUrl?: string;
    caption?: string;
    privacy?: GalleryPrivacy;
    sourceChat?: string;
    cache?: boolean;
    thumb?: string;
  },
) {
  const name = input.name.trim().slice(0, 120) || "file";
  if (input.linkUrl && /^https?:\/\//i.test(input.linkUrl)) {
    return mutateStore((data) => {
      const item: GalleryItem = {
        id: randomId(),
        ownerUserId: userId,
        kind: "link",
        name,
        mime: "text/uri-list",
        size: input.linkUrl!.length,
        caption: (input.caption ?? "").slice(0, 200),
        privacy: input.privacy === "shared" || input.privacy === "public" ? input.privacy : "private",
        sourceChat: input.sourceChat ?? "",
        albumIds: [],
        cache: false,
        hash: createHash("sha256").update(input.linkUrl!).digest("hex").slice(0, 24),
        thumb: "",
        duplicateOf: null,
        createdAt: Date.now(),
        deletedAt: null,
      };
      data.galleryItems.unshift(item);
      return { ok: true as const, item: publicItem(item, userId) };
    });
  }
  const dataUrl = input.dataUrl ?? "";
  const match = dataUrl.match(/^data:([^;]+);base64,(.+)$/);
  if (!match) return { ok: false as const, error: "رسانه نامعتبر است.", status: 400 };
  let bytes: Buffer;
  try {
    bytes = Buffer.from(match[2]!, "base64");
  } catch {
    return { ok: false as const, error: "رسانه نامعتبر است.", status: 400 };
  }
  if (bytes.length > GALLERY_MAX_BYTES || bytes.length > MEDIA_MAX_BYTES) {
    return { ok: false as const, error: "حجم از سقف گالری بیشتر است.", status: 413 };
  }
  const magic = sniffMagic(bytes);
  if (!magic.ok) return { ok: false as const, error: magic.warning ?? "فایل رد شد.", status: 400 };
  const mime = magic.mime !== "application/octet-stream" ? magic.mime : match[1] || "application/octet-stream";
  const hash = createHash("sha256").update(bytes.subarray(0, Math.min(64, bytes.length))).update(String(bytes.length)).digest("hex").slice(0, 24);
  return mutateStore(async (data) => {
    const flood = hitRateLimit(data, `gal:${userId}`, 60_000, 20);
    if (!flood.allowed) return { ok: false as const, error: "آپلود پیاپی محدود شد.", status: 429 };
    const dup = data.galleryItems.find((i) => i.ownerUserId === userId && i.hash === hash && !i.deletedAt);
    const id = randomId();
    const written = await writeGalleryBlob(userId, id, bytes);
    if (!written.ok) return { ok: false as const, error: written.error, status: 400 };
    const item: GalleryItem = {
      id,
      ownerUserId: userId,
      kind: kindFrom(name, mime),
      name,
      mime,
      size: bytes.length,
      caption: (input.caption ?? "").slice(0, 200),
      privacy: input.privacy === "shared" || input.privacy === "public" ? input.privacy : "private",
      sourceChat: input.sourceChat ?? "",
      albumIds: [],
      cache: Boolean(input.cache),
      hash,
      thumb: typeof input.thumb === "string" && input.thumb.startsWith("data:image/") ? input.thumb.slice(0, 80_000) : "",
      duplicateOf: dup ? dup.id : null,
      createdAt: Date.now(),
      deletedAt: null,
    };
    data.galleryItems.unshift(item);
    const cached = data.galleryItems.filter((i) => i.ownerUserId === userId && i.cache && !i.deletedAt);
    if (cached.length > GALLERY_CACHE_MAX) {
      for (const extra of cached.slice(GALLERY_CACHE_MAX)) extra.deletedAt = Date.now();
    }
    return { ok: true as const, item: publicItem(item, userId), duplicate: Boolean(dup) };
  });
}

export async function getGalleryMedia(userId: string, itemId: string, token: string) {
  const data = await readStoreSnapshot();
  const item = data.galleryItems.find((i) => i.id === itemId);
  if (!item) return { ok: false as const, error: "یافت نشد.", status: 404 };
  if (item.ownerUserId !== userId) return { ok: false as const, error: "اجازه نداری.", status: 403 };
  if (item.deletedAt) return { ok: false as const, error: "حذف شده.", status: 404 };
  const prefs = data.galleryPrefs?.find((p) => p.userId === userId);
  if (prefs?.lockHash && Date.now() > (prefs.unlockedUntil ?? 0)) return { ok: false as const, error: "گالری قفل است.", status: 403 };
  if (!verifyGalleryMedia(itemId, userId, token)) return { ok: false as const, error: "لینک منقضی یا نامعتبر است.", status: 403 };
  const buf = await readGalleryBlob(userId, itemId);
  if (!buf) return { ok: false as const, error: "فایل نیست.", status: 404 };
  return { ok: true as const, bytes: buf, mime: item.mime };
}

export async function trashItems(userId: string, ids: string[], permanent: boolean) {
  return mutateStore(async (data) => {
    const now = Date.now();
    let n = 0;
    for (const id of ids.slice(0, 40)) {
      const item = data.galleryItems.find((i) => i.id === id && i.ownerUserId === userId);
      if (!item) continue;
      if (permanent) {
        item.deletedAt = now;
        data.galleryItems = data.galleryItems.filter((i) => i.id !== id);
        await deleteGalleryBlob(userId, id);
      } else {
        item.deletedAt = now;
      }
      n += 1;
    }
    return { ok: true as const, count: n };
  });
}

export async function setGalleryPrivacy(userId: string, ids: string[], privacy: GalleryPrivacy) {
  return mutateStore((data) => {
    let n = 0;
    for (const id of ids.slice(0, 40)) {
      const item = data.galleryItems.find((i) => i.id === id && i.ownerUserId === userId);
      if (!item) continue;
      item.privacy = privacy;
      n += 1;
    }
    return { ok: true as const, count: n };
  });
}

export async function restoreItems(userId: string, ids: string[]) {
  return mutateStore((data) => {
    let n = 0;
    for (const id of ids.slice(0, 40)) {
      const item = data.galleryItems.find((i) => i.id === id && i.ownerUserId === userId);
      if (!item?.deletedAt) continue;
      item.deletedAt = null;
      n += 1;
    }
    return { ok: true as const, count: n };
  });
}

export async function clearGalleryCache(userId: string) {
  return mutateStore(async (data) => {
    let n = 0;
    for (const item of data.galleryItems.filter((i) => i.ownerUserId === userId && i.cache && !i.deletedAt)) {
      item.deletedAt = Date.now();
      n += 1;
    }
    return { ok: true as const, count: n };
  });
}

export async function saveAlbum(userId: string, input: { id?: string; name: string; itemIds?: string[]; delete?: boolean }) {
  const name = input.name.trim().slice(0, 48);
  return mutateStore((data) => {
    if (input.id && input.delete) {
      const album = data.galleryAlbums.find((a) => a.id === input.id && a.ownerUserId === userId);
      if (!album) return { ok: false as const, error: "آلبوم نیست.", status: 404 };
      album.deletedAt = Date.now();
      return { ok: true as const };
    }
    if (input.id) {
      const album = data.galleryAlbums.find((a) => a.id === input.id && a.ownerUserId === userId && !a.deletedAt);
      if (!album) return { ok: false as const, error: "آلبوم نیست.", status: 404 };
      if (name) album.name = name;
      if (Array.isArray(input.itemIds)) album.itemIds = input.itemIds.slice(0, 80);
      for (const item of data.galleryItems.filter((i) => i.ownerUserId === userId)) {
        item.albumIds = item.albumIds.filter((id) => id !== album.id);
        if (album.itemIds.includes(item.id)) item.albumIds.push(album.id);
      }
      return { ok: true as const, album: { id: album.id, name: album.name, itemIds: album.itemIds } };
    }
    if (name.length < 1) return { ok: false as const, error: "نام آلبوم خالی است.", status: 400 };
    const album: GalleryAlbum = {
      id: randomId(),
      ownerUserId: userId,
      name,
      itemIds: (input.itemIds ?? []).slice(0, 80),
      createdAt: Date.now(),
      deletedAt: null,
    };
    data.galleryAlbums.unshift(album);
    for (const id of album.itemIds) {
      const item = data.galleryItems.find((i) => i.id === id && i.ownerUserId === userId);
      if (item && !item.albumIds.includes(album.id)) item.albumIds.push(album.id);
    }
    return { ok: true as const, album: { id: album.id, name: album.name, itemIds: album.itemIds } };
  });
}

export async function updateGalleryPrefs(
  userId: string,
  patch: Partial<Pick<GalleryPrefs, "autoWifi" | "autoMobile" | "autoRoaming" | "autoSave" | "uploadQuality" | "downloadQuality">> & { lockPin?: string | null },
) {
  return mutateStore((data) => {
    const p = prefsOf(data, userId);
    if (typeof patch.autoWifi === "boolean") p.autoWifi = patch.autoWifi;
    if (typeof patch.autoMobile === "boolean") p.autoMobile = patch.autoMobile;
    if (typeof patch.autoRoaming === "boolean") p.autoRoaming = patch.autoRoaming;
    if (typeof patch.autoSave === "boolean") p.autoSave = patch.autoSave;
    if (patch.uploadQuality === "standard" || patch.uploadQuality === "high" || patch.uploadQuality === "original") p.uploadQuality = patch.uploadQuality;
    if (patch.downloadQuality === "standard" || patch.downloadQuality === "high" || patch.downloadQuality === "original") p.downloadQuality = patch.downloadQuality;
    if (patch.lockPin === "") {
      p.lockHash = null;
      p.lockSalt = null;
      p.unlockedUntil = 0;
    } else if (typeof patch.lockPin === "string" && patch.lockPin.length >= 4) {
      p.lockSalt = newSalt();
      p.lockHash = hashOtp(patch.lockPin.slice(0, 12), p.lockSalt);
      p.unlockedUntil = Date.now() + 15 * 60_000;
    }
    return { ok: true as const };
  });
}

export async function unlockGallery(userId: string, pin: string) {
  return mutateStore((data) => {
    const p = prefsOf(data, userId);
    if (!p.lockHash || !p.lockSalt) return { ok: true as const };
    if (!otpHashesEqual(p.lockHash, hashOtp(pin, p.lockSalt))) return { ok: false as const, error: "پین نادرست است.", status: 403 };
    p.unlockedUntil = Date.now() + 15 * 60_000;
    return { ok: true as const };
  });
}
