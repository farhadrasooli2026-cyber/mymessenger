export const NOTIFY_CATEGORIES = [
  "all",
  "messages",
  "calls",
  "groups",
  "channels",
  "business",
  "security",
  "payments",
  "system",
  "stories",
  "bots",
  "ai",
] as const;

export type NotifyCategory = (typeof NOTIFY_CATEGORIES)[number];

export const NOTIFY_TONES = ["nixo", "soft", "ping", "silent"] as const;
export type NotifyTone = (typeof NOTIFY_TONES)[number];

export const MUTE_CHAT_PRESETS = [
  { id: "1h", ms: 60 * 60_000, label: "1 Hour" },
  { id: "8h", ms: 8 * 60 * 60_000, label: "8 Hours" },
  { id: "1d", ms: 24 * 60 * 60_000, label: "1 Day" },
  { id: "1w", ms: 7 * 24 * 60 * 60_000, label: "1 Week" },
  { id: "forever", ms: null, label: "Until I Turn It Back On" },
] as const;

export const NOTIFY_FLOOD_WINDOW_MS = 60_000;
export const NOTIFY_FLOOD_PER_SOURCE = 12;
export const NOTIFY_FLOOD_PER_USER = 80;
export const NOTIFY_KEEP = 300;

export type NotifyLockScreen = "full" | "sender" | "hidden";

export type NotifyMute = {
  targetType: "chat" | "group" | "channel" | "bot" | "user";
  targetId: string;
  until: number | null;
};

export type NotifyOverride = {
  targetType: "chat" | "group" | "channel" | "bot" | "user";
  targetId: string;
  enabled?: boolean;
  preview?: boolean;
  sound?: NotifyTone;
};

export type NotifyPrefs = {
  userId: string;
  showMessagePreview: boolean;
  lockScreen: NotifyLockScreen;
  vibration: boolean;
  badge: boolean;
  sounds: { message: NotifyTone; call: NotifyTone; mention: NotifyTone; system: NotifyTone };
  enabled: {
    messages: boolean;
    calls: boolean;
    groups: boolean;
    channels: boolean;
    stories: boolean;
    bots: boolean;
    business: boolean;
    ai: boolean;
    payments: boolean;
    security: boolean;
    system: boolean;
  };
  mentions: boolean;
  replies: boolean;
  groupAdmin: boolean;
  dnd: boolean;
  dndStart: string;
  dndEnd: string;
  dndAllowIds: string[];
  mutes: NotifyMute[];
  overrides: NotifyOverride[];
  updatedAt: number;
};

export function defaultNotifyPrefs(userId: string): NotifyPrefs {
  return {
    userId,
    showMessagePreview: true,
    lockScreen: "sender",
    vibration: true,
    badge: true,
    sounds: { message: "nixo", call: "nixo", mention: "ping", system: "soft" },
    enabled: {
      messages: true,
      calls: true,
      groups: true,
      channels: true,
      stories: true,
      bots: true,
      business: true,
      ai: true,
      payments: true,
      security: true,
      system: true,
    },
    mentions: true,
    replies: true,
    groupAdmin: true,
    dnd: false,
    dndStart: "23:00",
    dndEnd: "08:00",
    dndAllowIds: [],
    mutes: [],
    overrides: [],
    updatedAt: 0,
  };
}

export type NotifyTarget = {
  type: "chat" | "group" | "channel" | "story" | "business" | "bot" | "ai" | "order" | "security" | "call" | "system";
  id: string;
  href?: string;
};

export type NotifyRecord = {
  id: string;
  userId: string;
  category: Exclude<NotifyCategory, "all">;
  kind: string;
  title: string;
  body: string;
  senderName: string;
  photoUrl: string | null;
  priority: "normal" | "high";
  e2ee: boolean;
  suppressed: boolean;
  reason?: string;
  readAt: number | null;
  deletedAt: number | null;
  createdAt: number;
  sourceId: string;
  target: NotifyTarget;
  pushState: "inapp" | "push_unsupported" | "suppressed" | "failed";
};

export const CATEGORY_FA: Record<NotifyCategory, string> = {
  all: "همه",
  messages: "پیام‌ها",
  calls: "تماس‌ها",
  groups: "گروه‌ها",
  channels: "کانال‌ها",
  business: "کسب‌وکار",
  security: "امنیت",
  payments: "پرداخت",
  system: "سیستم",
  stories: "استوری",
  bots: "ربات",
  ai: "هوش مصنوعی",
};
