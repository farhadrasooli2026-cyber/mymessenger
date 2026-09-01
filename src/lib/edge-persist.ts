import { defaultPops, type EdgePop, type EdgePopId } from "@/lib/edge-policy";
import { defaultEdgeConfig, emptyEdgePersist, type EdgeConfig, type EdgePersist, type EdgeSample } from "@/lib/edge-types";

export type { EdgePersist };
export { emptyEdgePersist };

function num(v: unknown, fb: number, min: number, max: number) {
  const n = typeof v === "number" && Number.isFinite(v) ? v : fb;
  return Math.min(max, Math.max(min, n));
}

function str(v: unknown, max = 80) {
  return typeof v === "string" ? v.slice(0, max) : "";
}

export function hydrateEdgePersist(raw: unknown): EdgePersist {
  const base = emptyEdgePersist();
  if (!raw || typeof raw !== "object") return base;
  const rec = raw as Partial<EdgePersist>;
  const pops = Array.isArray(rec.pops) && rec.pops.length ? rec.pops.map(sanitizePop) : defaultPops();
  const configs = Array.isArray(rec.configs) && rec.configs.length ? rec.configs.map(sanitizeCfg) : [defaultEdgeConfig()];
  const current = configs.find((c) => c.id === rec.currentConfigId) ?? configs[0]!;
  return {
    pops,
    configs: configs.slice(-20),
    currentConfigId: current.id,
    samples: Array.isArray(rec.samples) ? (rec.samples as EdgeSample[]).slice(-800) : [],
    hits: num(rec.hits, 0, 0, 1e12),
    misses: num(rec.misses, 0, 0, 1e12),
    purges: Array.isArray(rec.purges) ? rec.purges.slice(-80) : [],
    synthetics: Array.isArray(rec.synthetics) ? rec.synthetics.slice(-80) : [],
    originMs: Array.isArray(rec.originMs) ? rec.originMs.filter((n) => typeof n === "number").slice(-200) : [],
    bandwidthGb: num(rec.bandwidthGb, 0.4, 0, 1e6),
    costUsdMonth: num(rec.costUsdMonth, 12, 0, 1e6),
    lastRollbackAt: typeof rec.lastRollbackAt === "number" ? rec.lastRollbackAt : null,
  };
}

function sanitizePop(p: EdgePop): EdgePop {
  const id = (["fra", "lhr", "iad", "sin", "gru"] as EdgePopId[]).includes(p.id) ? p.id : "fra";
  const residency = p.residency === "us" || p.residency === "apac" || p.residency === "sa" ? p.residency : "eu";
  return {
    id,
    region: str(p.region, 40) || "eu-central",
    residency,
    healthy: p.healthy !== false,
    rttMs: num(p.rttMs, 40, 1, 2000),
    capacityPct: num(p.capacityPct, 30, 0, 100),
    wsGateways: num(p.wsGateways, 1, 1, 16),
    turn: p.turn !== false,
  };
}

function sanitizeCfg(c: EdgeConfig): EdgeConfig {
  const d = defaultEdgeConfig();
  return {
    id: str(c.id, 40) || d.id,
    version: num(c.version, 1, 1, 10_000),
    cacheGeneration: num(c.cacheGeneration, 1, 1, 10_000),
    originHost: str(c.originHost, 80) || d.originHost,
    allowHosts: Array.isArray(c.allowHosts) ? c.allowHosts.map((h) => str(h, 80)).filter(Boolean).slice(0, 20) : d.allowHosts,
    originShield: c.originShield !== false,
    waf: c.waf !== false,
    ddos: c.ddos !== false,
    brotli: c.brotli !== false,
    gzip: c.gzip !== false,
    http3: c.http3 !== false,
    ipv6: c.ipv6 !== false,
    anycast: c.anycast !== false,
    signedTtlSec: num(c.signedTtlSec, 120, 30, 600),
    canaryPct: num(c.canaryPct, 0, 0, 100),
    residencyLock: c.residencyLock === "eu" || c.residencyLock === "us" ? c.residencyLock : "none",
    createdAt: typeof c.createdAt === "number" ? c.createdAt : 0,
  };
}
