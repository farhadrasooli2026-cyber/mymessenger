import { z } from "zod";
import { json, jsonError } from "@/lib/http";
import { hitRateLimit } from "@/lib/rate-limit";
import { mutateStore } from "@/lib/store";
import { requireStaff } from "@/lib/admin-moderation";
import {
  cancelDrJob,
  drDashboard,
  failback,
  failover,
  importDrBackup,
  restorePreview,
  restoreProduction,
  rollbackProduction,
  runDrBackup,
  runRestoreTest,
  setDrMode,
  updateDrPolicy,
  validateRecovery,
  verifyDrPoint,
} from "@/lib/dr";
import { DR_BACKUP_KINDS, DR_SCOPES, type DrBackupKind, type DrScope, type PlatformMode } from "@/lib/dr-types";

const bodySchema = z.object({
  action: z.enum([
    "backup",
    "verify",
    "preview",
    "restore-test",
    "restore",
    "rollback",
    "mode",
    "failover",
    "failback",
    "policy",
    "cancel",
    "import",
    "validate",
  ]),
  id: z.string().max(80).optional(),
  kind: z.enum(DR_BACKUP_KINDS).optional(),
  scopes: z.array(z.enum(DR_SCOPES)).max(12).optional(),
  password: z.string().max(200).optional(),
  confirm: z.string().max(40).optional(),
  mode: z.enum(["normal", "maintenance", "read_only"]).optional(),
  pitMs: z.number().optional(),
  fullEveryMs: z.number().optional(),
  incrEveryMs: z.number().optional(),
  autoEnabled: z.boolean().optional(),
});

export async function GET() {
  const r = await drDashboard();
  if (!r.ok) return jsonError(r.error, r.status);
  return json(r);
}

export async function POST(request: Request) {
  const staff = await requireStaff("backup.view");
  if (!staff.ok) return jsonError(staff.error, staff.status);
  let parsed: z.infer<typeof bodySchema>;
  try {
    parsed = bodySchema.parse(await request.json());
  } catch {
    return jsonError("درخواست نامعتبر است.", 400);
  }

  const rate = await mutateStore((data) => hitRateLimit(data, `dr:${staff.user.id}:${parsed.action}`, 60 * 60_000, 20));
  if (!rate.allowed) return jsonError("تعداد عملیات بازیابی بیش از حد است.", 429);

  if (parsed.action === "backup") {
    const r = await runDrBackup({
      kind: (parsed.kind ?? "full") as DrBackupKind,
      scopes: parsed.scopes as DrScope[] | undefined,
      actorId: staff.user.id,
    });
    if (!r.ok) return jsonError(r.error, r.status);
    return json(r);
  }
  if (parsed.action === "verify") {
    const r = await verifyDrPoint(parsed.id ?? "");
    if (!r.ok) return jsonError(r.error, r.status);
    return json(r);
  }
  if (parsed.action === "preview") {
    const r = await restorePreview(parsed.id ?? "");
    if (!r.ok) return jsonError(r.error, r.status);
    return json(r);
  }
  if (parsed.action === "restore-test") {
    const r = await runRestoreTest(parsed.id ?? "", staff.user.id);
    if (!r.ok) return jsonError(r.error, r.status);
    return json(r);
  }
  if (parsed.action === "restore") {
    const r = await restoreProduction({
      id: parsed.id ?? "",
      password: parsed.password ?? "",
      confirm: parsed.confirm ?? "",
      scopes: parsed.scopes as DrScope[] | undefined,
      pitMs: parsed.pitMs,
    });
    if (!r.ok) return jsonError(r.error, "status" in r ? r.status : 400);
    return json(r);
  }
  if (parsed.action === "rollback") {
    const r = await rollbackProduction(parsed.password ?? "", parsed.confirm ?? "");
    if (!r.ok) return jsonError(r.error, "status" in r ? r.status : 400);
    return json(r);
  }
  if (parsed.action === "mode") {
    const r = await setDrMode((parsed.mode ?? "maintenance") as PlatformMode, parsed.password ?? "", parsed.confirm ?? "");
    if (!r.ok) return jsonError(r.error, "status" in r ? r.status : 400);
    return json(r);
  }
  if (parsed.action === "failover") {
    const r = await failover(parsed.password ?? "", parsed.confirm ?? "");
    if (!r.ok) return jsonError(r.error, "status" in r ? r.status : 400);
    return json(r);
  }
  if (parsed.action === "failback") {
    const r = await failback(parsed.password ?? "", parsed.confirm ?? "");
    if (!r.ok) return jsonError(r.error, "status" in r ? r.status : 400);
    return json(r);
  }
  if (parsed.action === "policy") {
    const r = await updateDrPolicy({
      fullEveryMs: parsed.fullEveryMs,
      incrEveryMs: parsed.incrEveryMs,
      autoEnabled: parsed.autoEnabled,
    });
    if (!r.ok) return jsonError(r.error, r.status);
    return json(r);
  }
  if (parsed.action === "cancel") {
    const r = await cancelDrJob(parsed.id ?? "");
    if (!r.ok) return jsonError(r.error, "status" in r ? r.status : 400);
    return json(r);
  }
  if (parsed.action === "import") {
    const r = await importDrBackup(parsed.id ?? "");
    if (!r.ok) return jsonError(r.error, r.status);
    return json(r);
  }
  if (parsed.action === "validate") {
    return json({ ok: true, validation: await validateRecovery() });
  }
  return jsonError("عملیات نامعتبر است.", 400);
}
