import { json, jsonError } from "@/lib/http";
import { requireActiveUser } from "@/lib/auth";
import { getGroup } from "@/lib/groups";
import { listUploadedChunks, readMediaChunk, saveMediaChunk } from "@/lib/media-files";
import { MEDIA_MAX_CHUNKS } from "@/lib/media";
import { gateFileDownload, gateFileUpload } from "@/lib/file-access";
import { readStoreSnapshot } from "@/lib/store";

type Ctx = { params: Promise<{ id: string; blobId: string; index: string }> };

export async function PUT(request: Request, ctx: Ctx) {
  const user = await requireActiveUser();
  if (!user) return jsonError("نشست فعال نیست.", 401);
  const { id, blobId, index } = await ctx.params;
  const g = await getGroup(user.id, id);
  if (!g) return jsonError("گروه یافت نشد.", 404);
  if (g.group.perms.sendFiles === false && g.group.myRole !== "owner" && g.group.myRole !== "admin") {
    return jsonError("ارسال فایل در این گروه محدود است.", 403);
  }
  const gated = await gateFileUpload(user.id);
  if (!gated.ok) return jsonError(gated.error, gated.status);
  const n = Number(index);
  if (!Number.isInteger(n) || n < 0 || n >= MEDIA_MAX_CHUNKS) return jsonError("تکه نامعتبر است.");
  const rec = (await request.json().catch(() => null)) as { enc?: string; ciphertext?: string; nonce?: string } | null;
  if (!rec || rec.enc !== "e2ee-v1" || typeof rec.ciphertext !== "string" || typeof rec.nonce !== "string") {
    return jsonError("فقط تکهٔ رمزنگاری‌شده پذیرفته می‌شود.");
  }
  const saved = await saveMediaChunk(user.id, blobId, n, JSON.stringify({ enc: rec.enc, ciphertext: rec.ciphertext, nonce: rec.nonce }));
  if (!saved.ok) return jsonError(saved.error);
  const done = await listUploadedChunks(user.id, blobId);
  return json({ ok: true, uploaded: done });
}

export async function GET(_request: Request, ctx: Ctx) {
  const user = await requireActiveUser();
  if (!user) return jsonError("نشست فعال نیست.", 401);
  const { id, blobId, index } = await ctx.params;
  const g = await getGroup(user.id, id);
  if (!g) return jsonError("گروه یافت نشد.", 404);
  const msg = g.messages.find((m) => m.blobId === blobId && !m.deleted);
  if (!msg) return jsonError("فایل در دسترس نیست.", 404);
  const gated = await gateFileDownload(user.id, blobId);
  if (!gated.ok) return jsonError(gated.error, gated.status);
  const n = Number(index);
  const owner = msg.senderKey;
  const data = await readStoreSnapshot();
  const stillMember = data.groups
    .find((row) => row.id === id)
    ?.members.some((m) => m.key === user.id && !m.leftAt);
  if (!stillMember) return jsonError("عضو این گروه نیستی.", 403);
  const raw = await readMediaChunk(owner, blobId, n);
  if (!raw) return jsonError("تکه یافت نشد.", 404);
  try {
    return json({ ok: true, chunk: JSON.parse(raw) });
  } catch {
    return jsonError("تکه نامعتبر است.");
  }
}
