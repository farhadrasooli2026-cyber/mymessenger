import "server-only";
import type { StoreData } from "@/lib/store";
import { SCHEMA_VERSION } from "@/lib/db/catalog";

export type SchemaMeta = {
  version: number;
  migratedAt: number;
  env: "test" | "development" | "production";
};

export function defaultSchemaMeta(): SchemaMeta {
  const env = process.env.VITEST ? "test" : process.env.NIXO_ENV === "production" || process.env.NODE_ENV === "production" ? "production" : "development";
  return { version: 0, migratedAt: 0, env };
}

export function hydrateSchemaMeta(raw: unknown): SchemaMeta {
  const base = defaultSchemaMeta();
  if (!raw || typeof raw !== "object") return base;
  const rec = raw as Record<string, unknown>;
  return {
    version: typeof rec.version === "number" ? rec.version : 0,
    migratedAt: typeof rec.migratedAt === "number" ? rec.migratedAt : 0,
    env: rec.env === "production" || rec.env === "test" || rec.env === "development" ? rec.env : base.env,
  };
}

type Migration = { to: number; name: string; up: (data: StoreData) => void };

const MIGRATIONS: Migration[] = [
  {
    to: 1,
    name: "schema-meta-and-jobs",
    up: (data) => {
      const env = defaultSchemaMeta().env;
      data.schemaMeta = { version: 1, migratedAt: Date.now(), env };
      data.dbJobs ??= [];
      data.dbAudit ??= [];
    },
  },
];

/** Additive, forward-only. Never drops user collections. */
export function applyMigrations(data: StoreData): { from: number; to: number; applied: string[] } {
  data.schemaMeta = hydrateSchemaMeta(data.schemaMeta);
  const applied: string[] = [];
  const from = data.schemaMeta.version;
  for (const step of MIGRATIONS) {
    if (data.schemaMeta.version >= step.to) continue;
    if (step.to > SCHEMA_VERSION) continue;
    step.up(data);
    data.schemaMeta.version = step.to;
    data.schemaMeta.migratedAt = Date.now();
    applied.push(step.name);
  }
  return { from, to: data.schemaMeta.version, applied };
}

export function assertSchemaCompatible(data: StoreData): { ok: boolean; error?: string } {
  const v = hydrateSchemaMeta(data.schemaMeta).version;
  if (v > SCHEMA_VERSION) {
    return { ok: false, error: "نسخهٔ Schema از این برنامه جلوتر است." };
  }
  return { ok: true };
}
