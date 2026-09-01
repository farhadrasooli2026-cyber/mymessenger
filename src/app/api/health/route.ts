import { json } from "@/lib/http";
import { dbHealth } from "@/lib/db/health";
import { SCHEMA_VERSION } from "@/lib/db/catalog";
import { publicHealth } from "@/lib/monitor";

/** Public readiness — no PII, no paths, no credentials. */
export async function GET(request: Request) {
  const probe = new URL(request.url).searchParams.get("probe");
  const pub = await publicHealth(probe);
  if (probe === "live" || probe === "ready") {
    return json(pub, pub.ok ? 200 : 503);
  }
  const h = await dbHealth();
  return json(
    {
      ...pub,
      schemaVersion: h.schemaVersion,
      expectedSchema: SCHEMA_VERSION,
      env: h.env,
      writerPool: h.writerPool,
      queryTimeoutMs: h.queryTimeoutMs,
    },
    pub.ok ? 200 : 503,
  );
}
