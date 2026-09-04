/** Postgres DDL for NIXO. No Prisma/Drizzle — one JSONB document plus a migration ledger. */

export const NIXO_PG_MIGRATION_SQL = `
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
