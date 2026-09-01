import { json, jsonError } from "@/lib/http";
import { requireActiveSession } from "@/lib/auth";
import {
  cancelDeletion,
  confirmIdentifierChange,
  deactivateAccount,
  getAccount,
  reactivateAccount,
  scheduleDeletion,
  startDeletionChallenge,
  startIdentifierChange,
  updateAccountPrefs,
} from "@/lib/account";
import { RETENTION_POLICY } from "@/lib/account-types";
import { isDemoInboxEnabled } from "@/lib/env-config";
import { getOutbox } from "@/lib/outbox";
import { revokeAllDevices } from "@/lib/security";
import { clientIp, clearSession } from "@/lib/session";

export async function GET() {
  const ctx = await requireActiveSession();
  if (!ctx) return jsonError("نشست فعال نیست.", 401);
  const account = await getAccount(ctx.user.id);
  if (!account) return jsonError("نشست فعال نیست.", 401);
  return json({ ok: true, account, policy: RETENTION_POLICY });
}

export async function POST(request: Request) {
  const ctx = await requireActiveSession();
  if (!ctx) return jsonError("نشست فعال نیست.", 401);
  const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
  if (!body || typeof body.action !== "string") return jsonError("درخواست نامعتبر است.");
  const ip = await clientIp();
  const userId = ctx.user.id;

  if (body.action === "delete-otp") {
    const result = await startDeletionChallenge(userId, ip);
    if (!result.ok) return jsonError(result.error, result.status);
    const inbox = isDemoInboxEnabled() ? getOutbox(result.challengeId) : null;
    return json({ ok: true, challengeId: result.challengeId, masked: result.masked, inbox: inbox?.body ?? null });
  }
  if (body.action === "delete-confirm") {
    const result = await scheduleDeletion(
      userId,
      {
        phrase: String(body.phrase ?? ""),
        code: typeof body.code === "string" ? body.code : undefined,
        challengeId: typeof body.challengeId === "string" ? body.challengeId : undefined,
        password: typeof body.password === "string" ? body.password : undefined,
      },
      ip,
      ctx.session.sid,
    );
    if (!result.ok) return jsonError(result.error, result.status);
    return json(result);
  }
  if (body.action === "delete-cancel") {
    const result = await cancelDeletion(userId, ip);
    if (!result.ok) return jsonError(result.error, result.status);
    return json(result);
  }
  if (body.action === "change-start") {
    const channel = body.channel === "email" ? "email" : "phone";
    const result = await startIdentifierChange(userId, channel, String(body.identifier ?? ""), ip);
    if (!result.ok) return jsonError(result.error, result.status);
    const inbox = isDemoInboxEnabled() ? getOutbox(result.challengeId) : null;
    return json({ ok: true, challengeId: result.challengeId, masked: result.masked, inbox: inbox?.body ?? null });
  }
  if (body.action === "change-confirm") {
    const result = await confirmIdentifierChange(
      userId,
      { code: String(body.code ?? ""), password: typeof body.password === "string" ? body.password : undefined },
      ip,
    );
    if (!result.ok) return jsonError(result.error, result.status);
    return json(result);
  }
  if (body.action === "logout-all") {
    await revokeAllDevices(userId, ip);
    await clearSession();
    return json({ ok: true, next: "/" });
  }
  if (body.action === "deactivate") {
    const result = await deactivateAccount(userId, String(body.phrase ?? ""), ip);
    if (!result.ok) return jsonError(result.error, result.status);
    return json(result);
  }
  if (body.action === "reactivate") {
    const result = await reactivateAccount(userId, ip);
    if (!result.ok) return jsonError(result.error, result.status);
    return json(result);
  }
  if (body.action === "prefs") {
    const result = await updateAccountPrefs(userId, body);
    if (!result.ok) return jsonError(result.error, result.status);
    return json(result);
  }
  return jsonError("عملیات ناشناخته است.");
}
