import { json, jsonError } from "@/lib/http";
import { requireActiveUser } from "@/lib/auth";
import { getGroup } from "@/lib/groups";
import { listUploadedChunks } from "@/lib/media-files";

type Ctx = { params: Promise<{ id: string; blobId: string }> };

export async function GET(_request: Request, ctx: Ctx) {
  const user = await requireActiveUser();
  if (!user) return jsonError("نشست فعال نیست.", 401);
  const { id, blobId } = await ctx.params;
  const g = await getGroup(user.id, id);
  if (!g) return jsonError("گروه یافت نشد.", 404);
  const done = await listUploadedChunks(user.id, blobId);
  return json({ ok: true, uploaded: done });
}
