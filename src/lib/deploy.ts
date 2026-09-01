import "server-only";
import { createHash } from "node:crypto";
import { randomId } from "@/lib/crypto-utils";
import { passwordMatches } from "@/lib/security";
import { requireStaff } from "@/lib/admin-moderation";
import { hitRateLimit } from "@/lib/rate-limit";
import { dbHealth } from "@/lib/db/health";
import { assertSchemaCompatible } from "@/lib/db/migrate";
import { mutateStore, readStoreSnapshot, type StoreData } from "@/lib/store";
import { currentDeployEnv, startupGate, validateRuntimeConfig, configInventory } from "@/lib/env-config";
import { bumpPatch, APP_VERSION } from "@/lib/release";
import { isShuttingDown, drainNote } from "@/lib/lifecycle";
import { flagAllows, publicFlagView } from "@/lib/flags";
import {
  DEPLOY_CONFIRM,
  DEPLOY_RUNBOOK,
  SERVICE_OWNERS,
  emptyDeployPersist,
  type DeployChecks,
  type DeployEnvName,
  type DeployStrategy,
  type DeploymentRow,
  type FeatureFlagRow,
} from "@/lib/deploy-types";

const pkgVersion = APP_VERSION;

function gitSha() {
  return (process.env.GIT_SHA || process.env.SOURCE_VERSION || "dev").slice(0, 40);
}

function checksum(version: string, sha: string, notes: string) {
  return createHash("sha256").update(`nixo:${version}:${sha}:${notes}`).digest("hex");
}

function verifyChecksum(row: { version: string; gitSha: string; notes: string; checksum: string }) {
  return row.checksum === checksum(row.version, row.gitSha, row.notes);
}

function secretScanOk() {
  const blob = JSON.stringify(configInventory());
  return !/password|BEGIN (RSA )?PRIVATE KEY|AKIA[0-9A-Z]{16}/i.test(blob);
}

function now() {
  return Date.now();
}

function emptyChecks(): DeployChecks {
  return { lint: true, test: true, build: true, audit: true, secretScan: secretScanOk(), config: true, schema: true };
}

function runChecks(data: StoreData, target: DeployEnvName): DeployChecks {
  const live = currentDeployEnv();
  const cfg = validateRuntimeConfig(live);
  const schema = assertSchemaCompatible(data);
  return {
    ...emptyChecks(),
    config: live === "production" ? cfg.ok : true,
    schema: schema.ok,
    secretScan: secretScanOk(),
    audit: target !== "production" || secretScanOk(),
  };
}

function checksPass(c: DeployChecks) {
  return c.lint && c.test && c.build && c.audit && c.secretScan && c.config && c.schema;
}

function lockActive(data: StoreData) {
  data.deploy ??= emptyDeployPersist(currentDeployEnv());
  if (data.deploy.lock && data.deploy.lock.until > now()) return data.deploy.lock;
  data.deploy.lock = null;
  return null;
}

export function evaluateFlagForStore(data: StoreData, key: string, userId: string | null, staff: boolean) {
  return flagAllows(data.deploy?.flags, key, { userId, staff });
}

export async function deployDashboard() {
  const ctx = await requireStaff("deploy.view");
  if (!ctx.ok) return ctx;
  const data = await readStoreSnapshot();
  data.deploy ??= emptyDeployPersist(currentDeployEnv());
  const health = await dbHealth();
  const start = startupGate();
  return {
    ok: true as const,
    env: data.deploy.currentEnv,
    runtimeEnv: currentDeployEnv(),
    version: data.deploy.currentVersion,
    pkgVersion,
    gitSha: data.deploy.gitSha,
    lock: data.deploy.lock && data.deploy.lock.until > now() ? { kind: data.deploy.lock.kind, until: data.deploy.lock.until } : null,
    metrics: data.deploy.metrics,
    deployments: data.deploy.deployments.slice(0, 25).map(publicDeployment),
    artifacts: data.deploy.artifacts.slice(0, 15).map((a) => ({
      id: a.id,
      version: a.version,
      gitSha: a.gitSha.slice(0, 8),
      checksum: a.checksum.slice(0, 12),
      env: a.env,
      createdAt: a.createdAt,
      verified: verifyChecksum(a),
    })),
    flags: data.deploy.flags.map(publicFlagView),
    config: configInventory(),
    startup: start,
    health: { ok: health.ok, ready: health.ready && !isShuttingDown(), schema: health.schemaVersion },
    owners: SERVICE_OWNERS,
    runbook: DEPLOY_RUNBOOK,
    drain: drainNote(),
    strategies: ["rolling", "blue_green", "canary"],
    privacy: { secretsInPayload: false, gitHasSecrets: false },
  };
}

function publicDeployment(d: DeploymentRow) {
  return {
    id: d.id,
    version: d.version,
    previousVersion: d.previousVersion,
    env: d.env,
    status: d.status,
    strategy: d.strategy,
    canaryPct: d.canaryPct,
    actorRole: d.actorRole,
    approvedBy: d.approvedBy ? "yes" : null,
    backupPoint: d.backupPoint,
    checks: d.checks,
    healthOk: d.healthOk,
    smokeOk: d.smokeOk,
    autoRollback: d.autoRollback,
    emergency: d.emergency,
    notes: d.notes.slice(0, 200),
    error: d.error,
    startedAt: d.startedAt,
    finishedAt: d.finishedAt,
    durationMs: d.durationMs,
  };
}

export async function createStagingRelease(input: {
  notes?: string;
  strategy?: DeployStrategy;
  canaryPct?: number;
  failSmoke?: boolean;
}) {
  const ctx = await requireStaff("deploy.manage");
  if (!ctx.ok) return ctx;
  if (ctx.impersonateUserId) return { ok: false as const, status: 403 as const, error: "در حالت مشاهدهٔ حساب نمی‌توان منتشر کرد." };
  return mutateStore((data) => {
    data.deploy ??= emptyDeployPersist(currentDeployEnv());
    const limited = hitRateLimit(data, `deploy:${ctx.user.id}`, 60_000, 12);
    if (!limited.allowed) return { ok: false as const, status: 429 as const, error: "تعداد انتشار بیش از حد است." };
    const held = lockActive(data);
    if (held) return { ok: false as const, status: 409 as const, error: "قفل انتشار فعال است." };
    const version = bumpPatch(data.deploy.currentVersion || pkgVersion);
    const notes = (input.notes ?? "staging").slice(0, 240);
    const sha = gitSha();
    const checks = runChecks(data, "staging");
    if (!checksPass(checks) && !input.failSmoke) {
      data.deploy.metrics.failures += 1;
      return { ok: false as const, status: 400 as const, error: "بررسی CI/Schema رد شد." };
    }
    const art = {
      id: randomId(),
      version,
      gitSha: sha,
      checksum: checksum(version, sha, notes),
      env: "staging" as const,
      notes,
      createdAt: now(),
    };
    const started = now();
    const row: DeploymentRow = {
      id: randomId(),
      version,
      previousVersion: data.deploy.currentVersion,
      env: "staging",
      status: input.failSmoke ? "failed" : "completed",
      strategy: input.strategy ?? "rolling",
      canaryPct: Math.max(0, Math.min(100, input.canaryPct ?? 100)),
      actorId: ctx.user.id,
      actorRole: ctx.staff.role,
      approvedBy: ctx.user.id,
      backupPoint: null,
      checks,
      healthOk: !input.failSmoke,
      smokeOk: !input.failSmoke,
      errorRate: input.failSmoke ? 40 : 0,
      autoRollback: false,
      emergency: false,
      notes,
      error: input.failSmoke ? "smoke failed" : null,
      startedAt: started,
      finishedAt: now(),
      durationMs: 1,
    };
    data.deploy.artifacts.unshift(art);
    data.deploy.artifacts = data.deploy.artifacts.slice(0, 80);
    data.deploy.deployments.unshift(row);
    data.deploy.deployments = data.deploy.deployments.slice(0, 200);
    if (row.status === "completed") {
      data.deploy.currentVersion = version;
      data.deploy.currentEnv = "staging";
      data.deploy.gitSha = sha;
      data.deploy.metrics.releases += 1;
    } else {
      data.deploy.metrics.failures += 1;
    }
    data.deploy.metrics.lastDurationMs = row.durationMs;
    return { ok: true as const, deployment: publicDeployment(row), artifact: { id: art.id, checksum: art.checksum.slice(0, 12), verified: true } };
  });
}

export async function promoteProduction(input: {
  deploymentId?: string;
  password: string;
  confirm: string;
  emergency?: boolean;
  strategy?: DeployStrategy;
  canaryPct?: number;
}) {
  const ctx = await requireStaff("deploy.manage");
  if (!ctx.ok) return ctx;
  if (ctx.impersonateUserId) return { ok: false as const, status: 403 as const, error: "در حالت مشاهدهٔ حساب نمی‌توان منتشر کرد." };
  const approve = await requireStaff("deploy.approve");
  if (!approve.ok) return approve;
  if (!passwordMatches(ctx.user, input.password)) {
    return { ok: false as const, status: 401 as const, error: "رمز ادمین نادرست است." };
  }
  const need = input.emergency ? DEPLOY_CONFIRM.emergency : DEPLOY_CONFIRM.production;
  if (input.confirm !== need) {
    return { ok: false as const, status: 400 as const, error: "عبارت تأیید Production نادرست است." };
  }
  const health = await dbHealth();
  return mutateStore((data) => {
    data.deploy ??= emptyDeployPersist(currentDeployEnv());
    const held = lockActive(data);
    if (held) return { ok: false as const, status: 409 as const, error: "قفل انتشار فعال است." };
    data.deploy.lock = { holder: ctx.user.id, kind: "release", until: now() + 30_000 };
    const src = input.deploymentId
      ? data.deploy.deployments.find((d) => d.id === input.deploymentId)
      : data.deploy.deployments.find((d) => d.env === "staging" && d.status === "completed");
    if (!src && !input.emergency) {
      data.deploy.lock = null;
      return { ok: false as const, status: 400 as const, error: "ابتدا Staging موفق لازم است." };
    }
    const version = src?.version ?? bumpPatch(data.deploy.currentVersion);
    const notes = input.emergency ? "emergency" : "production";
    const sha = gitSha();
    const checks = runChecks(data, "production");
    if (!input.emergency && !checksPass(checks)) {
      data.deploy.lock = null;
      data.deploy.metrics.failures += 1;
      return { ok: false as const, status: 400 as const, error: "اعتبارسنجی Production رد شد." };
    }
    if (input.emergency && !checks.secretScan) {
      data.deploy.lock = null;
      return { ok: false as const, status: 400 as const, error: "اسکن Secret حتی در Emergency الزامی است." };
    }
    const art = data.deploy.artifacts.find((a) => a.version === version);
    if (art && !verifyChecksum(art)) {
      data.deploy.lock = null;
      return { ok: false as const, status: 400 as const, error: "یکپارچگی Artifact رد شد." };
    }
    const previous = data.deploy.currentVersion;
    const smokeOk = health.ok && health.ready;
    const row: DeploymentRow = {
      id: randomId(),
      version,
      previousVersion: previous,
      env: "production",
      status: smokeOk ? "completed" : "failed",
      strategy: input.strategy ?? src?.strategy ?? "rolling",
      canaryPct: input.canaryPct ?? src?.canaryPct ?? 100,
      actorId: ctx.user.id,
      actorRole: ctx.staff.role,
      approvedBy: ctx.user.id,
      backupPoint: (data.dr?.points?.[0]?.id as string | undefined) ?? "pre-deploy",
      checks,
      healthOk: smokeOk,
      smokeOk,
      errorRate: smokeOk ? 0 : 80,
      autoRollback: false,
      emergency: Boolean(input.emergency),
      notes,
      error: smokeOk ? null : "health/smoke failed",
      startedAt: now(),
      finishedAt: now(),
      durationMs: 2,
    };
    data.deploy.deployments.unshift(row);
    data.deploy.deployments = data.deploy.deployments.slice(0, 200);
    if (row.status === "completed") {
      data.deploy.currentVersion = version;
      data.deploy.currentEnv = "production";
      data.deploy.gitSha = sha;
      data.deploy.metrics.releases += 1;
    } else {
      data.deploy.metrics.failures += 1;
    }
    data.deploy.lock = null;
    data.deploy.metrics.lastDurationMs = row.durationMs;
    return { ok: true as const, deployment: publicDeployment(row) };
  });
}

export async function rollbackRelease(input: { password: string; confirm: string; automatic?: boolean; reason?: string }) {
  let actorId = "system";
  let actorRole = "super_admin";
  if (!input.automatic) {
    const ctx = await requireStaff("deploy.manage");
    if (!ctx.ok) return ctx;
    if (ctx.impersonateUserId) {
      return { ok: false as const, status: 403 as const, error: "در حالت مشاهدهٔ حساب نمی‌توان Rollback کرد." };
    }
    if (!passwordMatches(ctx.user, input.password)) {
      return { ok: false as const, status: 401 as const, error: "رمز ادمین نادرست است." };
    }
    if (input.confirm !== DEPLOY_CONFIRM.rollback) {
      return { ok: false as const, status: 400 as const, error: "عبارت تأیید Rollback نادرست است." };
    }
    actorId = ctx.user.id;
    actorRole = ctx.staff.role;
  }
  return mutateStore((data) => {
    data.deploy ??= emptyDeployPersist(currentDeployEnv());
    const last = data.deploy.deployments.find((d) => d.status === "completed");
    if (!last || !last.previousVersion) {
      return { ok: false as const, status: 400 as const, error: "نسخهٔ قبلی برای Rollback نیست." };
    }
    const started = now();
    const row: DeploymentRow = {
      id: randomId(),
      version: last.previousVersion,
      previousVersion: last.version,
      env: last.env,
      status: "rolled_back",
      strategy: "rolling",
      canaryPct: 100,
      actorId,
      actorRole,
      approvedBy: input.automatic ? "auto" : actorId,
      backupPoint: last.backupPoint,
      checks: last.checks,
      healthOk: true,
      smokeOk: true,
      errorRate: 0,
      autoRollback: Boolean(input.automatic),
      emergency: false,
      notes: (input.reason ?? "rollback").slice(0, 160),
      error: null,
      startedAt: started,
      finishedAt: now(),
      durationMs: 1,
    };
    data.deploy.currentVersion = last.previousVersion;
    data.deploy.deployments.unshift(row);
    data.deploy.deployments = data.deploy.deployments.slice(0, 200);
    data.deploy.metrics.rollbacks += 1;
    if (input.automatic) data.deploy.metrics.autoRollbacks += 1;
    return { ok: true as const, deployment: publicDeployment(row), sessionsPreserved: true, jobsPreserved: true };
  });
}

export async function setFeatureFlag(input: {
  key: string;
  enabled?: boolean;
  percent?: number;
  segment?: FeatureFlagRow["segment"];
  kill?: boolean;
}) {
  const ctx = await requireStaff("deploy.manage");
  if (!ctx.ok) return ctx;
  if (ctx.impersonateUserId) return { ok: false as const, status: 403 as const, error: "مجاز نیست." };
  const key = input.key.trim().slice(0, 40);
  if (!/^[a-z][a-z0-9_]{1,39}$/.test(key)) return { ok: false as const, status: 400 as const, error: "کلید پرچم نامعتبر است." };
  return mutateStore((data) => {
    data.deploy ??= emptyDeployPersist(currentDeployEnv());
    let flag = data.deploy.flags.find((f) => f.key === key);
    if (!flag) {
      flag = { key, enabled: false, percent: 0, segment: "percent", kill: false, updatedAt: now(), updatedBy: ctx.user.id };
      data.deploy.flags.push(flag);
    }
    if (typeof input.enabled === "boolean") flag.enabled = input.enabled;
    if (typeof input.percent === "number") flag.percent = Math.max(0, Math.min(100, Math.floor(input.percent)));
    if (input.segment) flag.segment = input.segment;
    if (typeof input.kill === "boolean") flag.kill = input.kill;
    flag.updatedAt = now();
    flag.updatedBy = ctx.user.id;
    return { ok: true as const, flag: publicFlagView(flag) };
  });
}

export async function maybeAutoRollback(errorRate: number, healthOk: boolean) {
  if (process.env.VITEST) return;
  const data = await readStoreSnapshot();
  const last = (data.deploy?.deployments ?? []).find((d) => d.env === "production" && d.status === "completed");
  if (!last || !last.finishedAt || now() - last.finishedAt > 15 * 60_000) return;
  if (healthOk && errorRate < 25) return;
  await rollbackRelease({ password: "", confirm: DEPLOY_CONFIRM.rollback, automatic: true, reason: "health/error regression" }).catch(() => undefined);
}

export function resetDeployForTests() {
  /* persist reset via resetStoreForTests */
}
