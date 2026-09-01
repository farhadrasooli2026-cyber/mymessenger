import { json } from "@/lib/http";
import { publicReleaseInfo } from "@/lib/release";
import { currentDeployEnv } from "@/lib/env-config";
import { isShuttingDown } from "@/lib/lifecycle";

/** Public version — no secrets, no git remotes, no hostnames. */
export async function GET() {
  return json(
    {
      ok: true,
      ...publicReleaseInfo(),
      env: currentDeployEnv(),
      draining: isShuttingDown(),
    },
    200,
    { "Cache-Control": "public, max-age=15" },
  );
}
