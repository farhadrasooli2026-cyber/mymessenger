export const INBOX_PIN_MAX = 10_000;
export const INBOX_FOLDER_MAX = 16;
export const INBOX_NAME_MAX = 32;

export const INBOX_KINDS = ["dm", "group", "channel", "community", "bot", "business"] as const;
export type InboxKind = (typeof INBOX_KINDS)[number];

export const FOLDER_ICONS = ["💬", "👤", "👥", "📢", "🤖", "💼", "⭐", "📁", "🔔", "🌙"] as const;

export const BUILTIN_FOLDERS = [
  { id: "all", name: "همه", icon: "💬", includeTypes: [...INBOX_KINDS] },
  { id: "unread", name: "نخوانده", icon: "🔔", includeTypes: [...INBOX_KINDS], unreadOnly: true },
  { id: "personal", name: "شخصی", icon: "👤", includeTypes: ["dm"] as InboxKind[] },
  { id: "groups", name: "گروه‌ها", icon: "👥", includeTypes: ["group", "community"] as InboxKind[] },
  { id: "channels", name: "کانال‌ها", icon: "📢", includeTypes: ["channel"] as InboxKind[] },
  { id: "bots", name: "ربات‌ها", icon: "🤖", includeTypes: ["bot"] as InboxKind[] },
  { id: "business", name: "کسب‌وکار", icon: "💼", includeTypes: ["business"] as InboxKind[] },
  { id: "favorites", name: "برگزیده‌ها", icon: "⭐", includeTypes: [...INBOX_KINDS], favoritesOnly: true },
  { id: "archived", name: "بایگانی", icon: "📁", includeTypes: [...INBOX_KINDS], archived: true },
] as const;

export type ChatOrgSort = "recent" | "unread" | "name" | "favorites";
