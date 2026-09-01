export const DEFAULT_REACTIONS = ["❤️", "👍", "😂", "😮", "😢", "🔥", "🎉", "🙏"] as const;

export type EmojiEntry = { e: string; n: string; k: string[] };

export type EmojiCategory = { id: string; label: string; items: EmojiEntry[] };

export const EMOJI_CATEGORIES: EmojiCategory[] = [
  {
    id: "smileys",
    label: "Smileys",
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
    items: [
      { e: "👍", n: "thumbs up", k: ["ok", "like", "تأیید"] },
      { e: "👎", n: "thumbs down", k: ["no"] },
      { e: "👏", n: "clap", k: ["bravo"] },
      { e: "🙌", n: "raised hands", k: ["hooray"] },
      { e: "🙏", n: "pray", k: ["please", "thanks", "ممنون"] },
      { e: "🤝", n: "handshake", k: ["deal"] },
      { e: "✌️", n: "victory", k: ["peace"] },
      { e: "🤞", n: "crossed fingers", k: ["luck"] },
      { e: "👋", n: "wave", k: ["hi", "سلام"] },
      { e: "💪", n: "muscle", k: ["strong"] },
      { e: "🫶", n: "heart hands", k: ["love"] },
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
    items: [
      { e: "👋", n: "wave", k: ["hi"] },
      { e: "🧑", n: "person", k: ["person"] },
      { e: "👩", n: "woman", k: ["woman"] },
      { e: "👨", n: "man", k: ["man"] },
      { e: "👶", n: "baby", k: ["baby"] },
      { e: "🧓", n: "older", k: ["elder"] },
    ],
  },
  {
    id: "nature",
    label: "Nature",
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
  const t = value.trim();
  if (!t || t.length > 8) return false;
  if (/[\u0000-\u001f<>&"'`]/.test(t)) return false;
  return /\p{Extended_Pictographic}|\p{Emoji_Presentation}|[\u200d\ufe0f]/u.test(t) || DEFAULT_REACTIONS.includes(t as (typeof DEFAULT_REACTIONS)[number]);
}
