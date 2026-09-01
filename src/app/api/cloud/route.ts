import { json, jsonError } from "@/lib/http";
import { cloudDashboard, cloudMutate } from "@/lib/cloud";
import type { CloudRegionId, CloudServiceId } from "@/lib/cloud-types";

export async function GET() {
  const r = await cloudDashboard();
  if (!r.ok) return jsonError(r.error, r.status);
  return json(r);
}

export async function POST(request: Request) {
  const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
  if (!body || typeof body.action !== "string") return jsonError("درخواست نامعتبر است.");
  const r = await cloudMutate({
    action: body.action,
    service: body.service as CloudServiceId | undefined,
    confirm: typeof body.confirm === "string" ? body.confirm : undefined,
    autoscaling: typeof body.autoscaling === "boolean" ? body.autoscaling : undefined,
    cooldownSec: typeof body.cooldownSec === "number" ? body.cooldownSec : undefined,
    budgetUsd: typeof body.budgetUsd === "number" ? body.budgetUsd : undefined,
    min: typeof body.min === "number" ? body.min : undefined,
    max: typeof body.max === "number" ? body.max : undefined,
    region: body.region as CloudRegionId | undefined,
  });
  if (!r.ok) return jsonError(r.error, r.status ?? 400);
  return json(r);
}
