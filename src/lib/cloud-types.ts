/** Cloud autoscaling types. No secrets, connection strings, or private keys. */

export const CLOUD_SERVICES = ["api", "worker", "search", "notify", "media", "turn"] as const;
export type CloudServiceId = (typeof CLOUD_SERVICES)[number];

export const CLOUD_REGIONS = ["eu-central", "us-east", "ap-south"] as const;
export type CloudRegionId = (typeof CLOUD_REGIONS)[number];

export const INSTANCE_STATES = ["booting", "ready", "draining", "unhealthy", "terminated"] as const;
export type InstanceState = (typeof INSTANCE_STATES)[number];

export const CLOUD_CONFIRM = {
  failover: "CLOUD_FAILOVER",
  chaos: "CLOUD_CHAOS",
  loadtest: "CLOUD_LOADTEST",
  promote: "CLOUD_PROMOTE",
} as const;

export type CloudInstance = {
  id: string;
  service: CloudServiceId;
  region: CloudRegionId;
  zone: string;
  state: InstanceState;
  cpuPct: number;
  memPct: number;
  inflight: number;
  ws: number;
  startedAt: number;
  drainUntil: number | null;
};

export type ServiceScalePolicy = {
  min: number;
  max: number;
  cpuTarget: number;
  memTarget: number;
  requestTarget: number;
  queueTarget: number;
  wsTarget: number;
};

export type CloudPolicy = {
  autoscaling: boolean;
  cooldownSec: number;
  budgetUsd: number;
  primaryRegion: CloudRegionId;
  secondaryRegion: CloudRegionId;
  multiZone: boolean;
  services: Record<CloudServiceId, ServiceScalePolicy>;
  dbPoolMax: number;
  dbReplicas: number;
  cacheTtlSec: number;
  cdnEnabled: boolean;
  objectStorage: boolean;
  waf: boolean;
  ddos: boolean;
  scheduledPeakHour: number | null;
  predictive: boolean;
  updatedAt: number;
};

export type CloudMetrics = {
  at: number;
  rps: number;
  queueLength: number;
  wsConnections: number;
  presenceKeys: number;
  dbConnections: number;
  replicaLagMs: number;
  storageGb: number;
  bandwidthMbps: number;
  cdnHitPct: number;
  cpuPct: number;
  memPct: number;
  costUsdHour: number;
};

export type ScaleEvent = {
  id: string;
  at: number;
  service: CloudServiceId;
  action: "up" | "down" | "blocked" | "drain" | "failover" | "chaos" | "rollback";
  from: number;
  to: number;
  reason: string;
};

export type CloudAlert = {
  id: string;
  at: number;
  kind: "budget" | "capacity" | "unhealthy" | "lag" | "loop";
  detail: string;
};

export type CloudPersist = {
  policy: CloudPolicy;
  instances: CloudInstance[];
  events: ScaleEvent[];
  alerts: CloudAlert[];
  metrics: CloudMetrics[];
  lastScaleAt: number;
  failoverAt: number | null;
  drills: { id: string; kind: string; at: number; ok: boolean; note: string }[];
  estimatedMonthUsd: number;
};

export function defaultServicePolicy(service: CloudServiceId): ServiceScalePolicy {
  const base: ServiceScalePolicy = { min: 1, max: 6, cpuTarget: 70, memTarget: 75, requestTarget: 80, queueTarget: 40, wsTarget: 400 };
  if (service === "api") return { ...base, min: 2, max: 12, wsTarget: 800 };
  if (service === "worker") return { ...base, min: 1, max: 10, queueTarget: 25 };
  if (service === "turn" || service === "media") return { ...base, min: 1, max: 8 };
  if (service === "search") return { ...base, min: 1, max: 6 };
  return base;
}

export function defaultCloudPolicy(): CloudPolicy {
  const services = {} as Record<CloudServiceId, ServiceScalePolicy>;
  for (const s of CLOUD_SERVICES) services[s] = defaultServicePolicy(s);
  return {
    autoscaling: true,
    cooldownSec: 90,
    budgetUsd: 400,
    primaryRegion: "eu-central",
    secondaryRegion: "us-east",
    multiZone: true,
    services,
    dbPoolMax: 32,
    dbReplicas: 1,
    cacheTtlSec: 60,
    cdnEnabled: true,
    objectStorage: true,
    waf: true,
    ddos: true,
    scheduledPeakHour: 18,
    predictive: false,
    updatedAt: 0,
  };
}

export function emptyCloudPersist(): CloudPersist {
  return {
    policy: defaultCloudPolicy(),
    instances: [],
    events: [],
    alerts: [],
    metrics: [],
    lastScaleAt: 0,
    failoverAt: null,
    drills: [],
    estimatedMonthUsd: 0,
  };
}

export const CLOUD_RTO_RPO = {
  identity: { rtoMin: 15, rpoMin: 5 },
  messaging: { rtoMin: 30, rpoMin: 5 },
  storage: { rtoMin: 60, rpoMin: 15 },
  calls: { rtoMin: 20, rpoMin: 30 },
  search: { rtoMin: 120, rpoMin: 60 },
} as const;
