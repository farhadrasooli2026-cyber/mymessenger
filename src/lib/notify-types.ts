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
  "lives",
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

export const NOTIFY_KINDS = [
  "message",
  "reply",
  "mention",
  "reaction",
  "friend-request",
  "friend-accepted",
  "follow",
  "story",
  "story_reply",
  "channel_post",
  "group_invite",
  "group_join",
  "incoming_voice",
  "incoming_video",
  "missed",
  "security",
  "system",
] as const;

export const PUSH_PROVIDERS = ["nixo-web", "nixo-local"] as const;
export const VIBRATION_PATTERNS = {
  nixo: [40, 60, 40],
  pulse: [20, 40, 20, 40, 80],
  call: [200, 120, 200],
  silent: [] as number[],
} as const;

export const NOTIFY_FLOOD_WINDOW_MS = 60_000;
export const NOTIFY_FLOOD_PER_SOURCE = 12;
export const NOTIFY_FLOOD_PER_USER = 80;
export const PUSH_RATE_PER_USER = 40;
export const NOTIFY_KEEP = 300;
export const NOTIFY_PAGE = 40;
export const PUSH_RETRY_MAX = 5;
export const PUSH_KEEP_MS = 7 * 24 * 60 * 60_000;
export const NOTIFY_TTL_MS = 90 * 24 * 60 * 60_000;
export const NOTIFY_COLLAPSE_MS = 8_000;
export const NOTIFY_THROTTLE_MS = 2_000;

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
  vibrationPattern: keyof typeof VIBRATION_PATTERNS;
  soundEnabled: boolean;
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
    lives: boolean;
    friends: boolean;
  };
  mentions: boolean;
  replies: boolean;
  reactions: boolean;
  groupAdmin: boolean;
  friends: boolean;
  globalEnabled: boolean;
  dndAllowCalls: boolean;
  locale: "fa" | "en";
  timeZone: string;
  dnd: boolean;
  dndStart: string;
  dndEnd: string;
  dndAllowIds: string[];
  mutes: NotifyMute[];
  overrides: NotifyOverride[];
  securityDisableAckAt: number | null;
  updatedAt: number;
};

export function defaultNotifyPrefs(userId: string): NotifyPrefs {
  return {
    userId,
    showMessagePreview: true,
    lockScreen: "sender",
    vibration: true,
    vibrationPattern: "nixo",
    soundEnabled: true,
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
      lives: true,
      friends: true,
    },
    mentions: true,
    replies: true,
    reactions: true,
    groupAdmin: true,
    friends: true,
    globalEnabled: true,
    dndAllowCalls: true,
    locale: "fa",
    timeZone: "Asia/Tehran",
    dnd: false,
    dndStart: "23:00",
    dndEnd: "08:00",
    dndAllowIds: [],
    mutes: [],
    overrides: [],
    securityDisableAckAt: null,
    updatedAt: 0,
  };
}

export type NotifyTarget = {
  type: "chat" | "group" | "channel" | "story" | "business" | "bot" | "ai" | "order" | "security" | "call" | "system" | "live" | "mini" | "contact";
  id: string;
  href?: string;
};

export type NotifyPriority = "low" | "normal" | "high" | "critical";
export type NotifyLifecycle = "pending" | "processing" | "sent" | "delivered" | "failed" | "read" | "dismissed";
export type PushJobStatus = "queued" | "running" | "sent" | "delivered" | "failed" | "dead";
export type PushPlatform = "web" | "mobile" | "desktop";

export type DeviceNotifyPrefs = {
  sound: boolean;
  vibration: boolean;
  badge: boolean;
  enabled: boolean;
};

export type NotifyRecord = {
  id: string;
  eventId: string;
  userId: string;
  category: Exclude<NotifyCategory, "all">;
  kind: string;
  title: string;
  body: string;
  senderName: string;
  photoUrl: string | null;
  priority: NotifyPriority;
  e2ee: boolean;
  suppressed: boolean;
  reason?: string;
  readAt: number | null;
  dismissedAt?: number | null;
  deletedAt: number | null;
  createdAt: number;
  sourceId: string;
  target: NotifyTarget;
  pushState: "inapp" | "push_unsupported" | "suppressed" | "failed" | "sent" | "delivered" | "pending";
  state?: NotifyLifecycle;
  groupKey?: string;
  collapsedCount?: number;
  locale?: string;
};

export type PushToken = {
  id: string;
  userId: string;
  deviceSessionId: string;
  platform: PushPlatform;
  endpointHash: string;
  endpointTail: string;
  endpoint: string;
  permission: "granted" | "denied" | "default";
  devicePrefs: DeviceNotifyPrefs;
  createdAt: number;
  rotatedAt: number;
  revokedAt: number | null;
  invalidAt: number | null;
};

export type PushJob = {
  id: string;
  userId: string;
  notificationId: string;
  tokenId: string;
  idempotencyKey: string;
  platform: PushPlatform;
  priority: NotifyPriority;
  status: PushJobStatus;
  attempts: number;
  nextAt?: number;
  lastError?: string;
  provider: string;
  failoverProvider?: string;
  latencyMs?: number;
  createdAt: number;
};

export type NotifyDeadLetter = {
  id: string;
  jobId: string;
  userId: string;
  notificationId: string;
  error: string;
  at: number;
};

export type NotifyAudit = {
  id: string;
  userId: string;
  action: string;
  detail: string;
  at: number;
};

export const NOTIFY_TEMPLATES: Record<"fa" | "en", Record<string, string>> = {
  fa: {
    message: "پیام جدید",
    mention: "منشن شدید",
    reply: "پاسخ جدید",
    reaction: "واکنش جدید",
    incoming_voice: "تماس صوتی ورودی",
    incoming_video: "تماس تصویری ورودی",
    missed: "تماس از دست‌رفته",
    channel_post: "پست جدید کانال",
    friend_request: "درخواست دوستی",
    friend_accepted: "دوستی پذیرفته شد",
    follow: "دنبال‌کننده جدید",
    story: "استوری جدید",
    group_invite: "دعوت به گروه",
    group_join: "عضویت در گروه",
    default: "اعلان نیکسو",
  },
  en: {
    message: "New message",
    mention: "You were mentioned",
    reply: "New reply",
    reaction: "New reaction",
    incoming_voice: "Incoming voice call",
    incoming_video: "Incoming video call",
    missed: "Missed call",
    channel_post: "New channel post",
    friend_request: "Friend request",
    friend_accepted: "Friend request accepted",
    follow: "New follower",
    story: "New story",
    group_invite: "Group invite",
    group_join: "Joined a group",
    default: "NIXO notification",
  },
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
  lives: "پخش زنده",
};
