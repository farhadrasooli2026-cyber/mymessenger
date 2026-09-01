import "server-only";
import { createHash } from "node:crypto";
import { randomId } from "@/lib/crypto-utils";
import { hitRateLimit } from "@/lib/rate-limit";
import { mutateStore, readStoreSnapshot } from "@/lib/store";
import type { StoreData } from "@/lib/store";
import { FILE_DL_PER_MIN, FILE_SEARCH_PER_MIN, FILE_SEND_PER_MIN } from "@/lib/files";

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
  },
) {
  const gated = await gateFileSearch(userId);
  if (!gated.ok) return gated;
  const { listGallery } = await import("@/lib/gallery");
  const kinds: Array<"document" | "file" | "audio"> =
    opts.type === "document" || opts.type === "file" || opts.type === "audio" ? [opts.type] : ["document", "file", "audio"];
  const pages = await Promise.all(kinds.map((kind) => listGallery(userId, { kind, q: opts.q, from: opts.from, to: opts.to, chat: opts.chat })));
  const failed = pages.find((p) => !p.ok);
  if (failed && !failed.ok) return failed;
  let items = pages.flatMap((p) => (p.ok ? p.items : []));
  const seen = new Set<string>();
  items = items.filter((i) => {
    if (seen.has(i.id)) return false;
    seen.add(i.id);
    return true;
  });
  if (opts.type && opts.type !== "all") {
    const t = opts.type.toLowerCase();
    items = items.filter((i) => i.kind === t || i.mime.toLowerCase().includes(t) || i.name.toLowerCase().endsWith(`.${t}`));
  }
  if (typeof opts.minSize === "number") items = items.filter((i) => i.size >= opts.minSize!);
  if (typeof opts.maxSize === "number") items = items.filter((i) => i.size <= opts.maxSize!);
  const { sortFiles } = await import("@/lib/files");
  const sort = opts.sort === "oldest" || opts.sort === "name" || opts.sort === "size" || opts.sort === "type" ? opts.sort : "newest";
  items = sortFiles(items, sort);
  const offset = Math.max(0, opts.offset ?? 0);
  const page = items.slice(offset, offset + 40);
  const okPage = pages.find((p) => p.ok);
  return {
    ok: true as const,
    items: page,
    total: items.length,
    offset,
    stats: okPage && okPage.ok ? okPage.stats : null,
    prefs: okPage && okPage.ok ? okPage.prefs : null,
    recent: items.slice(0, 12),
  };
}
