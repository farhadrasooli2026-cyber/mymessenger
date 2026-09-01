import { json, jsonError } from "@/lib/http";
import { requireActiveUser } from "@/lib/auth";
import { listUploadedChunks } from "@/lib/media-files";
import { authorizeChatBlob, authorizeChatBlobUpload } from "@/lib/media-share";

type Ctx = { params: Promise<{ id: string; blobId: string }> };

export async function GET(_request: Request, ctx: Ctx) {
  const user = await requireActiveUser();
  if (!user) return jsonError("نشست فعال نیست.", 401);
  const { id, blobId } = await ctx.params;
  const upload = await authorizeChatBlobUpload(user.id, id, blobId);
  if (!upload.ok) return jsonError(upload.error, upload.status);
  const access = await authorizeChatBlob(user.id, id, blobId);
  if (access.ok) {
    const done = await listUploadedChunks(access.storageUserId, blobId);
    const mine = await listUploadedChunks(user.id, blobId);
    const uploaded = [...new Set([...done, ...mine])].sort((a, b) => a - b);
    return json({ ok: true, uploaded, threadId: id, messageId: access.messageId });
  }
  const mine = await listUploadedChunks(user.id, blobId);
  return json({ ok: true, uploaded: mine, threadId: id, resume: true });
}
