export const LIVE_CREATE_WINDOW_MS = 10 * 60_000;
export const LIVE_CREATE_MAX = 4;
export const LIVE_JOIN_PER_MIN = 24;
export const LIVE_CHAT_PER_MIN = 24;
export const LIVE_REACT_PER_MIN = 48;
export const LIVE_GUEST_REQ_PER_MIN = 8;
export const LIVE_MAX_VIEWERS_HARD = 200;
export const LIVE_RECORD_MAX_BYTES = 8 * 1024 * 1024;
export const LIVE_CHAT_MAX = 240;
export const LIVE_INVITE_TTL_MS = 12 * 60 * 60_000;
export const LIVE_ACCESS_TTL_MS = 8 * 60_000;

export const LIVE_CATEGORIES = ["talk", "music", "news", "education", "gaming", "business", "other"] as const;
export type LiveCategory = (typeof LIVE_CATEGORIES)[number];

export type LiveVisibility = "public" | "private" | "members" | "invite";
export type LiveStatus = "scheduled" | "starting" | "live" | "paused" | "ended";
export type LiveRole = "host" | "cohost" | "guest" | "moderator" | "viewer";
export type LiveScope = "solo" | "group" | "channel";
export type LiveQuality = "auto" | "low" | "medium" | "high";

export type LiveGuestPerms = { camera: boolean; mic: boolean; screen: boolean };

export type LiveParticipant = {
  userId: string;
  name: string;
  role: LiveRole;
  joinedAt: number;
  leftAt: number | null;
  mutedChatUntil: number | null;
  kicked: boolean;
  banned: boolean;
  camera: boolean;
  mic: boolean;
  guestPerms: LiveGuestPerms;
  joinCount: number;
};

export type LiveChatMsg = {
  id: string;
  userId: string;
  name: string;
  body: string;
  createdAt: number;
  deleted: boolean;
};

export type LiveRecordingMeta = {
  id: string;
  liveId: string;
  hostUserId: string;
  createdAt: number;
  size: number;
  durationMs: number;
  mime: string;
  deletedAt: number | null;
};

export type LivePrefs = {
  userId: string;
  notifyLive: boolean;
  hideLiveOnLockScreen: boolean;
  adultConfirmed: boolean;
  region: string;
};

export type LiveStream = {
  id: string;
  hostUserId: string;
  hostName: string;
  scope: LiveScope;
  groupId: string | null;
  channelId: string | null;
  title: string;
  description: string;
  thumbDataUrl: string;
  visibility: LiveVisibility;
  allowIds: string[];
  status: LiveStatus;
  scheduledAt: number | null;
  startedAt: number | null;
  endedAt: number | null;
  pausedAt: number | null;
  audioOnly: boolean;
  quality: LiveQuality;
  chatEnabled: boolean;
  slowModeMs: number;
  reactionsEnabled: boolean;
  guestRequestsEnabled: boolean;
  recordEnabled: boolean;
  maxViewers: number;
  ageRestricted: boolean;
  geoHint: string;
  category: LiveCategory;
  tags: string[];
  inviteToken: string | null;
  inviteExpiresAt: number | null;
  copyrightFlag: boolean;
  emergencyStopped: boolean;
  peakViewers: number;
  uniqueJoins: string[];
  chat: LiveChatMsg[];
  participants: LiveParticipant[];
  guestQueue: { userId: string; name: string; at: number }[];
  reminders: { userId: string; at: number }[];
  reactionCount: number;
  modLog: { id: string; actorId: string; action: string; targetId?: string; at: number }[];
  recordingId: string | null;
  createdAt: number;
};

export const DEFAULT_LIVE_PREFS = (userId: string): LivePrefs => ({
  userId,
  notifyLive: true,
  hideLiveOnLockScreen: false,
  adultConfirmed: false,
  region: "",
});
