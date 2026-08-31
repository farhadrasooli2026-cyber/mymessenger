export const STORY_TTL_MS = 24 * 60 * 60 * 1000;
export const STORY_MAX_MEDIA = 420_000;
export const STORY_VIDEO_MAX_MS = 15_000;
export const STORY_MEDIA_TOKEN_MS = 10 * 60 * 1000;

export type StoryKind = "text" | "photo" | "video" | "gif" | "sticker" | "location";
export type StoryVisibility = "everyone" | "contacts" | "closeFriends" | "selected";
export type StoryPurpose = "general" | "product" | "discount" | "announcement" | "service";

export const STORY_MUSIC = [
  { id: "pulse", label: "نبض کهربا" },
  { id: "breeze", label: "نسیم سبز" },
  { id: "night", label: "شب آرام" },
] as const;

export const STORY_FILTERS = [
  { id: "none", label: "بدون فیلتر", css: "none" },
  { id: "warm", label: "گرم", css: "sepia(0.35) saturate(1.2)" },
  { id: "cool", label: "سرد", css: "hue-rotate(20deg) saturate(0.85)" },
  { id: "mono", label: "تک‌رنگ", css: "grayscale(1)" },
  { id: "blur", label: "محو", css: "blur(6px)" },
] as const;

export const STORY_STICKERS = ["🔥", "✨", "💚", "🎉", "📍", "🌙", "⭐", "🎵"] as const;

export const STATUS_PRESETS = [
  { id: "available", label: "در دسترس" },
  { id: "busy", label: "مشغول" },
  { id: "work", label: "سر کار" },
  { id: "away", label: "دور از دسترس" },
  { id: "custom", label: "سفارشی" },
] as const;

export const STORY_PURPOSE_FA: Record<StoryPurpose, string> = {
  general: "عمومی",
  product: "محصول",
  discount: "تخفیف",
  announcement: "اطلاعیه",
  service: "خدمت جدید",
};
