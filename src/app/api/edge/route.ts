import { json, jsonError } from "@/lib/http";
import { requireActiveUser } from "@/lib/auth";
import { hashIp } from "@/lib/crypto-utils";
import { ingestEdgeRum, edgeDashboard, edgeMutate } from "@/lib/edge";
import type { EdgePopId } from "@/lib/edge-policy";
import { clientIp } from "@/lib/session";

export async function GET() {
  const r = await edgeDashboard();
  if (!r.ok) return jsonError(r.error, r.status);
  return json(r);
}

export async function POST(request: Request) {
  const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
  if (!body || typeof body.action !== "string") return jsonError("درخواست نامعتبر است.");
  if (body.action === "rum") {
    const user = await requireActiveUser();
    const ip = hashIp(await clientIp());
    const kind = body.kind === "api" || body.kind === "media" || body.kind === "ws" || body.kind === "call" ? body.kind : "static";
    const r = await ingestEdgeRum({
      userId: user?.id ?? null,
      ipHash: ip,
      ms: typeof body.ms === "number" ? body.ms : -1,
      kind,
      pop: body.pop as EdgePopId | undefined,
    });
    if (!r.ok) return jsonError(r.error, r.status);
    return json(r);
  }
  const r = await edgeMutate({
    action: body.action,
    confirm: typeof body.confirm === "string" ? body.confirm : undefined,
    prefix: typeof body.prefix === "string" ? body.prefix : undefined,
    pop: body.pop as EdgePopId | undefined,
    healthy: typeof body.healthy === "boolean" ? body.healthy : undefined,
    canaryPct: typeof body.canaryPct === "number" ? body.canaryPct : undefined,
    residencyLock: body.residencyLock === "eu" || body.residencyLock === "us" || body.residencyLock === "none" ? body.residencyLock : undefined,
  });
  if (!r.ok) return jsonError(r.error, r.status ?? 400);
  return json(r);
}
