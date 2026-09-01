import { json, jsonError } from "@/lib/http";
import { requireActiveUser } from "@/lib/auth";
import { callQualitySummary } from "@/lib/call-signal";

export async function GET() {
  const user = await requireActiveUser();
  if (!user) return jsonError("نشست فعال نیست.", 401);
  const summary = await callQualitySummary(user.id);
  return json(summary);
}
