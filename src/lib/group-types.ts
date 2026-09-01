export const GROUP_MAX_MEMBERS = 256;
export const GROUP_MAX_PINS = 5;
export const GROUP_FLOOD_WINDOW_MS = 20_000;
export const GROUP_FLOOD_MAX = 10;
export const GROUP_OWNED_MAX = 20;
export const GROUP_CREATE_WINDOW_MS = 60 * 60 * 1000;
export const GROUP_CREATE_MAX = 8;
export const GROUP_JOIN_WINDOW_MS = 10 * 60 * 1000;
export const GROUP_JOIN_MAX = 20;
export const GROUP_INVITE_WINDOW_MS = 10 * 60 * 1000;
export const GROUP_INVITE_MAX = 40;
export const GROUP_MEMBER_PAGE = 40;
export const GROUP_CATEGORIES = ["general", "friends", "work", "gaming", "education", "local", "tech", "art"] as const;
export type GroupCategory = (typeof GROUP_CATEGORIES)[number];

export type CustomGroupRole = {
  id: string;
  name: string;
  inviteMembers: boolean;
  pinMessages: boolean;
  deleteMessages: boolean;
  muteMembers: boolean;
};
export const GROUP_STORAGE_MAX_ITEMS = 2000;
export const GROUP_SLOW_PRESETS = [
  { id: "off", ms: 0, label: "خاموش" },
  { id: "10s", ms: 10_000, label: "۱۰ ثانیه" },
  { id: "30s", ms: 30_000, label: "۳۰ ثانیه" },
  { id: "1m", ms: 60_000, label: "۱ دقیقه" },
  { id: "5m", ms: 300_000, label: "۵ دقیقه" },
] as const;

export type GroupRole = "owner" | "admin" | "moderator" | "member";

export type GroupPerms = {
  sendMessages: boolean;
  sendPhotos: boolean;
  sendVideos: boolean;
  sendFiles: boolean;
  sendVoice: boolean;
  sendLinks: boolean;
  addMembers: boolean;
  changeInfo: boolean;
  pinMessages: boolean;
  createPolls: boolean;
  startCalls: boolean;
};

export const DEFAULT_GROUP_PERMS: GroupPerms = {
  sendMessages: true,
  sendPhotos: true,
  sendVideos: true,
  sendFiles: true,
  sendVoice: true,
  sendLinks: true,
  addMembers: false,
  changeInfo: false,
  pinMessages: false,
  createPolls: false,
  startCalls: true,
};

export type GroupAdminPerms = {
  manageGroup: boolean;
  addMembers: boolean;
  removeMembers: boolean;
  deleteMessages: boolean;
  pinMessages: boolean;
  manageCalls: boolean;
  manageInvites: boolean;
  managePermissions: boolean;
};

export const DEFAULT_GROUP_ADMIN_PERMS: GroupAdminPerms = {
  manageGroup: true,
  addMembers: true,
  removeMembers: true,
  deleteMessages: true,
  pinMessages: true,
  manageCalls: true,
  manageInvites: true,
  managePermissions: false,
};

export const ROLE_FA: Record<GroupRole, string> = {
  owner: "مالک",
  admin: "ادمین",
  moderator: "ناظم",
  member: "عضو",
};

export function rankRole(role: GroupRole): number {
  if (role === "owner") return 4;
  if (role === "admin") return 3;
  if (role === "moderator") return 2;
  return 1;
}

export const MUTE_PRESETS = [
  { id: "1h", ms: 60 * 60 * 1000, label: "۱ ساعت" },
  { id: "1d", ms: 24 * 60 * 60 * 1000, label: "۱ روز" },
  { id: "1w", ms: 7 * 24 * 60 * 1000, label: "۱ هفته" },
] as const;

export const PERM_FA: Record<keyof GroupPerms, string> = {
  sendMessages: "ارسال پیام",
  sendPhotos: "ارسال عکس / GIF",
  sendVideos: "ارسال ویدیو",
  sendFiles: "ارسال فایل",
  sendVoice: "ارسال صوت",
  sendLinks: "ارسال لینک",
  addMembers: "افزودن عضو",
  changeInfo: "تغییر اطلاعات گروه",
  pinMessages: "پین پیام",
  createPolls: "ساخت نظرسنجی",
  startCalls: "شروع تماس گروهی",
};

export const ADMIN_PERM_FA: Record<keyof GroupAdminPerms, string> = {
  manageGroup: "مدیریت گروه",
  addMembers: "افزودن عضو",
  removeMembers: "حذف / بن عضو",
  deleteMessages: "حذف پیام",
  pinMessages: "پین پیام",
  manageCalls: "مدیریت تماس",
  manageInvites: "مدیریت دعوت",
  managePermissions: "تغییر مجوز اعضا",
};

export const GROUP_FOLDER_PRESETS = ["Friends", "Work", "Gaming"] as const;

export type GroupHistoryMode = "all" | "from-join";
