import { defaultPops, type EdgePop, type EdgePopId } from "@/lib/edge-policy";

export const EDGE_CONFIRM = {
  purge: "EDGE_PURGE",
  rollback: "EDGE_ROLLBACK",
  canary: "EDGE_CANARY",
} as const;

export type EdgeConfig = {
  id: string;
  version: number;
  cacheGeneration: number;
  originHost: string;
  allowHosts: string[];
  originShield: boolean;
  waf: boolean;
  ddos: boolean;
  brotli: boolean;
  gzip: boolean;
  http3: boolean;
  ipv6: boolean;
  anycast: boolean;
  signedTtlSec: number;
  canaryPct: number;
  residencyLock: "none" | "eu" | "us";
  createdAt: number;
};

export type EdgeSample = { at: number; ms: number; kind: "static" | "api" | "media" | "ws" | "call"; pop: EdgePopId };

export type EdgePersist = {
  pops: EdgePop[];
  configs: EdgeConfig[];
  currentConfigId: string;
  samples: EdgeSample[];
  hits: number;
  misses: number;
  purges: { id: string; at: number; prefix: string; actorHint: string }[];
  synthetics: { id: string; at: number; pop: EdgePopId; ok: boolean; ms: number }[];
  originMs: number[];
  bandwidthGb: number;
  costUsdMonth: number;
  lastRollbackAt: number | null;
};

export function defaultEdgeConfig(now = 0): EdgeConfig {
  return {
    id: "edge-cfg-1",
    version: 1,
    cacheGeneration: 1,
    originHost: "origin.nixo.internal",
    allowHosts: ["nixo.example", "localhost", "127.0.0.1"],
    originShield: true,
    waf: true,
    ddos: true,
    brotli: true,
    gzip: true,
    http3: true,
    ipv6: true,
    anycast: true,
    signedTtlSec: 120,
    canaryPct: 0,
    residencyLock: "none",
    createdAt: now,
  };
}

export function emptyEdgePersist(): EdgePersist {
  const cfg = defaultEdgeConfig();
  return {
    pops: defaultPops(),
    configs: [cfg],
    currentConfigId: cfg.id,
    samples: [],
    hits: 0,
    misses: 0,
    purges: [],
    synthetics: [],
    originMs: [],
    bandwidthGb: 0.4,
    costUsdMonth: 12,
    lastRollbackAt: null,
  };
}
