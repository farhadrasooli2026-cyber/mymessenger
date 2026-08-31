import { json, jsonError } from "@/lib/http";
import { requireActiveUser } from "@/lib/auth";
import { liveGroupCallForGroup, startGroupCall } from "@/lib/group-calls";

export async function GET(request: Request) {
  const user = await requireActiveUser();
  if (!user) return jsonError("نشست فعال نیست.", 401);
  const groupId = new URL(request.url).searchParams.get("groupId");
  if (!groupId) return jsonError("گروه مشخص نیست.");
  const r = await liveGroupCallForGroup(user.id, groupId);
  if (!r.ok) return jsonError(r.error, r.status);
  return json({ ok: true, call: r.call });
}

export async function POST(request: Request) {
  const user = await requireActiveUser();
  if (!user) return jsonError("نشست فعال نیست.", 401);
  const body = (await request.json().catch(() => null)) as {
    groupId?: string;
    kind?: string;
    maxParticipants?: number;
  } | null;
  if (!body?.groupId || (body.kind !== "voice" && body.kind !== "video")) {
    return jsonError("درخواست تماس گروهی نامعتبر است.");
  }
  const r = await startGroupCall(user.id, body.groupId, body.kind, body.maxParticipants);
  if (!r.ok) {
    if ("call" in r && r.call) return jsonError(r.error, r.status, { call: r.call });
    return jsonError(r.error, r.status);
  }
  return json({ ok: true, call: r.call });
}
