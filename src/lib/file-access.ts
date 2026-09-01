import "server-only";
import { createHash } from "node:crypto";
import { randomId } from "@/lib/crypto-utils";
import { hitRateLimit } from "@/lib/rate-limit";
import { mutateStore } from "@/lib/store";
import type { StoreData } from "@/lib/store";
import { FILE_BW_PER_MIN, FILE_DL_PER_MIN, FILE_SEARCH_PER_MIN, FILE_SEND_PER_MIN } from "@/lib/files";

function ensureLogs(data: StoreData) {
  data.fileAccessLogs ??= [];
}

export function logFileAccess(data: StoreData, userId: string, action: string, target: string) {
  ensureLogs(data);
  data.fileAccessLogs.unshift({
    id: randomId(),
    userId,
    action,
    target: target.slice(0, 80),
    at: Date.now(),
  });
  data.fileAccessLogs = data.fileAccessLogs.slice(0, 400);
}

export async function gateFileUpload(userId: string) {
  return mutateStore((data) => {
    const hit = hitRateLimit(data, `file:up:${userId}`, 60_000, FILE_SEND_PER_MIN * 4);
    if (!hit.allowed) return { ok: false as const, error: "آپلود فایل پیاپی محدود شد.", status: 429 };
    logFileAccess(data, userId, "upload-chunk", "blob");
    return { ok: true as const };
  });
}

export async function gateFileDownload(userId: string, blobId: string) {
  return mutateStore((data) => {
    const hit = hitRateLimit(data, `file:dl:${userId}`, 60_000, FILE_DL_PER_MIN);
    if (!hit.allowed) return { ok: false as const, error: "دانلود فایل پیاپی محدود شد.", status: 429 };
    const bw = hitRateLimit(data, `file:bw:${userId}`, 60_000, FILE_BW_PER_MIN);
    if (!bw.allowed) return { ok: false as const, error: "مصرف پهنای باند محدود شد.", status: 429 };
    logFileAccess(data, userId, "download-chunk", blobId);
    return { ok: true as const };
  });
}

export async function gateFileSearch(userId: string) {
  return mutateStore((data) => {
    const hit = hitRateLimit(data, `file:search:${userId}`, 60_000, FILE_SEARCH_PER_MIN);
    if (!hit.allowed) return { ok: false as const, error: "جستجوی فایل محدود شد.", status: 429 };
    return { ok: true as const };
  });
}

export function fileContentHash(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes.subarray(0, Math.min(bytes.length, 256 * 1024))).update(String(bytes.length)).digest("hex");
}

export async function listFileIndex(
  userId: string,
  opts: {
    q?: string;
    type?: string;
    chat?: string;
    minSize?: number;
    maxSize?: number;
    from?: number;
    to?: number;
    sort?: string;
    offset?: number;
    cursor?: string;
    sender?: string;
  },
) {
  const gated = await gateFileSearch(userId);
  if (!gated.ok) return gated;
  const { listGallery } = await import("@/lib/gallery");
  const kind =
    opts.type === "photo" ||
    opts.type === "video" ||
    opts.type === "audio" ||
    opts.type === "document" ||
    opts.type === "file" ||
    opts.type === "voice" ||
    opts.type === "gif"
      ? opts.type
      : "all";
  const listed = await listGallery(userId, {
    kind,
    q: opts.q,
    from: opts.from,
    to: opts.to,
    chat: opts.chat,
    sender: opts.sender,
    cursor: opts.cursor,
    limit: opts.cursor ? 40 : 400,
  });
  if (!listed.ok) return listed;
  let items = listed.items;
  if (opts.type && opts.type !== "all" && kind === "all") {
    const t = opts.type.toLowerCase();
    items = items.filter((i) => i.kind === t || i.mime.toLowerCase().includes(t) || i.name.toLowerCase().endsWith(`.${t}`));
  }
  if (typeof opts.minSize === "number") items = items.filter((i) => i.size >= opts.minSize!);
  if (typeof opts.maxSize === "number") items = items.filter((i) => i.size <= opts.maxSize!);
  const { sortFiles } = await import("@/lib/files");
  const sort = opts.sort === "oldest" || opts.sort === "name" || opts.sort === "size" || opts.sort === "type" ? opts.sort : "newest";
  items = sortFiles(items, sort);
  const { encodeMediaCursor } = await import("@/lib/media-share");
  const offset = Math.max(0, opts.offset ?? 0);
  const sliced = opts.cursor ? items.slice(0, 40) : items.slice(offset, offset + 40);
  const last = sliced[sliced.length - 1];
  return {
    ok: true as const,
    items: sliced,
    total: listed.stats?.count ?? items.length,
    offset,
    nextCursor: listed.nextCursor ?? (items.length > sliced.length && last ? encodeMediaCursor(last.createdAt, last.id) : null),
    stats: listed.stats,
    prefs: listed.prefs,
    recent: items.slice(0, 12),
  };
}
