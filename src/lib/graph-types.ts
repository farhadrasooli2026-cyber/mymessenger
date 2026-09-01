/** Social graph + recommendation persist. No phone, email, or precise location. */

export const GRAPH_MODEL_VERSION = 1;
export const GRAPH_FEATURE_VERSION = 1;
export const GRAPH_CACHE_TTL_MS = 45_000;
export const GRAPH_PAGE = 16;

export type RecKind = "people" | "follow" | "group" | "channel" | "creator";

export type RecItem = {
  kind: RecKind;
  id: string;
  title: string;
  subtitle: string;
  reason: string;
  href: string;
  score: number;
  fresh?: boolean;
};

export type GraphEvent = {
  id: string;
  kind: string;
  actorId: string;
  targetId?: string;
  at: number;
};

export type GraphJob = {
  id: string;
  kind: "rebuild" | "drain";
  status: "queued" | "running" | "done" | "failed";
  attempts: number;
  createdAt: number;
  lastError?: string;
};

export type GraphRecCache = {
  userId: string;
  gen: number;
  at: number;
  itemIds: string[];
};

export type GraphFeedback = {
  id: string;
  userId: string;
  targetType: RecKind;
  targetId: string;
  action: "hide" | "not-interested" | "click" | "dismiss";
  at: number;
};

export type GraphMetrics = {
  queries: number;
  errors: number;
  empty: number;
  clicks: number;
  lastLatencyMs: number;
  samples: number[];
};

export type GraphPersist = {
  modelVersion: number;
  featureVersion: number;
  rolledBack: boolean;
  events: GraphEvent[];
  jobs: GraphJob[];
  cache: GraphRecCache[];
  feedback: GraphFeedback[];
  metrics: GraphMetrics;
};

export function emptyGraphPersist(): GraphPersist {
  return {
    modelVersion: GRAPH_MODEL_VERSION,
    featureVersion: GRAPH_FEATURE_VERSION,
    rolledBack: false,
    events: [],
    jobs: [],
    cache: [],
    feedback: [],
    metrics: { queries: 0, errors: 0, empty: 0, clicks: 0, lastLatencyMs: 0, samples: [] },
  };
}

export function hydrateGraphPersist(raw?: Partial<GraphPersist> | null): GraphPersist {
  const base = emptyGraphPersist();
  if (!raw || typeof raw !== "object") return base;
  return {
    modelVersion: typeof raw.modelVersion === "number" ? raw.modelVersion : base.modelVersion,
    featureVersion: typeof raw.featureVersion === "number" ? raw.featureVersion : base.featureVersion,
    rolledBack: Boolean(raw.rolledBack),
    events: Array.isArray(raw.events) ? raw.events.slice(0, 800) : [],
    jobs: Array.isArray(raw.jobs) ? raw.jobs.slice(0, 80) : [],
    cache: Array.isArray(raw.cache) ? raw.cache.slice(0, 80) : [],
    feedback: Array.isArray(raw.feedback) ? raw.feedback.slice(0, 800) : [],
    metrics: {
      queries: raw.metrics?.queries ?? 0,
      errors: raw.metrics?.errors ?? 0,
      empty: raw.metrics?.empty ?? 0,
      clicks: raw.metrics?.clicks ?? 0,
      lastLatencyMs: raw.metrics?.lastLatencyMs ?? 0,
      samples: Array.isArray(raw.metrics?.samples) ? raw.metrics.samples.slice(-200) : [],
    },
  };
}

export function pruneGraphPersist(g: GraphPersist, now: number): GraphPersist {
  return {
    ...g,
    events: g.events.filter((e) => now - e.at < 14 * 86_400_000).slice(0, 800),
    jobs: g.jobs.filter((j) => now - j.createdAt < 7 * 86_400_000).slice(0, 80),
    cache: g.cache.filter((c) => now - c.at < GRAPH_CACHE_TTL_MS * 4).slice(0, 80),
    feedback: g.feedback.filter((f) => now - f.at < 90 * 86_400_000).slice(0, 800),
    metrics: { ...g.metrics, samples: (g.metrics.samples ?? []).slice(-200) },
  };
}

export function purgeGraphSubject(g: GraphPersist, uid: string): GraphPersist {
  return {
    ...g,
    events: g.events.filter((e) => e.actorId !== uid && e.targetId !== uid),
    cache: g.cache.filter((c) => c.userId !== uid),
    feedback: g.feedback.filter((f) => f.userId !== uid),
  };
}
