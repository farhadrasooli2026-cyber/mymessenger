export const SAVED_MAX_MEDIA = 420_000;
export const SAVED_PIN_MAX = 12;
export const SAVED_FOLDER_MAX = 16;
export const SAVED_TRASH_MS = 14 * 24 * 60 * 60 * 1000;
export const SAVED_NAME_MAX = 32;
export const SAVED_MEDIA_TOKEN_MS = 10 * 60 * 1000;

export const SAVED_KINDS = [
  "text",
  "photo",
  "video",
  "audio",
  "voice",
  "file",
  "link",
  "contact",
  "location",
  "sticker",
  "message",
] as const;

export type SavedKind = (typeof SAVED_KINDS)[number];

export const SAVED_TAGS = ["Work", "Personal", "Important", "Later", "Downloads", "Projects"] as const;

export const BOOKMARK_PRESETS = [
  { id: "work", name: "Work", icon: "💼" },
  { id: "personal", name: "Personal", icon: "👤" },
  { id: "important", name: "Important", icon: "⭐" },
  { id: "later", name: "Later", icon: "🕓" },
] as const;

export type SavedSort = "newest" | "oldest" | "saved" | "type" | "chat";

export const SAVED_VIEWS = [
  { id: "all", label: "همه" },
  { id: "media", label: "Saved Media" },
  { id: "photo", label: "Photos" },
  { id: "video", label: "Videos" },
  { id: "audio", label: "Audio" },
  { id: "voice", label: "Voice" },
  { id: "file", label: "Files" },
  { id: "link", label: "Links" },
  { id: "bookmarks", label: "Bookmarks" },
  { id: "trash", label: "Trash" },
] as const;
