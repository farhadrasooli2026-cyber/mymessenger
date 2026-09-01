import { collate } from "@/lib/i18n/collate";

export const FILE_MAX_BYTES = 28 * 1024 * 1024;
export const IMAGE_MAX_BYTES = 8 * 1024 * 1024;
export const AUDIO_MAX_BYTES = 12 * 1024 * 1024;
export const DOCUMENT_MAX_BYTES = 20 * 1024 * 1024;
export const VIDEO_MAX_BYTES = FILE_MAX_BYTES;
export const FILE_SEND_PER_MIN = 12;
export const FILE_DL_PER_MIN = 80;
export const FILE_SEARCH_PER_MIN = 40;
export const FILE_BW_PER_MIN = 160;

export type FileKind = "image" | "video" | "audio" | "document" | "archive" | "text" | "unknown";

export function maxBytesForKind(kind: FileKind): number {
  switch (kind) {
    case "image":
      return IMAGE_MAX_BYTES;
    case "audio":
      return AUDIO_MAX_BYTES;
    case "document":
    case "text":
      return DOCUMENT_MAX_BYTES;
    case "video":
      return VIDEO_MAX_BYTES;
    default:
      return FILE_MAX_BYTES;
  }
}

export function guessKindFromName(name: string, mime = ""): FileKind {
  const ext = extOf(name);
  const m = mime.toLowerCase();
  if (m.startsWith("image/") || ["jpg", "jpeg", "png", "webp", "gif", "heic"].includes(ext)) return "image";
  if (m.startsWith("video/") || ["mp4", "webm", "mov", "m4v"].includes(ext)) return "video";
  if (m.startsWith("audio/") || ["mp3", "m4a", "ogg", "wav", "flac"].includes(ext)) return "audio";
  if (["pdf", "doc", "docx", "xls", "xlsx", "ppt", "pptx", "txt", "csv"].includes(ext) || m.includes("pdf") || m.includes("word") || m.includes("sheet") || m.includes("presentation")) {
    return "document";
  }
  if (["zip", "rar", "7z"].includes(ext) || m.includes("zip") || m.includes("rar") || m.includes("7z")) return "archive";
  if (m.startsWith("text/")) return "text";
  return "unknown";
}
export const ZIP_MAX_ENTRIES = 2_000;
export const ZIP_MAX_UNCOMPRESSED = 180 * 1024 * 1024;

const DANGEROUS_EXT = new Set([
  "exe", "bat", "cmd", "com", "scr", "pif", "msi", "dll", "js", "mjs", "vbs", "ps1", "apk", "html", "htm", "svg", "jar",
  "hta", "wsf", "cpl", "reg", "lnk",
]);

const ALLOWED_EXT = new Set([
  "jpg", "jpeg", "png", "webp", "gif", "heic",
  "mp4", "webm", "mov", "m4v",
  "mp3", "m4a", "ogg", "wav", "flac",
  "pdf", "zip", "rar", "7z",
  "doc", "docx", "xls", "xlsx", "ppt", "pptx",
  "txt", "csv",
]);

export function extOf(name: string): string {
  const base = name.split(/[/\\]/).pop() ?? name;
  const i = base.lastIndexOf(".");
  return i >= 0 ? base.slice(i + 1).toLowerCase() : "";
}

/** Strip path traversal and control characters. Local rename only. */
export function sanitizeFileName(name: string): string {
  const base = name.replace(/\\/g, "/").split("/").pop() ?? "file";
  const cleaned = base.replace(/[\u0000-\u001f<>:"|?*]/g, "_").replace(/^\.+/, "").slice(0, 180);
  return cleaned || "nixo-file";
}

export type FileSniff = { ok: boolean; mime: string; kind: "image" | "video" | "audio" | "document" | "archive" | "text" | "unknown"; error?: string };

function isBlockedExecutable(bytes: Uint8Array): boolean {
  if (bytes.length >= 2 && bytes[0] === 0x4d && bytes[1] === 0x5a) return true;
  if (bytes.length >= 4 && bytes[0] === 0x7f && bytes[1] === 0x45 && bytes[2] === 0x4c && bytes[3] === 0x46) return true;
  if (bytes.length >= 4 && bytes[0] === 0xca && bytes[1] === 0xfe && bytes[2] === 0xba && bytes[3] === 0xbe) return true;
  if (bytes.length >= 4 && bytes[0] === 0xcf && bytes[1] === 0xfa && bytes[2] === 0xed && bytes[3] === 0xfe) return true;
  return false;
}

/** JPEG APP1 (EXIF) را حذف می‌کند تا GPS و مدل دوربین بدون رضایت لو نرود. */
export function stripJpegExif(buf: Buffer): Buffer {
  if (buf.length < 4 || buf[0] !== 0xff || buf[1] !== 0xd8) return buf;
  const out: number[] = [0xff, 0xd8];
  let i = 2;
  while (i + 3 < buf.length) {
    if (buf[i] !== 0xff) {
      out.push(...buf.subarray(i));
      break;
    }
    const marker = buf[i + 1]!;
    if (marker === 0xda) {
      out.push(...buf.subarray(i));
      break;
    }
    if (marker === 0xd9) {
      out.push(0xff, 0xd9);
      break;
    }
    if (marker === 0xd8) {
      i += 2;
      continue;
    }
    if (marker === 0x00 || marker === 0xd0 || marker === 0xd1 || marker === 0xd2 || marker === 0xd3 || marker === 0xd4 || marker === 0xd5 || marker === 0xd6 || marker === 0xd7) {
      out.push(0xff, marker);
      i += 2;
      continue;
    }
    if (i + 4 > buf.length) {
      out.push(...buf.subarray(i));
      break;
    }
    const len = buf.readUInt16BE(i + 2);
    const next = i + 2 + len;
    if (next > buf.length || len < 2) {
      out.push(...buf.subarray(i));
      break;
    }
    if (marker === 0xe1) {
      i = next;
      continue;
    }
    out.push(...buf.subarray(i, next));
    i = next;
  }
  return Buffer.from(out);
}

export function sniffFileBytes(bytes: Uint8Array): FileSniff {
  if (bytes.length < 8) return { ok: false, mime: "application/octet-stream", kind: "unknown", error: "فایل ناقص است." };
  if (isBlockedExecutable(bytes)) {
    return { ok: false, mime: "application/octet-stream", kind: "unknown", error: "فایل اجرایی طبق سیاست امنیتی رد شد." };
  }
  const ascii = String.fromCharCode(...Array.from(bytes.slice(0, Math.min(64, bytes.length))));
  if (/^\s*</.test(ascii) || /<script/i.test(ascii)) {
    return { ok: false, mime: "text/html", kind: "unknown", error: "HTML/اسکریپت به‌عنوان فایل پذیرفته نمی‌شود." };
  }
  if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return { ok: true, mime: "image/jpeg", kind: "image" };
  if (bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47) return { ok: true, mime: "image/png", kind: "image" };
  if (ascii.startsWith("GIF8")) return { ok: true, mime: "image/gif", kind: "image" };
  if (ascii.startsWith("RIFF") && ascii.slice(8, 12) === "WEBP") return { ok: true, mime: "image/webp", kind: "image" };
  if (ascii.startsWith("%PDF")) return { ok: true, mime: "application/pdf", kind: "document" };
  if (bytes[0] === 0xd0 && bytes[1] === 0xcf && bytes[2] === 0x11 && bytes[3] === 0xe0) {
    return { ok: true, mime: "application/msword", kind: "document" };
  }
  if (ascii.startsWith("Rar!\u001a\u0007") || (bytes[0] === 0x52 && bytes[1] === 0x61 && bytes[2] === 0x72 && bytes[3] === 0x21)) {
    return { ok: true, mime: "application/vnd.rar", kind: "archive" };
  }
  if (bytes[0] === 0x37 && bytes[1] === 0x7a && bytes[2] === 0xbc && bytes[3] === 0xaf) {
    return { ok: true, mime: "application/x-7z-compressed", kind: "archive" };
  }
  if (bytes[0] === 0x50 && bytes[1] === 0x4b) {
    const zip = inspectZipSafety(bytes);
    if (!zip.ok) return { ok: false, mime: "application/zip", kind: "archive", error: zip.error };
    const inner = ascii.slice(0, 64).toLowerCase();
    if (inner.includes("word/") || looksLikeOffice(bytes, "word/")) return { ok: true, mime: "application/vnd.openxmlformats-officedocument.wordprocessingml.document", kind: "document" };
    if (looksLikeOffice(bytes, "xl/")) return { ok: true, mime: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", kind: "document" };
    if (looksLikeOffice(bytes, "ppt/")) return { ok: true, mime: "application/vnd.openxmlformats-officedocument.presentationml.presentation", kind: "document" };
    return { ok: true, mime: "application/zip", kind: "archive" };
  }
  if (ascii.includes("ftyp")) return { ok: true, mime: "video/mp4", kind: "video" };
  if (bytes[0] === 0x1a && bytes[1] === 0x45 && bytes[2] === 0xdf) return { ok: true, mime: "video/webm", kind: "video" };
  if (ascii.startsWith("ID3") || (bytes[0] === 0xff && (bytes[1]! & 0xe0) === 0xe0)) return { ok: true, mime: "audio/mpeg", kind: "audio" };
  if (ascii.startsWith("OggS")) return { ok: true, mime: "audio/ogg", kind: "audio" };
  if (ascii.startsWith("RIFF") && ascii.slice(8, 12) === "WAVE") return { ok: true, mime: "audio/wav", kind: "audio" };
  if (ascii.startsWith("fLaC")) return { ok: true, mime: "audio/flac", kind: "audio" };
  if (isMostlyText(bytes)) return { ok: true, mime: "text/plain", kind: "text" };
  return { ok: false, mime: "application/octet-stream", kind: "unknown", error: "امضای فایل شناخته نشد؛ فقط پسوند کافی نیست." };
}

function looksLikeOffice(bytes: Uint8Array, folder: string) {
  const sample = String.fromCharCode(...Array.from(bytes.slice(0, Math.min(512, bytes.length))));
  return sample.includes(folder) || sample.includes("[Content_Types].xml");
}

function isMostlyText(bytes: Uint8Array) {
  const n = Math.min(bytes.length, 4096);
  let bad = 0;
  for (let i = 0; i < n; i += 1) {
    const c = bytes[i]!;
    if (c === 0) return false;
    if (c < 9 || (c > 13 && c < 32 && c !== 27)) bad += 1;
  }
  return bad / n < 0.05;
}

export function inspectZipSafety(bytes: Uint8Array): { ok: boolean; error?: string } {
  let i = 0;
  let entries = 0;
  let uncompressed = 0;
  while (i + 30 <= bytes.length && entries <= ZIP_MAX_ENTRIES) {
    if (bytes[i] !== 0x50 || bytes[i + 1] !== 0x4b) break;
    const sig3 = bytes[i + 2];
    const sig4 = bytes[i + 3];
    if (sig3 === 0x03 && sig4 === 0x04) {
      const comp = u32(bytes, i + 18);
      const uncomp = u32(bytes, i + 22);
      const nameLen = u16(bytes, i + 26);
      const extra = u16(bytes, i + 28);
      const nameBytes = bytes.slice(i + 30, i + 30 + nameLen);
      const name = String.fromCharCode(...Array.from(nameBytes));
      if (name.includes("..") || name.startsWith("/") || name.includes("\\") || name.includes("\0")) {
        return { ok: false, error: "مسیر داخل آرشیو نامعتبر است (Path Traversal)." };
      }
      uncompressed += uncomp;
      entries += 1;
      i += 30 + nameLen + extra + comp;
      continue;
    }
    if ((sig3 === 0x01 && sig4 === 0x02) || (sig3 === 0x05 && sig4 === 0x06)) break;
    i += 1;
  }
  if (entries > ZIP_MAX_ENTRIES) return { ok: false, error: "تعداد ورودی‌های آرشیو از سقف نیکسو بیشتر است." };
  if (uncompressed > ZIP_MAX_UNCOMPRESSED) return { ok: false, error: "حجم بازشدهٔ آرشیو مشکوک است (Zip Bomb)." };
  return { ok: true };
}

function u16(b: Uint8Array, o: number) {
  return (b[o] ?? 0) | ((b[o + 1] ?? 0) << 8);
}
function u32(b: Uint8Array, o: number) {
  return ((b[o] ?? 0) | ((b[o + 1] ?? 0) << 8) | ((b[o + 2] ?? 0) << 16) | ((b[o + 3] ?? 0) << 24)) >>> 0;
}

/** Admin allow-list is declared extension only — E2EE payloads are opaque to the server. */
export function declaredExtAllowed(allowed: string[] | null | undefined, nameOrExt: string): boolean {
  if (!allowed || allowed.length === 0) return true;
  const ext = nameOrExt.includes(".") || nameOrExt.includes("/") ? extOf(nameOrExt) : nameOrExt.replace(/^\./, "").toLowerCase();
  return allowed.includes(ext);
}

export function jpegDimensions(buf: Buffer): { width: number; height: number } | null {
  if (buf.length < 8 || buf[0] !== 0xff || buf[1] !== 0xd8) return null;
  let i = 2;
  while (i + 8 < buf.length) {
    if (buf[i] !== 0xff) {
      i += 1;
      continue;
    }
    const marker = buf[i + 1]!;
    if (marker === 0xc0 || marker === 0xc1 || marker === 0xc2) {
      return { height: buf.readUInt16BE(i + 5), width: buf.readUInt16BE(i + 7) };
    }
    if (marker === 0xd8 || marker === 0xd9 || (marker >= 0xd0 && marker <= 0xd7)) {
      i += 2;
      continue;
    }
    if (i + 4 > buf.length) break;
    const len = buf.readUInt16BE(i + 2);
    if (len < 2) break;
    i += 2 + len;
  }
  return null;
}

export function pngDimensions(buf: Buffer): { width: number; height: number } | null {
  if (buf.length < 24 || buf[0] !== 0x89 || buf[1] !== 0x50) return null;
  return { width: buf.readUInt32BE(16), height: buf.readUInt32BE(20) };
}

export function scanNamedFile(name: string, declaredMime: string, size: number, sniffedKind?: FileKind): { ok: boolean; warning?: string } {
  const ext = extOf(name);
  if (size > FILE_MAX_BYTES) return { ok: false, warning: "حجم فایل از سقف سرور بیشتر است." };
  const kind = sniffedKind && sniffedKind !== "unknown" ? sniffedKind : guessKindFromName(name, declaredMime);
  const cap = maxBytesForKind(kind);
  if (size > cap) {
    return { ok: false, warning: `حجم این نوع فایل بیش از حد مجاز است (حداکثر ${Math.round(cap / (1024 * 1024))} مگابایت).` };
  }
  if (DANGEROUS_EXT.has(ext) || /javascript|html|svg/i.test(declaredMime)) {
    return { ok: false, warning: "این نوع فایل خطرناک است و پذیرفته نمی‌شود." };
  }
  if (ext && !ALLOWED_EXT.has(ext)) return { ok: false, warning: "این پسوند در فهرست مجاز نیکسو نیست." };
  return { ok: true };
}

export function previewMode(mime: string, name: string): "pdf" | "image" | "video" | "audio" | "text" | "none" {
  if (mime === "application/pdf" || extOf(name) === "pdf") return "pdf";
  if (mime.startsWith("image/")) return "image";
  if (mime.startsWith("video/")) return "video";
  if (mime.startsWith("audio/")) return "audio";
  if (mime.startsWith("text/") || extOf(name) === "txt" || extOf(name) === "csv") return "text";
  return "none";
}

export type FileSort = "newest" | "oldest" | "name" | "size" | "type";

export function sortFiles<T extends { name: string; size: number; mime: string; createdAt: number }>(items: T[], sort: FileSort, locale?: string | null): T[] {
  const copy = [...items];
  if (sort === "oldest") copy.sort((a, b) => a.createdAt - b.createdAt);
  else if (sort === "name") copy.sort((a, b) => collate(a.name, b.name, locale));
  else if (sort === "size") copy.sort((a, b) => b.size - a.size);
  else if (sort === "type") copy.sort((a, b) => collate(a.mime, b.mime, locale) || collate(a.name, b.name, locale));
  else copy.sort((a, b) => b.createdAt - a.createdAt);
  return copy;
}
