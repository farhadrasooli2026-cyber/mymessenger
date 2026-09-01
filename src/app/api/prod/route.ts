import { json, jsonError } from "@/lib/http";
import { prodDashboard, prodMutate, runAndStoreSmoke } from "@/lib/prod";

export async function GET() {
  const r = await prodDashboard();
  if (!r.ok) return jsonError(r.error, r.status);
  return json(r);
}

export async function POST(request: Request) {
  const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
  if (!body || typeof body.action !== "string") return jsonError("درخواست نامعتبر است.");
  if (body.action === "smoke") {
    const r = await runAndStoreSmoke();
    if (!r.ok) return jsonError(r.error, r.status);
    return json(r);
  }
  const r = await prodMutate({
    action: body.action,
    reason: typeof body.reason === "string" ? body.reason : undefined,
    confirm: typeof body.confirm === "string" ? body.confirm : undefined,
    title: typeof body.title === "string" ? body.title : undefined,
    severity: typeof body.severity === "string" ? body.severity : undefined,
    incidentId: typeof body.incidentId === "string" ? body.incidentId : undefined,
    summary: typeof body.summary === "string" ? body.summary : undefined,
  });
  if (!r.ok) return jsonError(r.error, r.status ?? 400);
  return json(r);
}
