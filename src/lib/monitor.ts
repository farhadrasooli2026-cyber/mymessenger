import "server-only";
import { cpus, freemem, loadavg, totalmem } from "node:os";
import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { randomId } from "@/lib/crypto-utils";
import { dbHealth } from "@/lib/db/health";
import { listSnapshots } from "@/lib/db/backup";
import { getStorePath, mutateStore, readStoreSnapshot, type StoreData } from "@/lib/store";
import {
  ALERT_KEEP,
  emptyApiTotals,
  emptyMonitorPersist,
  ERROR_KEEP,
  LOG_KEEP,
  SAMPLE_KEEP,
  SLOW_MS,
  TIMEOUT_MS,
  type AlertSeverity,
  type ApiTotals,
  type ErrorGroup,
  type IncidentStatus,
  type LogLevel,
  type MonitorAlert,
  type MonitorLog,
  type MonitorService,
  type ServiceHealth,
} from "@/lib/monitor-types";
import { fingerprintError, formatStructuredLog, redactMonitorText, shouldEmitLevel } from "@/lib/logger";
import { requireStaff } from "@/lib/admin-moderation";
import { isShuttingDown } from "@/lib/lifecycle";
import { startupGate } from "@/lib/env-config";
import { persistHealth } from "@/lib/persist";

type Live = {
  api: ApiTotals;
  window: { start: number; requests: number; errors: number; latencySum: number };
  logs: MonitorLog[];
  errors: Map<string, ErrorGroup>;
  lastCpu: { user: number; system: number; at: number };
  lastFlush: number;
};

const live: Live = {
  api: emptyApiTotals(),
  window: { start: Date.now(), requests: 0, errors: 0, latencySum: 0 },
  logs: [],
  errors: new Map(),
  lastCpu: { user: 0, system: 0, at: 0 },
  lastFlush: 0,
};

function heartbeatPath() {
  return path.join(process.cwd(), ".data", process.env.VITEST ? `monitor-hb.test.${process.env.VITEST_WORKER_ID ?? "0"}.json` : "monitor-heartbeat.json");
}

function classifyRoute(pathname: string) {
  return pathname
    .replace(/\/[a-f0-9]{8,}/gi, "/*")
    .replace(/\/\d+/g, "/*")
    .split("?")[0]
    ?.slice(0, 80) ?? "/api";
}

function cpuPct() {
  const usage = process.cpuUsage();
  const now = Date.now();
  if (!live.lastCpu.at) {
    live.lastCpu = { user: usage.user, system: usage.system, at: now };
    const load = loadavg()[0] ?? 0;
    const n = Math.max(1, cpus().length);
    return Math.min(100, Math.round((load / n) * 100));
  }
  const du = usage.user - live.lastCpu.user;
  const ds = usage.system - live.lastCpu.system;
  const dt = Math.max(1, now - live.lastCpu.at) * 1000;
  live.lastCpu = { user: usage.user, system: usage.system, at: now };
  return Math.min(100, Math.round(((du + ds) / dt) * 100));
}

export function recordApiHit(input: {
  status: number;
  ms: number;
  route?: string;
  bytesIn?: number;
  bytesOut?: number;
  traceId?: string;
}) {
  const statusKey = String(input.status);
  live.api.requests += 1;
  live.api.status[statusKey] = (live.api.status[statusKey] ?? 0) + 1;
  live.api.latencySum += Math.max(0, input.ms);
  live.api.latencyMax = Math.max(live.api.latencyMax, input.ms);
  live.api.bytesIn += input.bytesIn ?? 0;
  live.api.bytesOut += input.bytesOut ?? 0;
  if (input.status >= 500) live.api.errors += 1;
  if (input.ms >= SLOW_MS) live.api.slow += 1;
  if (input.ms >= TIMEOUT_MS || input.status === 504) live.api.timeouts += 1;
  const w = live.window;
  if (Date.now() - w.start > 60_000) {
    live.window = { start: Date.now(), requests: 0, errors: 0, latencySum: 0 };
  }
  live.window.requests += 1;
  if (input.status >= 500) live.window.errors += 1;
  live.window.latencySum += input.ms;
  if (input.status >= 500) {
    nixoLog("error", "api", `HTTP ${input.status} ${classifyRoute(input.route ?? "/api")}`, input.traceId);
  }
  evaluateLiveThresholds();
}

export function nixoLog(level: LogLevel, service: MonitorService, message: string, traceId = "") {
  if (!shouldEmitLevel(level)) return;
  const row: MonitorLog = {
    id: randomId().slice(0, 12),
    at: Date.now(),
    level,
    service,
    message: redactMonitorText(message),
    traceId: traceId.slice(0, 40),
  };
  live.logs.unshift(row);
  live.logs = live.logs.slice(0, LOG_KEEP);
  if (level === "error" || level === "critical") {
    const fp = fingerprintError(service, row.message);
    const prev = live.errors.get(fp);
    if (prev) {
      prev.count += 1;
      prev.lastAt = row.at;
      prev.sample = row.message;
    } else {
      live.errors.set(fp, { fingerprint: fp, service, sample: row.message, count: 1, lastAt: row.at });
    }
  }
  if (process.env.VITEST) return;
  const line = formatStructuredLog(row);
  if (level === "error" || level === "critical") console.error(JSON.stringify(line));
  else if (level === "warn") console.warn(JSON.stringify(line));
}

export function trackException(service: MonitorService, err: unknown, traceId = "") {
  const msg = err instanceof Error ? err.message : String(err);
  nixoLog("error", service, msg, traceId);
}

function raiseAlert(key: string, severity: AlertSeverity, title: string) {
  void mutateStore((data) => {
    data.monitor ??= emptyMonitorPersist();
    const existing = data.monitor.alerts.find((a) => a.key === key && !a.resolvedAt);
    const now = Date.now();
    if (existing) {
      existing.count += 1;
      existing.at = now;
      if (existing.ackAt && now - existing.ackAt < 10 * 60_000) existing.suppressed = true;
      if (!existing.ackAt && existing.count >= 3 && severity === "critical") existing.escalated = true;
      return;
    }
    const alert: MonitorAlert = {
      id: randomId(),
      key,
      severity,
      title,
      at: now,
      count: 1,
      ackAt: null,
      ackBy: null,
      resolvedAt: null,
      suppressed: false,
      escalated: false,
    };
    data.monitor.alerts.unshift(alert);
    data.monitor.alerts = data.monitor.alerts.slice(0, ALERT_KEEP);
    if (severity === "critical" || severity === "high") {
      data.adminAlerts = data.adminAlerts ?? [];
      data.adminAlerts.unshift({
        id: randomId(),
        severity: severity === "critical" ? "critical" : "high",
        title,
        detail: "monitor",
        createdAt: now,
        ackAt: null,
        ackBy: null,
      });
      data.adminAlerts = data.adminAlerts.slice(0, 400);
      const open = data.monitor.incidents.find((i) => i.status !== "resolved" && i.status !== "closed" && i.title === title);
      if (!open) {
        data.monitor.incidents.unshift({
          id: randomId(),
          title,
          status: "detected",
          ownerId: null,
          createdAt: now,
          updatedAt: now,
          alertIds: [alert.id],
          timeline: [{ at: now, actor: "monitor", action: "detected" }],
        });
      } else if (!open.alertIds.includes(alert.id)) {
        open.alertIds.push(alert.id);
        open.timeline.unshift({ at: now, actor: "monitor", action: "linked-alert" });
      }
    }
  }).catch(() => {
    nixoLog("warn", "monitor", "store write for alert failed; heartbeat still live");
  });
}

function evaluateLiveThresholds() {
  const w = live.window;
  if (w.requests >= 20) {
    const rate = w.errors / w.requests;
    if (rate >= 0.2) raiseAlert("error-rate", "high", "نرخ خطای API بالا است");
    const avg = w.latencySum / Math.max(1, w.requests);
    if (avg >= SLOW_MS) raiseAlert("latency", "warning", "میانگین تأخیر API بالا است");
  }
}

export async function observeHttp(status: number) {
  try {
    const { headers } = await import("next/headers");
    const h = await headers();
    const start = Number(h.get("x-nixo-start") ?? "0");
    const ms = start > 0 ? Math.max(0, Date.now() - start) : 0;
    const route = h.get("x-nixo-path") ?? "/api";
    const traceId = h.get("x-request-id") ?? "";
    const bytesIn = Number(h.get("content-length") ?? "0");
    recordApiHit({ status, ms, route, bytesIn, traceId });
  } catch {
    recordApiHit({ status, ms: 0, route: "/api" });
  }
}

async function writeHeartbeat(ok: boolean) {
  try {
    const file = heartbeatPath();
    await mkdir(path.dirname(file), { recursive: true });
    await writeFile(file, JSON.stringify({ ok, at: Date.now(), pid: process.pid }), "utf8");
  } catch {
    /* independent path; ignore */
  }
}

export async function readHeartbeat() {
  try {
    const raw = await readFile(heartbeatPath(), "utf8");
    const parsed = JSON.parse(raw) as { ok?: boolean; at?: number };
    return { ok: Boolean(parsed.ok), at: parsed.at ?? 0, independent: true };
  } catch {
    return { ok: false, at: 0, independent: true };
  }
}

function serviceMap(data: StoreData, dbOk: boolean, storeBytes: number | null): Record<string, ServiceHealth> {
  const jobs = (data.searchIndexJobs ?? []).filter((j) => j.status === "queued" || j.status === "running").length;
  const vaultFail = data.storageMetrics?.uploadFail ?? 0;
  const pushDead = (data.notifyDeadLetters ?? []).length;
  const memMb = process.memoryUsage().rss / (1024 * 1024);
  const map: Record<string, ServiceHealth> = {
    api: live.api.errors > 50 && live.api.requests > 0 && live.api.errors / live.api.requests > 0.5 ? "degraded" : "up",
    database: dbOk ? "up" : "down",
    cache: (data.searchMetrics?.cacheHits ?? 0) >= 0 ? "up" : "degraded",
    queue: jobs > 40 ? "degraded" : "up",
    storage: vaultFail > 20 ? "degraded" : "up",
    messaging: "up",
    calls: "up",
    video: "up",
    stories: "up",
    notify: pushDead > 30 ? "degraded" : "up",
    search: (data.searchMetrics?.errors ?? 0) > 20 ? "degraded" : "up",
    groups: "up",
    channels: "up",
    auth: (data.securityMetrics?.loginFails ?? 0) > 40 ? "degraded" : "up",
    security: "up",
    moderation: "up",
    backup: "up",
    monitor: memMb > 0 ? "up" : "down",
  };
  if (storeBytes != null && storeBytes > 80 * 1024 * 1024) map.database = "degraded";
  return map;
}

function domainMetrics(data: StoreData) {
  const now = Date.now();
  const day = 24 * 60 * 60_000;
  const users = data.users;
  const dau = users.filter((u) => now - (u.lastSeenAt || 0) < day).length;
  const mau = users.filter((u) => now - (u.lastSeenAt || 0) < 30 * day).length;
  const newUsers = users.filter((u) => now - (u.createdAt || 0) < day).length;
  const cohort = users.filter((u) => now - (u.createdAt || 0) > 7 * day);
  const retained = cohort.filter((u) => now - (u.lastSeenAt || 0) < 7 * day).length;
  const quality = data.callQuality ?? [];
  const jitter = quality.length ? Math.round(quality.reduce((s, q) => s + (q.jitterMs ?? 0), 0) / quality.length) : 0;
  const loss = quality.length ? Math.round((quality.reduce((s, q) => s + (q.loss ?? 0), 0) / quality.length) * 1000) / 1000 : 0;
  const rtt = quality.length ? Math.round(quality.reduce((s, q) => s + (q.rttMs ?? 0), 0) / quality.length) : 0;
  const bitrate = quality.length ? Math.round(quality.reduce((s, q) => s + (q.bitrateKbps ?? 0), 0) / quality.length) : 0;
  const frozen = quality.filter((q) => q.frozen).length;
  const calls = data.calls ?? [];
  const ended = calls.filter((c) => c.status === "ended" || c.status === "missed" || c.status === "declined");
  const failCalls = calls.filter((c) => c.status === "missed" || c.status === "declined").length;
  const push = data.pushJobs ?? [];
  const vault = data.vaultObjects ?? [];
  const reports = data.reports ?? [];
  const searchQueries = data.searchMetrics?.queries ?? 0;
  const emptySearch = data.searchMetrics?.emptyResults ?? 0;
  return {
    users: {
      total: users.length,
      dau,
      mau,
      newUsers,
      retention7d: cohort.length ? Math.round((retained / cohort.length) * 1000) / 10 : null,
      sessions: (data.devices ?? []).filter((d) => !d.revokedAt).length,
    },
    messaging: {
      threads: data.threads.length,
      envelopes: data.messages.length,
      note: "ciphertext only — plaintext is not in analytics",
    },
    calls: {
      total: calls.length,
      ended: ended.length,
      failed: failCalls,
      rttMs: rtt,
      jitterMs: jitter,
      loss,
      bitrateKbps: bitrate,
      frozen,
    },
    stories: { total: (data.userStories ?? []).length, views: (data.storyWatches ?? []).length },
    notify: {
      records: (data.notifications ?? []).length,
      push: push.length,
      failed: push.filter((j) => j.status === "failed" || j.status === "dead").length,
      deadLetters: (data.notifyDeadLetters ?? []).length,
    },
    search: {
      queries: searchQueries,
      errors: data.searchMetrics?.errors ?? 0,
      latencyMs: data.searchMetrics?.lastLatencyMs ?? 0,
      empty: emptySearch,
      zeroResultRate: searchQueries ? Math.round((emptySearch / searchQueries) * 1000) / 10 : 0,
      cacheHits: data.searchMetrics?.cacheHits ?? 0,
    },
    storage: {
      objects: vault.filter((v) => !v.deletedAt).length,
      bytes: vault.reduce((s, v) => s + (v.deletedAt ? 0 : v.size), 0),
      uploads: data.storageMetrics?.uploads ?? 0,
      uploadFail: data.storageMetrics?.uploadFail ?? 0,
      downloads: data.storageMetrics?.downloads ?? 0,
      downloadFail: data.storageMetrics?.downloadFail ?? 0,
    },
    groups: { total: (data.groups ?? []).filter((g) => !g.deletedAt).length },
    channels: {
      total: (data.pubChannels ?? []).filter((c) => !c.deletedAt).length,
      posts: (data.channelPosts ?? []).length,
    },
    auth: {
      loginFails: data.securityMetrics?.loginFails ?? 0,
      permissionDenies: data.securityMetrics?.permissionDenies ?? 0,
      incidents: data.securityMetrics?.incidents ?? 0,
    },
    moderation: data.adminMetrics ?? {},
    abuse: {
      reports: reports.length,
      spam: reports.filter((r) => r.category === "spam").length,
    },
    rateLimit: { http429: live.api.status["429"] ?? 0 },
    recoveries: (data.dbJobs ?? []).filter((j) => j.kind === "verify" || j.kind === "cleanup").length,
    queues: {
      search: (data.searchIndexJobs ?? []).filter((j) => j.status === "queued" || j.status === "running").length,
      vault: (data.vaultJobs ?? []).filter((j) => j.status === "queued" || j.status === "running").length,
      push: push.filter((j) => j.status === "queued" || j.status === "running").length,
      media: (data.mediaJobs ?? []).filter((j) => j.status === "queued" || j.status === "running").length,
    },
    cache: { searchHits: data.searchMetrics?.cacheHits ?? 0 },
    features: {
      stories: (data.userStories ?? []).length,
      groups: (data.groups ?? []).length,
      channels: (data.pubChannels ?? []).length,
      calls: calls.length,
      search: data.searchMetrics?.queries ?? 0,
    },
  };
}

export async function flushMonitor() {
  const health = await dbHealth();
  let storeBytes: number | null = health.storeBytes;
  try {
    storeBytes = (await stat(getStorePath())).size;
  } catch {
    storeBytes = health.storeBytes;
  }
  const cpu = cpuPct();
  const memMb = Math.round(process.memoryUsage().rss / (1024 * 1024));
  const diskMb = storeBytes != null ? Math.round(storeBytes / (1024 * 1024)) : 0;
  const flags: { key: string; severity: AlertSeverity; title: string }[] = [];
  if (cpu > 90) flags.push({ key: "cpu", severity: "warning", title: "مصرف CPU بالا است" });
  if (memMb > 700) flags.push({ key: "memory", severity: "warning", title: "مصرف حافظه بالا است" });
  if (diskMb > 80) flags.push({ key: "disk", severity: "high", title: "حجم Store در حال رشد است" });
  if (!health.ok) flags.push({ key: "database", severity: "critical", title: "پایگاه داده پاسخ نمی‌دهد" });
  await writeHeartbeat(true);
  const errors = [...live.errors.values()].sort((a, b) => b.lastAt - a.lastAt).slice(0, ERROR_KEEP);
  const extra = await mutateStore((data) => {
    data.monitor ??= emptyMonitorPersist();
    const services = serviceMap(data, health.ok, storeBytes);
    data.monitor.api = { ...live.api, status: { ...live.api.status } };
    data.monitor.heartbeatAt = Date.now();
    data.monitor.logs = live.logs.slice(0, LOG_KEEP);
    data.monitor.errors = errors;
    data.monitor.samples.unshift({ at: Date.now(), cpuPct: cpu, memMb, diskMb, services });
    data.monitor.samples = data.monitor.samples.slice(0, SAMPLE_KEEP);
    const q = (data.searchIndexJobs ?? []).filter((j) => j.status === "queued").length;
    const out: { key: string; severity: AlertSeverity; title: string }[] = [];
    if (q > 50) out.push({ key: "queue", severity: "warning", title: "صف ایندکس جستجو طولانی است" });
    if ((data.storageMetrics?.uploadFail ?? 0) > 15) out.push({ key: "storage", severity: "high", title: "خطای ذخیره‌سازی زیاد است" });
    if ((data.securityMetrics?.loginFails ?? 0) > 40) out.push({ key: "failed-login", severity: "high", title: "ورود ناموفق غیرعادی" });
    if ((data.securityMetrics?.incidents ?? 0) > 0) out.push({ key: "security-incident", severity: "critical", title: "رویداد امنیتی ثبت شده" });
    if ((data.dbJobs ?? []).some((j) => j.kind === "backup" && j.status === "failed" && Date.now() - j.createdAt < 24 * 60 * 60_000)) {
      out.push({ key: "backup-fail", severity: "critical", title: "پشتیبان ناموفق" });
    }
    return out;
  });
  for (const f of [...flags, ...extra]) raiseAlert(f.key, f.severity, f.title);
  live.lastFlush = Date.now();
  const { maybeAutoDrBackup } = await import("@/lib/dr");
  await maybeAutoDrBackup().catch(() => nixoLog("warn", "backup", "auto backup skipped"));
  const { maybeDrainPerf } = await import("@/lib/perf");
  await maybeDrainPerf().catch(() => nixoLog("warn", "queue", "worker drain skipped"));
  const { maybeAutoRollback } = await import("@/lib/deploy");
  const errRate = live.api.requests ? (live.api.errors / live.api.requests) * 100 : 0;
  await maybeAutoRollback(errRate, true).catch(() => nixoLog("warn", "monitor", "auto rollback skipped"));
}

export async function maybeFlush() {
  if (Date.now() - live.lastFlush < (process.env.VITEST ? 0 : 8000)) return;
  await flushMonitor().catch(() => nixoLog("error", "monitor", "flush failed"));
}

export async function publicHealth(probe?: string | null) {
  const hb = await readHeartbeat();
  const liveProbe = {
    ok: true,
    pid: Boolean(process.pid),
    heartbeatLagMs: hb.at ? Date.now() - hb.at : null,
    independentHeartbeat: hb.independent,
  };
  if (probe === "live") return { ok: liveProbe.ok && !isShuttingDown(), live: { ...liveProbe, draining: isShuttingDown() } };
  const db = await dbHealth();
  const start = startupGate();
  const persist = await persistHealth();
  const persistReady = persist.connected;
  const ready = {
    ok: db.ok && db.ready && persistReady && !isShuttingDown() && start.ok,
    schema: db.schemaVersion,
  };
  const blockers = [
    ...start.errors,
    ...(!persistReady ? ["database unreachable"] : []),
  ];
  if (probe === "ready") {
    const { otpProvidersReady } = await import("@/lib/otp-delivery");
    const { deployedGitSha } = await import("@/lib/release");
    return {
      ok: ready.ok,
      ready,
      startup: start.ok,
      blockers,
      warnings: start.warnings ?? [],
      gitSha: deployedGitSha(),
      otp: otpProvidersReady(),
      persist,
    };
  }
  return {
    ok: db.ok && liveProbe.ok,
    live: liveProbe,
    ready,
    startup: start.ok,
    blockers,
    warnings: start.warnings ?? [],
    env: db.env,
    writerPool: db.writerPool,
  };
}

export async function monitorDashboard() {
  const ctx = await requireStaff("monitor");
  if (!ctx.ok) return ctx;
  await maybeFlush();
  const data = await readStoreSnapshot();
  data.monitor ??= emptyMonitorPersist();
  const db = await dbHealth();
  const hb = await readHeartbeat();
  let backups: { id: string; createdAt: number; bytes: number; verifiedAt: number | null }[] = [];
  try {
    backups = (await listSnapshots()).slice(0, 8).map((s) => ({
      id: s.id,
      createdAt: s.createdAt,
      bytes: s.bytes,
      verifiedAt: s.verifiedAt ?? null,
    }));
  } catch {
    nixoLog("warn", "backup", "list snapshots failed");
  }
  const lastBackup = backups[0];
  if (lastBackup && Date.now() - lastBackup.createdAt > 48 * 60 * 60_000) {
    raiseAlert("backup-stale", "warning", "پشتیبان تازه نیست");
  }
  if (hb.at && Date.now() - hb.at > 3 * 60_000) {
    raiseAlert("monitor-heartbeat", "high", "ضربان پایش کهنه است");
  }
  const api = data.monitor.api.requests ? data.monitor.api : live.api;
  const avg = api.requests ? Math.round(api.latencySum / api.requests) : 0;
  const errRate = api.requests ? Math.round((api.errors / api.requests) * 1000) / 10 : 0;
  const availability = api.requests ? Math.round((1 - api.errors / api.requests) * 10000) / 100 : 100;
  const mem = process.memoryUsage();
  const hist = data.monitor.samples.slice(0, 24);
  const oldest = hist[hist.length - 1];
  const newest = hist[0];
  const diskDelta = oldest && newest && newest.at !== oldest.at ? newest.diskMb - oldest.diskMb : 0;
  const hours = oldest && newest ? Math.max(1, (newest.at - oldest.at) / 3_600_000) : 1;
  const projectedStoreMb7d = Math.max(0, Math.round(newest ? newest.diskMb + (diskDelta / hours) * 24 * 7 : 0));
  return {
    ok: true as const,
    role: ctx.staff.role,
    process: {
      cpuPct: cpuPct(),
      memMb: Math.round(mem.rss / (1024 * 1024)),
      heapMb: Math.round(mem.heapUsed / (1024 * 1024)),
      load: loadavg()[0] ?? 0,
      cores: cpus().length,
      freeMemMb: Math.round(freemem() / (1024 * 1024)),
      totalMemMb: Math.round(totalmem() / (1024 * 1024)),
      storeBytes: db.storeBytes,
    },
    health: {
      database: db.ok ? "up" : "down",
      ready: db.ready,
      heartbeat: hb,
      services: data.monitor.samples[0]?.services ?? serviceMap(data, db.ok, db.storeBytes),
      history: data.monitor.samples.slice(0, 24).map((s) => ({ at: s.at, cpuPct: s.cpuPct, memMb: s.memMb, diskMb: s.diskMb })),
    },
    api: {
      ...api,
      avgMs: avg,
      errorRate: errRate,
      throughputPerMin: live.window.requests,
      availability,
      slaTarget: 99.9,
      slaMet: availability >= 99.9,
    },
    capacity: {
      users: data.users.length,
      storageBytes: (data.vaultObjects ?? []).reduce((s, v) => s + (v.deletedAt ? 0 : v.size), 0),
      storeBytes: db.storeBytes,
      projectedStoreMb7d,
    },
    domain: domainMetrics(data),
    logs: (data.monitor.logs.length ? data.monitor.logs : live.logs).slice(0, 40),
    errors: (data.monitor.errors.length ? data.monitor.errors : [...live.errors.values()]).slice(0, 30),
    alerts: data.monitor.alerts.slice(0, 40).map((a) => ({
      id: a.id,
      severity: a.severity,
      title: a.title,
      at: a.at,
      count: a.count,
      ack: Boolean(a.ackAt),
      resolved: Boolean(a.resolvedAt),
      suppressed: a.suppressed,
      escalated: a.escalated,
    })),
    incidents: data.monitor.incidents.slice(0, 20),
    backups,
    dependencies: [
      { from: "api", to: "database" },
      { from: "api", to: "storage" },
      { from: "search", to: "database" },
      { from: "notify", to: "queue" },
      { from: "calls", to: "api" },
      { from: "monitor", to: "database" },
      { from: "monitor", to: "heartbeat" },
    ],
    privacy: {
      storesPlaintextMessages: false,
      storesCallMedia: false,
      storesFileBytes: false,
      piiInMetrics: false,
    },
  };
}

export async function ackMonitorAlert(id: string) {
  const ctx = await requireStaff("monitor");
  if (!ctx.ok) return ctx;
  return mutateStore((data) => {
    data.monitor ??= emptyMonitorPersist();
    const row = data.monitor.alerts.find((a) => a.id === id);
    if (!row) return { ok: false as const, error: "هشدار یافت نشد.", status: 404 };
    row.ackAt = Date.now();
    row.ackBy = ctx.user.id;
    row.suppressed = true;
    return { ok: true as const };
  });
}

export async function resolveMonitorAlert(id: string) {
  const ctx = await requireStaff("monitor");
  if (!ctx.ok) return ctx;
  return mutateStore((data) => {
    data.monitor ??= emptyMonitorPersist();
    const row = data.monitor.alerts.find((a) => a.id === id);
    if (!row) return { ok: false as const, error: "هشدار یافت نشد.", status: 404 };
    row.resolvedAt = Date.now();
    return { ok: true as const };
  });
}

export async function setIncident(id: string, status: IncidentStatus, ownerId?: string | null) {
  const ctx = await requireStaff("monitor");
  if (!ctx.ok) return ctx;
  return mutateStore((data) => {
    data.monitor ??= emptyMonitorPersist();
    const row = data.monitor.incidents.find((i) => i.id === id);
    if (!row) return { ok: false as const, error: "حادثه یافت نشد.", status: 404 };
    row.status = status;
    row.updatedAt = Date.now();
    if (ownerId !== undefined) row.ownerId = ownerId;
    row.timeline.unshift({ at: Date.now(), actor: ctx.user.id.slice(0, 8), action: status });
    return { ok: true as const };
  });
}

export async function recoverMonitor() {
  const ctx = await requireStaff("monitor");
  if (!ctx.ok) return ctx;
  const persist = await mutateStore((data) => {
    data.monitor ??= emptyMonitorPersist();
    data.monitor.recoveredAt = Date.now();
    data.monitor.heartbeatAt = Date.now();
    if (!data.monitor.api) data.monitor.api = emptyApiTotals();
    live.api = { ...data.monitor.api, status: { ...data.monitor.api.status } };
    live.logs = data.monitor.logs ?? [];
    live.errors = new Map((data.monitor.errors ?? []).map((e) => [e.fingerprint, e]));
    return data.monitor;
  });
  await writeHeartbeat(true);
  nixoLog("warn", "monitor", "monitor recovered from store+heartbeat");
  return { ok: true as const, heartbeatAt: persist.heartbeatAt, logs: persist.logs.length, recoveredAt: persist.recoveredAt };
}

export async function ingestClientError(message: string) {
  const text = redactMonitorText(message).slice(0, 200);
  if (text.length < 3) return { ok: false as const, error: "پیام خالی است.", status: 400 };
  nixoLog("error", "api", `client ${text}`);
  await mutateStore((data) => {
    data.monitor ??= emptyMonitorPersist();
    data.monitor.clientErrors += 1;
  });
  return { ok: true as const };
}

export function resetMonitorForTests() {
  live.api = emptyApiTotals();
  live.window = { start: Date.now(), requests: 0, errors: 0, latencySum: 0 };
  live.logs = [];
  live.errors = new Map();
  live.lastFlush = 0;
}

export { classifyRoute, live as monitorLive };
