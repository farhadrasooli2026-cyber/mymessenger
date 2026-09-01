/** Privacy-safe monitoring types. No message bodies, files, or secrets. */

export const MONITOR_SERVICES = [
  "api",
  "database",
  "cache",
  "queue",
  "storage",
  "messaging",
  "calls",
  "video",
  "stories",
  "notify",
  "search",
  "groups",
  "channels",
  "auth",
  "security",
  "moderation",
  "backup",
  "monitor",
] as const;
export type MonitorService = (typeof MONITOR_SERVICES)[number];

export type LogLevel = "debug" | "info" | "warn" | "error" | "critical";
export type AlertSeverity = "info" | "warning" | "high" | "critical";
export type IncidentStatus = "detected" | "investigating" | "mitigating" | "resolved" | "closed";
export type ServiceHealth = "up" | "degraded" | "down";

export type ApiTotals = {
  requests: number;
  errors: number;
  timeouts: number;
  slow: number;
  latencySum: number;
  latencyMax: number;
  bytesIn: number;
  bytesOut: number;
  status: Record<string, number>;
};

export type MonitorLog = {
  id: string;
  at: number;
  level: LogLevel;
  service: MonitorService;
  message: string;
  traceId: string;
};

export type ErrorGroup = {
  fingerprint: string;
  service: MonitorService;
  sample: string;
  count: number;
  lastAt: number;
};

export type MonitorAlert = {
  id: string;
  key: string;
  severity: AlertSeverity;
  title: string;
  at: number;
  count: number;
  ackAt: number | null;
  ackBy: string | null;
  resolvedAt: number | null;
  suppressed: boolean;
  escalated: boolean;
};

export type MonitorIncident = {
  id: string;
  title: string;
  status: IncidentStatus;
  ownerId: string | null;
  createdAt: number;
  updatedAt: number;
  alertIds: string[];
  timeline: { at: number; actor: string; action: string }[];
};

export type HealthSample = {
  at: number;
  cpuPct: number;
  memMb: number;
  diskMb: number;
  services: Record<string, ServiceHealth>;
};

export type MonitorPersist = {
  api: ApiTotals;
  heartbeatAt: number;
  recoveredAt: number | null;
  samples: HealthSample[];
  logs: MonitorLog[];
  errors: ErrorGroup[];
  alerts: MonitorAlert[];
  incidents: MonitorIncident[];
  clientErrors: number;
};

export function emptyApiTotals(): ApiTotals {
  return {
    requests: 0,
    errors: 0,
    timeouts: 0,
    slow: 0,
    latencySum: 0,
    latencyMax: 0,
    bytesIn: 0,
    bytesOut: 0,
    status: {},
  };
}

export function emptyMonitorPersist(): MonitorPersist {
  return {
    api: emptyApiTotals(),
    heartbeatAt: 0,
    recoveredAt: null,
    samples: [],
    logs: [],
    errors: [],
    alerts: [],
    incidents: [],
    clientErrors: 0,
  };
}

export function hydrateMonitorPersist(raw?: Partial<MonitorPersist> | null): MonitorPersist {
  const base = emptyMonitorPersist();
  if (!raw || typeof raw !== "object") return base;
  return {
    api: { ...emptyApiTotals(), ...(raw.api ?? {}), status: { ...(raw.api?.status ?? {}) } },
    heartbeatAt: typeof raw.heartbeatAt === "number" ? raw.heartbeatAt : 0,
    recoveredAt: typeof raw.recoveredAt === "number" ? raw.recoveredAt : null,
    samples: Array.isArray(raw.samples) ? raw.samples.slice(0, SAMPLE_KEEP) : [],
    logs: Array.isArray(raw.logs) ? raw.logs.slice(0, LOG_KEEP) : [],
    errors: Array.isArray(raw.errors) ? raw.errors.slice(0, ERROR_KEEP) : [],
    alerts: Array.isArray(raw.alerts) ? raw.alerts.slice(0, ALERT_KEEP) : [],
    incidents: Array.isArray(raw.incidents) ? raw.incidents : [],
    clientErrors: typeof raw.clientErrors === "number" ? raw.clientErrors : 0,
  };
}

export const SLOW_MS = 1200;
export const TIMEOUT_MS = 8000;
export const LOG_KEEP = 300;
export const SAMPLE_KEEP = 48;
export const ERROR_KEEP = 80;
export const ALERT_KEEP = 120;
