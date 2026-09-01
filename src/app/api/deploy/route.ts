import { z } from "zod";
import { json, jsonError } from "@/lib/http";
import { requireStaff } from "@/lib/admin-moderation";
import { hitRateLimit } from "@/lib/rate-limit";
import { mutateStore } from "@/lib/store";
import {
  createStagingRelease,
  deployDashboard,
  promoteProduction,
  rollbackRelease,
  setFeatureFlag,
} from "@/lib/deploy";
import { DEPLOY_STRATEGIES } from "@/lib/deploy-types";

const bodySchema = z.object({
  action: z.enum(["staging", "production", "emergency", "rollback", "flag"]),
  notes: z.string().max(240).optional(),
  strategy: z.enum(DEPLOY_STRATEGIES).optional(),
  canaryPct: z.number().min(0).max(100).optional(),
  deploymentId: z.string().max(80).optional(),
  password: z.string().max(200).optional(),
  confirm: z.string().max(40).optional(),
  key: z.string().max(40).optional(),
  enabled: z.boolean().optional(),
  percent: z.number().min(0).max(100).optional(),
  segment: z.enum(["all", "staff", "percent"]).optional(),
  kill: z.boolean().optional(),
});

export async function GET() {
  const r = await deployDashboard();
  if (!r.ok) return jsonError(r.error, r.status);
  return json(r);
}

export async function POST(request: Request) {
  const ctx = await requireStaff("deploy.view");
  if (!ctx.ok) return jsonError(ctx.error, ctx.status);
  let parsed: z.infer<typeof bodySchema>;
  try {
    parsed = bodySchema.parse(await request.json());
  } catch {
    return jsonError("درخواست نامعتبر است.", 400);
  }
  const limited = await mutateStore((data) => hitRateLimit(data, `deploy:api:${ctx.user.id}`, 60_000, 30));
  if (!limited.allowed) return jsonError("تعداد درخواست بیش از حد است.", 429);

  if (parsed.action === "staging") {
    const r = await createStagingRelease({
      notes: parsed.notes,
      strategy: parsed.strategy,
      canaryPct: parsed.canaryPct,
    });
    if (!r.ok) return jsonError(r.error, r.status);
    return json(r);
  }
  if (parsed.action === "production" || parsed.action === "emergency") {
    const r = await promoteProduction({
      deploymentId: parsed.deploymentId,
      password: parsed.password ?? "",
      confirm: parsed.confirm ?? "",
      emergency: parsed.action === "emergency",
      strategy: parsed.strategy,
      canaryPct: parsed.canaryPct,
    });
    if (!r.ok) return jsonError(r.error, r.status);
    return json(r);
  }
  if (parsed.action === "rollback") {
    const r = await rollbackRelease({ password: parsed.password ?? "", confirm: parsed.confirm ?? "" });
    if (!r.ok) return jsonError(r.error, r.status);
    return json(r);
  }
  if (parsed.action === "flag") {
    if (!parsed.key) return jsonError("کلید پرچم لازم است.", 400);
    const r = await setFeatureFlag({
      key: parsed.key,
      enabled: parsed.enabled,
      percent: parsed.percent,
      segment: parsed.segment,
      kill: parsed.kill,
    });
    if (!r.ok) return jsonError(r.error, r.status);
    return json(r);
  }
  return jsonError("عملیات نامعتبر است.", 400);
}
