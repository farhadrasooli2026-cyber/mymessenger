export const MEDIA_CHUNK = 160 * 1024;
export const MEDIA_MAX_BYTES = 28 * 1024 * 1024;
export const MEDIA_MAX_CHUNKS = 180;

export type MediaKind = "photo" | "video" | "file";
export type MessageKind = "text" | "voice" | MediaKind;
export type Quality = "compressed" | "standard" | "high" | "original";
export type AutoMode = "always" | "wifi" | "mobile" | "never";
export type MimeClass = "image" | "video" | "file" | "audio";

export type MediaMeta = {
  name: string;
  mime: string;
  caption: string;
  quality: Quality;
  mute?: boolean;
  trimStartMs?: number;
  trimEndMs?: number;
  width?: number;
  height?: number;
  durationMs?: number;
  rotation?: number;
};

export const QUALITY_LABELS: { id: Quality; fa: string }[] = [
  { id: "compressed", fa: "فشرده" },
  { id: "standard", fa: "استاندارد" },
  { id: "high", fa: "کیفیت بالا" },
  { id: "original", fa: "اصلی" },
];

const DANGEROUS = new Set([
  "exe", "bat", "cmd", "com", "scr", "pif", "msi", "dll", "js", "vbs", "ps1", "apk", "html", "htm", "svg", "jar",
]);

const ALLOWED = new Set([
  "jpg", "jpeg", "png", "webp", "gif", "heic", "mp4", "webm", "mov", "m4v", "mp3", "m4a", "ogg", "wav", "flac",
  "pdf", "zip", "rar", "7z", "doc", "docx", "xls", "xlsx", "ppt", "pptx", "txt", "csv",
]);

export function extOf(name: string): string {
  const i = name.lastIndexOf(".");
  return i >= 0 ? name.slice(i + 1).toLowerCase() : "";
}

/** Inspect leading bytes; never trust the filename alone. */
export function sniffMagic(bytes: Uint8Array): { ok: boolean; mime: string; warning?: string } {
  if (bytes.length < 4) return { ok: false, mime: "application/octet-stream", warning: "فایل ناقص است." };
  const b = bytes;
  const ascii = String.fromCharCode(...Array.from(b.slice(0, Math.min(32, b.length))));
  if (/^\s*</.test(ascii) || /<script/i.test(ascii) || ascii.startsWith("%PDF") === false && /javascript/i.test(ascii)) {
    if (/^\s*</.test(ascii) || /<script/i.test(ascii)) {
      return { ok: false, mime: "text/html", warning: "محتوای HTML/اسکریپت پذیرفته نمی‌شود." };
    }
  }
  if (b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return { ok: true, mime: "image/jpeg" };
  if (b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47) return { ok: true, mime: "image/png" };
  if (ascii.startsWith("GIF8")) return { ok: true, mime: "image/gif" };
  if (ascii.startsWith("RIFF") && ascii.slice(8, 12) === "WEBP") return { ok: true, mime: "image/webp" };
  if (ascii.startsWith("%PDF")) return { ok: true, mime: "application/pdf" };
  if (b[0] === 0x50 && b[1] === 0x4b) return { ok: true, mime: "application/zip" };
  if (ascii.includes("ftyp")) return { ok: true, mime: "video/mp4" };
  if (b[0] === 0x1a && b[1] === 0x45 && b[2] === 0xdf) return { ok: true, mime: "video/webm" };
  if (ascii.startsWith("ID3") || (b[0] === 0xff && (b[1] & 0xe0) === 0xe0)) return { ok: true, mime: "audio/mpeg" };
  if (ascii.startsWith("OggS")) return { ok: true, mime: "audio/ogg" };
  if (ascii.startsWith("RIFF") && ascii.slice(8, 12) === "WAVE") return { ok: true, mime: "audio/wav" };
  if (ascii.startsWith("fLaC")) return { ok: true, mime: "audio/flac" };
  return { ok: true, mime: "application/octet-stream", warning: "امضای فایل ناشناخته است؛ فقط پس از بررسی مجاز ذخیره می‌شود." };
}

export function scanAttachment(name: string, mime: string, size: number): {
  ok: boolean;
  warning?: string;
  mimeClass: MimeClass;
} {
  const ext = extOf(name);
  if (size > MEDIA_MAX_BYTES) return { ok: false, warning: "حجم فایل از سقف نیکسو بیشتر است.", mimeClass: "file" };
  if (DANGEROUS.has(ext) || /javascript|html/i.test(mime)) {
    return { ok: false, warning: "این نوع فایل مشکوک است و بدون هشدار باز نمی‌شود.", mimeClass: "file" };
  }
  if (ext && !ALLOWED.has(ext)) {
    return { ok: false, warning: "این پسوند در فهرست فایل‌های مجاز نیست.", mimeClass: "file" };
  }
  const mimeClass: MimeClass = mime.startsWith("image/")
    ? "image"
    : mime.startsWith("video/")
      ? "video"
      : mime.startsWith("audio/")
        ? "audio"
        : "file";
  return { ok: true, mimeClass };
}

export function kindFromClass(c: MimeClass): MediaKind {
  if (c === "image") return "photo";
  if (c === "video") return "video";
  return "file";
}

export function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}

export function jpegQuality(q: Quality): { max: number; quality: number } {
  if (q === "compressed") return { max: 960, quality: 0.52 };
  if (q === "standard") return { max: 1440, quality: 0.74 };
  if (q === "high") return { max: 1920, quality: 0.88 };
  return { max: 4096, quality: 0.95 };
}

const AUTO_KEY = "nixo.media.auto";
const SAVE_KEY = "nixo.media.autosave";

export type AutoSettings = {
  photos: AutoMode;
  videos: AutoMode;
  files: AutoMode;
  voice: AutoMode;
};

export function defaultAuto(): AutoSettings {
  return { photos: "always", videos: "wifi", files: "never", voice: "always" };
}

export function loadAutoSettings(): AutoSettings {
  try {
    const raw = localStorage.getItem(AUTO_KEY);
    if (!raw) return defaultAuto();
    return { ...defaultAuto(), ...(JSON.parse(raw) as AutoSettings) };
  } catch {
    return defaultAuto();
  }
}

export function saveAutoSettings(s: AutoSettings): void {
  try {
    localStorage.setItem(AUTO_KEY, JSON.stringify(s));
  } catch {
    /* ignore */
  }
}

export function autoSaveGallery(): boolean {
  try {
    return localStorage.getItem(SAVE_KEY) === "1";
  } catch {
    return false;
  }
}

export function setAutoSaveGallery(on: boolean): void {
  try {
    localStorage.setItem(SAVE_KEY, on ? "1" : "0");
  } catch {
    /* ignore */
  }
}

export function shouldAutoDownload(mode: AutoMode): boolean {
  if (mode === "always") return true;
  if (mode === "never") return false;
  const conn = (navigator as Navigator & { connection?: { saveData?: boolean; type?: string; effectiveType?: string } }).connection;
  if (mode === "wifi") {
    if (conn?.type) return conn.type === "wifi" || conn.type === "ethernet";
    return !conn?.saveData;
  }
  return true;
}

export const STICKERS = ["😀", "😂", "❤️", "🔥", "✨", "🙏", "👍", "🎉", "🌸", "⭐"];

export const UPLOAD_PROGRESS_KEY = "nixo.media.chunks.";
