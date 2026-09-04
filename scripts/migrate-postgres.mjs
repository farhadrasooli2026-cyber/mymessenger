#!/usr/bin/env node
/**
 * Apply NIXO Postgres tables (nixo_store + nixo_schema_migrations).
 * Reads DATABASE_URL / NIXO_DATABASE_URL / POSTGRES_URL. Never logs the URL or password.
 * Skip (exit 0) when no URL is set. Exit 1 when a URL is set but Postgres is unreachable.
 */
import { createRequire } from "node:module";
import dns from "node:dns";

dns.setDefaultResultOrder("ipv4first");

const require = createRequire(import.meta.url);

function cleanEnvValue(raw) {
  let v = String(raw ?? "").trim();
  if (
    (v.startsWith('"') && v.endsWith('"') && v.length >= 2) ||
    (v.startsWith("'") && v.endsWith("'") && v.length >= 2)
  ) {
    v = v.slice(1, -1).trim();
  }
  return v.replace(/\r?\n/g, "").trim();
}

function databaseUrl() {
  for (const name of ["NIXO_DATABASE_URL", "DATABASE_URL", "POSTGRES_URL"]) {
    const v = cleanEnvValue(process.env[name] ?? "");
    if (v) return v;
  }
  return "";
}

function redact(err) {
  const msg = err instanceof Error ? err.message : "unknown";
  return msg.replace(/:\/\/[^@/\s]+@/g, "://[redacted]@").slice(0, 220);
}

function sslOption(url) {
  if (/localhost|127\.0\.0\.1/.test(url)) return false;
  return { rejectUnauthorized: false };
}

const SQL = `
CREATE TABLE IF NOT EXISTS nixo_schema_migrations (
  id TEXT PRIMARY KEY,
  applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS nixo_store (
  id TEXT PRIMARY KEY,
  payload JSONB NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

INSERT INTO nixo_schema_migrations (id)
VALUES ('001_nixo_store')
ON CONFLICT (id) DO NOTHING;
`;

const url = databaseUrl();
if (!url) {
  console.info(JSON.stringify({ service: "migrate", msg: "skip_no_database_url" }));
  process.exit(0);
}

const { Pool } = require("pg");
const pool = new Pool({
  connectionString: url,
  max: 1,
  connectionTimeoutMillis: 20_000,
  ssl: sslOption(url),
});

try {
  await pool.query(SQL);
  await pool.query("SELECT 1");
  console.info(JSON.stringify({ service: "migrate", msg: "ok", applied: "001_nixo_store" }));
  await pool.end();
  process.exit(0);
} catch (err) {
  console.error(JSON.stringify({ service: "migrate", msg: "failed", detail: redact(err) }));
  try {
    await pool.end();
  } catch {
    /* ignore */
  }
  process.exit(1);
}
