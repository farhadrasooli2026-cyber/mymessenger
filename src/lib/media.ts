import { scanNamedFile, sniffFileBytes } from "@/lib/files";

export { extOf } from "@/lib/files";

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

/** Inspect leading bytes; never trust the filename alone. */
export function sniffMagic(bytes: Uint8Array): { ok: boolean; mime: string; warning?: string } {
  const s = sniffFileBytes(bytes);
  return { ok: s.ok, mime: s.mime, warning: s.error };
}

export function scanAttachment(name: string, mime: string, size: number): {
  ok: boolean;
  warning?: string;
  mimeClass: MimeClass;
} {
  const named = scanNamedFile(name, mime, size);
  const mimeClass: MimeClass = mime.startsWith("image/")
    ? "image"
    : mime.startsWith("video/")
      ? "video"
      : mime.startsWith("audio/")
        ? "audio"
        : "file";
  if (!named.ok) return { ok: false, warning: named.warning, mimeClass };
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
