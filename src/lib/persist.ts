import "server-only";

const DOC_ID = "main";

export function databaseUrl(): string {
  return (
    process.env.NIXO_DATABASE_URL ||
    process.env.DATABASE_URL ||
    process.env.POSTGRES_URL ||
    ""
  ).trim();
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

type PgPool = {
  query: (sql: string, params?: unknown[]) => Promise<{ rows: Record<string, unknown>[] }>;
};

let pool: PgPool | null = null;
let ready = false;

function sslOption(url: string) {
  if (/localhost|127\.0\.0\.1/.test(url)) return false;
  return { rejectUnauthorized: false };
}

async function getPool(): Promise<PgPool> {
  if (pool) return pool;
  const url = databaseUrl();
  if (!url) throw new Error("database_url_missing");
  const pg = await import("pg");
  const created = new pg.Pool({
    connectionString: url,
    max: 3,
    idleTimeoutMillis: 10_000,
    connectionTimeoutMillis: 8_000,
    ssl: sslOption(url),
  });
  pool = created;
  return created;
}

async function ensureTable(client: PgPool) {
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

export async function loadPersistedJson(): Promise<string | null> {
  if (persistMode() !== "postgres") return null;
  const client = await getPool();
  await ensureTable(client);
  const res = await client.query("SELECT payload FROM nixo_store WHERE id = $1", [DOC_ID]);
  const payload = res.rows[0]?.payload;
  if (payload == null) return null;
  return typeof payload === "string" ? payload : JSON.stringify(payload);
}

export async function savePersistedJson(json: string): Promise<void> {
  if (persistMode() !== "postgres") return;
  const client = await getPool();
  await ensureTable(client);
  await client.query(
    `INSERT INTO nixo_store (id, payload, updated_at)
     VALUES ($1, $2::jsonb, NOW())
     ON CONFLICT (id) DO UPDATE SET payload = EXCLUDED.payload, updated_at = NOW()`,
    [DOC_ID, json],
  );
}

export function persistHealth(): { driver: "postgres" | "file"; databaseUrlSet: boolean } {
  return { driver: persistMode(), databaseUrlSet: Boolean(databaseUrl()) };
}
