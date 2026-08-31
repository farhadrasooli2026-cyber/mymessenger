export const GROUP_MAX_MEMBERS = 256;
export const GROUP_MAX_PINS = 5;
export const GROUP_FLOOD_WINDOW_MS = 20_000;
export const GROUP_FLOOD_MAX = 10;

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
  { id: "1w", ms: 7 * 24 * 60 * 60 * 1000, label: "۱ هفته" },
] as const;

export const PERM_FA: Record<keyof GroupPerms, string> = {
  sendMessages: "ارسال پیام",
  sendPhotos: "ارسال عکس",
  sendVideos: "ارسال ویدیو",
  sendFiles: "ارسال فایل",
  sendVoice: "ارسال صوت",
  sendLinks: "ارسال لینک",
  addMembers: "افزودن عضو",
  changeInfo: "تغییر اطلاعات گروه",
  pinMessages: "پین پیام",
  createPolls: "ساخت نظرسنجی",
};
