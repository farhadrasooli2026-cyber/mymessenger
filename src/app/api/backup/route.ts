import { json, jsonError } from "@/lib/http";
import { requireActiveSession } from "@/lib/auth";
import {
  deleteBackup,
  enableBackupSecrets,
  getBackupState,
  loadBackupForRestore,
  markRestored,
  nextAutoDue,
  saveBackupPrefs,
  storeEncryptedBackup,
} from "@/lib/backup";
import { clientIp } from "@/lib/session";

export async function GET() {
  const ctx = await requireActiveSession();
  if (!ctx) return jsonError("نشست فعال نیست.", 401);
  const state = await getBackupState(ctx.user.id);
  if (!state) return jsonError("نشست فعال نیست.", 401);
  return json({
    ok: true,
    ...state,
    autoDue: nextAutoDue(state.latest?.createdAt ?? null, state.prefs.schedule) && state.prefs.auto,
  });
}

export async function POST(request: Request) {
  const ctx = await requireActiveSession();
  if (!ctx) return jsonError("Backup Failed — Permission Error.", 401);
  const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
  if (!body || typeof body.action !== "string") return jsonError("درخواست نامعتبر است.");
  const ip = await clientIp();
  const userId = ctx.user.id;

  if (body.action === "prefs") {
    const result = await saveBackupPrefs(userId, {
      auto: typeof body.auto === "boolean" ? body.auto : undefined,
      schedule: body.schedule === "daily" || body.schedule === "weekly" || body.schedule === "monthly" ? body.schedule : undefined,
      includePhotos: typeof body.includePhotos === "boolean" ? body.includePhotos : undefined,
      includeVideos: typeof body.includeVideos === "boolean" ? body.includeVideos : undefined,
      includeFiles: typeof body.includeFiles === "boolean" ? body.includeFiles : undefined,
      includeVoice: typeof body.includeVoice === "boolean" ? body.includeVoice : undefined,
    });
    if (!result.ok) return jsonError(result.error, result.status);
    return json(result);
  }
  if (body.action === "enable") {
    const result = await enableBackupSecrets(userId, String(body.password ?? ""), String(body.recoveryKey ?? ""), ip);
    if (!result.ok) return jsonError(result.error, result.status);
    return json(result);
  }
  if (body.action === "upload") {
    const result = await storeEncryptedBackup(
      userId,
      {
        salt: String(body.salt ?? ""),
        nonce: String(body.nonce ?? ""),
        ciphertext: String(body.ciphertext ?? ""),
      },
      {
        chats: body.chats !== false,
        settings: body.settings !== false,
        photos: Boolean(body.photos),
        videos: Boolean(body.videos),
        files: Boolean(body.files),
        voice: Boolean(body.voice),
      },
      ip,
    );
    if (!result.ok) return jsonError(result.error, result.status, { errorCode: result.errorCode });
    return json(result);
  }
  if (body.action === "restore") {
    const result = await loadBackupForRestore(userId, String(body.secret ?? ""));
    if (!result.ok) return jsonError(result.error, result.status);
    await markRestored(userId, ip);
    return json(result);
  }
  if (body.action === "delete") {
    const result = await deleteBackup(userId, ip);
    if (!result.ok) return jsonError(result.error, result.status);
    return json(result);
  }
  return jsonError("عملیات ناشناخته است.");
}
