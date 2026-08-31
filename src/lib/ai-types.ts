export const AI_TOPICS = [
  { id: "general", label: "عمومی", hint: "سؤال، ایده، کارهای روزمره" },
  { id: "coding", label: "Coding", hint: "کد و توضیح فنی" },
  { id: "translation", label: "Translation", hint: "فارسی، انگلیسی، ترکی" },
  { id: "business", label: "Business", hint: "ایمیل و متن کاری" },
  { id: "study", label: "Study", hint: "خلاصه و یادگیری" },
  { id: "ideas", label: "Ideas", hint: "ایده و طوفان فکری" },
  { id: "writing", label: "Writing", hint: "نوشتن و بازنویسی" },
] as const;

export type AiTopic = (typeof AI_TOPICS)[number]["id"];

export const AI_MODELS = [
  { id: "fast", name: "NIXO Fast", detail: "پاسخ کوتاه و سریع روی موتور داخلی نیکسو" },
  { id: "balanced", name: "NIXO Balanced", detail: "ترجمه، نوشتن و خلاصه با زمینهٔ گفتگو" },
  { id: "advanced", name: "NIXO Advanced", detail: "پاسخ بلندتر، فایل و تصویر SVG محلی (سهمیهٔ روزانه)" },
] as const;

export type AiModelId = (typeof AI_MODELS)[number]["id"];

export const AI_FREE = {
  messagesPerDay: 48,
  filesPerDay: 8,
  imagesPerDay: 6,
};

export type AiIntent =
  | "chat"
  | "translate"
  | "summarize"
  | "write"
  | "rewrite"
  | "shorten"
  | "expand"
  | "tone"
  | "grammar"
  | "reply"
  | "ideas"
  | "image"
  | "describe"
  | "ocr"
  | "file"
  | "spam";

export type AiChatRecord = {
  id: string;
  userId: string;
  title: string;
  topic: AiTopic;
  model: AiModelId;
  createdAt: number;
  updatedAt: number;
};

export type AiMessageRecord = {
  id: string;
  chatId: string;
  userId: string;
  role: "user" | "assistant";
  text: string;
  intent: AiIntent;
  createdAt: number;
  stopped?: boolean;
  feedback?: "up" | "down" | null;
  imageSvg?: string | null;
};

export type AiMemoryItem = {
  id: string;
  userId: string;
  fact: string;
  createdAt: number;
};

export type AiPrefs = {
  userId: string;
  saveHistory: boolean;
  memoryEnabled: boolean;
  composerOnDevice: boolean;
  allowCloudE2ee: boolean;
  groupAssist: boolean;
  channelAssist: boolean;
  model: AiModelId;
  voiceOut: boolean;
  updatedAt: number;
};

export type AiLog = {
  id: string;
  userId: string;
  at: number;
  kind: "chat" | "tool" | "abuse" | "consent" | "delete";
  summary: string;
};

export const DEFAULT_AI_PREFS: Omit<AiPrefs, "userId" | "updatedAt"> = {
  saveHistory: true,
  memoryEnabled: false,
  composerOnDevice: true,
  allowCloudE2ee: false,
  groupAssist: false,
  channelAssist: false,
  model: "balanced",
  voiceOut: false,
};

export const TONES = ["neutral", "formal", "friendly", "short"] as const;
export type Tone = (typeof TONES)[number];
