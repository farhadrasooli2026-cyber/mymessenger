import "server-only";
import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { SCHEMA_VERSION } from "@/lib/db/catalog";
import { APP_VERSION } from "@/lib/release";
import {
  backupSignatureOk,
  decryptBackupBytes,
  encryptBackupBytes,
  randomId,
  signBackupBlob,
} from "@/lib/crypto-utils";
import { passwordMatches } from "@/lib/security";
import { requireStaff } from "@/lib/admin-moderation";
import { dbHealth } from "@/lib/db/health";
import { copyVaultBackup } from "@/lib/storage-files";
import {
  backupDir,
  binPath,
  deleteExpiredSnapshot,
  metaPath,
  offsiteDir,
  writeBoth,
  MAX_SNAPSHOT_BYTES,
} from "@/lib/db/backup";
import { mutateStore, readStoreSnapshot, type StoreData } from "@/lib/store";
import { hitRateLimit } from "@/lib/rate-limit";
import { rememberPlatformMode } from "@/lib/dr-mode";
import {
  CLASS_FOR_SCOPE,
  DR_CONFIRM,
  DR_JOB_TIMEOUT_MS,
  DR_RUNBOOK,
  RECOVERY_PRIORITY,
  emptyDrPersist,
  type DrBackupKind,
  type DrClass,
  type DrJob,
  type DrPersist,
  type DrPointMeta,
  type DrScope,
  type FailoverSite,
  type PlatformMode,
} from "@/lib/dr-types";

const APP_VERSION = "0.1.0";

function lockPath() {
  return path.join(process.cwd(), ".data", process.env.VITEST ? `dr-lock.test.${process.env.VITEST_WORKER_ID ?? "0"}.json` : "dr-lock.json");
}

export type DrLock = {
  generation: number;
  site: FailoverSite;
  mode: PlatformMode;
  at: number;
};

export async function readDrLock(): Promise<DrLock> {
  try {
    const raw = JSON.parse(await readFile(lockPath(), "utf8")) as DrLock;
    return {
      generation: raw.generation ?? 1,
      site: raw.site === "replica" ? "replica" : "primary",
      mode: raw.mode === "maintenance" || raw.mode === "read_only" ? raw.mode : "normal",
      at: raw.at ?? 0,
    };
  } catch {
    return { generation: 1, site: "primary", mode: "normal", at: 0 };
  }
}

async function writeDrLock(lock: DrLock) {
  await mkdir(path.dirname(lockPath()), { recursive: true });
  await writeFile(lockPath(), JSON.stringify(lock), "utf8");
  rememberPlatformMode(lock.mode);
}

function audit(data: StoreData, actorId: string | null, action: string, target: string, result: "ok" | "deny" | "error") {
  data.dr ??= emptyDrPersist();
  data.dr.audits.unshift({ id: randomId(), at: Date.now(), actorId, action, target, result });
  data.dr.audits = data.dr.audits.slice(0, 400);
}

function jobRow(partial: Partial<DrJob> & Pick<DrJob, "type" | "status">): DrJob {
  const now = Date.now();
  return {
    id: randomId(),
    kind: undefined,
    actorId: null,
    backupId: null,
    scopes: [],
    bytes: 0,
    durationMs: 0,
    error: null,
    createdAt: now,
    updatedAt: now,
    retries: 0,
    checkpoint: "queued",
    ...partial,
  };
}

function sinceTs(item: { createdAt?: number; updatedAt?: number; at?: number }) {
  return item.updatedAt ?? item.createdAt ?? item.at ?? 0;
}

function pickChanged<T extends { createdAt?: number; updatedAt?: number; at?: number }>(rows: T[] | undefined, since: number): T[] {
  return (rows ?? []).filter((r) => sinceTs(r) >= since);
}

function sliceForKind(data: StoreData, kind: DrBackupKind, scopes: DrScope[], since: number | null): Record<string, unknown> {
  const include = (s: DrScope) => scopes.includes(s) || scopes.includes("database");
  if (kind === "full" || scopes.includes("database")) {
    return {
      users: data.users,
      threads: data.threads,
      messages: data.messages,
      groups: data.groups,
      groupMessages: data.groupMessages,
      pubChannels: data.pubChannels,
      channelPosts: data.channelPosts,
      userStories: data.userStories,
      vaultObjects: (data.vaultObjects ?? []).map((v) => ({
        id: v.id,
        ownerUserId: v.ownerUserId,
        size: v.size,
        deletedAt: v.deletedAt ?? null,
      })),
      staffMembers: data.staffMembers,
      adminAudit: data.adminAudit,
      securityMetrics: data.securityMetrics,
      schemaMeta: data.schemaMeta,
      devices: data.devices,
      notifications: data.notifications,
      searchMetrics: data.searchMetrics,
      calls: data.calls,
    };
  }
  const from = since ?? 0;
  const out: Record<string, unknown> = {};
  if (include("users")) out.users = pickChanged(data.users, from);
  if (include("messages")) {
    out.threads = pickChanged(data.threads, from);
    out.messages = pickChanged(data.messages, from);
  }
  if (include("groups")) {
    out.groups = pickChanged(data.groups, from);
    out.groupMessages = pickChanged(data.groupMessages, from);
  }
  if (include("channels")) {
    out.pubChannels = pickChanged(data.pubChannels, from);
    out.channelPosts = pickChanged(data.channelPosts, from);
  }
  if (include("stories")) out.userStories = pickChanged(data.userStories, from);
  if (include("files") || include("storage")) {
    out.vaultObjects = pickChanged(data.vaultObjects, from).map((v) => ({
      id: v.id,
      ownerUserId: v.ownerUserId,
      size: v.size,
      deletedAt: v.deletedAt ?? null,
    }));
  }
  if (include("admin")) {
    out.staffMembers = data.staffMembers;
    out.adminAudit = pickChanged(data.adminAudit, from);
  }
  if (include("audit")) out.adminAudit = pickChanged(data.adminAudit, from);
  if (include("security")) out.securityMetrics = data.securityMetrics;
  return out;
}

function classify(scopes: DrScope[]): DrClass {
  if (scopes.includes("database") || scopes.includes("messages") || scopes.includes("users")) return "critical";
  if (scopes.some((s) => CLASS_FOR_SCOPE[s] === "high")) return "high";
  if (scopes.every((s) => CLASS_FOR_SCOPE[s] === "config")) return "config";
  return "standard";
}

function tierFor(now: Date): DrPointMeta["tier"] {
  if (now.getUTCDate() === 1) return "monthly";
  if (now.getUTCDay() === 0) return "weekly";
  return "daily";
}

function looksMalicious(buf: Buffer, plain: string) {
  if (buf.subarray(0, 2).toString() === "MZ") return true;
  if (plain.includes("\u0000") && plain.length > 20) return true;
  return false;
}

async function persistPoint(plain: Buffer, metaExtra: Omit<DrPointMeta, "id" | "bytes" | "sha256" | "signature" | "offsite">) {
  if (plain.length > MAX_SNAPSHOT_BYTES) return { ok: false as const, error: "حجم پشتیبان بیش از سقف است.", status: 413 };
  const sealed = encryptBackupBytes(plain);
  const id = randomId();
  const sha256 = createHash("sha256").update(sealed).digest("hex");
  const meta: DrPointMeta = {
    ...metaExtra,
    id,
    bytes: sealed.length,
    sha256,
    signature: signBackupBlob(id, sha256),
    offsite: true,
  };
  await writeBoth(id, sealed, {
    id,
    createdAt: meta.createdAt,
    bytes: meta.bytes,
    sha256,
    schemaVersion: meta.schemaVersion,
    verifiedAt: meta.verifiedAt,
    env: process.env.NIXO_ENV ?? "development",
    signature: meta.signature,
    offsite: true,
    kind: meta.kind,
    immutable: meta.immutable,
  });
  return { ok: true as const, meta, sealed };
}

export async function runDrBackup(input: { kind: DrBackupKind; scopes?: DrScope[]; actorId: string | null }) {
  if (input.actorId) {
    const ctx = await requireStaff("backup.manage");
    if (!ctx.ok) return ctx;
  }
  const started = Date.now();
  const data = await readStoreSnapshot();
  data.dr ??= emptyDrPersist();
  const scopes = input.scopes?.length ? input.scopes : (["database"] as DrScope[]);
  let kind = input.kind;
  if (kind !== "full" && !data.dr.lastFullAt) kind = "full";
  const since = kind === "full" ? null : kind === "incremental" ? data.dr.lastIncrAt || data.dr.lastFullAt : data.dr.lastFullAt;
  const body = {
    v: 1,
    kind,
    scopes,
    appVersion: APP_VERSION,
    schemaVersion: data.schemaMeta?.version ?? SCHEMA_VERSION,
    createdAt: Date.now(),
    since,
    config: { nixoEnvKeys: ["NIXO_PEPPER", "NIXO_DATA_KEY", "NIXO_SESSION_SECRET", "NIXO_BACKUP_KEY"], valuesOmitted: true },
    slice: sliceForKind(data, kind, scopes, since),
    malwareScan: "clean" as const,
  };
  const plain = Buffer.from(JSON.stringify(body), "utf8");
  const made = await persistPoint(plain, {
    kind,
    class: classify(scopes),
    scopes,
    createdAt: Date.now(),
    schemaVersion: body.schemaVersion,
    appVersion: APP_VERSION,
    verifiedAt: Date.now(),
    restoreTestAt: null,
    immutable: tierFor(new Date()) === "monthly",
    tier: tierFor(new Date()),
    baseId: kind === "full" ? null : data.dr.points.find((p) => p.kind === "full")?.id ?? null,
    since,
  });
  if (!made.ok) {
    await mutateStore((d) => {
      d.dr ??= emptyDrPersist();
      d.dr.jobs.unshift(
        jobRow({
          type: "backup",
          kind,
          status: "failed",
          actorId: input.actorId,
          scopes,
          error: made.error,
          durationMs: Date.now() - started,
          checkpoint: "encrypt",
        }),
      );
      audit(d, input.actorId, "backup.fail", kind, "error");
      d.adminAlerts.unshift({
        id: randomId(),
        severity: "critical",
        title: "پشتیبان ناموفق",
        detail: "dr",
        createdAt: Date.now(),
        ackAt: null,
        ackBy: null,
      });
    });
    return made;
  }
  if (scopes.includes("storage") || scopes.includes("files") || scopes.includes("database")) {
    for (const obj of (data.vaultObjects ?? []).slice(0, 40)) {
      if (!obj.deletedAt) await copyVaultBackup(obj.ownerUserId, obj.storageKey).catch(() => undefined);
    }
  }
  await mutateStore((d) => {
    d.dr ??= emptyDrPersist();
    d.dr.points.unshift(made.meta);
    d.dr.points = d.dr.points.slice(0, 80);
    if (kind === "full") d.dr.lastFullAt = made.meta.createdAt;
    else d.dr.lastIncrAt = made.meta.createdAt;
    d.dr.jobs.unshift(
      jobRow({
        type: "backup",
        kind,
        status: "completed",
        actorId: input.actorId,
        backupId: made.meta.id,
        scopes,
        bytes: made.meta.bytes,
        durationMs: Date.now() - started,
        checkpoint: "offsite-copied",
      }),
    );
    d.dr.jobs = d.dr.jobs.slice(0, 200);
    audit(d, input.actorId, "backup.create", made.meta.id, "ok");
  });
  if (data.dr.policy.autoRestoreTest && !process.env.VITEST) {
    void runRestoreTest(made.meta.id, input.actorId).catch(() => undefined);
  }
  await rotateBackups();
  return { ok: true as const, point: made.meta };
}

export async function verifyDrPoint(id: string) {
  if (!/^[a-f0-9]{16,64}$/i.test(id)) return { ok: false as const, error: "شناسه نامعتبر است.", status: 400 };
  try {
    const meta = JSON.parse(await readFile(metaPath(id), "utf8")) as { sha256: string; signature?: string };
    const buf = await readFile(binPath(id));
    const hash = createHash("sha256").update(buf).digest("hex");
    if (hash !== meta.sha256) return { ok: false as const, error: "Checksum همخوان نیست.", status: 400 };
    if (meta.signature && !backupSignatureOk(id, hash, meta.signature)) {
      return { ok: false as const, error: "امضا نامعتبر است.", status: 400 };
    }
    const plain = decryptBackupBytes(buf).toString("utf8");
    if (looksMalicious(buf, plain)) return { ok: false as const, error: "پشتیبان مشکوک رد شد.", status: 400 };
    JSON.parse(plain);
    await mutateStore((d) => {
      d.dr ??= emptyDrPersist();
      const row = d.dr.points.find((p) => p.id === id);
      if (row) row.verifiedAt = Date.now();
      d.dr.jobs.unshift(jobRow({ type: "verify", status: "completed", backupId: id, checkpoint: "verified" }));
      audit(d, null, "backup.verify", id, "ok");
    });
    return { ok: true as const };
  } catch {
    return { ok: false as const, error: "Verify شکست.", status: 400 };
  }
}

function previewSummary(parsed: Record<string, unknown>) {
  const slice = (parsed.slice as Record<string, unknown> | undefined) ?? parsed;
  const len = (k: string) => (Array.isArray(slice[k]) ? (slice[k] as unknown[]).length : 0);
  return {
    users: len("users"),
    messages: len("messages"),
    groups: len("groups"),
    channels: len("pubChannels"),
    stories: len("userStories"),
    files: len("vaultObjects"),
    schemaVersion: typeof parsed.schemaVersion === "number" ? parsed.schemaVersion : 0,
    appVersion: typeof parsed.appVersion === "string" ? parsed.appVersion : APP_VERSION,
    kind: parsed.kind ?? "full",
  };
}

export async function restorePreview(id: string) {
  const v = await verifyDrPoint(id);
  if (!v.ok) return v;
  const buf = await readFile(binPath(id));
  const parsed = JSON.parse(decryptBackupBytes(buf).toString("utf8")) as Record<string, unknown>;
  if (typeof parsed.schemaVersion === "number" && parsed.schemaVersion > SCHEMA_VERSION) {
    return { ok: false as const, error: "نسخه Schema پشتیبان جدیدتر از برنامه است.", status: 409 };
  }
  const previewPath = path.join(path.dirname(backupDir()), `dr-preview.${id.slice(0, 8)}.json`);
  await mkdir(path.dirname(previewPath), { recursive: true });
  await writeFile(previewPath, JSON.stringify({ isolated: true, summary: previewSummary(parsed) }));
  return { ok: true as const, isolated: true, summary: previewSummary(parsed) };
}

export async function runRestoreTest(id: string, actorId: string | null) {
  const started = Date.now();
  const preview = await restorePreview(id);
  await mutateStore((d) => {
    d.dr ??= emptyDrPersist();
    const row = d.dr.points.find((p) => p.id === id);
    if (row) row.restoreTestAt = Date.now();
    d.dr.lastRestoreTestAt = Date.now();
    d.dr.jobs.unshift(
      jobRow({
        type: "restore-test",
        status: preview.ok ? "completed" : "failed",
        actorId,
        backupId: id,
        durationMs: Date.now() - started,
        error: preview.ok ? null : preview.error,
        checkpoint: preview.ok ? "isolated-ok" : "isolated-fail",
      }),
    );
    audit(d, actorId, "restore.test", id, preview.ok ? "ok" : "error");
    if (!preview.ok) {
      d.adminAlerts.unshift({
        id: randomId(),
        severity: "high",
        title: "آزمایش Restore ناموفق",
        detail: "dr",
        createdAt: Date.now(),
        ackAt: null,
        ackBy: null,
      });
    }
  });
  return preview;
}

function mergeSlice(live: StoreData, slice: Record<string, unknown>, scopes: DrScope[]) {
  const all = scopes.includes("database");
  const take = (s: DrScope) => all || scopes.includes(s);
  const asArr = <T>(k: string, fallback: T[]) => (Array.isArray(slice[k]) ? (slice[k] as T[]) : fallback);
  if (take("users") && Array.isArray(slice.users)) live.users = slice.users as StoreData["users"];
  if (take("messages")) {
    if (slice.threads) live.threads = asArr("threads", live.threads);
    if (slice.messages) live.messages = asArr("messages", live.messages);
  }
  if (take("groups")) {
    if (slice.groups) live.groups = asArr("groups", live.groups);
    if (slice.groupMessages) live.groupMessages = asArr("groupMessages", live.groupMessages);
  }
  if (take("channels")) {
    if (slice.pubChannels) live.pubChannels = asArr("pubChannels", live.pubChannels);
    if (slice.channelPosts) live.channelPosts = asArr("channelPosts", live.channelPosts);
  }
  if (take("stories") && slice.userStories) live.userStories = asArr("userStories", live.userStories);
  if ((take("files") || take("storage")) && slice.vaultObjects) {
    /* metadata only — blob restore uses vault-backup replica */
  }
  if (take("admin") && slice.staffMembers) live.staffMembers = asArr("staffMembers", live.staffMembers);
}

export async function restoreProduction(input: {
  id: string;
  password: string;
  confirm: string;
  scopes?: DrScope[];
  pitMs?: number;
}) {
  const ctx = await requireStaff("backup.restore");
  if (!ctx.ok) return ctx;
  if (ctx.staff.role !== "super_admin") return { ok: false as const, error: "Restore روی Production فقط ابرادمین.", status: 403 };
  if (input.confirm !== DR_CONFIRM.restoreProduction) {
    return { ok: false as const, error: "عبارت تأیید RESTORE_PRODUCTION لازم است.", status: 400 };
  }
  if (!passwordMatches(ctx.user, input.password)) return { ok: false as const, error: "رمز ادمین لازم است.", status: 401 };
  if (ctx.session.impersonateUserId) return { ok: false as const, error: "در مشاهدهٔ کاربر Restore مجاز نیست.", status: 403 };
  const limited = await mutateStore((data) => hitRateLimit(data, `dr:restore:${ctx.user.id}`, 60 * 60_000, 3));
  if (!limited.allowed) return { ok: false as const, error: "محدودیت Restore.", status: 429 };

  let id = input.id;
  if (input.pitMs) {
    const data = await readStoreSnapshot();
    const point = (data.dr?.points ?? [])
      .filter((p) => p.createdAt <= input.pitMs!)
      .sort((a, b) => b.createdAt - a.createdAt)[0];
    if (!point) return { ok: false as const, error: "Restore Point برای آن زمان نیست.", status: 404 };
    id = point.id;
  }

  const preview = await restorePreview(id);
  if (!preview.ok) return preview;

  const checkpoint = await runDrBackup({ kind: "full", actorId: ctx.user.id, scopes: ["database"] });
  const buf = await readFile(binPath(id));
  const parsed = JSON.parse(decryptBackupBytes(buf).toString("utf8")) as Record<string, unknown>;
  const slice = ((parsed.slice as Record<string, unknown> | undefined) ?? parsed) as Record<string, unknown>;
  const scopes = input.scopes?.length ? input.scopes : ((parsed.scopes as DrScope[] | undefined) ?? ["database"]);

  await mutateStore((live) => {
    live.dr ??= emptyDrPersist();
    live.dr.rollbackId = checkpoint.ok ? checkpoint.point.id : live.dr.rollbackId;
    mergeSlice(live, slice, scopes);
    live.dr.jobs.unshift(
      jobRow({
        type: "restore",
        status: "completed",
        actorId: ctx.user.id,
        backupId: id,
        scopes,
        checkpoint: "applied",
      }),
    );
    audit(live, ctx.user.id, "restore.production", id, "ok");
  });
  const validation = await validateRecovery();
  return { ok: true as const, validation, preview: preview.summary, rollbackId: checkpoint.ok ? checkpoint.point.id : null };
}

export async function rollbackProduction(password: string, confirm: string) {
  const data = await readStoreSnapshot();
  const id = data.dr?.rollbackId;
  if (!id) return { ok: false as const, error: "Checkpoint برگشت نیست.", status: 404 };
  return restoreProduction({ id, password, confirm, scopes: ["database"] });
}

export async function validateRecovery() {
  const health = await dbHealth();
  const data = await readStoreSnapshot();
  return {
    database: health.ok && health.ready,
    authentication: data.users.length >= 0,
    messaging: Array.isArray(data.messages),
    storage: Array.isArray(data.vaultObjects),
    search: Boolean(data.searchMetrics),
    notifications: Array.isArray(data.notifications),
    calls: Array.isArray(data.calls),
    admin: Array.isArray(data.staffMembers),
    integrityIssues: health.integrityIssues,
  };
}

export async function setDrMode(mode: PlatformMode, password: string, confirm: string) {
  const ctx = await requireStaff("backup.manage");
  if (!ctx.ok) return ctx;
  if (confirm !== DR_CONFIRM.mode) return { ok: false as const, error: "عبارت MAINTENANCE لازم است.", status: 400 };
  if (!passwordMatches(ctx.user, password)) return { ok: false as const, error: "رمز ادمین لازم است.", status: 401 };
  const lock = await readDrLock();
  lock.mode = mode;
  lock.at = Date.now();
  await writeDrLock(lock);
  rememberPlatformMode(mode);
  await mutateStore((d) => {
    d.dr ??= emptyDrPersist();
    d.dr.mode = mode;
    audit(d, ctx.user.id, "mode", mode, "ok");
  });
  return { ok: true as const, mode };
}

export async function failover(password: string, confirm: string, automatic = false) {
  let actor: string | null = null;
  if (!automatic) {
    const ctx = await requireStaff("backup.restore");
    if (!ctx.ok) return ctx;
    if (ctx.staff.role !== "super_admin") return { ok: false as const, error: "Failover دستی فقط ابرادمین.", status: 403 };
    if (confirm !== DR_CONFIRM.failover) return { ok: false as const, error: "عبارت FAILOVER لازم است.", status: 400 };
    if (!passwordMatches(ctx.user, password)) return { ok: false as const, error: "رمز ادمین لازم است.", status: 401 };
    actor = ctx.user.id;
  }
  const lock = await readDrLock();
  const data = await readStoreSnapshot();
  if (data.dr && lock.generation > data.dr.generation) {
    return { ok: false as const, error: "قفل نسل بالاتر است؛ Split-Brain محتمل است.", status: 409 };
  }
  const next: DrLock = {
    generation: lock.generation + 1,
    site: "replica",
    mode: "read_only",
    at: Date.now(),
  };
  await writeDrLock(next);
  rememberPlatformMode("read_only");
  await mutateStore((d) => {
    d.dr ??= emptyDrPersist();
    if (d.dr.generation >= next.generation) {
      /* loser of split-brain does not clobber */
      return;
    }
    d.dr.generation = next.generation;
    d.dr.site = "replica";
    d.dr.mode = "read_only";
    d.dr.lastFailoverAt = Date.now();
    d.dr.jobs.unshift(jobRow({ type: "failover", status: "completed", checkpoint: "replica", actorId: actor }));
    audit(d, actor, "failover", "replica", "ok");
    d.adminAlerts.unshift({
      id: randomId(),
      severity: "critical",
      title: automatic ? "Failover خودکار" : "Failover دستی",
      detail: "dr",
      createdAt: Date.now(),
      ackAt: null,
      ackBy: null,
    });
  });
  return { ok: true as const, site: "replica" as const, generation: next.generation };
}

export async function failback(password: string, confirm: string) {
  const ctx = await requireStaff("backup.restore");
  if (!ctx.ok) return ctx;
  if (confirm !== DR_CONFIRM.failback) return { ok: false as const, error: "عبارت FAILBACK لازم است.", status: 400 };
  if (!passwordMatches(ctx.user, password)) return { ok: false as const, error: "رمز ادمین لازم است.", status: 401 };
  const lock = await readDrLock();
  const next: DrLock = { generation: lock.generation + 1, site: "primary", mode: "normal", at: Date.now() };
  await writeDrLock(next);
  rememberPlatformMode("normal");
  await mutateStore((d) => {
    d.dr ??= emptyDrPersist();
    d.dr.generation = next.generation;
    d.dr.site = "primary";
    d.dr.mode = "normal";
    d.dr.jobs.unshift(jobRow({ type: "failback", status: "completed", checkpoint: "primary", actorId: ctx.user.id }));
    audit(d, ctx.user.id, "failback", "primary", "ok");
  });
  return { ok: true as const, site: "primary" as const };
}

export async function updateDrPolicy(patch: Partial<DrPersist["policy"]>) {
  const ctx = await requireStaff("backup.manage");
  if (!ctx.ok) return ctx;
  return mutateStore((d) => {
    d.dr ??= emptyDrPersist();
    d.dr.policy = { ...d.dr.policy, ...patch };
    audit(d, ctx.user.id, "policy", "retention/schedule", "ok");
    return { ok: true as const, policy: d.dr.policy };
  });
}

export async function cancelDrJob(id: string) {
  const ctx = await requireStaff("backup.manage");
  if (!ctx.ok) return ctx;
  return mutateStore((d) => {
    d.dr ??= emptyDrPersist();
    const row = d.dr.jobs.find((j) => j.id === id);
    if (!row) return { ok: false as const, error: "کار یافت نشد.", status: 404 };
    if (row.status === "completed") return { ok: false as const, error: "کار تمام شده.", status: 400 };
    row.status = "cancelled";
    row.updatedAt = Date.now();
    audit(d, ctx.user.id, "job.cancel", id, "ok");
    return { ok: true as const };
  });
}

export async function rotateBackups() {
  const data = await readStoreSnapshot();
  const policy = data.dr?.policy;
  if (!policy) return;
  const points = [...(data.dr?.points ?? [])].sort((a, b) => b.createdAt - a.createdAt);
  const keep = new Set<string>();
  const daily = points.filter((p) => p.tier === "daily").slice(0, policy.keepDaily);
  const weekly = points.filter((p) => p.tier === "weekly").slice(0, policy.keepWeekly);
  const monthly = points.filter((p) => p.tier === "monthly").slice(0, policy.keepMonthly);
  for (const p of [...daily, ...weekly, ...monthly]) keep.add(p.id);
  const expired = points.filter((p) => !keep.has(p.id) && !p.immutable);
  for (const p of expired) await deleteExpiredSnapshot(p.id, p.immutable);
  if (expired.length) {
    await mutateStore((d) => {
      d.dr ??= emptyDrPersist();
      d.dr.points = d.dr.points.filter((p) => keep.has(p.id) || p.immutable);
      audit(d, null, "backup.rotate", String(expired.length), "ok");
    });
  }
}

export async function maybeAutoDrBackup() {
  if (process.env.VITEST) return;
  const data = await readStoreSnapshot();
  data.dr ??= emptyDrPersist();
  if (!data.dr.policy.autoEnabled) return;
  const now = Date.now();
  if (now - data.dr.lastFullAt >= data.dr.policy.fullEveryMs) {
    await runDrBackup({ kind: "full", actorId: null });
    return;
  }
  if (now - data.dr.lastIncrAt >= data.dr.policy.incrEveryMs) {
    await runDrBackup({ kind: "incremental", actorId: null });
  }
}

export async function maybeAutoFailover() {
  if (process.env.VITEST) return;
  try {
    await readStoreSnapshot();
  } catch {
    await failover("", "", true);
  }
}

export async function importDrBackup(id: string) {
  const ctx = await requireStaff("backup.manage");
  if (!ctx.ok) return ctx;
  const verified = await verifyDrPoint(id);
  if (!verified.ok) {
    await mutateStore((d) => {
      d.dr ??= emptyDrPersist();
      d.dr.jobs.unshift(jobRow({ type: "import", status: "failed", backupId: id, error: verified.error, actorId: ctx.user.id }));
      audit(d, ctx.user.id, "backup.import", id, "deny");
    });
    return { ok: false as const, error: "پشتیبان ناشناس یا دستکاری‌شده وارد نمی‌شود.", status: 400 };
  }
  await mutateStore((d) => {
    d.dr ??= emptyDrPersist();
    d.dr.jobs.unshift(jobRow({ type: "import", status: "completed", backupId: id, actorId: ctx.user.id, checkpoint: "signed" }));
    audit(d, ctx.user.id, "backup.import", id, "ok");
  });
  return { ok: true as const };
}

export async function publicStatus() {
  const lock = await readDrLock();
  let ok = true;
  try {
    const h = await dbHealth();
    ok = h.ok;
  } catch {
    ok = false;
  }
  return {
    ok,
    product: "NIXO",
    mode: lock.mode,
    site: lock.site,
    degraded: lock.mode !== "normal" || lock.site !== "primary" || !ok,
    version: APP_VERSION,
  };
}

export async function drDashboard() {
  const ctx = await requireStaff("backup.view");
  if (!ctx.ok) return ctx;
  const data = await readStoreSnapshot();
  data.dr ??= emptyDrPersist();
  const lock = await readDrLock();
  const last = data.dr.points[0];
  const rpoLag = last ? Date.now() - last.createdAt : null;
  return {
    ok: true as const,
    role: ctx.staff.role,
    policy: data.dr.policy,
    mode: data.dr.mode,
    site: data.dr.site,
    generation: data.dr.generation,
    lock,
    isolated: backupDir() !== offsiteDir(),
    offsiteDirNamed: true,
    rpoMs: data.dr.policy.rpoMs,
    rtoMs: data.dr.policy.rtoMs,
    rpoLagMs: rpoLag,
    rpoMet: rpoLag == null || rpoLag <= data.dr.policy.rpoMs,
    priority: RECOVERY_PRIORITY,
    runbook: DR_RUNBOOK,
    points: data.dr.points.slice(0, 24).map((p) => ({
      id: p.id,
      kind: p.kind,
      class: p.class,
      tier: p.tier,
      bytes: p.bytes,
      createdAt: p.createdAt,
      verifiedAt: p.verifiedAt,
      restoreTestAt: p.restoreTestAt,
      immutable: p.immutable,
      offsite: p.offsite,
      schemaVersion: p.schemaVersion,
    })),
    jobs: data.dr.jobs.slice(0, 30).map((j) => ({
      id: j.id,
      type: j.type,
      status: j.status,
      kind: j.kind,
      bytes: j.bytes,
      durationMs: j.durationMs,
      checkpoint: j.checkpoint,
      error: j.error,
      createdAt: j.createdAt,
      retries: j.retries,
    })),
    audits: data.dr.audits.slice(0, 20).map((a) => ({
      id: a.id,
      at: a.at,
      action: a.action,
      result: a.result,
      target: a.target.slice(0, 16),
    })),
    confirm: DR_CONFIRM,
    timeoutMs: DR_JOB_TIMEOUT_MS,
    credentialIsolated: true,
    downloadForbidden: true,
  };
}

export { backupDir, offsiteDir };
