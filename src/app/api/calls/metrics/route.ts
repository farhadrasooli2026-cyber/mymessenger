import { json, jsonError } from "@/lib/http";
import { requireActiveUser } from "@/lib/auth";
import { callQualitySummary } from "@/lib/call-signal";
import { iceHealth } from "@/lib/ice";

export async function GET() {
  const user = await requireActiveUser();
  if (!user) return jsonError("نشست فعال نیست.", 401);
  const summary = await callQualitySummary(user.id);
  return json({ ...summary, ice: iceHealth() });
}
