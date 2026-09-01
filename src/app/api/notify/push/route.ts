import { json, jsonError } from "@/lib/http";
import { requireActiveSession } from "@/lib/auth";
import { listPushTokens, registerPushToken, revokePushToken, updateDeviceNotifyPrefs } from "@/lib/notify";

export async function GET() {
  const session = await requireActiveSession();
  if (!session) return jsonError("نشست فعال نیست.", 401);
  return json(await listPushTokens(session.user.id, session.session.sid));
}

export async function POST(request: Request) {
  const session = await requireActiveSession();
  if (!session) return jsonError("نشست فعال نیست.", 401);
  if (!session.session.sid) return jsonError("دستگاه این نشست شناخته نشد.", 403);
  const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
  const permission = body?.permission === "denied" || body?.permission === "default" ? body.permission : "granted";
  const platform = body?.platform === "mobile" || body?.platform === "desktop" ? body.platform : "web";
  const result = await registerPushToken(session.user.id, session.session.sid, {
    endpoint: String(body?.endpoint ?? ""),
    platform,
    permission,
    devicePrefs:
      body?.devicePrefs && typeof body.devicePrefs === "object"
        ? (body.devicePrefs as { sound?: boolean; vibration?: boolean; badge?: boolean; enabled?: boolean })
        : undefined,
  });
  if (!result.ok) return jsonError(result.error, result.status);
  return json(result);
}

export async function DELETE(request: Request) {
  const session = await requireActiveSession();
  if (!session) return jsonError("نشست فعال نیست.", 401);
  const id = new URL(request.url).searchParams.get("id") ?? "";
  const result = await revokePushToken(session.user.id, id);
  if (!result.ok) return jsonError(result.error, result.status);
  return json(result);
}

export async function PATCH(request: Request) {
  const session = await requireActiveSession();
  if (!session) return jsonError("نشست فعال نیست.", 401);
  const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
  const id = String(body?.id ?? "");
  const prefs = (body?.devicePrefs && typeof body.devicePrefs === "object" ? body.devicePrefs : body) as Record<string, unknown> | null;
  const result = await updateDeviceNotifyPrefs(session.user.id, id, {
    sound: typeof prefs?.sound === "boolean" ? prefs.sound : undefined,
    vibration: typeof prefs?.vibration === "boolean" ? prefs.vibration : undefined,
    badge: typeof prefs?.badge === "boolean" ? prefs.badge : undefined,
    enabled: typeof prefs?.enabled === "boolean" ? prefs.enabled : undefined,
  });
  if (!result.ok) return jsonError(result.error, result.status);
  return json(result);
}
