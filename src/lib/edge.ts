import "server-only";
import { hmacIdentifier, randomId } from "@/lib/crypto-utils";
import { hitRateLimit } from "@/lib/rate-limit";
import { mutateStore, type StoreData } from "@/lib/store";
import { hydrateEdgePersist } from "@/lib/edge-persist";
import { EDGE_CONFIRM } from "@/lib/edge-types";
import {
  PERF_BUDGET,
  cacheControlFor,
  classifyPath,
  percentile,
  routeToPop,
  wsGatewayFor,
  type EdgePopId,
} from "@/lib/edge-policy";
import { currentDeployEnv } from "@/lib/env-config";
import { iceHealth } from "@/lib/ice";

export function ensureEdge(data: StoreData) {
  data.edge = hydrateEdgePersist(data.edge);
}

function hint(id: string) {
  return hmacIdentifier(`edge-actor:${id}`).slice(0, 12);
}

function currentCfg(data: StoreData) {
  ensureEdge(data);
  return data.edge.configs.find((c) => c.id === data.edge.currentConfigId) ?? data.edge.configs[0]!;
}

export async function ingestEdgeRum(input: {
  userId?: string | null;
  ipHash: string;
  ms: number;
  kind: "static" | "api" | "media" | "ws" | "call";
  pop?: EdgePopId;
}) {
  if (input.ms < 0 || input.ms > 60_000) return { ok: false as const, status: 400, error: "نمونه نامعتبر است." };
  return mutateStore((data) => {
    ensureEdge(data);
    const rl = hitRateLimit(data, `edge-rum:${input.ipHash}`, 60_000, 40);
    if (!rl.allowed) return { ok: false as const, status: 429, error: "نمونه محدود شد." };
    if (Math.abs(hmacIdentifier(`rum:${input.userId ?? input.ipHash}`).charCodeAt(0)) % 5 !== 0) {
      return { ok: true as const, sampled: false };
    }
    const pop = input.pop && data.edge.pops.some((p) => p.id === input.pop) ? input.pop : (routeToPop(data.edge.pops, { latency: true })?.id ?? "fra");
    data.edge.samples.push({ at: Date.now(), ms: Math.round(input.ms), kind: input.kind, pop });
    data.edge.samples = data.edge.samples.slice(-800);
    if (input.kind === "static") data.edge.hits += 1;
    else data.edge.misses += 1;
    return { ok: true as const, sampled: true };
  });
}

export async function edgeDashboard() {
  const { requireStaff: rs } = await import("@/lib/admin-moderation");
  const staff = await rs("edge.view");
  if (!staff.ok) return staff;
  const canManage = (await (await import("@/lib/admin-moderation")).requireStaff("edge.manage")).ok;
  return mutateStore((data) => {
    ensureEdge(data);
    const cfg = currentCfg(data);
    const samples = data.edge.samples.map((s) => s.ms);
    const byPop: Record<string, number[]> = {};
    for (const s of data.edge.samples) {
      byPop[s.pop] ??= [];
      byPop[s.pop]!.push(s.ms);
    }
    const hitRatio = data.edge.hits + data.edge.misses === 0 ? 0 : Math.round((data.edge.hits / (data.edge.hits + data.edge.misses)) * 100);
    const pop = routeToPop(data.edge.pops, { latency: true });
    return {
      ok: true as const,
      env: currentDeployEnv(),
      note: "کش مشترک فقط برای Asset نسخه‌دار عمومی است. پیام، فایل خصوصی، AI و پرداخت وارد CDN نمی‌شوند. Authorization در Origin می‌ماند.",
      config: {
        id: cfg.id,
        version: cfg.version,
        cacheGeneration: cfg.cacheGeneration,
        originHost: cfg.originHost,
        originShield: cfg.originShield,
        waf: cfg.waf,
        ddos: cfg.ddos,
        brotli: cfg.brotli,
        gzip: cfg.gzip,
        http3: cfg.http3,
        ipv6: cfg.ipv6,
        anycast: cfg.anycast,
        signedTtlSec: cfg.signedTtlSec,
        canaryPct: cfg.canaryPct,
        residencyLock: cfg.residencyLock,
      },
      pops: data.edge.pops,
      route: pop,
      ws: { gateway: wsGatewayFor(pop, "demo-session"), sticky: true, failover: "ready probe + reconnect" },
      cache: {
        hitRatio,
        hits: data.edge.hits,
        misses: data.edge.misses,
        static: cacheControlFor("static"),
        api: cacheControlFor("api-private"),
        media: cacheControlFor("media-private"),
      },
      latency: {
        p50: percentile(samples, 50),
        p95: percentile(samples, 95),
        p99: percentile(samples, 99),
        originP50: percentile(data.edge.originMs, 50),
        byPop: Object.fromEntries(Object.entries(byPop).map(([k, v]) => [k, { p50: percentile(v, 50), p95: percentile(v, 95) }])),
      },
      budget: PERF_BUDGET,
      ice: iceHealth(),
      cost: { bandwidthGb: data.edge.bandwidthGb, usdMonth: data.edge.costUsdMonth },
      purges: data.edge.purges.slice(0, 12),
      synthetics: data.edge.synthetics.slice(0, 12),
      configs: data.edge.configs.map((c) => ({ id: c.id, version: c.version, at: c.createdAt })),
      access: { canManage },
    };
  });
}

export async function edgeMutate(input: {
  action: string;
  confirm?: string;
  prefix?: string;
  pop?: EdgePopId;
  healthy?: boolean;
  canaryPct?: number;
  residencyLock?: "none" | "eu" | "us";
}) {
  const { requireStaff: rs } = await import("@/lib/admin-moderation");
  const staff = await rs("edge.manage");
  if (!staff.ok) return staff;
  return mutateStore((data) => {
    ensureEdge(data);
    const now = Date.now();
    const cfg = currentCfg(data);
    if (input.action === "purge") {
      if (input.confirm !== EDGE_CONFIRM.purge) return { ok: false as const, status: 400, error: "تأیید EDGE_PURGE لازم است." };
      const prefix = (input.prefix ?? "/_next/static").slice(0, 80);
      const kind = classifyPath(prefix.startsWith("/") ? prefix : `/${prefix}`);
      if (kind !== "static" && kind !== "public-short") {
        return { ok: false as const, status: 403, error: "Purge فقط برای Asset عمومی نسخه‌دار مجاز است." };
      }
      cfg.cacheGeneration += 1;
      data.edge.purges.unshift({ id: randomId(), at: now, prefix, actorHint: hint(staff.user.id) });
      data.edge.purges = data.edge.purges.slice(0, 80);
      return { ok: true as const, generation: cfg.cacheGeneration };
    }
    if (input.action === "pop") {
      const pop = data.edge.pops.find((p) => p.id === input.pop);
      if (!pop) return { ok: false as const, status: 404, error: "PoP نیست." };
      if (typeof input.healthy === "boolean") pop.healthy = input.healthy;
      return { ok: true as const, pops: data.edge.pops };
    }
    if (input.action === "synthetic") {
      for (const pop of data.edge.pops) {
        const ms = pop.healthy ? pop.rttMs + 8 : 5000;
        data.edge.synthetics.unshift({ id: randomId(), at: now, pop: pop.id, ok: pop.healthy, ms });
      }
      data.edge.synthetics = data.edge.synthetics.slice(0, 80);
      data.edge.originMs.push(22);
      data.edge.originMs = data.edge.originMs.slice(-200);
      return { ok: true as const, synthetics: data.edge.synthetics.slice(0, 8) };
    }
    if (input.action === "canary") {
      if (input.confirm !== EDGE_CONFIRM.canary) return { ok: false as const, status: 400, error: "تأیید EDGE_CANARY لازم است." };
      const next = {
        ...cfg,
        id: randomId(),
        version: cfg.version + 1,
        canaryPct: Math.min(100, Math.max(0, input.canaryPct ?? 10)),
        createdAt: now,
      };
      data.edge.configs.push(next);
      data.edge.currentConfigId = next.id;
      return { ok: true as const, config: { id: next.id, version: next.version, canaryPct: next.canaryPct } };
    }
    if (input.action === "rollback") {
      if (input.confirm !== EDGE_CONFIRM.rollback) return { ok: false as const, status: 400, error: "تأیید EDGE_ROLLBACK لازم است." };
      const prev = data.edge.configs.filter((c) => c.id !== cfg.id).sort((a, b) => b.version - a.version)[0];
      if (!prev) return { ok: false as const, status: 409, error: "نسخهٔ قبلی نیست." };
      data.edge.currentConfigId = prev.id;
      data.edge.lastRollbackAt = now;
      return { ok: true as const, config: { id: prev.id, version: prev.version } };
    }
    if (input.action === "residency") {
      cfg.residencyLock = input.residencyLock ?? "none";
      return { ok: true as const, residencyLock: cfg.residencyLock };
    }
    if (input.action === "auto-rollback") {
      const p95 = percentile(data.edge.samples.map((s) => s.ms), 95);
      if (p95 > PERF_BUDGET.apiP95Ms * 3 && data.edge.samples.length > 8) {
        const prev = data.edge.configs.filter((c) => c.id !== cfg.id).sort((a, b) => b.version - a.version)[0];
        if (prev) {
          data.edge.currentConfigId = prev.id;
          data.edge.lastRollbackAt = now;
        }
        return { ok: true as const, triggered: Boolean(prev), p95 };
      }
      return { ok: true as const, triggered: false, p95 };
    }
    return { ok: false as const, status: 400, error: "عملیات ناشناخته است." };
  });
}
