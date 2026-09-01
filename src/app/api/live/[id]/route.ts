import { json, jsonError } from "@/lib/http";
import { requireActiveUser } from "@/lib/auth";
import { actLive, deleteRecording, getLive, saveRecordingMeta } from "@/lib/live";
import { deleteLiveRecordingFile, writeLiveRecording } from "@/lib/live-files";
import { randomId } from "@/lib/crypto-utils";
import { LIVE_RECORD_MAX_BYTES } from "@/lib/live-types";

type Ctx = { params: Promise<{ id: string }> };

export async function GET(request: Request, ctx: Ctx) {
  const user = await requireActiveUser();
  if (!user) return jsonError("نشست فعال نیست.", 401);
  const { id } = await ctx.params;
  const invite = new URL(request.url).searchParams.get("invite");
  const result = await getLive(user.id, id, invite);
  if (!result.ok) return jsonError(result.error, result.status);
  return json({ ok: true, live: result.live });
}

export async function POST(request: Request, ctx: Ctx) {
  const user = await requireActiveUser();
  if (!user) return jsonError("نشست فعال نیست.", 401);
  const { id } = await ctx.params;
  const url = new URL(request.url);
  if (url.searchParams.get("record") === "1") {
    const buf = Buffer.from(await request.arrayBuffer());
    if (buf.length > LIVE_RECORD_MAX_BYTES) return jsonError("حجم Recording از سقف بیشتر است.", 413);
    const recId = randomId();
    const wr = await writeLiveRecording(user.id, recId, buf);
    if (!wr.ok) return jsonError(wr.error, 400);
    const meta = await saveRecordingMeta(user.id, id, {
      id: recId,
      size: buf.length,
      durationMs: Number(url.searchParams.get("duration") ?? 0) || 0,
      mime: request.headers.get("content-type") || "video/webm",
    });
    if (!meta.ok) {
      await deleteLiveRecordingFile(user.id, recId);
      return jsonError(meta.error, meta.status);
    }
    return json({ ok: true, recordingId: recId });
  }
  const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
  if (!body?.action || typeof body.action !== "string") return jsonError("عملیات نامعتبر است.");
  if (body.action === "delete-recording") {
    const del = await deleteRecording(user.id, id);
    if (!del.ok) return jsonError(del.error, del.status);
    if (del.recordingId) await deleteLiveRecordingFile(del.hostUserId, del.recordingId);
    return json({ ok: true });
  }
  const result = await actLive(user.id, id, body.action, body);
  if (!result.ok) return jsonError(result.error, result.status);
  return json({ ok: true, live: result.live });
}
