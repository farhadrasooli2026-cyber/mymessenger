import {
  AI_FEATURE_KEYS,
  AI_PROMPT_VERSIONS,
  AI_PROVIDERS,
  defaultAiPolicy,
  type AiCacheEntry,
  type AiEvalRecord,
  type AiIdempotency,
  type AiJob,
  type AiPolicy,
  type AiPromptVersion,
  type AiProviderId,
  type AiVectorRow,
} from "@/lib/ai-types";

export type AiPersist = {
  policy: AiPolicy;
  jobs: AiJob[];
  idempotency: AiIdempotency[];
  cache: AiCacheEntry[];
  evals: AiEvalRecord[];
  vectors: AiVectorRow[];
};

export function emptyAiPersist(): AiPersist {
  return { policy: defaultAiPolicy(), jobs: [], idempotency: [], cache: [], evals: [], vectors: [] };
}

function str(v: unknown, max = 80) {
  return typeof v === "string" ? v.slice(0, max) : "";
}

export function hydrateAiPersist(raw: unknown): AiPersist {
  const base = emptyAiPersist();
  if (!raw || typeof raw !== "object") return base;
  const rec = raw as Record<string, unknown>;
  const p = (rec.policy && typeof rec.policy === "object" ? rec.policy : {}) as Record<string, unknown>;
  const features = { ...base.policy.features };
  const featIn = p.features && typeof p.features === "object" ? (p.features as Record<string, unknown>) : {};
  for (const k of AI_FEATURE_KEYS) {
    if (typeof featIn[k] === "boolean") features[k] = featIn[k];
  }
  const primary = AI_PROVIDERS.includes(p.primaryProvider as AiProviderId) ? (p.primaryProvider as AiProviderId) : "local";
  const fallback = AI_PROVIDERS.includes(p.fallbackProvider as AiProviderId) ? (p.fallbackProvider as AiProviderId) : "local";
  const promptVersion = AI_PROMPT_VERSIONS.includes(p.promptVersion as AiPromptVersion)
    ? (p.promptVersion as AiPromptVersion)
    : "pv-1";
  const rollout = p.rollout === "staging" || p.rollout === "canary" || p.rollout === "ga" ? p.rollout : "ga";
  return {
    policy: {
      enabled: p.enabled !== false,
      primaryProvider: primary,
      fallbackProvider: fallback,
      mockFail: Boolean(p.mockFail),
      features,
      tokenLimit: num(p.tokenLimit, 3000, 200, 20_000),
      contextMessages: num(p.contextMessages, 16, 0, 32),
      responseChars: num(p.responseChars, 8000, 200, 20_000),
      timeoutMs: num(p.timeoutMs, 12_000, 500, 60_000),
      costCapUsd: num(p.costCapUsd, 50, 0, 1_000_000),
      estimatedUsdSpent: num(p.estimatedUsdSpent, 0, 0, 1_000_000),
      creditCost: num(p.creditCost, 0, 0, 100),
      requireCredits: Boolean(p.requireCredits),
      promptVersion,
      experimentName: str(p.experimentName, 40),
      experimentPercent: num(p.experimentPercent, 0, 0, 100),
      rollout,
      retentionDays: num(p.retentionDays, 90, 1, 730),
      allowCallAudio: false,
      allowRecording: false,
      updatedAt: typeof p.updatedAt === "number" ? p.updatedAt : 0,
    },
    jobs: Array.isArray(rec.jobs) ? (rec.jobs as AiJob[]).slice(-400) : [],
    idempotency: Array.isArray(rec.idempotency) ? (rec.idempotency as AiIdempotency[]).slice(-2000) : [],
    cache: Array.isArray(rec.cache) ? (rec.cache as AiCacheEntry[]).slice(-400) : [],
    evals: Array.isArray(rec.evals) ? (rec.evals as AiEvalRecord[]).slice(-80) : [],
    vectors: Array.isArray(rec.vectors) ? (rec.vectors as AiVectorRow[]).slice(-2000) : [],
  };
}

function num(v: unknown, fallback: number, min: number, max: number) {
  const n = typeof v === "number" && Number.isFinite(v) ? v : fallback;
  return Math.min(max, Math.max(min, n));
}

export function pruneAiPersist(sys: AiPersist, now: number): AiPersist {
  const keep = sys.policy.retentionDays * 24 * 60 * 60 * 1000;
  return {
    ...sys,
    policy: { ...sys.policy, allowCallAudio: false, allowRecording: false },
    jobs: sys.jobs.filter((j) => now - j.createdAt < keep).slice(-400),
    idempotency: sys.idempotency.filter((i) => now - i.at < keep).slice(-2000),
    cache: sys.cache.filter((c) => now - c.at < 24 * 60 * 60 * 1000).slice(-400),
    evals: sys.evals.filter((e) => now - e.at < keep).slice(-80),
    vectors: sys.vectors.filter((v) => now - v.at < keep).slice(-2000),
  };
}
