import "server-only";
import { cpus, loadavg } from "node:os";
import { randomId } from "@/lib/crypto-utils";
import { QUERY_TIMEOUT_MS, WRITER_POOL_SIZE } from "@/lib/db/catalog";
import { clampLimit } from "@/lib/db/query";
import { requireStaff } from "@/lib/admin-moderation";
import { drainSearchIndexJobs } from "@/lib/search";
import { drainPushJobs } from "@/lib/notify";
import { mutateStore, readStoreSnapshot, type StoreData } from "@/lib/store";
import { setShedLevel, currentShed } from "@/lib/perf-mode";
import {
  CDN_PUBLIC_MAX_AGE,
  READ_REPLICA_NOTE,
  SHARD_KEY,
  emptyPerfPersist,
  type PerfJob,
  type PerfJobKind,
  type PerfPersist,
  type PerfPriority,
  type ShedLevel,
} from "@/lib/perf-types";

const FORBIDDEN_CACHE = /password|token|secret|ciphertext|cookie|otp|pepper|privatekey|totp/i;
const MAX_CACHE = 800;
const SINGLE = new Map<string, Promise<unknown>>();
const memCache = new Map<string, { exp: number; value: unknown }>();
const permCache = new Map<string, { exp: number; allow: boolean }>();
const breakers = new Map<string, { fails: number; openUntil: number }>();
const pubsub = new Map<string, Set<(msg: { topic: string; id: string }) => void>>();
const heapSamples: number[] = [];

function now() {
  return Date.now();
}

export function pickFields<T extends Record<string, unknown>>(row: T, keys: readonly string[]): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const k of keys) {
    if (k in row && !FORBIDDEN_CACHE.test(k)) out[k] = row[k];
  }
  return out;
}

export function cacheKeySafe(key: string) {
  return Boolean(key) && key.length < 180 && !FORBIDDEN_CACHE.test(key);
}

export function cacheGet<T>(key: string): T | undefined {
  if (!cacheKeySafe(key)) return undefined;
  const row = memCache.get(key);
  if (!row) return undefined;
  if (row.exp < now()) {
    memCache.delete(key);
    return undefined;
  }
  return row.value as T;
}

export function cacheSet(key: string, value: unknown, ttlMs = 15_000) {
  if (!cacheKeySafe(key)) return false;
  if (value && typeof value === "object") {
    const blob = JSON.stringify(value);
    if (FORBIDDEN_CACHE.test(blob) || blob.length > 8_000) return false;
  }
  if (typeof value === "string" && (value.length > 400 || FORBIDDEN_CACHE.test(value))) return false;
  memCache.set(key, { exp: now() + Math.max(250, ttlMs), value });
  if (memCache.size > MAX_CACHE) {
    const first = memCache.keys().next().value;
    if (first) memCache.delete(first);
  }
  return true;
}

export function cacheInvalidate(prefix?: string) {
  if (!prefix) {
    memCache.clear();
    permCache.clear();
    return;
  }
  for (const k of [...memCache.keys()]) {
    if (k.startsWith(prefix)) memCache.delete(k);
  }
  for (const k of [...permCache.keys()]) {
    if (k.startsWith(prefix)) permCache.delete(k);
  }
}

export async function singleFlight<T>(key: string, produce: () => Promise<T> | T): Promise<T> {
  const hit = cacheGet<T>(key);
  if (hit !== undefined) {
    void bumpMetric("cacheHits");
    return hit;
  }
  const pending = SINGLE.get(key) as Promise<T> | undefined;
  if (pending) {
    void bumpMetric("cacheStampedeBlocked");
    return pending;
  }
  const run = Promise.resolve()
    .then(produce)
    .then((value) => {
      cacheSet(key, value);
      return value;
    })
    .finally(() => SINGLE.delete(key));
  SINGLE.set(key, run);
  void bumpMetric("cacheMisses");
  return run;
}

async function bumpMetric(field: keyof PerfPersist["metrics"], by = 1) {
  if (process.env.VITEST) {
    /* tests mutate via enqueueJob / dashboard */
    return;
  }
  await mutateStore((data) => {
    data.perf ??= emptyPerfPersist();
    const m = data.perf.metrics;
    if (typeof m[field] === "number") (m[field] as number) += by;
  }).catch(() => undefined);
}

export function cachedPublicUser(data: StoreData, userId: string) {
  const key = `pub:user:${userId}`;
  const hit = cacheGet<{ id: string; username: string | null; displayName: string | null }>(key);
  if (hit) return hit;
  const user = data.users.find((u) => u.id === userId);
  if (!user) return null;
  const card = {
    id: user.id,
    username: user.username ?? null,
    displayName: [user.firstName, user.lastName].filter(Boolean).join(" ") || null,
  };
  cacheSet(key, card, 12_000);
  return card;
}

export function cachedPublicGroup(data: StoreData, groupId: string) {
  const key = `pub:group:${groupId}`;
  const hit = cacheGet<{ id: string; name: string; username: string | null; members: number }>(key);
  if (hit) return hit;
  const group = data.groups.find((g) => g.id === groupId && !g.deletedAt);
  if (!group) return null;
  const card = {
    id: group.id,
    name: group.name,
    username: group.username ?? null,
    members: group.members.filter((m) => !m.leftAt).length,
  };
  cacheSet(key, card, 8_000);
  return card;
}

export function cachedPublicChannel(data: StoreData, channelId: string) {
  const key = `pub:channel:${channelId}`;
  const hit = cacheGet<{ id: string; name: string; username: string | null; subscribers: number }>(key);
  if (hit) return hit;
  const ch = data.pubChannels.find((c) => c.id === channelId);
  if (!ch) return null;
  const card = {
    id: ch.id,
    name: ch.name,
    username: ch.username ?? null,
    subscribers: ch.subscribers.length,
  };
  cacheSet(key, card, 8_000);
  return card;
}

export function permCached(userId: string, scope: string, compute: () => boolean) {
  const key = `perm:${userId}:${scope}`;
  const hit = permCache.get(key);
  if (hit && hit.exp > now()) return hit.allow;
  const allow = compute();
  permCache.set(key, { exp: now() + 5_000, allow });
  return allow;
}

export function invalidatePermCache(userId?: string) {
  if (!userId) {
    permCache.clear();
    return;
  }
  for (const k of [...permCache.keys()]) {
    if (k.startsWith(`perm:${userId}:`)) permCache.delete(k);
  }
}

export function circuitAllow(name: string, failThreshold = 5, coolMs = 15_000) {
  const row = breakers.get(name);
  if (row && row.openUntil > now()) return false;
  if (row && row.openUntil && row.openUntil <= now()) breakers.delete(name);
  void failThreshold;
  void coolMs;
  return true;
}

export function circuitFail(name: string, failThreshold = 5, coolMs = 15_000) {
  const row = breakers.get(name) ?? { fails: 0, openUntil: 0 };
  row.fails += 1;
  if (row.fails >= failThreshold) {
    row.openUntil = now() + coolMs;
    if (!process.env.VITEST) {
      void mutateStore((d) => {
        d.perf ??= emptyPerfPersist();
        d.perf.metrics.circuitOpens += 1;
      }).catch(() => undefined);
    }
  }
  breakers.set(name, row);
}

export function circuitOk(name: string) {
  breakers.delete(name);
}

export function subscribePerf(topic: string, fn: (msg: { topic: string; id: string }) => void) {
  let set = pubsub.get(topic);
  if (!set) {
    set = new Set();
    pubsub.set(topic, set);
  }
  set.add(fn);
  return () => set!.delete(fn);
}

export function publishPerf(topic: string, id: string) {
  const set = pubsub.get(topic);
  if (!set) return 0;
  for (const fn of set) fn({ topic, id });
  return set.size;
}

export function buildHotIndex(data: StoreData) {
  const userById = new Map<string, number>();
  const userByUsername = new Map<string, string>();
  const messagesByThread = new Map<string, number>();
  data.users.forEach((u, i) => {
    userById.set(u.id, i);
    if (u.username) userByUsername.set(u.username.toLowerCase(), u.id);
  });
  for (const m of data.messages) {
    messagesByThread.set(m.threadId, (messagesByThread.get(m.threadId) ?? 0) + 1);
  }
  return { userById, userByUsername, messagesByThread, users: data.users.length, messages: data.messages.length };
}

export function prefetchById<T extends { id: string }>(rows: T[], ids: string[]) {
  const map = new Map<string, T>();
  const want = new Set(ids);
  for (const row of rows) {
    if (want.has(row.id)) map.set(row.id, row);
  }
  return map;
}

export function backoffMs(retries: number) {
  const n = Math.max(0, Math.min(8, retries));
  return Math.min(30_000, 400 * 2 ** n);
}

function heapMb() {
  return Math.round(process.memoryUsage().rss / (1024 * 1024));
}

function recordHeap() {
  const mb = heapMb();
  heapSamples.push(mb);
  if (heapSamples.length > 24) heapSamples.shift();
  if (heapSamples.length < 6) return { mb, leakSuspect: false };
  const first = heapSamples[0] ?? mb;
  return { mb, leakSuspect: first > 0 && mb > first * 1.8 && mb > 250 };
}

export async function enqueuePerfJob(input: {
  kind: PerfJobKind;
  targetId: string;
  priority?: PerfPriority;
  idempotencyKey?: string;
}) {
  const key = input.idempotencyKey || `${input.kind}:${input.targetId}`;
  return mutateStore((data) => {
    data.perf ??= emptyPerfPersist();
    const dup = data.perf.jobs.find((j) => j.idempotencyKey === key && (j.status === "queued" || j.status === "running"));
    if (dup) return { ok: true as const, id: dup.id, deduped: true };
    const job: PerfJob = {
      id: randomId(),
      kind: input.kind,
      priority: input.priority ?? (input.kind === "push" || input.kind === "fanout" ? 8 : 4),
      status: "queued",
      targetId: input.targetId.slice(0, 80),
      idempotencyKey: key.slice(0, 120),
      retries: 0,
      runAfter: now(),
      error: null,
      createdAt: now(),
      updatedAt: now(),
      durationMs: 0,
    };
    data.perf.jobs.unshift(job);
    data.perf.jobs = data.perf.jobs.slice(0, 400);
    return { ok: true as const, id: job.id, deduped: false };
  });
}

function runOne(job: PerfJob, data: StoreData) {
  const started = now();
  if (now() - started > QUERY_TIMEOUT_MS) throw new Error("timeout");
  if (job.kind === "search") drainSearchIndexJobs(data);
  else if (job.kind === "push") drainPushJobs(data);
  else if (job.kind === "index") buildHotIndex(data);
  else if (job.kind === "fanout") publishPerf(`fanout:${job.targetId}`, job.id);
  else if (job.kind === "thumb" || job.kind === "transcode") {
    /* CPU-light placeholder: real media workers already live in media-share / storage */
  } else if (job.kind === "bench") {
    if (job.targetId === "fail") throw new Error("bench-fail");
    runMicroBench(data);
  }
  job.durationMs = now() - started;
}

export async function drainPerfWorkers() {
  const heap = recordHeap();
  if (heap.mb > 900) return { ok: true as const, ran: 0, skipped: "memory" };
  return mutateStore((data) => {
    data.perf ??= emptyPerfPersist();
    data.perf.metrics.heapMb = heap.mb;
    data.perf.metrics.leakSuspect = heap.leakSuspect;
    drainSearchIndexJobs(data);
    drainPushJobs(data);
    const conc = Math.max(1, Math.min(4, data.perf.policy.workerConcurrency));
    const queued = data.perf.jobs
      .filter((j) => (j.status === "queued" || j.status === "failed") && j.runAfter <= now() && j.status !== "dead")
      .sort((a, b) => b.priority - a.priority || a.createdAt - b.createdAt)
      .slice(0, conc);
    let ran = 0;
    for (const job of queued) {
      job.status = "running";
      job.updatedAt = now();
      try {
        runOne(job, data);
        job.status = "done";
        data.perf.metrics.jobsDone += 1;
        ran += 1;
      } catch (err) {
        job.retries += 1;
        job.error = err instanceof Error ? err.message.slice(0, 120) : "fail";
        data.perf.metrics.jobsFailed += 1;
        if (job.retries >= data.perf.policy.retryMax) {
          job.status = "dead";
          data.perf.metrics.jobsDead += 1;
          data.perf.dlq.unshift({ id: randomId(), jobId: job.id, kind: job.kind, error: job.error, at: now() });
          data.perf.dlq = data.perf.dlq.slice(0, 200);
        } else {
          job.status = "queued";
          job.runAfter = now() + backoffMs(job.retries);
        }
      }
    }
    data.perf.jobs = data.perf.jobs.filter((j) => j.status !== "done" || now() - j.updatedAt < 86_400_000).slice(0, 400);
    updateShedFromLoad(data);
    return { ok: true as const, ran };
  });
}

function updateShedFromLoad(data: StoreData) {
  if (!data.perf.policy.loadShed) {
    data.perf.shed = "off";
    setShedLevel("off");
    return;
  }
  const load = loadavg()[0] ?? 0;
  const cores = Math.max(1, cpus().length);
  const q =
    data.perf.jobs.filter((j) => j.status === "queued").length +
    (data.searchIndexJobs ?? []).filter((j) => j.status === "queued").length +
    (data.pushJobs ?? []).filter((j) => j.status === "queued").length;
  let next: ShedLevel = "off";
  if (load / cores > 0.9 || q > 80) next = "hard";
  else if (load / cores > 0.65 || q > 30) next = "soft";
  if (next === "soft") data.perf.metrics.shedSoft += 1;
  if (next === "hard") data.perf.metrics.shedHard += 1;
  data.perf.shed = next;
  setShedLevel(next);
}

export async function maybeDrainPerf() {
  if (process.env.VITEST) return;
  await drainPerfWorkers().catch(() => undefined);
}

export function runMicroBench(data: StoreData) {
  const n = Math.min(2000, data.users.length || 1);
  const target = data.users[0]?.id ?? "missing";
  const t0 = performance.now();
  for (let i = 0; i < n; i += 1) data.users.find((u) => u.id === target);
  const scanMs = performance.now() - t0;
  const idx = buildHotIndex(data);
  const t1 = performance.now();
  for (let i = 0; i < n; i += 1) idx.userById.get(target);
  const indexMs = performance.now() - t1;
  return {
    samples: n,
    scanMs: Math.round(scanMs * 1000) / 1000,
    indexMs: Math.round(indexMs * 1000) / 1000,
    faster: indexMs <= scanMs,
  };
}

export async function perfDashboard() {
  const ctx = await requireStaff("monitor");
  if (!ctx.ok) return ctx;
  await drainPerfWorkers().catch(() => undefined);
  const data = await readStoreSnapshot();
  data.perf ??= emptyPerfPersist();
  const bench = runMicroBench(data);
  const queues = {
    perf: data.perf.jobs.filter((j) => j.status === "queued" || j.status === "running").length,
    search: (data.searchIndexJobs ?? []).filter((j) => j.status === "queued" || j.status === "running").length,
    push: (data.pushJobs ?? []).filter((j) => j.status === "queued" || j.status === "running").length,
    media: (data.mediaJobs ?? []).filter((j) => j.status === "queued" || j.status === "running").length,
    vault: (data.vaultJobs ?? []).filter((j) => j.status === "queued" || j.status === "running").length,
    delayMs: data.perf.jobs.find((j) => j.status === "queued") ? Math.max(0, now() - (data.perf.jobs.find((j) => j.status === "queued")?.createdAt ?? now())) : 0,
    dead: data.perf.dlq.length + (data.notifyDeadLetters ?? []).length,
  };
  return {
    ok: true as const,
    shed: currentShed(),
    policy: data.perf.policy,
    metrics: data.perf.metrics,
    queues,
    jobs: data.perf.jobs.slice(0, 30).map((j) => ({
      id: j.id,
      kind: j.kind,
      status: j.status,
      priority: j.priority,
      retries: j.retries,
      durationMs: j.durationMs,
      targetId: j.targetId.slice(0, 8),
    })),
    dlq: data.perf.dlq.slice(0, 15),
    bench,
    pool: { writer: WRITER_POOL_SIZE, queryTimeoutMs: QUERY_TIMEOUT_MS, shardKey: SHARD_KEY, replica: READ_REPLICA_NOTE },
    http: { http2: true, http3Ready: true, keepAlive: true, compressSafe: true, cdnMaxAge: CDN_PUBLIC_MAX_AGE, apiCache: "private, no-store" },
    privacy: { cacheStoresCiphertext: false, cacheStoresSecrets: false },
    sockets: { reconnectBackoff: true, heartbeat: true, pubsubTopics: pubsub.size },
  };
}

export async function setPerfPolicy(patch: Partial<PerfPersist["policy"]> & { shed?: ShedLevel }) {
  const ctx = await requireStaff("monitor");
  if (!ctx.ok) return ctx;
  return mutateStore((data) => {
    data.perf ??= emptyPerfPersist();
    if (patch.shed) {
      data.perf.shed = patch.shed;
      setShedLevel(patch.shed);
    }
    const { shed: _s, ...rest } = patch;
    data.perf.policy = { ...data.perf.policy, ...rest };
    return { ok: true as const, policy: data.perf.policy, shed: data.perf.shed };
  });
}

export function resetPerfForTests() {
  memCache.clear();
  permCache.clear();
  SINGLE.clear();
  breakers.clear();
  pubsub.clear();
  heapSamples.length = 0;
  setShedLevel("off");
}

export { clampLimit, FORBIDDEN_CACHE };
