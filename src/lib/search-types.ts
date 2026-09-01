export const SEARCH_PAGE = 20;
export const SEARCH_FLOOD_WINDOW_MS = 60_000;
export const SEARCH_FLOOD_MAX = 40;
export const SEARCH_HISTORY_MAX = 20;

export const SEARCH_KINDS = [
  "all",
  "people",
  "users",
  "chats",
  "messages",
  "groups",
  "channels",
  "communities",
  "bots",
  "mini",
  "business",
  "products",
  "files",
  "media",
  "photos",
  "videos",
  "gifs",
  "voice",
  "music",
  "links",
] as const;

export type SearchKind = (typeof SEARCH_KINDS)[number];

export { SAVED_TAGS, SAVED_MAX_MEDIA } from "@/lib/saved-types";

export type SearchHit = {
  id: string;
  scope:
    | "user"
    | "group"
    | "channel"
    | "community"
    | "channelPost"
    | "communityPost"
    | "saved"
    | "chatLocal"
    | "bot"
    | "business"
    | "mini"
    | "product"
    | "chat";
  title: string;
  preview: string;
  sender: string;
  chatName: string;
  date: number;
  kind: string;
  score?: number;
  photoUrl?: string | null;
  verified?: boolean;
  members?: number;
  visibility?: string;
  location?: string | null;
  price?: number;
  currency?: string;
  category?: string;
  username?: string | null;
  target: {
    type: "user" | "group" | "channel" | "community" | "chat" | "saved" | "bot" | "business" | "mini" | "product";
    id: string;
    messageId?: string;
    businessId?: string;
  };
};
