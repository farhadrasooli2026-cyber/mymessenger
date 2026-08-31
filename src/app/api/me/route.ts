import { json, jsonError } from "@/lib/http";
import { requireActiveSession } from "@/lib/auth";
import { markLogout, recentSecurityNotices, touchDevice } from "@/lib/security";
import { clientIp, clientUserAgent, clearSession } from "@/lib/session";

export async function GET() {
  const ctx = await requireActiveSession();
  if (!ctx) return jsonError("نشست فعال نیست.", 401);
  await touchDevice(ctx.session.sid, await clientIp(), await clientUserAgent());
  const notices = await recentSecurityNotices(ctx.user.id);
  return json({ ok: true, user: ctx.profile, notices });
}

export async function DELETE() {
  const ctx = await requireActiveSession();
  if (ctx) {
    await markLogout(ctx.user.id, ctx.session.sid, await clientIp());
  }
  await clearSession();
  return json({ ok: true });
}
