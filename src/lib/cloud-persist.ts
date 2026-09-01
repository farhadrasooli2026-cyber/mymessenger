import {
  CLOUD_REGIONS,
  CLOUD_SERVICES,
  INSTANCE_STATES,
  defaultServicePolicy,
  emptyCloudPersist,
  type CloudInstance,
  type CloudPersist,
  type CloudPolicy,
  type CloudRegionId,
  type InstanceState,
  type ServiceScalePolicy,
} from "@/lib/cloud-types";

export type { CloudPersist };
export { emptyCloudPersist };

function num(v: unknown, fallback: number, min: number, max: number) {
  const n = typeof v === "number" && Number.isFinite(v) ? v : fallback;
  return Math.min(max, Math.max(min, n));
}

function str(v: unknown, max = 80) {
  return typeof v === "string" ? v.slice(0, max) : "";
}

export function hydrateCloudPersist(raw: unknown): CloudPersist {
  const base = emptyCloudPersist();
  if (!raw || typeof raw !== "object") return base;
  const rec = raw as Record<string, unknown>;
  const p = rec.policy && typeof rec.policy === "object" ? (rec.policy as Record<string, unknown>) : {};
  const services = { ...base.policy.services };
  const svcIn = p.services && typeof p.services === "object" ? (p.services as Record<string, unknown>) : {};
  for (const s of CLOUD_SERVICES) {
    const row = svcIn[s] && typeof svcIn[s] === "object" ? (svcIn[s] as Record<string, unknown>) : {};
    const d = defaultServicePolicy(s);
    services[s] = {
      min: num(row.min, d.min, 1, 40),
      max: num(row.max, d.max, 1, 80),
      cpuTarget: num(row.cpuTarget, d.cpuTarget, 20, 95),
      memTarget: num(row.memTarget, d.memTarget, 20, 95),
      requestTarget: num(row.requestTarget, d.requestTarget, 5, 5000),
      queueTarget: num(row.queueTarget, d.queueTarget, 1, 10_000),
      wsTarget: num(row.wsTarget, d.wsTarget, 10, 50_000),
    } satisfies ServiceScalePolicy;
    if (services[s].min > services[s].max) services[s].min = services[s].max;
  }
  const primary = CLOUD_REGIONS.includes(p.primaryRegion as CloudRegionId) ? (p.primaryRegion as CloudRegionId) : "eu-central";
  let secondary = CLOUD_REGIONS.includes(p.secondaryRegion as CloudRegionId) ? (p.secondaryRegion as CloudRegionId) : "us-east";
  if (secondary === primary) secondary = CLOUD_REGIONS.find((r) => r !== primary) ?? "us-east";
  const policy: CloudPolicy = {
    autoscaling: p.autoscaling !== false,
    cooldownSec: num(p.cooldownSec, 90, 15, 3600),
    budgetUsd: num(p.budgetUsd, 400, 10, 1_000_000),
    primaryRegion: primary,
    secondaryRegion: secondary,
    multiZone: p.multiZone !== false,
    services,
    dbPoolMax: num(p.dbPoolMax, 32, 1, 200),
    dbReplicas: num(p.dbReplicas, 1, 0, 8),
    cacheTtlSec: num(p.cacheTtlSec, 60, 5, 3600),
    cdnEnabled: p.cdnEnabled !== false,
    objectStorage: p.objectStorage !== false,
    waf: p.waf !== false,
    ddos: p.ddos !== false,
    scheduledPeakHour: p.scheduledPeakHour === null || p.scheduledPeakHour === undefined ? 18 : num(p.scheduledPeakHour, 18, 0, 23),
    predictive: Boolean(p.predictive),
    updatedAt: typeof p.updatedAt === "number" ? p.updatedAt : 0,
  };
  const instances = Array.isArray(rec.instances) ? (rec.instances as CloudInstance[]).map(sanitizeInstance).filter(Boolean) as CloudInstance[] : [];
  return {
    policy,
    instances: instances.slice(-200),
    events: Array.isArray(rec.events) ? rec.events.slice(-400) : [],
    alerts: Array.isArray(rec.alerts) ? rec.alerts.slice(-120) : [],
    metrics: Array.isArray(rec.metrics) ? rec.metrics.slice(-120) : [],
    lastScaleAt: typeof rec.lastScaleAt === "number" ? rec.lastScaleAt : 0,
    failoverAt: typeof rec.failoverAt === "number" ? rec.failoverAt : null,
    drills: Array.isArray(rec.drills) ? rec.drills.slice(-40) : [],
    estimatedMonthUsd: num(rec.estimatedMonthUsd, 0, 0, 10_000_000),
  };
}

function sanitizeInstance(row: CloudInstance): CloudInstance | null {
  if (!row || typeof row !== "object") return null;
  const service = CLOUD_SERVICES.includes(row.service) ? row.service : null;
  if (!service) return null;
  const region = CLOUD_REGIONS.includes(row.region) ? row.region : "eu-central";
  const state: InstanceState = INSTANCE_STATES.includes(row.state) ? row.state : "ready";
  return {
    id: str(row.id, 40) || "inst",
    service,
    region,
    zone: str(row.zone, 24) || `${region}-a`,
    state,
    cpuPct: num(row.cpuPct, 10, 0, 100),
    memPct: num(row.memPct, 20, 0, 100),
    inflight: num(row.inflight, 0, 0, 100_000),
    ws: num(row.ws, 0, 0, 100_000),
    startedAt: typeof row.startedAt === "number" ? row.startedAt : 0,
    drainUntil: typeof row.drainUntil === "number" ? row.drainUntil : null,
  };
}
