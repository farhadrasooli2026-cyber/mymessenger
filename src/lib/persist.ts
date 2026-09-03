import "server-only";

const DOC_ID = "main";
const STORE_LOCK_KEY = 871234501;

function cleanEnvValue(raw: string): string {
  let v = raw.trim();
  if (
    (v.startsWith('"') && v.endsWith('"') && v.length >= 2) ||
    (v.startsWith("'") && v.endsWith("'") && v.length >= 2)
  ) {
    v = v.slice(1, -1).trim();
  }
  return v.replace(/\r?\n/g, "").trim();
}

export function databaseUrl(): string {
  for (const name of ["NIXO_DATABASE_URL", "DATABASE_URL", "POSTGRES_URL"]) {
    const v = cleanEnvValue(process.env[name] ?? "");
    if (v) return v;
  }
  return "";
}

export function persistMode(): "postgres" | "file" {
  if (process.env.VITEST) return "file";
  if (databaseUrl()) return "postgres";
  return "file";
}

export function productionPersistOk(): boolean {
  if (databaseUrl()) return true;
  return process.env.NIXO_ALLOW_FILE_STORE === "1";
}

type SqlResult = { rows: Record<string, unknown>[] };
type SqlClient = {
  query: (sql: string, params?: unknown[]) => Promise<SqlResult>;
};
type SqlPool = SqlClient & {
  connect: () => Promise<SqlClient & { release: () => void }>;
};

let pool: SqlPool | null = null;
let ready = false;

function sslOption(url: string) {
  if (/localhost|127\.0\.0\.1/.test(url)) return false;
  return { rejectUnauthorized: false };
}

function redactDbError(err: unknown): string {
  const msg = err instanceof Error ? err.message : "unknown";
  return msg.replace(/:\/\/[^@/\s]+@/g, "://[redacted]@").slice(0, 220);
}

function payloadToString(payload: unknown): string | null {
  if (payload == null) return null;
  return typeof payload === "string" ? payload : JSON.stringify(payload);
}

async function getPool(): Promise<SqlPool> {
  if (pool) return pool;
  const url = databaseUrl();
  if (!url) throw new Error("database_url_missing");
  const pg = await import("pg");
  const created = new pg.Pool({
    connectionString: url,
    max: 6,
    idleTimeoutMillis: 10_000,
    connectionTimeoutMillis: 8_000,
    ssl: sslOption(url),
  }) as unknown as SqlPool;
  pool = created;
  return created;
}

async function ensureTable(client: SqlClient) {
  if (ready) return;
  await client.query(`
    CREATE TABLE IF NOT EXISTS nixo_store (
      id TEXT PRIMARY KEY,
      payload JSONB NOT NULL,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);
  ready = true;
}

const UPSERT = `INSERT INTO nixo_store (id, payload, updated_at)
     VALUES ($1, $2::jsonb, NOW())
     ON CONFLICT (id) DO UPDATE SET payload = EXCLUDED.payload, updated_at = NOW()`;

export async function loadPersistedJson(): Promise<string | null> {
  if (persistMode() !== "postgres") return null;
  const client = await getPool();
  await ensureTable(client);
  const res = await client.query("SELECT payload FROM nixo_store WHERE id = $1", [DOC_ID]);
  return payloadToString(res.rows[0]?.payload);
}

export async function savePersistedJson(json: string): Promise<void> {
  if (persistMode() !== "postgres") return;
  const client = await getPool();
  await ensureTable(client);
  await client.query(UPSERT, [DOC_ID, json]);
}

/**
 * Serialize store writes across Render web processes so OTP rows are not
 * lost to last-write-wins on the JSONB document.
 */
export async function withPostgresDocument<T>(
  fn: (raw: string | null) => Promise<{ json: string; result: T }>,
): Promise<T> {
  const poolClient = await getPool();
  const client = await poolClient.connect();
  try {
    await client.query("BEGIN");
    await client.query("SELECT pg_advisory_xact_lock($1)", [STORE_LOCK_KEY]);
    await ensureTable(client);
    const res = await client.query("SELECT payload FROM nixo_store WHERE id = $1 FOR UPDATE", [DOC_ID]);
    const current = payloadToString(res.rows[0]?.payload);
    const { json, result } = await fn(current);
    await client.query(UPSERT, [DOC_ID, json]);
    await client.query("COMMIT");
    return result;
  } catch (err) {
    try {
      await client.query("ROLLBACK");
    } catch {
      /* ignore */
    }
    console.error(
      JSON.stringify({
        service: "persist",
        level: "error",
        msg: "postgres_txn_failed",
        detail: redactDbError(err),
      }),
    );
    throw err;
  } finally {
    client.release();
  }
}

export async function persistHealth(): Promise<{
  driver: "postgres" | "file";
  databaseUrlSet: boolean;
  connected: boolean;
}> {
  const driver = persistMode();
  const databaseUrlSet = Boolean(databaseUrl());
  if (driver !== "postgres") {
    return { driver, databaseUrlSet, connected: true };
  }
  try {
    const client = await getPool();
    await ensureTable(client);
    await client.query("SELECT 1");
    return { driver, databaseUrlSet, connected: true };
  } catch (err) {
    console.error(
      JSON.stringify({
        service: "persist",
        level: "error",
        msg: "postgres_unreachable",
        detail: redactDbError(err),
      }),
    );
    return { driver, databaseUrlSet, connected: false };
  }
}
