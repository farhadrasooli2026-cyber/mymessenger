export const SEARCH_PAGE = 20;
export const SEARCH_FLOOD_WINDOW_MS = 60_000;
export const SEARCH_FLOOD_MAX = 40;
export const SEARCH_HISTORY_MAX = 20;
export const SEARCH_INDEX_RETRY_MAX = 5;
export const SEARCH_CACHE_TTL_MS = 15_000;

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
  "audio",
  "images",
  "music",
  "links",
  "live",
  "hashtags",
  "mentions",
  "stickers",
  "emoji",
  "highlights",
  "members",
  "subscribers",
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
    | "chat"
    | "live"
    | "hashtag"
    | "mention"
    | "sticker"
    | "emoji"
    | "highlight"
    | "member"
    | "subscriber";
  title: string;
  preview: string;
  sender: string;
  chatName: string;
  date: number;
  kind: string;
  score?: number;
  photoUrl?: string | null;
  fileName?: string | null;
  fileKind?: string | null;
  verified?: boolean;
  members?: number;
  visibility?: string;
  location?: string | null;
  price?: number;
  currency?: string;
  category?: string;
  username?: string | null;
  highlight?: { t: string; hit: boolean }[];
  target: {
    type: "user" | "group" | "channel" | "community" | "chat" | "saved" | "bot" | "business" | "mini" | "product" | "live" | "hashtag" | "sticker" | "highlight";
    id: string;
    messageId?: string;
    businessId?: string;
  };
};

export type SearchDoc = {
  id: string;
  kind: "user" | "group" | "channel" | "post" | "sticker";
  entityId: string;
  parentId?: string;
  title: string;
  preview: string;
  tags: string[];
  public: true;
  updatedAt: number;
};

export type SearchIndexJob = {
  id: string;
  idempotencyKey: string;
  kind: "sync" | "delete";
  status: "queued" | "running" | "done" | "failed";
  attempts: number;
  nextAt?: number;
  lastError?: string;
  createdAt: number;
};

export type SearchQueryCache = {
  key: string;
  gen: number;
  at: number;
  userId: string;
  hitIds: string[];
};

export type SearchMetrics = {
  queries: number;
  errors: number;
  cacheHits: number;
  lastLatencyMs: number;
  lastError?: string;
  emptyResults?: number;
  opens?: number;
};
