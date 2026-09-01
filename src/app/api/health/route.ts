import { json } from "@/lib/http";
import { dbHealth } from "@/lib/db/health";
import { SCHEMA_VERSION } from "@/lib/db/catalog";

/** Public readiness — no PII, no paths, no credentials. */
export async function GET() {
  const h = await dbHealth();
  return json({
    ok: h.ok,
    ready: h.ready,
    schemaVersion: h.schemaVersion,
    expectedSchema: SCHEMA_VERSION,
    env: h.env,
    writerPool: h.writerPool,
    queryTimeoutMs: h.queryTimeoutMs,
  });
}
