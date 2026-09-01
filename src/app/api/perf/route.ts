import { z } from "zod";
import { json, jsonError } from "@/lib/http";
import { requireStaff } from "@/lib/admin-moderation";
import { hitRateLimit } from "@/lib/rate-limit";
import { mutateStore } from "@/lib/store";
import { drainPerfWorkers, enqueuePerfJob, perfDashboard, setPerfPolicy } from "@/lib/perf";
import { PERF_JOB_KINDS } from "@/lib/perf-types";

const bodySchema = z.object({
  action: z.enum(["drain", "enqueue", "policy"]),
  kind: z.enum(PERF_JOB_KINDS).optional(),
  targetId: z.string().max(80).optional(),
  shed: z.enum(["off", "soft", "hard"]).optional(),
  workerConcurrency: z.number().min(1).max(4).optional(),
  loadShed: z.boolean().optional(),
});

export async function GET() {
  const r = await perfDashboard();
  if (!r.ok) return jsonError(r.error, r.status);
  return json(r);
}

export async function POST(request: Request) {
  const ctx = await requireStaff("monitor");
  if (!ctx.ok) return jsonError(ctx.error, ctx.status);
  let parsed: z.infer<typeof bodySchema>;
  try {
    parsed = bodySchema.parse(await request.json());
  } catch {
    return jsonError("درخواست نامعتبر است.", 400);
  }
  const limited = await mutateStore((data) => hitRateLimit(data, `perf:api:${ctx.user.id}`, 60_000, 40));
  if (!limited.allowed) return jsonError("تعداد درخواست بیش از حد است.", 429);

  if (parsed.action === "drain") {
    const r = await drainPerfWorkers();
    return json(r);
  }
  if (parsed.action === "enqueue") {
    const r = await enqueuePerfJob({ kind: parsed.kind ?? "index", targetId: parsed.targetId ?? "manual" });
    return json(r);
  }
  if (parsed.action === "policy") {
    const r = await setPerfPolicy({
      shed: parsed.shed,
      workerConcurrency: parsed.workerConcurrency,
      loadShed: parsed.loadShed,
    });
    if (!r.ok) return jsonError(r.error, r.status);
    return json(r);
  }
  return jsonError("عملیات نامعتبر است.", 400);
}
