export const INBOX_PIN_MAX = 8;
export const INBOX_FOLDER_MAX = 16;
export const INBOX_NAME_MAX = 32;

export const INBOX_KINDS = ["dm", "group", "channel", "community", "bot", "business"] as const;
export type InboxKind = (typeof INBOX_KINDS)[number];

export const FOLDER_ICONS = ["💬", "👤", "👥", "📢", "🤖", "💼", "⭐", "📁", "🔔", "🌙"] as const;

export const BUILTIN_FOLDERS = [
  { id: "all", name: "All Chats", icon: "💬", includeTypes: [...INBOX_KINDS] },
  { id: "unread", name: "Unread", icon: "🔔", includeTypes: [...INBOX_KINDS], unreadOnly: true },
  { id: "personal", name: "Personal", icon: "👤", includeTypes: ["dm"] as InboxKind[] },
  { id: "groups", name: "Groups", icon: "👥", includeTypes: ["group", "community"] as InboxKind[] },
  { id: "channels", name: "Channels", icon: "📢", includeTypes: ["channel"] as InboxKind[] },
  { id: "bots", name: "Bots", icon: "🤖", includeTypes: ["bot"] as InboxKind[] },
  { id: "business", name: "Business", icon: "💼", includeTypes: ["business"] as InboxKind[] },
  { id: "favorites", name: "Favorites", icon: "⭐", includeTypes: [...INBOX_KINDS], favoritesOnly: true },
  { id: "archived", name: "Archived Chats", icon: "📁", includeTypes: [...INBOX_KINDS], archived: true },
] as const;

export type ChatOrgSort = "recent" | "unread" | "name" | "favorites";
