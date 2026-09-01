/** Privacy-preserving BI types. No PII, secrets, or message bodies. */

export const BI_SCHEMA_VERSION = 1 as const;

export const BI_RANGES = ["24h", "7d", "30d"] as const;
export type BiRange = (typeof BI_RANGES)[number];

export const BI_DESKS = [
  "admin",
  "product",
  "growth",
  "engagement",
  "reliability",
  "security",
  "storage",
  "call",
  "search",
  "business",
] as const;
export type BiDesk = (typeof BI_DESKS)[number];

export const BI_EVENT_NAMES = [
  "funnel.register_start",
  "funnel.register_verify",
  "funnel.onboarding_complete",
  "auth.login_success",
  "auth.login_fail",
  "growth.reactivation",
  "ui.session_start",
  "ui.feature_open",
  "ui.onboarding_step",
  "experiment.exposure",
] as const;
export type BiEventName = (typeof BI_EVENT_NAMES)[number];

export const BI_ESSENTIAL_EVENTS: ReadonlySet<BiEventName> = new Set([
  "funnel.register_start",
  "funnel.register_verify",
  "funnel.onboarding_complete",
  "auth.login_success",
  "auth.login_fail",
  "growth.reactivation",
]);

export const BI_CLIENT_EVENTS: ReadonlySet<BiEventName> = new Set([
  "ui.session_start",
  "ui.feature_open",
  "ui.onboarding_step",
]);

export const BI_FEATURE_KEYS = [
  "chat",
  "groups",
  "channels",
  "stories",
  "calls",
  "search",
  "notify",
  "settings",
  "shop",
  "live",
  "bots",
  "music",
  "gallery",
  "onboarding",
] as const;
export type BiFeatureKey = (typeof BI_FEATURE_KEYS)[number];

export const SENSITIVE_ANALYTICS_RE =
  /password|passwd|token|refresh|secret|otp|pepper|cookie|authorization|bearer|apikey|api[_-]?key|private[_-]?key|ciphertext|card|cvv|ssn|phone|email|plaintext|message_body|query_text/i;

export type BiPropValue = string | number | boolean;

export type BiEvent = {
  v: typeof BI_SCHEMA_VERSION;
  name: BiEventName;
  at: number;
  source: string;
  subject: string;
  essential: boolean;
  nonce: string;
  props: Record<string, BiPropValue>;
};

export type BiDailyRow = {
  day: string;
  counts: Record<string, number>;
  essential: number;
  product: number;
};

export type BiExperimentStatus = "running" | "stopped" | "rolled_back";

export type BiExperiment = {
  id: string;
  key: string;
  variants: ["control", "treatment"];
  percent: number;
  metric: string;
  status: BiExperimentStatus;
  startedAt: number;
  stoppedAt: number | null;
};

export type BiPipeline = {
  flushed: number;
  droppedInvalid: number;
  droppedDedupe: number;
  droppedConsent: number;
  droppedSchema: number;
  lastFlushAt: number | null;
  lastError: string | null;
  failures: number;
};

export type BiAuditRow = {
  id: string;
  at: number;
  actorHint: string;
  action: string;
  detail: string;
};

export type BiPersist = {
  raw: BiEvent[];
  daily: BiDailyRow[];
  experiments: BiExperiment[];
  pipeline: BiPipeline;
  audit: BiAuditRow[];
  nonces: { nonce: string; at: number }[];
};

export function emptyBiPipeline(): BiPipeline {
  return {
    flushed: 0,
    droppedInvalid: 0,
    droppedDedupe: 0,
    droppedConsent: 0,
    droppedSchema: 0,
    lastFlushAt: null,
    lastError: null,
    failures: 0,
  };
}

export function emptyBiPersist(): BiPersist {
  return {
    raw: [],
    daily: [],
    experiments: [],
    pipeline: emptyBiPipeline(),
    audit: [],
    nonces: [],
  };
}

const NAME_SET = new Set<string>(BI_EVENT_NAMES);

export function isBiEventName(v: string): v is BiEventName {
  return NAME_SET.has(v);
}

export function rangeMs(range: BiRange): number {
  if (range === "24h") return 24 * 60 * 60_000;
  if (range === "7d") return 7 * 24 * 60 * 60_000;
  return 30 * 24 * 60 * 60_000;
}

export const METRIC_DEFINITIONS: { id: string; title: string; formula: string }[] = [
  { id: "dau", title: "DAU", formula: "کاربران با lastSeen در ۲۴ ساعت؛ شناسه خام نیست." },
  { id: "wau", title: "WAU", formula: "کاربران با lastSeen در ۷ روز." },
  { id: "mau", title: "MAU", formula: "کاربران با lastSeen در ۳۰ روز." },
  { id: "new_users", title: "کاربران جدید", formula: "createdAt در بازهٔ انتخابی." },
  { id: "retention_7d", title: "Retention ۷روز", formula: "از کاربران با عمر >۷روز، چند درصد در ۷روز اخیر دیده شده‌اند." },
  { id: "churn", title: "Churn", formula: "سهم کاربران با lastSeen قدیمی‌تر از ۳۰روز / کل." },
  { id: "reactivation", title: "Reactivation", formula: "رویداد growth.reactivation + کاربران بازگشته پس از غیرفعال‌سازی." },
  { id: "delivery_rate", title: "Delivery Rate", formula: "پیام با deliveredAt / کل پاکت‌های رمزشده." },
  { id: "read_rate", title: "Read Rate", formula: "پیام با readAt / پیام تحویل‌شده." },
  { id: "login_fail_rate", title: "Login Failure", formula: "auth.login_fail / (success+fail) در رویدادهای ضروری." },
  { id: "refund_rate", title: "Refund Rate", formula: "بازپرداخت تکمیل‌شده / پرداخت تأییدشده (مبالغ تجمیعی)." },
  { id: "availability", title: "Availability", formula: "نمونه‌های پایش با سرویس api=up / کل نمونه." },
  { id: "p95_rtt", title: "P95 RTT تماس", formula: "صدک ۹۵ نمونه‌های کیفیت تماس (نه محتوای تماس)." },
];

export const RAW_RETENTION_MS = 7 * 24 * 60 * 60_000;
export const DAILY_RETENTION_MS = 90 * 24 * 60 * 60_000;
export const RAW_CAP = 4000;
export const DAILY_CAP = 120;
export const NONCE_CAP = 8000;
