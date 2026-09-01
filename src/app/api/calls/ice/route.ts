import { json, jsonError } from "@/lib/http";
import { requireActiveUser } from "@/lib/auth";
import { iceServersForSession } from "@/lib/ice";

export async function GET() {
  const user = await requireActiveUser();
  if (!user) return jsonError("نشست فعال نیست.", 401);
  const ice = iceServersForSession();
  return json({ ok: true, iceServers: ice.iceServers, relay: ice.relay, note: ice.note });
}
