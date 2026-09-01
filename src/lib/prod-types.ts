/** Production readiness types. No secrets, PAN, or session tokens. */

export const PROD_CONFIRM = {
  freeze: "PROD_FREEZE",
  thaw: "PROD_THAW",
  approve: "PROD_APPROVE",
  freezeOverride: "PROD_FREEZE_OVERRIDE",
} as const;

export const BLOCKING_KINDS = [
  "security_critical",
  "data_loss",
  "payment_integrity",
  "auth_bypass",
  "authz_bypass",
  "critical_crash",
  "database_corruption",
] as const;
export type BlockingKind = (typeof BLOCKING_KINDS)[number];

export type ProdCheck = {
  id: string;
  area: string;
  ok: boolean;
  blocking: boolean;
  kind: BlockingKind | null;
  detail: string;
};

export type SmokeProbe = {
  id: string;
  title: string;
  ok: boolean;
  detail: string;
};

export type ProdAuditSection = {
  id: string;
  title: string;
  items: { name: string; ok: boolean; note: string }[];
};

export type ProdIncident = {
  id: string;
  at: number;
  severity: "sev1" | "sev2" | "sev3";
  title: string;
  kind: "ops" | "security" | "privacy" | "payment";
  open: boolean;
  actorHint: string;
};

export type ProdPostmortem = {
  id: string;
  incidentId: string;
  at: number;
  summary: string;
  actorHint: string;
};

export type ProdApproval = {
  id: string;
  at: number;
  version: string;
  score: number;
  actorHint: string;
};

export type ProdSmokeRun = {
  id: string;
  at: number;
  passed: number;
  failed: number;
  probes: SmokeProbe[];
};

export type ProdPersist = {
  freeze: boolean;
  freezeReason: string;
  freezeAt: number | null;
  freezeActorHint: string | null;
  approvals: ProdApproval[];
  incidents: ProdIncident[];
  postmortems: ProdPostmortem[];
  smokeRuns: ProdSmokeRun[];
  lastScore: number | null;
  lastEvaluatedAt: number | null;
};

export function emptyProdPersist(): ProdPersist {
  return {
    freeze: false,
    freezeReason: "",
    freezeAt: null,
    freezeActorHint: null,
    approvals: [],
    incidents: [],
    postmortems: [],
    smokeRuns: [],
    lastScore: null,
    lastEvaluatedAt: null,
  };
}

export const SMOKE_SURFACE = [
  { id: "register", title: "ثبت‌نام" },
  { id: "login", title: "ورود" },
  { id: "logout", title: "خروج" },
  { id: "messaging", title: "پیام" },
  { id: "groups", title: "گروه" },
  { id: "channels", title: "کانال" },
  { id: "stories", title: "استوری" },
  { id: "calls", title: "تماس صوتی" },
  { id: "video", title: "تماس تصویری" },
  { id: "notify", title: "اعلان" },
  { id: "search", title: "جستجو" },
  { id: "upload", title: "آپلود فایل" },
  { id: "download", title: "دانلود فایل" },
  { id: "privacy", title: "حریم خصوصی" },
  { id: "security", title: "امنیت" },
  { id: "admin", title: "ادمین" },
  { id: "subscription", title: "اشتراک" },
  { id: "payment", title: "پرداخت" },
  { id: "refund", title: "استرداد" },
] as const;

export const CHECKLIST = [
  { id: "build", title: "Build موفق" },
  { id: "tests", title: "Tests موفق" },
  { id: "security", title: "Security Review" },
  { id: "migration", title: "Database Migration Review" },
  { id: "backup", title: "Backup فعال" },
  { id: "monitor", title: "Monitoring فعال" },
  { id: "alert", title: "Alerting فعال" },
  { id: "https", title: "HTTPS در Production" },
  { id: "secrets", title: "Secret Management" },
  { id: "ratelimit", title: "Rate Limit" },
  { id: "errors", title: "Error Tracking" },
  { id: "rollback", title: "Rollback آماده" },
  { id: "recovery", title: "Recovery Plan" },
  { id: "docs", title: "Documentation به‌روز" },
] as const;

export const RTO_RPO = {
  identity: { rtoMin: 15, rpoMin: 5 },
  messaging: { rtoMin: 30, rpoMin: 5 },
  storage: { rtoMin: 60, rpoMin: 15 },
  billing: { rtoMin: 30, rpoMin: 0 },
  search: { rtoMin: 120, rpoMin: 60 },
} as const;
