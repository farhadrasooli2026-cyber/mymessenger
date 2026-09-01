export const CHANNEL_FLOOD_WINDOW_MS = 20_000;
export const CHANNEL_FLOOD_MAX = 8;
export const CHANNEL_SUBSCRIBE_WINDOW_MS = 60_000;
export const CHANNEL_SUBSCRIBE_MAX = 12;
export const CHANNEL_MAX_PINS = 5;
export const CHANNEL_OWNED_MAX = 20;
export const CHANNEL_CREATE_WINDOW_MS = 60 * 60 * 1000;
export const CHANNEL_CREATE_MAX = 8;
export const CHANNEL_POST_PAGE = 40;
export const CHANNEL_SUB_PAGE = 40;
export const CHANNEL_BROADCAST_RETRY_MAX = 5;
export const CHANNEL_SCHEDULE_MAX_MS = 30 * 24 * 60 * 60 * 1000;
export const CHANNEL_MAX_SUBSCRIBERS = 50_000;
export const CHANNEL_REQUEST_TTL_MS = 7 * 24 * 60 * 60 * 1000;
export const CHANNEL_NAME_MAX = 48;
export const CHANNEL_DESC_MAX = 800;

export type ChannelSubscriptionState = "active" | "pending" | "left" | "banned";
export type ChannelJoinRequestStatus = "pending" | "approved" | "rejected" | "cancelled" | "expired";

export function validateChannelName(raw: string): { ok: true; name: string } | { ok: false; error: string } {
  const name = raw.trim().replace(/\s+/g, " ");
  if (name.length < 2 || name.length > CHANNEL_NAME_MAX) {
    return { ok: false, error: `نام کانال باید ۲ تا ${CHANNEL_NAME_MAX} نویسه باشد.` };
  }
  if (/[\u0000-\u001f]/.test(name) || /https?:\/\//i.test(name) || /<script/i.test(name)) {
    return { ok: false, error: "نام کانال نامعتبر است." };
  }
  return { ok: true, name };
}

export function validateChannelDescription(raw: string): { ok: true; text: string } | { ok: false; error: string } {
  const text = raw.trim().slice(0, CHANNEL_DESC_MAX);
  if (/[\u0000-\u0008]/.test(text) || /<script/i.test(text)) {
    return { ok: false, error: "توضیحات کانال نامعتبر است." };
  }
  return { ok: true, text };
}

export function extractChannelTags(text: string): string[] {
  const tags = new Set<string>();
  const re = /#([\p{L}\p{N}_]{2,32})/gu;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) tags.add(m[1]!.toLowerCase());
  return [...tags].slice(0, 12);
}

export type ChannelStaffRole = "owner" | "admin" | "editor" | "moderator";
export type ChannelCommentWho = "subscribers" | "staff";
export type ChannelNotify = "on" | "off" | "important";
export type ChannelPostKind = "text" | "photo" | "video" | "voice" | "audio" | "file" | "link" | "poll" | "album" | "gif" | "quiz";
export type ChannelPostStatus = "draft" | "scheduled" | "published";
export type ChannelPurpose = "general" | "news" | "products" | "promotions" | "announcements";
export type ChannelLifecycle = "active" | "restricted" | "suspended" | "deleted";
export type ChannelJoinMode = "open" | "invite" | "request";

export type ChannelAdminPerms = {
  postMessages: boolean;
  editPosts: boolean;
  deletePosts: boolean;
  pinPosts: boolean;
  manageComments: boolean;
  manageSubscribers: boolean;
  manageChannelInfo: boolean;
  manageOtherAdmins: boolean;
  manageInvites: boolean;
  manageBots: boolean;
  manageAI: boolean;
  viewAnalytics: boolean;
  createPosts?: boolean;
  manageChannel?: boolean;
  manageSettings?: boolean;
  manageMedia?: boolean;
  manageLinks?: boolean;
  manageReactions?: boolean;
  banSubscribers?: boolean;
};

export type CustomChannelRole = {
  id: string;
  name: string;
  perms: Partial<ChannelAdminPerms>;
};

export const CHANNEL_ROLE_FA: Record<ChannelStaffRole | "subscriber", string> = {
  owner: "مالک",
  admin: "ادمین",
  editor: "ویراستار",
  moderator: "ناظم",
  subscriber: "مشترک",
};

export function rankChannelRole(role: string): number {
  if (role === "owner") return 5;
  if (role === "admin") return 4;
  if (role === "editor") return 3;
  if (role === "moderator") return 2;
  return 1;
}

export const DEFAULT_CHANNEL_ADMIN_PERMS: ChannelAdminPerms = {
  postMessages: true,
  editPosts: true,
  deletePosts: true,
  pinPosts: true,
  manageComments: true,
  manageSubscribers: true,
  manageChannelInfo: true,
  manageOtherAdmins: false,
  manageInvites: true,
  manageBots: false,
  manageAI: true,
  viewAnalytics: true,
  createPosts: true,
  manageChannel: true,
  manageSettings: true,
  manageMedia: true,
  manageLinks: true,
  manageReactions: true,
  banSubscribers: true,
};

export const CHANNEL_PERM_FA: Record<keyof ChannelAdminPerms, string> = {
  postMessages: "انتشار پست",
  editPosts: "ویرایش پست",
  deletePosts: "حذف پست",
  pinPosts: "پین پست",
  manageComments: "مدیریت نظر",
  manageSubscribers: "مدیریت دنبال‌کننده",
  manageChannelInfo: "ویرایش اطلاعات کانال",
  manageOtherAdmins: "مدیریت ادمین‌های دیگر",
  manageInvites: "مدیریت دعوت",
  manageBots: "مدیریت ربات",
  manageAI: "استفاده از AI کمکی",
  viewAnalytics: "آمار کانال",
  createPosts: "ایجاد پست",
  manageChannel: "مدیریت کانال",
  manageSettings: "تنظیمات کانال",
  manageMedia: "مدیریت رسانه",
  manageLinks: "مدیریت لینک دعوت",
  manageReactions: "مدیریت واکنش",
  banSubscribers: "بن مشترک",
};

export const LIFECYCLE_FA: Record<ChannelLifecycle, string> = {
  active: "فعال",
  restricted: "محدود",
  suspended: "معلق",
  deleted: "حذف‌شده",
};

export const PURPOSE_FA: Record<ChannelPurpose, string> = {
  general: "عمومی",
  news: "اخبار",
  products: "محصولات",
  promotions: "تخفیف",
  announcements: "اطلاعیه",
};

export function formatSubscribers(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1).replace(/\.0$/, "")}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1).replace(/\.0$/, "")}K`;
  return String(n);
}
