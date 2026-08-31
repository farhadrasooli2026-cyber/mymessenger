import type { GroupRole } from "@/lib/group-types";

export const CHANNEL_FLOOD_WINDOW_MS = 20_000;
export const CHANNEL_FLOOD_MAX = 8;
export const CHANNEL_SUBSCRIBE_WINDOW_MS = 60_000;
export const CHANNEL_SUBSCRIBE_MAX = 12;

export type ChannelStaffRole = Extract<GroupRole, "owner" | "admin" | "moderator">;
export type ChannelNotify = "on" | "off" | "important";
export type ChannelPostKind = "text" | "photo" | "video" | "voice" | "file" | "link" | "poll" | "album";
export type ChannelPostStatus = "draft" | "scheduled" | "published";

export type ChannelAdminPerms = {
  postMessages: boolean;
  editPosts: boolean;
  deletePosts: boolean;
  pinPosts: boolean;
  manageComments: boolean;
  manageSubscribers: boolean;
  manageChannelInfo: boolean;
  manageOtherAdmins: boolean;
};

export const DEFAULT_CHANNEL_ADMIN_PERMS: ChannelAdminPerms = {
  postMessages: true,
  editPosts: true,
  deletePosts: true,
  pinPosts: true,
  manageComments: true,
  manageSubscribers: true,
  manageChannelInfo: true,
  manageOtherAdmins: false,
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
};

export function formatSubscribers(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1).replace(/\.0$/, "")}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1).replace(/\.0$/, "")}K`;
  return String(n);
}
