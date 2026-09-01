/** Performance types. Cache values must never include secrets or message bodies. */

export const PERF_JOB_KINDS = ["thumb", "transcode", "search", "push", "fanout", "index", "bench"] as const;
export type PerfJobKind = (typeof PERF_JOB_KINDS)[number];

export const PERF_PRIORITIES = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9] as const;
export type PerfPriority = (typeof PERF_PRIORITIES)[number];

export type ShedLevel = "off" | "soft" | "hard";

export type PerfJob = {
  id: string;
  kind: PerfJobKind;
  priority: PerfPriority;
  status: "queued" | "running" | "done" | "failed" | "dead";
  targetId: string;
  idempotencyKey: string;
  retries: number;
  runAfter: number;
  error: string | null;
  createdAt: number;
  updatedAt: number;
  durationMs: number;
};

export type PerfDlq = {
  id: string;
  jobId: string;
  kind: PerfJobKind;
  error: string;
  at: number;
};

export type PerfPolicy = {
  minInstances: number;
  maxInstances: number;
  cpuTargetPct: number;
  workerConcurrency: number;
  jobTimeoutMs: number;
  retryMax: number;
  cacheTtlMs: number;
  adaptiveRate: boolean;
  loadShed: boolean;
};

export type PerfMetrics = {
  jobsDone: number;
  jobsFailed: number;
  jobsDead: number;
  cacheHits: number;
  cacheMisses: number;
  cacheStampedeBlocked: number;
  shedSoft: number;
  shedHard: number;
  circuitOpens: number;
  benches: number;
  lastBenchMs: number;
  heapMb: number;
  leakSuspect: boolean;
};

export type PerfPersist = {
  jobs: PerfJob[];
  dlq: PerfDlq[];
  policy: PerfPolicy;
  metrics: PerfMetrics;
  shed: ShedLevel;
};

export function emptyPerfMetrics(): PerfMetrics {
  return {
    jobsDone: 0,
    jobsFailed: 0,
    jobsDead: 0,
    cacheHits: 0,
    cacheMisses: 0,
    cacheStampedeBlocked: 0,
    shedSoft: 0,
    shedHard: 0,
    circuitOpens: 0,
    benches: 0,
    lastBenchMs: 0,
    heapMb: 0,
    leakSuspect: false,
  };
}

export function emptyPerfPolicy(): PerfPolicy {
  return {
    minInstances: 1,
    maxInstances: 8,
    cpuTargetPct: 70,
    workerConcurrency: 2,
    jobTimeoutMs: 8_000,
    retryMax: 3,
    cacheTtlMs: 15_000,
    adaptiveRate: true,
    loadShed: true,
  };
}

export function emptyPerfPersist(): PerfPersist {
  return {
    jobs: [],
    dlq: [],
    policy: emptyPerfPolicy(),
    metrics: emptyPerfMetrics(),
    shed: "off",
  };
}

export function hydratePerfPersist(raw?: Partial<PerfPersist> | null): PerfPersist {
  const base = emptyPerfPersist();
  if (!raw || typeof raw !== "object") return base;
  return {
    jobs: Array.isArray(raw.jobs) ? raw.jobs.slice(0, 400) : [],
    dlq: Array.isArray(raw.dlq) ? raw.dlq.slice(0, 200) : [],
    policy: { ...base.policy, ...(raw.policy ?? {}) },
    metrics: { ...base.metrics, ...(raw.metrics ?? {}) },
    shed: raw.shed === "soft" || raw.shed === "hard" ? raw.shed : "off",
  };
}

export const CRITICAL_API_PREFIXES = [
  "/api/health",
  "/api/status",
  "/api/version",
  "/api/docs",
  "/api/register",
  "/api/recover",
  "/api/security",
  "/api/account",
  "/api/chats",
  "/api/me",
  "/api/devices",
  "/api/crypto",
] as const;

export const CORE_API_PREFIXES = [
  ...CRITICAL_API_PREFIXES,
  "/api/calls",
  "/api/notify",
  "/api/storage",
  "/api/groups",
  "/api/channels",
  "/api/billing",
  "/api/dr",
  "/api/monitor",
  "/api/admin",
  "/api/deploy",
  "/api/prod",
] as const;

export const SOFT_SHED_PREFIXES = [
  "/api/search",
  "/api/music",
  "/api/live",
  "/api/bots",
  "/api/mini",
  "/api/catalog",
  "/api/ai",
  "/api/shop",
  "/api/stickers",
  "/api/username",
] as const;

export const SHARD_KEY = "ownerUserId";
export const READ_REPLICA_NOTE = "readStoreSnapshot is the read path; mutateStore is the single writer.";
export const CDN_PUBLIC_MAX_AGE = 86_400;
