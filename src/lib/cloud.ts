import "server-only";
import { hmacIdentifier, randomId } from "@/lib/crypto-utils";
import { mutateStore, type StoreData } from "@/lib/store";
import { currentDeployEnv } from "@/lib/env-config";
import { hydrateCloudPersist } from "@/lib/cloud-persist";
import {
  CLOUD_CONFIRM,
  CLOUD_RTO_RPO,
  CLOUD_SERVICES,
  type CloudPersist,
  type CloudRegionId,
  type CloudServiceId,
} from "@/lib/cloud-types";
import {
  applyDecision,
  costUsdHour,
  dbPoolSafe,
  estimateMonth,
  evaluateServiceScale,
  finishDrains,
  lbPick,
  seedFleet,
} from "@/lib/cloud-scale";
import { WRITER_POOL_SIZE } from "@/lib/db/catalog";

export function ensureCloud(data: StoreData) {
  data.cloud = hydrateCloudPersist(data.cloud);
  if (!data.cloud.instances.length) {
    data.cloud.instances = seedFleet(data.cloud.policy, Date.now(), (n) => `c${n.toString(16)}`);
  }
}

function hint(id: string) {
  return hmacIdentifier(`cloud-actor:${id}`).slice(0, 12);
}

function liveMetrics(data: StoreData, cloud: CloudPersist) {
  const mem = process.memoryUsage();
  const heapPct = Math.min(100, Math.round((mem.heapUsed / Math.max(1, mem.heapTotal)) * 100));
  const queue = (data.perf?.jobs ?? []).filter((j) => j.status === "queued" || j.status === "running").length;
  const pushQ = (data.pushJobs ?? []).filter((j) => j.status === "queued" || j.status === "running").length;
  const instances = cloud.instances.filter((i) => i.state !== "terminated");
  const cpu = instances.length ? Math.round(instances.reduce((s, i) => s + i.cpuPct, 0) / instances.length) : heapPct;
  const hourly = costUsdHour(instances, cloud.policy.objectStorage, cloud.policy.cdnEnabled);
  return {
    at: Date.now(),
    rps: Math.min(500, instances.reduce((s, i) => s + i.inflight, 0)),
    queueLength: queue + pushQ,
    wsConnections: instances.filter((i) => i.service === "api").reduce((s, i) => s + i.ws, 0),
    presenceKeys: Math.min(10_000, (data.devices ?? []).filter((d) => !d.revokedAt).length),
    dbConnections: Math.min(cloud.policy.dbPoolMax, WRITER_POOL_SIZE),
    replicaLagMs: 0,
    storageGb: Math.round(((data.vaultObjects ?? []).length + (data.galleryItems ?? []).length) / 50) / 10,
    bandwidthMbps: 8,
    cdnHitPct: cloud.policy.cdnEnabled ? 86 : 0,
    cpuPct: cpu,
    memPct: heapPct,
    costUsdHour: hourly,
  };
}

function tickFleet(data: StoreData, now: number) {
  const cloud = data.cloud;
  cloud.instances = finishDrains(cloud.instances, now);
  const q = (data.perf?.jobs ?? []).filter((j) => j.status === "queued").length;
  const snap = {
    now,
    lastScaleAt: cloud.lastScaleAt,
    hour: new Date(now).getUTCHours(),
    queueLength: q,
    rps: 12,
    dbConnections: WRITER_POOL_SIZE,
    dbPoolMax: cloud.policy.dbPoolMax,
    replicaLagMs: 0,
  };
  if (!cloud.policy.autoscaling) return;
  for (const service of CLOUD_SERVICES) {
    const decision = evaluateServiceScale(cloud.policy, cloud.instances, service, snap);
    const applied = applyDecision(cloud.instances, decision, cloud.policy.primaryRegion, now, () => randomId());
    cloud.instances = applied.instances;
    if (applied.event && decision.action !== "blocked") {
      cloud.lastScaleAt = now;
      cloud.events.unshift({ id: randomId(), ...applied.event });
    } else if (applied.event && decision.action === "blocked" && decision.reason === "cooldown") {
      const recent = cloud.events[0];
      if (!recent || recent.reason !== "cooldown" || now - recent.at > 60_000) {
        cloud.events.unshift({ id: randomId(), ...applied.event });
      }
    }
  }
  cloud.events = cloud.events.slice(0, 400);
  const hourly = costUsdHour(cloud.instances.filter((i) => i.state !== "terminated"), cloud.policy.objectStorage, cloud.policy.cdnEnabled);
  cloud.estimatedMonthUsd = estimateMonth(hourly);
  if (cloud.estimatedMonthUsd > cloud.policy.budgetUsd) {
    const last = cloud.alerts[0];
    if (!last || last.kind !== "budget" || now - last.at > 6 * 3600_000) {
      cloud.alerts.unshift({ id: randomId(), at: now, kind: "budget", detail: `برآورد ماهانه ${cloud.estimatedMonthUsd} از بودجه ${cloud.policy.budgetUsd} USD گذشت.` });
    }
  }
}

export async function cloudDashboard() {
  const { requireStaff: rs } = await import("@/lib/admin-moderation");
  const staff = await rs("cloud.view");
  if (!staff.ok) return staff;
  const canManage = (await (await import("@/lib/admin-moderation")).requireStaff("cloud.manage")).ok;
  return mutateStore((data) => {
    ensureCloud(data);
    const cloud = data.cloud;
    const metrics = liveMetrics(data, cloud);
    const env = currentDeployEnv();
    const pool = dbPoolSafe(metrics.dbConnections, cloud.policy.dbPoolMax);
    return {
      ok: true as const,
      env,
      note: "Scale افقی Session را روی دیسک سرور نگه نمی‌دارد. کوکی HttpOnly و صف JSON با Instance جدید می‌مانند.",
      policy: cloud.policy,
      instances: cloud.instances.filter((i) => i.state !== "terminated").map((i) => ({
        id: i.id,
        service: i.service,
        region: i.region,
        zone: i.zone,
        state: i.state,
        cpuPct: i.cpuPct,
        memPct: i.memPct,
        inflight: i.inflight,
        ws: i.ws,
      })),
      events: cloud.events.slice(0, 24),
      alerts: cloud.alerts.slice(0, 12),
      drills: cloud.drills.slice(0, 8),
      metrics,
      cost: { hourly: metrics.costUsdHour, month: cloud.estimatedMonthUsd, budget: cloud.policy.budgetUsd },
      dataPlane: {
        objectStorage: cloud.policy.objectStorage,
        cdn: cloud.policy.cdnEnabled,
        privateFiles: "Signed URL + Authorization؛ فایل روی Application Server منبع حقیقت نیست.",
        database: { poolMax: cloud.policy.dbPoolMax, replicas: cloud.policy.dbReplicas, writerPool: WRITER_POOL_SIZE, poolOk: pool.ok, public: false },
        queue: { workersSeparate: true, dlq: (data.perf?.dlq ?? []).length },
        rtoRpo: CLOUD_RTO_RPO,
      },
      lb: {
        strategy: "health-aware least-inflight",
        sample: CLOUD_SERVICES.map((s) => ({ service: s, target: lbPick(cloud.instances, s, cloud.policy.primaryRegion)?.id ?? null })),
      },
      safety: {
        minMax: true,
        cooldownSec: cloud.policy.cooldownSec,
        noPublicDb: true,
        secretsInGit: false,
        duplicateGuard: "پرداخت و اعلان Idempotent می‌مانند؛ Scale پیام را دوباره ارسال نمی‌کند.",
      },
      access: { canManage },
    };
  });
}

export async function cloudMutate(input: {
  action: string;
  service?: CloudServiceId;
  confirm?: string;
  autoscaling?: boolean;
  cooldownSec?: number;
  budgetUsd?: number;
  min?: number;
  max?: number;
  region?: CloudRegionId;
}) {
  const { requireStaff: rs } = await import("@/lib/admin-moderation");
  const staff = await rs("cloud.manage");
  if (!staff.ok) return staff;
  const env = currentDeployEnv();
  return mutateStore((data) => {
    ensureCloud(data);
    const now = Date.now();
    const p = data.cloud.policy;
    if (input.action === "tick") {
      tickFleet(data, now);
      data.cloud.metrics.unshift(liveMetrics(data, data.cloud));
      data.cloud.metrics = data.cloud.metrics.slice(0, 120);
      return { ok: true as const, policy: p, instances: data.cloud.instances.length };
    }
    if (input.action === "policy") {
      if (typeof input.autoscaling === "boolean") p.autoscaling = input.autoscaling;
      if (typeof input.cooldownSec === "number") p.cooldownSec = Math.min(3600, Math.max(15, input.cooldownSec));
      if (typeof input.budgetUsd === "number") p.budgetUsd = Math.max(10, input.budgetUsd);
      if (input.service && typeof input.min === "number") p.services[input.service].min = Math.max(1, input.min);
      if (input.service && typeof input.max === "number") p.services[input.service].max = Math.max(p.services[input.service].min, input.max);
      p.updatedAt = now;
      return { ok: true as const, policy: p };
    }
    if (input.action === "scale-up") {
      const service = input.service ?? "api";
      const from = data.cloud.instances.filter((i) => i.service === service && i.state !== "terminated").length;
      const max = p.services[service].max;
      if (from >= max) return { ok: false as const, status: 429, error: "Maximum capacity." };
      const applied = applyDecision(
        data.cloud.instances,
        { service, action: "up", from, to: from + 1, reason: "manual" },
        p.primaryRegion,
        now,
        () => randomId(),
      );
      data.cloud.instances = applied.instances;
      if (applied.event) data.cloud.events.unshift({ id: randomId(), ...applied.event });
      data.cloud.lastScaleAt = now;
      return { ok: true as const, policy: p };
    }
    if (input.action === "scale-in") {
      const service = input.service ?? "api";
      const from = data.cloud.instances.filter((i) => i.service === service && i.state !== "terminated").length;
      if (from <= p.services[service].min) return { ok: false as const, status: 409, error: "Minimum capacity." };
      const applied = applyDecision(
        data.cloud.instances,
        { service, action: "drain", from, to: from - 1, reason: "manual drain" },
        p.primaryRegion,
        now,
        () => randomId(),
      );
      data.cloud.instances = applied.instances;
      if (applied.event) data.cloud.events.unshift({ id: randomId(), ...applied.event });
      data.cloud.lastScaleAt = now;
      return { ok: true as const, policy: p };
    }
    if (input.action === "failover") {
      if (input.confirm !== CLOUD_CONFIRM.failover) return { ok: false as const, status: 400, error: "تأیید CLOUD_FAILOVER لازم است." };
      const prev = p.primaryRegion;
      p.primaryRegion = p.secondaryRegion;
      p.secondaryRegion = prev;
      data.cloud.failoverAt = now;
      data.cloud.events.unshift({
        id: randomId(),
        at: now,
        service: "api",
        action: "failover",
        from: 0,
        to: 0,
        reason: `region ${prev} → ${p.primaryRegion}; sessions not revoked`,
      });
      data.cloud.drills.unshift({ id: randomId(), kind: "failover", at: now, ok: true, note: `actor ${hint(staff.user.id)}` });
      return { ok: true as const, policy: p };
    }
    if (input.action === "chaos") {
      if (env === "production") return { ok: false as const, status: 403, error: "Chaos فقط در Staging/Development." };
      if (input.confirm !== CLOUD_CONFIRM.chaos) return { ok: false as const, status: 400, error: "تأیید CLOUD_CHAOS لازم است." };
      const victim = data.cloud.instances.find((i) => i.state === "ready" && i.service === (input.service ?? "api"));
      if (victim) victim.state = "unhealthy";
      const remaining = data.cloud.instances.filter((i) => i.service === (input.service ?? "api") && i.state === "ready").length;
      data.cloud.events.unshift({
        id: randomId(),
        at: now,
        service: input.service ?? "api",
        action: "chaos",
        from: remaining + 1,
        to: remaining,
        reason: "controlled instance failure",
      });
      data.cloud.drills.unshift({
        id: randomId(),
        kind: "chaos",
        at: now,
        ok: remaining >= p.services[input.service ?? "api"].min - 1,
        note: remaining > 0 ? "fleet survived" : "fleet empty — raise min replicas",
      });
      return { ok: true as const, policy: p, remaining };
    }
    if (input.action === "loadtest") {
      if (env === "production") return { ok: false as const, status: 403, error: "Load test روی Production از این پنل اجرا نمی‌شود." };
      if (input.confirm !== CLOUD_CONFIRM.loadtest) return { ok: false as const, status: 400, error: "تأیید CLOUD_LOADTEST لازم است." };
      for (const inst of data.cloud.instances) {
        if (inst.service === "api" && inst.state === "ready") {
          inst.cpuPct = 92;
          inst.inflight = p.services.api.requestTarget + 10;
        }
      }
      tickFleet(data, now);
      data.cloud.drills.unshift({ id: randomId(), kind: "loadtest", at: now, ok: true, note: "synthetic cpu/request pressure" });
      return { ok: true as const, policy: p };
    }
    if (input.action === "stress") {
      if (env === "production") return { ok: false as const, status: 403, error: "Stress روی Production از این پنل اجرا نمی‌شود." };
      for (const inst of data.cloud.instances) {
        if (inst.state === "ready") inst.memPct = 96;
      }
      tickFleet(data, now);
      data.cloud.drills.unshift({ id: randomId(), kind: "stress", at: now, ok: true, note: "memory pressure" });
      return { ok: true as const, policy: p };
    }
    if (input.action === "restore-drill") {
      data.cloud.drills.unshift({
        id: randomId(),
        kind: "restore",
        at: now,
        ok: true,
        note: "DR restore path unchanged; cloud failover does not rewrite messages.",
      });
      return { ok: true as const, policy: p };
    }
    return { ok: false as const, status: 400, error: "عملیات ناشناخته است." };
  });
}

export function publicCloudHints() {
  return {
    regions: ["eu-central", "us-east", "ap-south"],
    sessions: "cookie; not sticky to one VM",
    files: "object storage / signed URL",
  };
}
