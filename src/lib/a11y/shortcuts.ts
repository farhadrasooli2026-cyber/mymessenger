/** Documented shortcuts. Never bind reserved browser/OS combos. */

export type ShortcutScope = "global" | "chat" | "search" | "call";

export type ShortcutDef = {
  id: string;
  combo: string;
  keys: { alt?: boolean; shift?: boolean; ctrl?: boolean; meta?: boolean; key: string };
  scope: ShortcutScope;
  description: string;
  descriptionEn: string;
};

/** Combos we refuse to register (browser/OS). */
export const RESERVED_SHORTCUTS = [
  "ctrl+t",
  "ctrl+n",
  "ctrl+w",
  "ctrl+l",
  "ctrl+r",
  "ctrl+p",
  "ctrl+s",
  "ctrl+o",
  "ctrl+tab",
  "alt+f4",
  "ctrl+shift+t",
  "ctrl+shift+n",
  "meta+t",
  "meta+w",
  "meta+l",
  "meta+r",
];

export const A11Y_SHORTCUTS: ShortcutDef[] = [
  {
    id: "help",
    combo: "alt+shift+/",
    keys: { alt: true, shift: true, key: "/" },
    scope: "global",
    description: "فهرست میانبرهای صفحه‌کلید",
    descriptionEn: "Keyboard shortcut help",
  },
  {
    id: "search",
    combo: "alt+shift+f",
    keys: { alt: true, shift: true, key: "f" },
    scope: "global",
    description: "باز کردن جستجو",
    descriptionEn: "Open search",
  },
  {
    id: "nav-chats",
    combo: "alt+1",
    keys: { alt: true, key: "1" },
    scope: "global",
    description: "گفتگوها",
    descriptionEn: "Chats",
  },
  {
    id: "nav-calls",
    combo: "alt+2",
    keys: { alt: true, key: "2" },
    scope: "global",
    description: "تماس‌ها",
    descriptionEn: "Calls",
  },
  {
    id: "nav-spaces",
    combo: "alt+3",
    keys: { alt: true, key: "3" },
    scope: "global",
    description: "فضاها",
    descriptionEn: "Spaces",
  },
  {
    id: "nav-me",
    combo: "alt+4",
    keys: { alt: true, key: "4" },
    scope: "global",
    description: "حساب من",
    descriptionEn: "Me",
  },
  {
    id: "escape",
    combo: "escape",
    keys: { key: "escape" },
    scope: "global",
    description: "بستن پنل، مودال یا جستجو",
    descriptionEn: "Close overlay",
  },
  {
    id: "send",
    combo: "ctrl+enter",
    keys: { ctrl: true, key: "enter" },
    scope: "chat",
    description: "ارسال پیام",
    descriptionEn: "Send message",
  },
  {
    id: "older",
    combo: "alt+shift+arrowup",
    keys: { alt: true, shift: true, key: "arrowup" },
    scope: "chat",
    description: "بارگذاری پیام‌های قدیمی‌تر",
    descriptionEn: "Load older messages",
  },
];

export function normalizeCombo(input: { alt?: boolean; shift?: boolean; ctrl?: boolean; meta?: boolean; key: string }): string {
  const parts: string[] = [];
  if (input.ctrl || input.meta) parts.push(input.meta ? "meta" : "ctrl");
  if (input.alt) parts.push("alt");
  if (input.shift) parts.push("shift");
  parts.push(input.key.toLowerCase());
  return parts.join("+");
}

export function isReservedCombo(combo: string): boolean {
  return RESERVED_SHORTCUTS.includes(combo.toLowerCase());
}

export function matchShortcut(e: { altKey: boolean; shiftKey: boolean; ctrlKey: boolean; metaKey: boolean; key: string }, def: ShortcutDef): boolean {
  const key = e.key.toLowerCase();
  if (key !== def.keys.key.toLowerCase()) return false;
  if (Boolean(def.keys.alt) !== e.altKey) return false;
  if (Boolean(def.keys.shift) !== e.shiftKey) return false;
  const wantCtrl = Boolean(def.keys.ctrl);
  const wantMeta = Boolean(def.keys.meta);
  if (wantCtrl) return e.ctrlKey || e.metaKey;
  if (wantMeta) return e.metaKey;
  if (def.keys.key === "escape") return true;
  return !e.ctrlKey && !e.metaKey;
}

export function typingTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  const tag = target.tagName;
  if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return true;
  return target.isContentEditable;
}
