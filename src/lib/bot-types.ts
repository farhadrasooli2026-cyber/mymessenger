export const BOT_API_WINDOW_MS = 60_000;
export const BOT_API_MAX = 60;
export const BOT_MSG_MAX = 20;
export const BOT_CREATE_MAX_DAY = 8;

export const DEFAULT_BOT_PERMS = {
  sendMessage: true,
  receiveMessage: true,
  sendPhoto: false,
  sendVideo: false,
  sendFile: false,
  sendButton: true,
  sendNotification: false,
  inline: true,
  readContacts: false,
  readPrivateChats: false,
  gallery: false,
  microphone: false,
  camera: false,
  location: false,
  moderateSpam: false,
  groupMessages: false,
  channelPost: false,
};

export type BotApiPerms = typeof DEFAULT_BOT_PERMS;

export const BOT_PERM_FA: Record<keyof BotApiPerms, string> = {
  sendMessage: "ارسال پیام در گفتگوی ربات",
  receiveMessage: "دریافت پیام همان گفتگو",
  sendPhoto: "ارسال عکس",
  sendVideo: "ارسال ویدیو",
  sendFile: "ارسال فایل",
  sendButton: "دکمهٔ تعاملی",
  sendNotification: "اعلان",
  inline: "نتیجهٔ اینلاین",
  readContacts: "مخاطبین",
  readPrivateChats: "چت خصوصی E2EE",
  gallery: "گالری",
  microphone: "میکروفون",
  camera: "دوربین",
  location: "موقعیت",
  moderateSpam: "مدیریت هرزنامه در گروه (سمت سرور)",
  groupMessages: "پیام در گروه پس از افزودن ادمین",
  channelPost: "پست کانال پس از اجازهٔ ادمین",
};

export const FORBIDDEN_DEFAULTS: (keyof BotApiPerms)[] = [
  "readContacts",
  "readPrivateChats",
  "gallery",
  "microphone",
  "camera",
  "location",
];

export const DEFAULT_BOT_COMMANDS: BotCommand[] = [
  { command: "start", description: "شروع گفتگو با ربات", permission: "public" },
  { command: "help", description: "راهنما", permission: "public" },
  { command: "settings", description: "تنظیمات اعلان", permission: "public" },
  { command: "search", description: "جستجو در قابلیت‌های ربات", permission: "public" },
];

export const MINI_CATEGORIES = [
  { id: "games", label: "بازی", emoji: "🎮" },
  { id: "shopping", label: "فروشگاه", emoji: "🛒" },
  { id: "finance", label: "مالی", emoji: "💳" },
  { id: "productivity", label: "بهره‌وری", emoji: "📋" },
  { id: "education", label: "آموزش", emoji: "📘" },
  { id: "entertainment", label: "سرگرمی", emoji: "📅" },
  { id: "business", label: "کسب‌وکار", emoji: "📊" },
  { id: "utilities", label: "ابزار", emoji: "🔧" },
  { id: "social", label: "اجتماعی", emoji: "💬" },
  { id: "booking", label: "رزرو", emoji: "📅" },
  { id: "payment", label: "پرداخت", emoji: "💳" },
] as const;

export type MiniCategory = (typeof MINI_CATEGORIES)[number]["id"];

export const MINI_SCOPES = [
  "profile",
  "username",
  "basic",
  "contacts",
  "camera",
  "microphone",
  "location",
  "files",
  "notifications",
  "payments",
] as const;
export type MiniScope = (typeof MINI_SCOPES)[number];

export const MINI_SCOPE_FA: Record<MiniScope, string> = {
  profile: "پروفایل نمایشی",
  username: "نام کاربری",
  basic: "اطلاعات پایهٔ حساب (بدون شماره/ایمیل)",
  contacts: "مخاطبین",
  camera: "دوربین",
  microphone: "میکروفون",
  location: "موقعیت",
  files: "فایل انتخابی کاربر (نه گالری خصوصی نیکسو)",
  notifications: "ارسال اعلان",
  payments: "پرداخت از مسیر NIXO Pay",
};

export const MINI_SENSITIVE: MiniScope[] = ["contacts", "camera", "microphone", "location", "files", "payments", "notifications"];

export type MiniAppStatus = "active" | "maintenance" | "suspended" | "removed" | "pending";

export const BOT_REPORT_CATEGORIES = [
  { id: "spam", label: "هرزنامه (Spam)" },
  { id: "scam", label: "کلاهبرداری (Scam)" },
  { id: "fraud", label: "تقلب (Fraud)" },
  { id: "malicious", label: "مخرب (Malicious)" },
  { id: "harassment", label: "آزار (Harassment)" },
  { id: "other", label: "سایر (Other)" },
] as const;

export type BotReportCategory = (typeof BOT_REPORT_CATEGORIES)[number]["id"];

export const BOT_CATEGORIES = [
  { id: "utility", label: "ابزار", emoji: "🔧" },
  { id: "games", label: "بازی", emoji: "🎮" },
  { id: "education", label: "آموزش", emoji: "📘" },
  { id: "business", label: "کسب‌وکار", emoji: "📊" },
  { id: "productivity", label: "بهره‌وری", emoji: "📋" },
  { id: "entertainment", label: "سرگرمی", emoji: "🎭" },
  { id: "support", label: "پشتیبانی", emoji: "💬" },
] as const;
export type BotCategory = (typeof BOT_CATEGORIES)[number]["id"];

export type BotStatus = "active" | "disabled" | "suspended" | "deleted";

export type BotCommand = { command: string; description: string; permission?: "public" | keyof BotApiPerms };

export const BOT_API_VERSION = "v1";
export const BOT_WEBHOOK_TIMEOUT_MS = 8_000;
export const BOT_JOB_MAX = 10;
export const BOT_KV_MAX = 40;

export type BotButton = { id: string; label: string; payload: string };

export type BotRecord = {
  id: string;
  ownerUserId: string;
  name: string;
  username: string;
  description: string;
  photoKind: "default" | "upload";
  verified: boolean;
  status: BotStatus;
  perms: BotApiPerms;
  commands: BotCommand[];
  category?: BotCategory;
  privacyUrl?: string;
  termsUrl?: string;
  version?: string;
  versions?: { version: string; startMessage: string; commands: BotCommand[]; at: number }[];
  webhookTimeoutMs?: number;
  webhookFailCount?: number;
  health?: "ok" | "degraded" | "down";
  tokenSalt: string;
  tokenHash: string;
  tokenHint: string;
  tokenRevokedAt: number | null;
  webhookUrl: string | null;
  webhookSecret: string | null;
  webhookLastStatus: string | null;
  webhookLastAt: number | null;
  createdAt: number;
  updatedAt: number;
  startMessage: string;
};

export type BotChat = {
  id: string;
  botId: string;
  userId: string;
  startedAt: number;
  stoppedAt: number | null;
  notify: "on" | "off" | "mute";
  updatedAt: number;
};

export type BotMessage = {
  id: string;
  chatId: string;
  botId: string;
  userId: string;
  from: "user" | "bot";
  kind: "text" | "photo" | "video" | "file" | "notification" | "system";
  text: string;
  buttons: BotButton[];
  createdAt: number;
  replyToId?: string;
  editedAt?: number | null;
  deletedAt?: number | null;
};

export type BotReview = {
  id: string;
  botId: string;
  userId: string;
  stars: number;
  body: string;
  createdAt: number;
  hidden: boolean;
};

export type BotAccessLog = {
  id: string;
  botId: string;
  userId: string;
  action: string;
  at: number;
};

export type BotKvItem = {
  botId: string;
  key: string;
  value: string;
  updatedAt: number;
};

export type BotJob = {
  id: string;
  botId: string;
  kind: "notify" | "send";
  userId: string;
  text: string;
  runAt: number;
  status: "queued" | "done" | "failed";
  attempts: number;
  idempotencyKey?: string;
};

export type BotIdempotency = {
  botId: string;
  key: string;
  result: string;
  at: number;
};

export type BotWebhookJob = {
  id: string;
  botId: string;
  body: string;
  attempts: number;
  nextAt: number;
  lastError: string;
};

export type MiniAppRecord = {
  id: string;
  botId: string;
  title: string;
  category: MiniCategory;
  description: string;
  html: string;
  paymentHint: boolean;
  createdAt: number;
  iconDataUrl?: string;
  version?: string;
  status?: MiniAppStatus;
  requestedScopes?: MiniScope[];
  privacyUrl?: string;
  termsUrl?: string;
  webUrl?: string | null;
  updatedAt?: number;
};

export type MiniGrant = {
  id: string;
  miniAppId: string;
  userId: string;
  profile: boolean;
  createdAt: number;
  scopes?: MiniScope[];
  tokenHash?: string;
  tokenSalt?: string;
  tokenExp?: number;
  revokedAt?: number | null;
  favorite?: boolean;
  installed?: boolean;
  lastUsedAt?: number;
};

export type MiniReview = {
  id: string;
  miniAppId: string;
  userId: string;
  stars: number;
  body: string;
  createdAt: number;
  hidden: boolean;
};

export type MiniSession = {
  id: string;
  miniAppId: string;
  userId: string;
  createdAt: number;
  revokedAt: number | null;
};

export type MiniAccessLog = {
  id: string;
  miniAppId: string;
  userId: string;
  action: string;
  at: number;
};

export type BotPlacement = {
  id: string;
  botId: string;
  groupId?: string;
  channelId?: string;
  canSend: boolean;
  canModerate: boolean;
  canPost: boolean;
  addedBy: string;
  addedAt: number;
};

export type BotLog = {
  id: string;
  botId: string;
  at: number;
  kind: "api" | "error" | "webhook" | "abuse" | "auth";
  summary: string;
};

export type BotUpdate = {
  id: string;
  botId: string;
  userId: string;
  type: "message" | "callback" | "inline";
  text: string;
  payload?: string;
  createdAt: number;
  consumedAt: number | null;
};
