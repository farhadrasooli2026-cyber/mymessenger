import { json, jsonError } from "@/lib/http";
import { requireActiveSession, requireDevicePending } from "@/lib/auth";
import { approveDevice, listUserDevices, publicDevice, revokeAllOtherDevices, revokeDevice } from "@/lib/security";
import { clientIp, writeSession } from "@/lib/session";
import { readStoreSnapshot } from "@/lib/store";

export async function GET() {
  const pending = await requireDevicePending();
  if (pending?.session.sid) {
    const data = await readStoreSnapshot();
    const d = (data.devices ?? []).find((x) => x.id === pending.session.sid);
    if (!d || d.revokedAt) return jsonError("نشست دستگاه باطل شده است.", 401);
    return json({
      ok: true,
      wait: true,
      device: publicDevice(d, d.id),
      approved: Boolean(d.trusted && !d.pending),
    });
  }
  const ctx = await requireActiveSession();
  if (!ctx) return jsonError("نشست فعال نیست.", 401);
  const list = await listUserDevices(ctx.user.id, ctx.session.sid);
  return json({ ok: true, wait: false, ...list });
}

export async function POST(request: Request) {
  const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
  if (!body || typeof body.action !== "string") return jsonError("درخواست نامعتبر است.");
  const ip = await clientIp();

  if (body.action === "activate") {
    const pending = await requireDevicePending();
    if (!pending?.session.sid) return jsonError("در انتظار تأیید دستگاه نیستید.", 401);
    const data = await readStoreSnapshot();
    const d = (data.devices ?? []).find((x) => x.id === pending.session.sid && x.userId === pending.user.id);
    if (!d || d.revokedAt) return jsonError("دسترسی این دستگاه قطع شد.", 403);
    if (d.pending || !d.trusted) return jsonError("هنوز توسط دستگاه مورد اعتماد تأیید نشده است.", 403);
    await writeSession({
      step: "complete",
      challengeId: pending.session.challengeId,
      userId: pending.user.id,
      sid: d.id,
      purpose: pending.session.purpose,
    });
    return json({ ok: true, next: "/app" });
  }

  const ctx = await requireActiveSession();
  if (!ctx) return jsonError("نشست فعال نیست.", 401);

  if (body.action === "approve") {
    const result = await approveDevice(ctx.user.id, String(body.deviceId ?? ""), ctx.session.sid, ip);
    if (!result.ok) return jsonError(result.error, result.status);
    return json({ ok: true });
  }
  if (body.action === "logout" || body.action === "remove") {
    const ok = await revokeDevice(ctx.user.id, String(body.deviceId ?? ""), ip);
    if (!ok) return jsonError("دستگاه یافت نشد.", 404);
    return json({ ok: true });
  }
  if (body.action === "logout-others") {
    const n = await revokeAllOtherDevices(ctx.user.id, ctx.session.sid, ip);
    return json({ ok: true, count: n });
  }
  return jsonError("عملیات ناشناخته است.");
}
