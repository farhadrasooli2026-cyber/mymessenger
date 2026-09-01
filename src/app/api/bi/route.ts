import { z } from "zod";
import { json, jsonError } from "@/lib/http";
import { requireActiveSession } from "@/lib/auth";
import { hitRateLimit } from "@/lib/rate-limit";
import { mutateStore } from "@/lib/store";
import { BI_DESKS, BI_RANGES, type BiDesk, type BiRange } from "@/lib/bi-types";
import { biConsentState, biDashboard, biMutate, ingestClientBi } from "@/lib/bi";

export async function GET(request: Request) {
  const url = new URL(request.url);
  const view = url.searchParams.get("view");
  if (view === "consent") {
    const session = await requireActiveSession();
    if (!session) return json({ ok: true, productAnalytics: false, essentialAlways: true, guest: true });
    return json(await biConsentState(session.user.id));
  }
  const range = (BI_RANGES as readonly string[]).includes(url.searchParams.get("range") ?? "")
    ? (url.searchParams.get("range") as BiRange)
    : "7d";
  const deskRaw = url.searchParams.get("desk") ?? "all";
  const desk = deskRaw === "all" || (BI_DESKS as readonly string[]).includes(deskRaw) ? (deskRaw as BiDesk | "all") : "all";
  const r = await biDashboard({
    range,
    compare: url.searchParams.get("compare") === "1",
    desk,
    locale: url.searchParams.get("locale") ?? undefined,
    country: url.searchParams.get("country") ?? undefined,
    device: url.searchParams.get("device") ?? undefined,
    os: url.searchParams.get("os") ?? undefined,
  });
  if (!r.ok) return jsonError(r.error, r.status);
  return json(r);
}

const postSchema = z.object({
  action: z.enum(["event", "purge", "experiment.upsert", "experiment.rollback"]),
  name: z.string().max(80).optional(),
  nonce: z.string().min(8).max(64).optional(),
  props: z.record(z.string(), z.union([z.string(), z.number(), z.boolean()])).optional(),
  source: z.string().max(40).optional(),
  key: z.string().max(40).optional(),
  percent: z.number().min(0).max(100).optional(),
  metric: z.string().max(80).optional(),
});

export async function POST(request: Request) {
  let parsed: z.infer<typeof postSchema>;
  try {
    parsed = postSchema.parse(await request.json());
  } catch {
    return jsonError("درخواست نامعتبر است.", 400);
  }

  if (parsed.action === "event") {
    const session = await requireActiveSession();
    if (!session) return json({ ok: true, stored: false, reason: "session" });
    const gate = await mutateStore((data) => {
      const hit = hitRateLimit(data, `bi:${session.user.id}`, 60_000, 40);
      return hit.allowed;
    });
    if (!gate) return json({ ok: true, stored: false, reason: "rate" });
    if (!parsed.name || !parsed.nonce) return json({ ok: true, stored: false, reason: "schema" });
    const consented = Boolean(session.user.prefs?.consents?.analytics);
    const r = await ingestClientBi({
      userId: session.user.id,
      consented,
      name: parsed.name,
      nonce: parsed.nonce,
      props: parsed.props,
      source: parsed.source,
    });
    return json(r);
  }

  const r = await biMutate({
    action: parsed.action,
    key: parsed.key,
    percent: parsed.percent,
    metric: parsed.metric,
  });
  if (!r.ok) return jsonError(r.error, r.status);
  return json(r);
}
