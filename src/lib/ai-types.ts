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
  { id: "fast", name: "NIXO Fast", detail: "پاسخ کوتاه از مدل زنده (Gemini 1.5 Flash یا GPT-4o-mini)" },
  { id: "balanced", name: "NIXO Balanced", detail: "گفتگوی زنده با زمینهٔ تاریخچهٔ همین چت AI" },
  { id: "advanced", name: "NIXO Advanced", detail: "پاسخ بلندتر از همان مدل زنده؛ سهمیهٔ روزانه برقرار است" },
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
  | "spam"
  | "search"
  | "audio"
  | "transcribe"
  | "recommend";

export const AI_PROVIDERS = ["local", "mock", "gemini", "openai"] as const;
export type AiProviderId = (typeof AI_PROVIDERS)[number];

export const AI_FEATURE_KEYS = [
  "assistant",
  "summarize",
  "translate",
  "write",
  "rewrite",
  "grammar",
  "reply",
  "search",
  "file",
  "ocr",
  "image",
  "audio",
  "moderation",
  "recommend",
  "memory",
] as const;
export type AiFeatureKey = (typeof AI_FEATURE_KEYS)[number];

export const AI_PROMPT_VERSIONS = ["pv-1", "pv-0"] as const;
export type AiPromptVersion = (typeof AI_PROMPT_VERSIONS)[number];

export const MODEL_VERSIONS: Record<AiModelId, string> = {
  fast: "nixo-fast-1",
  balanced: "nixo-balanced-1",
  advanced: "nixo-advanced-1",
};

export type AiPolicy = {
  enabled: boolean;
  primaryProvider: AiProviderId;
  fallbackProvider: AiProviderId;
  mockFail: boolean;
  features: Record<AiFeatureKey, boolean>;
  tokenLimit: number;
  contextMessages: number;
  responseChars: number;
  timeoutMs: number;
  costCapUsd: number;
  estimatedUsdSpent: number;
  creditCost: number;
  requireCredits: boolean;
  promptVersion: AiPromptVersion;
  experimentName: string;
  experimentPercent: number;
  rollout: "staging" | "canary" | "ga";
  retentionDays: number;
  allowCallAudio: false;
  allowRecording: false;
  updatedAt: number;
};

export type AiJob = {
  id: string;
  userId: string;
  kind: string;
  status: "queued" | "done" | "failed" | "cancelled";
  createdAt: number;
  doneAt: number | null;
};

export type AiIdempotency = {
  key: string;
  userId: string;
  at: number;
  creditRef: string;
  chatId: string;
  assistantId: string;
};

export type AiCacheEntry = {
  key: string;
  userId: string;
  text: string;
  intent: AiIntent;
  at: number;
};

export type AiEvalRecord = {
  id: string;
  dataset: string;
  modelVersion: string;
  promptVersion: string;
  score: number;
  at: number;
  notes: string;
};

export type AiVectorRow = {
  id: string;
  userId: string;
  resourceId: string;
  kind: "own-ai" | "allowed-search";
  tokens: string[];
  at: number;
};

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
  generatedByAi?: boolean;
  confidence?: number;
  provider?: AiProviderId;
  promptVersion?: string;
  modelVersion?: string;
  overridden?: boolean;
  variant?: "a" | "b";
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
  personalization: boolean;
  notifyAi: boolean;
  useMemoryInContext: boolean;
  updatedAt: number;
};

export type AiLog = {
  id: string;
  userId: string;
  at: number;
  kind: "chat" | "tool" | "abuse" | "consent" | "delete" | "provider" | "credit" | "safety" | "isolation" | "queue" | "eval" | "admin";
  summary: string;
};

export function defaultAiFeatures(): Record<AiFeatureKey, boolean> {
  return {
    assistant: true,
    summarize: true,
    translate: true,
    write: true,
    rewrite: true,
    grammar: true,
    reply: true,
    search: true,
    file: true,
    ocr: true,
    image: true,
    audio: true,
    moderation: true,
    recommend: true,
    memory: true,
  };
}

export function defaultAiPolicy(): AiPolicy {
  return {
    enabled: true,
    primaryProvider: "local",
    fallbackProvider: "local",
    mockFail: false,
    features: defaultAiFeatures(),
    tokenLimit: 3000,
    contextMessages: 16,
    responseChars: 8000,
    timeoutMs: 20_000,
    costCapUsd: 50,
    estimatedUsdSpent: 0,
    creditCost: 0,
    requireCredits: false,
    promptVersion: "pv-1",
    experimentName: "",
    experimentPercent: 0,
    rollout: "ga",
    retentionDays: 90,
    allowCallAudio: false,
    allowRecording: false,
    updatedAt: 0,
  };
}

export const DEFAULT_AI_PREFS: Omit<AiPrefs, "userId" | "updatedAt"> = {
  saveHistory: true,
  memoryEnabled: false,
  composerOnDevice: true,
  allowCloudE2ee: false,
  groupAssist: false,
  channelAssist: false,
  model: "balanced",
  voiceOut: false,
  personalization: false,
  notifyAi: false,
  useMemoryInContext: true,
};

export const TONES = ["neutral", "formal", "friendly", "short"] as const;
export type Tone = (typeof TONES)[number];
