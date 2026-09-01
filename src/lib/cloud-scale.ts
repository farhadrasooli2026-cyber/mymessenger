import type { CloudInstance, CloudPolicy, CloudServiceId, ScaleEvent } from "@/lib/cloud-types";

export type ScaleSnapshot = {
  now: number;
  lastScaleAt: number;
  hour: number;
  queueLength: number;
  rps: number;
  dbConnections: number;
  dbPoolMax: number;
  replicaLagMs: number;
};

export type ScaleDecision = {
  service: CloudServiceId;
  action: "up" | "down" | "drain" | "none" | "blocked";
  from: number;
  to: number;
  reason: string;
};

function live(instances: CloudInstance[], service: CloudServiceId) {
  return instances.filter((i) => i.service === service && i.state !== "terminated");
}

function readyCount(instances: CloudInstance[], service: CloudServiceId) {
  return instances.filter((i) => i.service === service && (i.state === "ready" || i.state === "booting")).length;
}

export function lbPick(instances: CloudInstance[], service: CloudServiceId, region: string): CloudInstance | null {
  const healthy = instances.filter(
    (i) => i.service === service && i.region === region && i.state === "ready",
  );
  if (!healthy.length) return null;
  healthy.sort((a, b) => a.inflight + a.ws - (b.inflight + b.ws));
  return healthy[0] ?? null;
}

export function costUsdHour(instances: CloudInstance[], objectStorage: boolean, cdn: boolean) {
  const compute = instances.filter((i) => i.state !== "terminated").length * 0.08;
  const storage = objectStorage ? 0.02 : 0.04;
  const edge = cdn ? 0.03 : 0.01;
  return Math.round((compute + storage + edge) * 1000) / 1000;
}

export function estimateMonth(hourly: number) {
  return Math.round(hourly * 24 * 30 * 100) / 100;
}

export function evaluateServiceScale(
  policy: CloudPolicy,
  instances: CloudInstance[],
  service: CloudServiceId,
  snap: ScaleSnapshot,
): ScaleDecision {
  const sp = policy.services[service];
  const rows = live(instances, service);
  const from = rows.length;
  const avgCpu = rows.length ? rows.reduce((s, i) => s + i.cpuPct, 0) / rows.length : 0;
  const avgMem = rows.length ? rows.reduce((s, i) => s + i.memPct, 0) / rows.length : 0;
  const inflight = rows.reduce((s, i) => s + i.inflight, 0);
  const ws = rows.reduce((s, i) => s + i.ws, 0);
  const queuePressure = service === "worker" || service === "notify" || service === "media" ? snap.queueLength : 0;

  if (from < sp.min) {
    return { service, action: "up", from, to: sp.min, reason: "minimum capacity" };
  }

  const cooling = snap.now - snap.lastScaleAt < policy.cooldownSec * 1000;
  const hot =
    avgCpu >= sp.cpuTarget ||
    avgMem >= sp.memTarget ||
    inflight / Math.max(1, from) >= sp.requestTarget ||
    queuePressure >= sp.queueTarget * from ||
    (service === "api" && ws / Math.max(1, from) >= sp.wsTarget);
  const scheduled =
    policy.scheduledPeakHour !== null && snap.hour === policy.scheduledPeakHour && from < Math.min(sp.max, sp.min + 1);
  const predictive = policy.predictive && snap.rps > 40 && from < sp.max;

  if ((hot || scheduled || predictive) && from < sp.max) {
    if (cooling && from >= sp.min) {
      return { service, action: "blocked", from, to: from, reason: "cooldown" };
    }
    return {
      service,
      action: "up",
      from,
      to: Math.min(sp.max, from + 1),
      reason: hot ? "load" : scheduled ? "scheduled peak" : "predictive",
    };
  }

  const quiet =
    avgCpu < sp.cpuTarget * 0.4 &&
    avgMem < sp.memTarget * 0.45 &&
    inflight / Math.max(1, from) < sp.requestTarget * 0.3 &&
    queuePressure < sp.queueTarget * 0.3 &&
    ws / Math.max(1, from) < sp.wsTarget * 0.3;
  if (quiet && from > sp.min) {
    const draining = rows.some((i) => i.state === "draining");
    if (draining) {
      return { service, action: "none", from, to: from, reason: "drain in progress" };
    }
    if (cooling) return { service, action: "blocked", from, to: from, reason: "cooldown" };
    const ready = readyCount(instances, service);
    if (service === "api" && ready <= sp.min) {
      return { service, action: "blocked", from, to: from, reason: "keep minimum ready API" };
    }
    return { service, action: "drain", from, to: from - 1, reason: "scale-in drain first" };
  }

  return { service, action: "none", from, to: from, reason: "steady" };
}

export function applyDecision(
  instances: CloudInstance[],
  decision: ScaleDecision,
  region: CloudPolicy["primaryRegion"],
  now: number,
  newId: () => string,
): { instances: CloudInstance[]; event: Omit<ScaleEvent, "id"> | null } {
  if (decision.action === "up") {
    const zone = `${region}-${decision.to % 2 === 0 ? "a" : "b"}`;
    const added: CloudInstance = {
      id: newId(),
      service: decision.service,
      region,
      zone,
      state: "booting",
      cpuPct: 8,
      memPct: 18,
      inflight: 0,
      ws: 0,
      startedAt: now,
      drainUntil: null,
    };
    return {
      instances: [...instances, added],
      event: { at: now, service: decision.service, action: "up", from: decision.from, to: decision.to, reason: decision.reason },
    };
  }
  if (decision.action === "drain") {
    const candidates = instances.filter((i) => i.service === decision.service && i.state === "ready");
    candidates.sort((a, b) => a.startedAt - b.startedAt);
    const target = candidates[0];
    if (!target) return { instances, event: null };
    const next = instances.map((i) =>
      i.id === target.id ? { ...i, state: "draining" as const, drainUntil: now + 8_000, inflight: 0 } : i,
    );
    return {
      instances: next,
      event: { at: now, service: decision.service, action: "drain", from: decision.from, to: decision.to, reason: decision.reason },
    };
  }
  if (decision.action === "blocked") {
    return {
      instances,
      event: { at: now, service: decision.service, action: "blocked", from: decision.from, to: decision.to, reason: decision.reason },
    };
  }
  return { instances, event: null };
}

export function finishDrains(instances: CloudInstance[], now: number): CloudInstance[] {
  return instances.map((i) => {
    if (i.state === "booting" && now - i.startedAt > 1500) return { ...i, state: "ready" as const };
    if (i.state === "draining" && i.drainUntil && now >= i.drainUntil) return { ...i, state: "terminated" as const, ws: 0, inflight: 0 };
    return i;
  });
}

export function seedFleet(policy: CloudPolicy, now: number, id: (n: number) => string): CloudInstance[] {
  const out: CloudInstance[] = [];
  let n = 0;
  for (const service of Object.keys(policy.services) as CloudServiceId[]) {
    const min = policy.services[service].min;
    for (let i = 0; i < min; i += 1) {
      n += 1;
      const zone = policy.multiZone ? `${policy.primaryRegion}-${i % 2 === 0 ? "a" : "b"}` : `${policy.primaryRegion}-a`;
      out.push({
        id: id(n),
        service,
        region: policy.primaryRegion,
        zone,
        state: "ready",
        cpuPct: 12,
        memPct: 22,
        inflight: 2,
        ws: service === "api" ? 4 : 0,
        startedAt: now,
        drainUntil: null,
      });
    }
  }
  return out;
}

export function dbPoolSafe(used: number, max: number) {
  if (used > max) return { ok: false, used: max, reason: "connection limit" };
  return { ok: true, used, reason: "ok" };
}

export function cacheMissIsSafe() {
  return true;
}
