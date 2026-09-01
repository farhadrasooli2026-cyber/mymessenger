import { z } from "zod";
import { json, jsonError } from "@/lib/http";
import { requireActiveSession } from "@/lib/auth";
import { hitRateLimit } from "@/lib/rate-limit";
import { mutateStore } from "@/lib/store";
import {
  ackMonitorAlert,
  ingestClientError,
  monitorDashboard,
  recoverMonitor,
  resolveMonitorAlert,
  setIncident,
} from "@/lib/monitor";
import type { IncidentStatus } from "@/lib/monitor-types";

const actionSchema = z.object({
  action: z.enum(["ack", "resolve", "incident", "recover", "client-error"]),
  id: z.string().max(80).optional(),
  status: z.enum(["detected", "investigating", "mitigating", "resolved", "closed"]).optional(),
  ownerId: z.string().max(80).nullable().optional(),
  message: z.string().max(400).optional(),
});

export async function GET() {
  const r = await monitorDashboard();
  if (!r.ok) return jsonError(r.error, r.status);
  return json(r);
}

export async function POST(request: Request) {
  let parsed: z.infer<typeof actionSchema>;
  try {
    parsed = actionSchema.parse(await request.json());
  } catch {
    return jsonError("درخواست نامعتبر است.", 400);
  }

  if (parsed.action === "client-error") {
    const session = await requireActiveSession();
    if (!session) return jsonError("نشست فعال نیست.", 401);
    const limited = await mutateStore((data) => hitRateLimit(data, `monitor:client:${session.user.id}`, 60_000, 20));
    if (!limited.allowed) return jsonError("تعداد گزارش خطا بیش از حد است.", 429, { retryAfterSec: limited.retryAfterSec });
    const r = await ingestClientError(parsed.message ?? "");
    if (!r.ok) return jsonError(r.error, r.status);
    return json(r);
  }

  if (parsed.action === "ack") {
    const r = await ackMonitorAlert(parsed.id ?? "");
    if (!r.ok) return jsonError(r.error, "status" in r ? r.status : 400);
    return json(r);
  }
  if (parsed.action === "resolve") {
    const r = await resolveMonitorAlert(parsed.id ?? "");
    if (!r.ok) return jsonError(r.error, "status" in r ? r.status : 400);
    return json(r);
  }
  if (parsed.action === "incident") {
    const r = await setIncident(parsed.id ?? "", (parsed.status ?? "investigating") as IncidentStatus, parsed.ownerId);
    if (!r.ok) return jsonError(r.error, "status" in r ? r.status : 400);
    return json(r);
  }
  if (parsed.action === "recover") {
    const r = await recoverMonitor();
    if (!r.ok) return jsonError(r.error, r.status);
    return json(r);
  }
  return jsonError("عملیات نامعتبر است.", 400);
}
