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
export const CHANNEL_SCHEDULE_MAX_MS = 30 * 24 * 60 * 60_000;

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
