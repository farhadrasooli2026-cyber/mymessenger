import "server-only";
import { APP_VERSION } from "@/lib/release";
import { DEPLOY_ENVS, type DeployEnvName } from "@/lib/deploy-types";
import { emailConfigured, smsConfigured } from "@/lib/otp-env";

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

/** Production never exposes the in-memory demo inbox, even if the env flag is omitted. */
export function isDemoInboxEnabled(): boolean {
  if (process.env.VITEST) return true;
  if (currentDeployEnv() === "production") return false;
  if (process.env.NIXO_DEMO_INBOX === "false") return false;
  if (process.env.NIXO_DEMO_INBOX === "true") return true;
  return currentDeployEnv() === "development" || currentDeployEnv() === "testing";
}

function productionEmailOk() {
  return emailConfigured();
}

function productionSmsOk() {
  return smsConfigured();
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
    "NIXO_EMAIL_PROVIDER",
    "NIXO_EMAIL_FROM",
    "NIXO_EMAIL_API_KEY",
    "NIXO_SMTP_HOST",
    "NIXO_SMTP_PORT",
    "NIXO_SMTP_USER",
    "NIXO_SMTP_PASS",
    "NIXO_SMTP_SECURE",
    "NIXO_MAILGUN_DOMAIN",
    "NIXO_SMS_PROVIDER",
    "NIXO_SMS_FROM",
    "NIXO_SMS_API_KEY",
    "NIXO_SMS_API_SECRET",
    "NIXO_PUBLIC_HOST",
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
    if (!productionEmailOk()) errors.push("production email provider missing");
    if (!productionSmsOk()) errors.push("production sms provider missing");
    if (!process.env.NIXO_BACKUP_KEY) warnings.push("backup key unset");
    if (!process.env.NIXO_DATA_KEY || process.env.NIXO_DATA_KEY.replace(/0/g, "") === "") warnings.push("data key looks empty");
  } else if (env === "staging") {
    if (demo === "true") warnings.push("demo inbox on in staging");
    if (!productionEmailOk()) warnings.push("staging email provider unset");
    if (!productionSmsOk()) warnings.push("staging sms provider unset");
  }
  return { ok: errors.length === 0, errors, warnings };
}

export function startupGate() {
  const env = currentDeployEnv();
  const cfg = validateRuntimeConfig(env);
  if (env === "production" && !cfg.ok) return { ok: false as const, env, version: APP_VERSION, errors: cfg.errors };
  return { ok: true as const, env, version: APP_VERSION, errors: cfg.errors, warnings: cfg.warnings };
}
