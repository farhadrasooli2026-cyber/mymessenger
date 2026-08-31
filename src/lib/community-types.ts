import type { GroupRole } from "@/lib/group-types";

export const COMMUNITY_FLOOD_WINDOW_MS = 20_000;
export const COMMUNITY_FLOOD_MAX = 8;

export type CommunityRole = GroupRole;
export type NotifyMode = "all" | "mentions" | "important" | "mute";

export type CommunityPerms = {
  sendMessages: boolean;
  sendMedia: boolean;
  sendFiles: boolean;
  createPosts: boolean;
  inviteMembers: boolean;
  addGroups: boolean;
  addChannels: boolean;
  manageMembers: boolean;
  manageMessages: boolean;
};

export const DEFAULT_COMMUNITY_PERMS: CommunityPerms = {
  sendMessages: false,
  sendMedia: false,
  sendFiles: false,
  createPosts: false,
  inviteMembers: false,
  addGroups: false,
  addChannels: false,
  manageMembers: false,
  manageMessages: false,
};

export const COMMUNITY_PERM_FA: Record<keyof CommunityPerms, string> = {
  sendMessages: "ارسال پیام در فضای جامعه",
  sendMedia: "ارسال رسانه",
  sendFiles: "ارسال فایل",
  createPosts: "انتشار پست کانال",
  inviteMembers: "دعوت عضو",
  addGroups: "افزودن گروه",
  addChannels: "افزودن کانال",
  manageMembers: "مدیریت اعضا",
  manageMessages: "مدیریت پیام‌ها",
};

export const NOTIFY_FA: Record<NotifyMode, string> = {
  all: "همهٔ اعلان‌ها",
  mentions: "فقط منشن",
  important: "فقط مهم",
  mute: "بی‌صدا",
};
