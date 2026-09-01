export const DEFAULT_REACTIONS = ["❤️", "👍", "😂", "😮", "😢", "🔥", "🎉", "🙏"] as const;

export type EmojiEntry = { e: string; n: string; k: string[]; tone?: boolean };

export type EmojiCategory = { id: string; label: string; labelFa: string; items: EmojiEntry[] };

export const SKIN_TONES = [
  { id: "default", modifier: "", swatch: "#f5d0c5", label: "پیش‌فرض" },
  { id: "1f3fb", modifier: "\u{1F3FB}", swatch: "#fadcbc", label: "روشن" },
  { id: "1f3fc", modifier: "\u{1F3FC}", swatch: "#e0bb95", label: "متوسط روشن" },
  { id: "1f3fd", modifier: "\u{1F3FD}", swatch: "#bf8f68", label: "متوسط" },
  { id: "1f3fe", modifier: "\u{1F3FE}", swatch: "#9b643d", label: "متوسط تیره" },
  { id: "1f3ff", modifier: "\u{1F3FF}", swatch: "#594539", label: "تیره" },
] as const;

const SKIN_RE = /[\u{1F3FB}-\u{1F3FF}]/gu;

export function normalizeEmoji(value: string): string {
  return value.normalize("NFC").trim();
}

export function stripSkinTone(emoji: string): string {
  return normalizeEmoji(emoji).replace(SKIN_RE, "").replace(/\uFE0F/g, "");
}

export function applySkinTone(emoji: string, modifier: string): string {
  const base = stripSkinTone(emoji);
  if (!modifier) return normalizeEmoji(emoji);
  if (!TONEABLE.has(base) && !TONEABLE.has(emoji)) return normalizeEmoji(emoji);
  return normalizeEmoji(base + modifier);
}

export const TONEABLE = new Set(["👍", "👎", "👏", "🙌", "🙏", "✌️", "🤞", "👋", "💪", "🫶", "🧑", "👩", "👨", "👶", "🧓"]);

export const EMOJI_CATEGORIES: EmojiCategory[] = [
  {
    id: "smileys",
    label: "Smileys",
    labelFa: "صورت‌ها",
    items: [
      { e: "😀", n: "grinning", k: ["happy", "smile", "خوشحال"] },
      { e: "😃", n: "smiley", k: ["happy", "خوشحال"] },
      { e: "😄", n: "smile", k: ["happy", "لبخند"] },
      { e: "😁", n: "grin", k: ["happy"] },
      { e: "😆", n: "laughing", k: ["lol", "خنده"] },
      { e: "😅", n: "sweat smile", k: ["relief"] },
      { e: "🤣", n: "rofl", k: ["lol", "خنده"] },
      { e: "😂", n: "joy", k: ["lol", "cry", "خنده"] },
      { e: "🙂", n: "slight smile", k: ["smile"] },
      { e: "😉", n: "wink", k: ["wink"] },
      { e: "😊", n: "blush", k: ["happy"] },
      { e: "😇", n: "innocent", k: ["angel"] },
      { e: "😍", n: "heart eyes", k: ["love", "عاشق"] },
      { e: "🥰", n: "smiling hearts", k: ["love"] },
      { e: "😘", n: "kiss", k: ["love"] },
      { e: "😋", n: "yum", k: ["food"] },
      { e: "😜", n: "stuck out tongue wink", k: ["play"] },
      { e: "🤪", n: "zany", k: ["crazy"] },
      { e: "🤗", n: "hug", k: ["hug"] },
      { e: "🤔", n: "thinking", k: ["hmm", "فکر"] },
      { e: "😐", n: "neutral", k: ["meh"] },
      { e: "😴", n: "sleeping", k: ["sleep"] },
      { e: "😷", n: "mask", k: ["sick"] },
      { e: "🤒", n: "thermometer", k: ["sick"] },
      { e: "🥶", n: "cold", k: ["cold"] },
      { e: "😎", n: "sunglasses", k: ["cool"] },
      { e: "🥳", n: "party", k: ["party", "جشن"] },
      { e: "😭", n: "sob", k: ["cry", "گریه"] },
      { e: "😤", n: "triumph", k: ["angry"] },
      { e: "😡", n: "rage", k: ["angry", "عصبانی"] },
      { e: "💀", n: "skull", k: ["dead"] },
      { e: "👻", n: "ghost", k: ["ghost"] },
    ],
  },
  {
    id: "gestures",
    label: "Gestures",
    labelFa: "ژست‌ها",
    items: [
      { e: "👍", n: "thumbs up", k: ["ok", "like", "تأیید"], tone: true },
      { e: "👎", n: "thumbs down", k: ["no"], tone: true },
      { e: "👏", n: "clap", k: ["bravo"], tone: true },
      { e: "🙌", n: "raised hands", k: ["hooray"], tone: true },
      { e: "🙏", n: "pray", k: ["please", "thanks", "ممنون"], tone: true },
      { e: "🤝", n: "handshake", k: ["deal"] },
      { e: "✌️", n: "victory", k: ["peace"], tone: true },
      { e: "🤞", n: "crossed fingers", k: ["luck"], tone: true },
      { e: "👋", n: "wave", k: ["hi", "سلام"], tone: true },
      { e: "💪", n: "muscle", k: ["strong"], tone: true },
      { e: "🫶", n: "heart hands", k: ["love"], tone: true },
      { e: "❤️", n: "red heart", k: ["love", "قلب"] },
      { e: "🧡", n: "orange heart", k: ["love"] },
      { e: "💛", n: "yellow heart", k: ["love"] },
      { e: "💚", n: "green heart", k: ["love"] },
      { e: "💙", n: "blue heart", k: ["love"] },
      { e: "💜", n: "purple heart", k: ["love"] },
      { e: "🖤", n: "black heart", k: ["love"] },
      { e: "💔", n: "broken heart", k: ["sad"] },
      { e: "🔥", n: "fire", k: ["hot", "آتش"] },
      { e: "✨", n: "sparkles", k: ["shine"] },
      { e: "⭐", n: "star", k: ["star"] },
      { e: "🎉", n: "tada", k: ["party"] },
      { e: "💯", n: "hundred", k: ["perfect"] },
    ],
  },
  {
    id: "people",
    label: "People",
    labelFa: "افراد",
    items: [
      { e: "👋", n: "wave", k: ["hi"], tone: true },
      { e: "🧑", n: "person", k: ["person"], tone: true },
      { e: "👩", n: "woman", k: ["woman"], tone: true },
      { e: "👨", n: "man", k: ["man"], tone: true },
      { e: "👶", n: "baby", k: ["baby"], tone: true },
      { e: "🧓", n: "older", k: ["elder"], tone: true },
    ],
  },
  {
    id: "nature",
    label: "Nature",
    labelFa: "طبیعت",
    items: [
      { e: "🐶", n: "dog", k: ["dog", "سگ"] },
      { e: "🐱", n: "cat", k: ["cat", "گربه"] },
      { e: "🦊", n: "fox", k: ["fox"] },
      { e: "🐻", n: "bear", k: ["bear"] },
      { e: "🐼", n: "panda", k: ["panda"] },
      { e: "🌸", n: "cherry blossom", k: ["flower"] },
      { e: "🌈", n: "rainbow", k: ["rainbow"] },
      { e: "☀️", n: "sun", k: ["sun"] },
      { e: "🌙", n: "moon", k: ["night"] },
      { e: "⚡", n: "zap", k: ["energy"] },
      { e: "❄️", n: "snowflake", k: ["cold"] },
    ],
  },
  {
    id: "food",
    label: "Food",
    labelFa: "خوراکی",
    items: [
      { e: "🍎", n: "apple", k: ["fruit"] },
      { e: "🍕", n: "pizza", k: ["food"] },
      { e: "🍔", n: "burger", k: ["food"] },
      { e: "🍣", n: "sushi", k: ["food"] },
      { e: "☕", n: "coffee", k: ["drink"] },
      { e: "🍰", n: "cake", k: ["dessert"] },
      { e: "🍫", n: "chocolate", k: ["sweet"] },
    ],
  },
  {
    id: "travel",
    label: "Travel",
    labelFa: "سفر",
    items: [
      { e: "🏠", n: "house", k: ["home"] },
      { e: "✈️", n: "airplane", k: ["travel"] },
      { e: "🚗", n: "car", k: ["car"] },
      { e: "🚀", n: "rocket", k: ["fast"] },
      { e: "🌍", n: "earth", k: ["world"] },
    ],
  },
  {
    id: "objects",
    label: "Objects",
    labelFa: "اشیا",
    items: [
      { e: "💡", n: "bulb", k: ["idea"] },
      { e: "📱", n: "phone", k: ["phone"] },
      { e: "💻", n: "laptop", k: ["work"] },
      { e: "📎", n: "paperclip", k: ["file"] },
      { e: "🔒", n: "lock", k: ["secure"] },
      { e: "🔑", n: "key", k: ["key"] },
    ],
  },
  {
    id: "symbols",
    label: "Symbols",
    labelFa: "نمادها",
    items: [
      { e: "✅", n: "check", k: ["ok"] },
      { e: "❌", n: "x", k: ["no"] },
      { e: "⚠️", n: "warning", k: ["warn"] },
      { e: "❓", n: "question", k: ["what"] },
      { e: "❗", n: "exclamation", k: ["alert"] },
      { e: "➕", n: "plus", k: ["add"] },
    ],
  },
];

export const ALL_EMOJI: EmojiEntry[] = EMOJI_CATEGORIES.flatMap((c) => c.items);

export function searchEmoji(q: string): EmojiEntry[] {
  const n = q.trim().toLowerCase();
  if (!n) return ALL_EMOJI;
  return ALL_EMOJI.filter(
    (item) => item.e.includes(n) || item.n.includes(n) || item.k.some((k) => k.includes(n)),
  );
}

export function isLikelyEmoji(value: string): boolean {
  const t = normalizeEmoji(value);
  if (!t || t.length > 24) return false;
  if (/[\u0000-\u001f<>&"'`]/.test(t)) return false;
  return /\p{Extended_Pictographic}|\p{Emoji_Presentation}|[\u200d\ufe0f\u{1F3FB}-\u{1F3FF}]/u.test(t) || DEFAULT_REACTIONS.includes(t as (typeof DEFAULT_REACTIONS)[number]);
}

export function reactionAllowed(allowed: string[], emoji: string): boolean {
  const safe = normalizeEmoji(emoji);
  if (allowed.includes(safe)) return true;
  const base = stripSkinTone(safe);
  return allowed.includes(base);
}
