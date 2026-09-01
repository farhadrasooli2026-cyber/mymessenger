/** Disaster recovery types. No encryption keys or dump bytes. */

export const DR_BACKUP_KINDS = ["full", "incremental", "differential"] as const;
export type DrBackupKind = (typeof DR_BACKUP_KINDS)[number];

export const DR_JOB_STATUSES = ["pending", "running", "completed", "failed", "cancelled"] as const;
export type DrJobStatus = (typeof DR_JOB_STATUSES)[number];

export const DR_SCOPES = [
  "database",
  "users",
  "messages",
  "groups",
  "channels",
  "stories",
  "files",
  "storage",
  "config",
  "security",
  "admin",
  "audit",
] as const;
export type DrScope = (typeof DR_SCOPES)[number];

export const DR_CLASSES = ["critical", "high", "standard", "config"] as const;
export type DrClass = (typeof DR_CLASSES)[number];

export type PlatformMode = "normal" | "maintenance" | "read_only";
export type FailoverSite = "primary" | "replica";

export const RECOVERY_PRIORITY = [
  "authentication",
  "database",
  "messaging",
  "storage",
  "groups",
  "channels",
  "notifications",
  "calls",
  "search",
  "admin",
] as const;

export const DR_CONFIRM = {
  restoreProduction: "RESTORE_PRODUCTION",
  failover: "FAILOVER",
  failback: "FAILBACK",
  mode: "MAINTENANCE",
} as const;

export const DR_RPO_MS = 6 * 60 * 60 * 1000;
export const DR_RTO_MS = 4 * 60 * 60 * 1000;
export const DR_FULL_EVERY_MS = 24 * 60 * 60 * 1000;
export const DR_INCR_EVERY_MS = 6 * 60 * 60 * 1000;
export const DR_JOB_TIMEOUT_MS = 120_000;
export const DR_KEEP_DAILY = 7;
export const DR_KEEP_WEEKLY = 4;
export const DR_KEEP_MONTHLY = 3;

export type DrPolicy = {
  fullEveryMs: number;
  incrEveryMs: number;
  keepDaily: number;
  keepWeekly: number;
  keepMonthly: number;
  rpoMs: number;
  rtoMs: number;
  autoEnabled: boolean;
  autoRestoreTest: boolean;
};

export type DrJob = {
  id: string;
  type: "backup" | "restore" | "verify" | "restore-test" | "failover" | "failback" | "import";
  kind?: DrBackupKind;
  status: DrJobStatus;
  actorId: string | null;
  backupId: string | null;
  scopes: DrScope[];
  bytes: number;
  durationMs: number;
  error: string | null;
  createdAt: number;
  updatedAt: number;
  retries: number;
  checkpoint: string;
};

export type DrPointMeta = {
  id: string;
  kind: DrBackupKind;
  class: DrClass;
  scopes: DrScope[];
  createdAt: number;
  bytes: number;
  sha256: string;
  signature: string;
  schemaVersion: number;
  appVersion: string;
  verifiedAt: number | null;
  restoreTestAt: number | null;
  immutable: boolean;
  tier: "daily" | "weekly" | "monthly";
  offsite: boolean;
  baseId: string | null;
  since: number | null;
};

export type DrAudit = {
  id: string;
  at: number;
  actorId: string | null;
  action: string;
  target: string;
  result: "ok" | "deny" | "error";
};

export type DrPersist = {
  policy: DrPolicy;
  jobs: DrJob[];
  points: DrPointMeta[];
  audits: DrAudit[];
  mode: PlatformMode;
  site: FailoverSite;
  generation: number;
  lastFullAt: number;
  lastIncrAt: number;
  lastRestoreTestAt: number;
  lastFailoverAt: number | null;
  rollbackId: string | null;
};

export function emptyDrPolicy(): DrPolicy {
  return {
    fullEveryMs: DR_FULL_EVERY_MS,
    incrEveryMs: DR_INCR_EVERY_MS,
    keepDaily: DR_KEEP_DAILY,
    keepWeekly: DR_KEEP_WEEKLY,
    keepMonthly: DR_KEEP_MONTHLY,
    rpoMs: DR_RPO_MS,
    rtoMs: DR_RTO_MS,
    autoEnabled: true,
    autoRestoreTest: true,
  };
}

export function emptyDrPersist(): DrPersist {
  return {
    policy: emptyDrPolicy(),
    jobs: [],
    points: [],
    audits: [],
    mode: "normal",
    site: "primary",
    generation: 1,
    lastFullAt: 0,
    lastIncrAt: 0,
    lastRestoreTestAt: 0,
    lastFailoverAt: null,
    rollbackId: null,
  };
}

export function hydrateDrPersist(raw?: Partial<DrPersist> | null): DrPersist {
  const base = emptyDrPersist();
  if (!raw || typeof raw !== "object") return base;
  return {
    policy: { ...base.policy, ...(raw.policy ?? {}) },
    jobs: Array.isArray(raw.jobs) ? raw.jobs.slice(0, 200) : [],
    points: Array.isArray(raw.points) ? raw.points.slice(0, 80) : [],
    audits: Array.isArray(raw.audits) ? raw.audits.slice(0, 400) : [],
    mode: raw.mode === "maintenance" || raw.mode === "read_only" ? raw.mode : "normal",
    site: raw.site === "replica" ? "replica" : "primary",
    generation: typeof raw.generation === "number" ? raw.generation : 1,
    lastFullAt: raw.lastFullAt ?? 0,
    lastIncrAt: raw.lastIncrAt ?? 0,
    lastRestoreTestAt: raw.lastRestoreTestAt ?? 0,
    lastFailoverAt: raw.lastFailoverAt ?? null,
    rollbackId: raw.rollbackId ?? null,
  };
}

export const DR_RUNBOOK = [
  { step: 1, title: "تشخیص", detail: "Health و ضربان مستقل را ببین. Incident بساز." },
  { step: 2, title: "ایزوله", detail: "Maintenance یا Read-Only را روشن کن تا نوشتن خراب نشود." },
  { step: 3, title: "اولویت", detail: "Authentication → Database → Messaging → Storage → بقیه." },
  { step: 4, title: "Verify", detail: "Checksum و Signature پشتیبان را قبل از Restore چک کن." },
  { step: 5, title: "Preview", detail: "Restore را در محیط جدا / Preview ببین؛ Production بدون تأیید RESTORE_PRODUCTION نیست." },
  { step: 6, title: "بازیابی", detail: "ترتیب Database سپس Storage سپس سرویس‌ها. Checkpoint نگه دار." },
  { step: 7, title: "اعتبارسنجی", detail: "Login، پیام، فایل، جستجو، اعلان، تماس، پنل ادمین." },
  { step: 8, title: "بازگشت", detail: "Failback فقط با generation قفل و تأیید FAILBACK." },
];

export const CLASS_FOR_SCOPE: Record<DrScope, DrClass> = {
  database: "critical",
  users: "critical",
  messages: "critical",
  security: "critical",
  admin: "critical",
  audit: "critical",
  groups: "high",
  channels: "high",
  storage: "high",
  files: "high",
  stories: "standard",
  config: "config",
};
