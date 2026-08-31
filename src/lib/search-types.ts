export const SEARCH_PAGE = 20;
export const SEARCH_FLOOD_WINDOW_MS = 60_000;
export const SEARCH_FLOOD_MAX = 40;
export const SEARCH_HISTORY_MAX = 20;

export const SEARCH_KINDS = [
  "all",
  "users",
  "groups",
  "channels",
  "communities",
  "messages",
  "photos",
  "videos",
  "files",
  "links",
  "voice",
  "music",
] as const;

export type SearchKind = (typeof SEARCH_KINDS)[number];

export const SAVED_TAGS = ["Work", "Personal", "Important", "Downloads", "Projects"] as const;
export const SAVED_MAX_MEDIA = 420_000;

export type SearchHit = {
  id: string;
  scope: "user" | "group" | "channel" | "community" | "channelPost" | "communityPost" | "saved" | "chatLocal";
  title: string;
  preview: string;
  sender: string;
  chatName: string;
  date: number;
  kind: string;
  target: {
    type: "user" | "group" | "channel" | "community" | "chat" | "saved";
    id: string;
    messageId?: string;
  };
};
