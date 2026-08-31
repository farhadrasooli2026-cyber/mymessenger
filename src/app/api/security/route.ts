import { json, jsonError } from "@/lib/http";
import { requireActiveSession } from "@/lib/auth";
import {
  clearBackupSecret,
  deletePasskey,
  disableTwoStep,
  enableTwoStep,
  fileVulnReport,
  getSecurityDashboard,
  issuePasskeyChallenge,
  registerPasskey,
  revokeAllOtherDevices,
  revokeDevice,
  rotateRecoveryCodes,
  setBackupSecret,
} from "@/lib/security";
import { clientIp } from "@/lib/session";

export async function GET() {
  const ctx = await requireActiveSession();
  if (!ctx) return jsonError("نشست فعال نیست.", 401);
  const dash = await getSecurityDashboard(ctx.user.id, ctx.session.sid);
  if (!dash) return jsonError("نشست فعال نیست.", 401);
  return json({ ok: true, ...dash });
}

export async function POST(request: Request) {
  const ctx = await requireActiveSession();
  if (!ctx) return jsonError("نشست فعال نیست.", 401);
  const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
  if (!body || typeof body.action !== "string") return jsonError("درخواست نامعتبر است.");
  const ip = await clientIp();
  const userId = ctx.user.id;
  const action = body.action;

  if (action === "twostep-enable") {
    const result = await enableTwoStep(userId, String(body.password ?? ""), ip);
    if (!result.ok) return jsonError(result.error, result.status, { retryAfterSec: "retryAfterSec" in result ? result.retryAfterSec : undefined });
    return json({ ok: true, codes: result.codes });
  }
  if (action === "twostep-disable") {
    const result = await disableTwoStep(userId, String(body.password ?? ""), ip);
    if (!result.ok) return jsonError(result.error, result.status);
    return json({ ok: true });
  }
  if (action === "recovery-codes") {
    const result = await rotateRecoveryCodes(userId, String(body.password ?? ""), ip);
    if (!result.ok) return jsonError(result.error, result.status);
    return json({ ok: true, codes: result.codes });
  }
  if (action === "backup-set") {
    const result = await setBackupSecret(userId, String(body.secret ?? ""), ip);
    if (!result.ok) return jsonError(result.error, result.status);
    return json({ ok: true });
  }
  if (action === "backup-clear") {
    const result = await clearBackupSecret(userId, String(body.secret ?? ""), ip);
    if (!result.ok) return jsonError(result.error, result.status);
    return json({ ok: true });
  }
  if (action === "passkey-challenge") {
    const mode = body.mode === "login" ? "login" : "register";
    const result = await issuePasskeyChallenge(userId, mode);
    return json(result);
  }
  if (action === "passkey-register") {
    const result = await registerPasskey(
      userId,
      {
        challengeId: String(body.challengeId ?? ""),
        credentialId: String(body.credentialId ?? ""),
        name: String(body.name ?? "Passkey"),
        clientDataJSON: String(body.clientDataJSON ?? ""),
      },
      ip,
    );
    if (!result.ok) return jsonError(result.error, result.status);
    return json({ ok: true });
  }
  if (action === "passkey-delete") {
    const result = await deletePasskey(userId, String(body.id ?? ""), ip);
    if (!result.ok) return jsonError(result.error, result.status);
    return json({ ok: true });
  }
  if (action === "revoke") {
    const ok = await revokeDevice(userId, String(body.deviceId ?? ""), ip);
    if (!ok) return jsonError("دستگاه یافت نشد یا قبلاً خارج شده.", 404);
    return json({ ok: true });
  }
  if (action === "revoke-others") {
    const n = await revokeAllOtherDevices(userId, ctx.session.sid, ip);
    return json({ ok: true, count: n });
  }
  if (action === "vuln") {
    const result = await fileVulnReport(userId, String(body.summary ?? ""), typeof body.contact === "string" ? body.contact : undefined, ip);
    if (!result.ok) return jsonError(result.error, result.status);
    return json({ ok: true });
  }
  return jsonError("عملیات ناشناخته است.");
}

export async function DELETE(request: Request) {
  const ctx = await requireActiveSession();
  if (!ctx) return jsonError("نشست فعال نیست.", 401);
  const url = new URL(request.url);
  const deviceId = url.searchParams.get("deviceId") ?? "";
  const ip = await clientIp();
  const ok = await revokeDevice(ctx.user.id, deviceId, ip);
  if (!ok) return jsonError("دستگاه یافت نشد.", 404);
  return json({ ok: true });
}
