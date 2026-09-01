import { jsonError } from "@/lib/http";
import { requireActiveUser } from "@/lib/auth";
import { getRecordingForUser } from "@/lib/live";
import { readLiveRecording } from "@/lib/live-files";

type Ctx = { params: Promise<{ id: string }> };

export async function GET(_req: Request, ctx: Ctx) {
  const user = await requireActiveUser();
  if (!user) return jsonError("نشست فعال نیست.", 401);
  const { id } = await ctx.params;
  const result = await getRecordingForUser(user.id, id);
  if (!result.ok) return jsonError(result.error, result.status);
  const bytes = await readLiveRecording(result.rec.hostUserId, result.rec.id);
  if (!bytes) return jsonError("Replay در دسترس نیست.", 404);
  return new Response(new Uint8Array(bytes), {
    headers: {
      "Content-Type": result.rec.mime || "video/webm",
      "Cache-Control": "private, no-store",
      "Content-Disposition": "inline",
    },
  });
}
