/** Deployment types. Never stores secret values, dumps, or session tokens. */

import { APP_VERSION } from "@/lib/release";

export const DEPLOY_ENVS = ["development", "testing", "staging", "production"] as const;
export type DeployEnvName = (typeof DEPLOY_ENVS)[number];

export const DEPLOY_STATUSES = ["pending", "building", "testing", "deploying", "completed", "failed", "rolled_back"] as const;
export type DeployStatus = (typeof DEPLOY_STATUSES)[number];

export const DEPLOY_STRATEGIES = ["rolling", "blue_green", "canary"] as const;
export type DeployStrategy = (typeof DEPLOY_STRATEGIES)[number];

export const FLAG_SEGMENTS = ["all", "staff", "percent"] as const;
export type FlagSegment = (typeof FLAG_SEGMENTS)[number];

export const DEPLOY_CONFIRM = {
  production: "DEPLOY_PRODUCTION",
  emergency: "EMERGENCY_DEPLOY",
  rollback: "ROLLBACK",
} as const;

export const SERVICE_OWNERS: { service: string; owner: string }[] = [
  { service: "identity", owner: "platform" },
  { service: "messaging", owner: "platform" },
  { service: "groups", owner: "platform" },
  { service: "channels", owner: "platform" },
  { service: "calls", owner: "platform" },
  { service: "storage", owner: "platform" },
  { service: "search", owner: "platform" },
  { service: "notify", owner: "platform" },
  { service: "admin", owner: "safety" },
];

export type DeployChecks = {
  lint: boolean;
  test: boolean;
  build: boolean;
  audit: boolean;
  secretScan: boolean;
  config: boolean;
  schema: boolean;
};

export type DeployArtifact = {
  id: string;
  version: string;
  gitSha: string;
  checksum: string;
  env: DeployEnvName;
  notes: string;
  createdAt: number;
};

export type DeploymentRow = {
  id: string;
  version: string;
  previousVersion: string;
  env: DeployEnvName;
  status: DeployStatus;
  strategy: DeployStrategy;
  canaryPct: number;
  actorId: string;
  actorRole: string;
  approvedBy: string | null;
  backupPoint: string | null;
  checks: DeployChecks;
  healthOk: boolean | null;
  smokeOk: boolean | null;
  errorRate: number | null;
  autoRollback: boolean;
  emergency: boolean;
  notes: string;
  error: string | null;
  startedAt: number;
  finishedAt: number | null;
  durationMs: number;
};

export type FeatureFlagRow = {
  key: string;
  enabled: boolean;
  percent: number;
  segment: FlagSegment;
  kill: boolean;
  updatedAt: number;
  updatedBy: string | null;
};

export type DeployLock = {
  holder: string;
  kind: "release" | "rollback";
  until: number;
};

export type DeployMetrics = {
  releases: number;
  failures: number;
  rollbacks: number;
  lastDurationMs: number;
  autoRollbacks: number;
};

export type DeployPersist = {
  currentVersion: string;
  currentEnv: DeployEnvName;
  gitSha: string;
  lock: DeployLock | null;
  artifacts: DeployArtifact[];
  deployments: DeploymentRow[];
  flags: FeatureFlagRow[];
  metrics: DeployMetrics;
};

export function emptyDeployMetrics(): DeployMetrics {
  return { releases: 0, failures: 0, rollbacks: 0, lastDurationMs: 0, autoRollbacks: 0 };
}

export function defaultFlags(): FeatureFlagRow[] {
  const now = 0;
  return [
    { key: "ai_suggestions", enabled: true, percent: 100, segment: "all", kill: false, updatedAt: now, updatedBy: null },
    { key: "ai_core", enabled: true, percent: 100, segment: "all", kill: false, updatedAt: now, updatedBy: null },
    { key: "live_discovery", enabled: true, percent: 100, segment: "all", kill: false, updatedAt: now, updatedBy: null },
    { key: "music_radio", enabled: false, percent: 0, segment: "percent", kill: false, updatedAt: now, updatedBy: null },
    { key: "shop_new_checkout", enabled: false, percent: 0, segment: "percent", kill: false, updatedAt: now, updatedBy: null },
  ];
}

export function emptyDeployPersist(env: DeployEnvName = "development"): DeployPersist {
  return {
    currentVersion: APP_VERSION,
    currentEnv: env,
    gitSha: "dev",
    lock: null,
    artifacts: [],
    deployments: [],
    flags: defaultFlags(),
    metrics: emptyDeployMetrics(),
  };
}

export function hydrateDeployPersist(raw?: Partial<DeployPersist> | null, env: DeployEnvName = "development"): DeployPersist {
  const base = emptyDeployPersist(env);
  if (!raw || typeof raw !== "object") return base;
  const flags = Array.isArray(raw.flags) && raw.flags.length ? raw.flags.slice(0, 80) : base.flags;
  const known = new Set(flags.map((f) => f.key));
  for (const d of base.flags) {
    if (!known.has(d.key)) flags.push(d);
  }
  return {
    currentVersion: typeof raw.currentVersion === "string" ? raw.currentVersion.slice(0, 32) : base.currentVersion,
    currentEnv: raw.currentEnv && ["development", "testing", "staging", "production"].includes(raw.currentEnv) ? raw.currentEnv : env,
    gitSha: typeof raw.gitSha === "string" ? raw.gitSha.slice(0, 40) : "dev",
    lock: raw.lock && typeof raw.lock === "object" ? raw.lock : null,
    artifacts: Array.isArray(raw.artifacts) ? raw.artifacts.slice(0, 80) : [],
    deployments: Array.isArray(raw.deployments) ? raw.deployments.slice(0, 200) : [],
    flags,
    metrics: { ...base.metrics, ...(raw.metrics ?? {}) },
  };
}

export const DEPLOY_RUNBOOK = [
  { id: "health", title: "Health پس از انتشار", steps: "GET /api/health?probe=live سپس probe=ready. Instance ناسالم نباید به Load Balancer برگردد." },
  { id: "smoke", title: "Smoke", steps: "Login، ارسال پیام آزمایشی روی Staging، جستجوی عمومی، دانلود فایل مجاز." },
  { id: "rollback", title: "Rollback", steps: "ROLLBACK + رمز ادمین. نشست کاربر باطل نمی‌شود. صف Job روی دیسک می‌ماند." },
  { id: "flags", title: "Feature Disable", steps: "Kill Switch پرچم را بزن؛ Authorization همچنان سمت سرور است." },
  { id: "queues", title: "صف‌ها", steps: "قبل از Shutdown، Workerها Drain شوند؛ Job در Store پایدار است." },
];
