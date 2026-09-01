export const GALLERY_MAX_BYTES = 2 * 1024 * 1024;
export const GALLERY_SOFT_MS = 30 * 24 * 60 * 60 * 1000;
export const GALLERY_TOKEN_MS = 10 * 60 * 1000;
export const GALLERY_CACHE_MAX = 40;

export type GalleryKind = "photo" | "video" | "gif" | "voice" | "audio" | "document" | "file" | "link";
export type GalleryPrivacy = "private" | "shared" | "public";
export type GalleryQuality = "standard" | "high" | "original";

export const GALLERY_KIND_FA: Record<GalleryKind, string> = {
  photo: "عکس",
  video: "ویدیو",
  gif: "GIF",
  voice: "پیام صوتی",
  audio: "صوت",
  document: "سند",
  file: "فایل",
  link: "لینک",
};

export type GalleryPrefs = {
  userId: string;
  autoWifi: boolean;
  autoMobile: boolean;
  autoRoaming: boolean;
  autoSave: boolean;
  uploadQuality: GalleryQuality;
  downloadQuality: GalleryQuality;
  lockHash: string | null;
  lockSalt: string | null;
  unlockedUntil: number;
  dataSaver: boolean;
  autoFiles: "wifi" | "mobile" | "never";
  previewFiles: boolean;
};

export const DEFAULT_GALLERY_PREFS = {
  autoWifi: true,
  autoMobile: false,
  autoRoaming: false,
  autoSave: false,
  uploadQuality: "standard" as GalleryQuality,
  downloadQuality: "standard" as GalleryQuality,
  lockHash: null as string | null,
  lockSalt: null as string | null,
  unlockedUntil: 0,
  dataSaver: false,
  autoFiles: "wifi" as const,
  previewFiles: true,
};
