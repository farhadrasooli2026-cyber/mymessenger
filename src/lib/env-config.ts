import "server-only";
import { APP_VERSION } from "@/lib/release";
import { DEPLOY_ENVS, type DeployEnvName } from "@/lib/deploy-types";

const DEV_PEPPER = "nixo-dev-pepper-not-for-production-use";
const DEV_SESSION = "nixo-dev-session-secret-not-for-production";

export function currentDeployEnv(): DeployEnvName {
  const v = (process.env.NIXO_ENV || "").toLowerCase();
  if (v === "testing" || v === "test") return "testing";
  if (v === "staging") return "staging";
  if (v === "production") return "production";
  if (process.env.VITEST) return "testing";
  if (process.env.NODE_ENV === "production") return "production";
  return "development";
}

export function envVarNames(): readonly string[] {
  return [
    "NIXO_PEPPER",
    "NIXO_DATA_KEY",
    "NIXO_SESSION_SECRET",
    "NIXO_BACKUP_KEY",
    "NIXO_ADMIN_KEY",
    "NIXO_DEMO_INBOX",
    "NIXO_ENV",
    "NIXO_STUN_URL",
    "NIXO_TURN_URL",
    "NIXO_TURN_SECRET",
  ] as const;
}

export function configInventory() {
  return envVarNames().map((name) => ({
    name,
    set: Boolean(process.env[name] && String(process.env[name]).length > 0),
    usesDevFallback:
      (name === "NIXO_PEPPER" && (!process.env.NIXO_PEPPER || process.env.NIXO_PEPPER === DEV_PEPPER)) ||
      (name === "NIXO_SESSION_SECRET" && (!process.env.NIXO_SESSION_SECRET || process.env.NIXO_SESSION_SECRET === DEV_SESSION)),
  }));
}

export function validateRuntimeConfig(env: DeployEnvName = currentDeployEnv()): { ok: boolean; errors: string[]; warnings: string[] } {
  const errors: string[] = [];
  const warnings: string[] = [];
  if (!DEPLOY_ENVS.includes(env)) errors.push("unknown env");
  const pepper = process.env.NIXO_PEPPER || "";
  const session = process.env.NIXO_SESSION_SECRET || "";
  const demo = process.env.NIXO_DEMO_INBOX;
  if (env === "production") {
    if (!pepper || pepper === DEV_PEPPER || pepper.length < 16) errors.push("production pepper missing");
    if (!session || session === DEV_SESSION || session.length < 16) errors.push("production session secret missing");
    if (demo === "true") errors.push("demo inbox must be off in production");
    if (!process.env.NIXO_BACKUP_KEY) warnings.push("backup key unset");
    if (!process.env.NIXO_DATA_KEY || process.env.NIXO_DATA_KEY.replace(/0/g, "") === "") warnings.push("data key looks empty");
  } else if (env === "staging") {
    if (demo === "true") warnings.push("demo inbox on in staging");
  }
  return { ok: errors.length === 0, errors, warnings };
}

export function startupGate() {
  const env = currentDeployEnv();
  const cfg = validateRuntimeConfig(env);
  if (env === "production" && !cfg.ok) return { ok: false as const, env, version: APP_VERSION, errors: cfg.errors };
  return { ok: true as const, env, version: APP_VERSION, errors: cfg.errors, warnings: cfg.warnings };
}
