import { json, jsonError } from "@/lib/http";
import { requireActiveUser } from "@/lib/auth";
import { getGroup } from "@/lib/groups";
import { listUploadedChunks } from "@/lib/media-files";
import { authorizeGroupBlob } from "@/lib/media-share";

type Ctx = { params: Promise<{ id: string; blobId: string }> };

export async function GET(_request: Request, ctx: Ctx) {
  const user = await requireActiveUser();
  if (!user) return jsonError("نشست فعال نیست.", 401);
  const { id, blobId } = await ctx.params;
  const g = await getGroup(user.id, id);
  if (!g) return jsonError("گروه یافت نشد.", 404);
  const access = await authorizeGroupBlob(user.id, id, blobId);
  if (access.ok) {
    const done = await listUploadedChunks(access.storageUserId, blobId);
    return json({ ok: true, uploaded: done, messageId: access.messageId });
  }
  if (!/^[a-f0-9]{8,64}$/i.test(blobId)) return jsonError("شناسه فایل نامعتبر است.");
  const mine = await listUploadedChunks(user.id, blobId);
  return json({ ok: true, uploaded: mine, resume: true });
}
