export const STORY_TTL_MS = 24 * 60 * 60 * 1000;
export const STORY_MAX_MEDIA = 420_000;

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
] as const;

export const STATUS_PRESETS = [
  { id: "available", label: "در دسترس" },
  { id: "busy", label: "مشغول" },
  { id: "work", label: "سر کار" },
  { id: "away", label: "دور از دسترس" },
  { id: "custom", label: "سفارشی" },
] as const;
