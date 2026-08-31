import { json, jsonError } from "@/lib/http";
import { requireActiveUser } from "@/lib/auth";
import { listMessages } from "@/lib/chat";
import { listUploadedChunks, saveMediaChunk } from "@/lib/media-files";
import { blockState } from "@/lib/safety";
import { readStoreSnapshot } from "@/lib/store";
import { MEDIA_MAX_CHUNKS } from "@/lib/media";

type Ctx = { params: Promise<{ id: string; blobId: string; index: string }> };

async function assertThread(userId: string, threadId: string) {
  const data = await readStoreSnapshot();
  const thread = data.threads.find((t) => t.id === threadId && t.ownerUserId === userId);
  if (!thread) return null;
  const safety = blockState(data, userId, thread.peerKey);
  if (!safety.messagesAllowed) return { blocked: true as const };
  return { thread, blocked: false as const };
}

export async function PUT(request: Request, ctx: Ctx) {
  const user = await requireActiveUser();
  if (!user) return jsonError("نشست فعال نیست.", 401);
  const { id, blobId, index } = await ctx.params;
  const access = await assertThread(user.id, id);
  if (!access) return jsonError("گفتگو یافت نشد.", 404);
  if (access.blocked) return jsonError("ارسال محدود شده است.", 403);
  const n = Number(index);
  if (!Number.isInteger(n) || n < 0 || n >= MEDIA_MAX_CHUNKS) return jsonError("تکه نامعتبر است.");
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return jsonError("درخواست نامعتبر است.");
  }
  const rec = body as { enc?: string; ciphertext?: string; nonce?: string };
  if (rec.enc !== "e2ee-v1" || typeof rec.ciphertext !== "string" || typeof rec.nonce !== "string") {
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
  const listed = await listMessages(user.id, id);
  if (!listed) return jsonError("گفتگو یافت نشد.", 404);
  const msg = listed.messages.find((m) => m.blobId === blobId);
  if (!msg || msg.expired) return jsonError("رسانه در دسترس نیست.", 404);
  const n = Number(index);
  const { readMediaChunk } = await import("@/lib/media-files");
  const raw = await readMediaChunk(user.id, blobId, n);
  if (!raw) return jsonError("تکه یافت نشد.", 404);
  try {
    return json({ ok: true, chunk: JSON.parse(raw) });
  } catch {
    return jsonError("تکه نامعتبر است.");
  }
}
