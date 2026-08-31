import { json, jsonError } from "@/lib/http";
import { requireActiveUser } from "@/lib/auth";
import { fileReport, reportInputSchema } from "@/lib/safety";

export async function POST(request: Request) {
  const user = await requireActiveUser();
  if (!user) return jsonError("نشست فعال نیست.", 401);
  const parsed = reportInputSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return jsonError("گزارش معتبر نیست.");
  const result = await fileReport(user.id, parsed.data);
  if (!result.ok) return jsonError(result.error, result.status);
  return json({ ok: true, reportId: result.reportId });
}
