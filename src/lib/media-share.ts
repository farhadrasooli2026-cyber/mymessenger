import "server-only";
import { isMessageExpired } from "@/lib/disappear";
import { deleteMediaBlob, listStoredBlobs, readMediaChunk, incompleteTtlMs } from "@/lib/media-files";
import { mutateStore, readStoreSnapshot } from "@/lib/store";
import type { ChatMessage, GroupMessage, MediaJob, StoreData } from "@/lib/store";
import { randomId } from "@/lib/crypto-utils";
import { blockState } from "@/lib/safety";
import { rankRole } from "@/lib/group-types";

export const MEDIA_JOB_RETRY_MAX = 3;

export type BlobAccess =
  | { ok: true; storageUserId: string; messageId: string; kind: string }
  | { ok: false; error: string; status: number };

function liveChatMessage(m: ChatMessage, userId: string, now: number): boolean {
  if (m.deletedEverywhere) return false;
  if (m.hiddenFor?.includes(userId)) return false;
  if (m.enc !== "e2ee-v1") return false;
  if (isMessageExpired(m, now)) return false;
  return Boolean(m.blobId);
}

export async function authorizeChatBlobUpload(userId: string, threadId: string, blobId: string): Promise<BlobAccess | { ok: true; storageUserId: string; messageId: string; kind: string } | { ok: false; error: string; status: number }> {
  if (!/^[a-f0-9]{8,64}$/i.test(blobId)) return { ok: false, error: "شناسه فایل نامعتبر است.", status: 400 };
  const data = await readStoreSnapshot();
  const thread = data.threads.find((t) => t.id === threadId && t.ownerUserId === userId);
  if (!thread) return { ok: false, error: "گفتگو یافت نشد.", status: 404 };
  const safety = blockState(data, userId, thread.peerKey);
  if (!safety.messagesAllowed) return { ok: false, error: "ارسال محدود شده است.", status: 403 };
  const now = Date.now();
  const msg = data.messages.find((m) => m.threadId === threadId && m.ownerUserId === userId && m.blobId === blobId);
  if (msg && msg.sender !== "me") return { ok: false, error: "فقط صاحب فایل می‌تواند آپلود کند.", status: 403 };
  if (msg && !liveChatMessage(msg, userId, now) && msg.deletedEverywhere) {
    return { ok: false, error: "این فایل حذف شده است.", status: 404 };
  }
  return { ok: true, storageUserId: userId, messageId: msg?.id ?? "", kind: msg?.kind ?? "file" };
}

export async function authorizeChatBlob(userId: string, threadId: string, blobId: string): Promise<BlobAccess> {
  if (!/^[a-f0-9]{8,64}$/i.test(blobId)) return { ok: false, error: "شناسه فایل نامعتبر است.", status: 400 };
  const data = await readStoreSnapshot();
  const thread = data.threads.find((t) => t.id === threadId && t.ownerUserId === userId);
  if (!thread) return { ok: false, error: "گفتگو یافت نشد.", status: 404 };
  const safety = blockState(data, userId, thread.peerKey);
  if (!safety.messagesAllowed) return { ok: false, error: "دسترسی به این گفتگو محدود است.", status: 403 };
  const now = Date.now();
  const msg = data.messages.find(
    (m) => m.threadId === threadId && m.ownerUserId === userId && m.blobId === blobId && liveChatMessage(m, userId, now),
  );
  if (!msg) return { ok: false, error: "رسانه در دسترس نیست.", status: 404 };
  const storageUserId = msg.sender === "me" ? userId : thread.peerKey;
  return { ok: true, storageUserId, messageId: msg.id, kind: msg.kind };
}

export async function authorizeGroupBlob(userId: string, groupId: string, blobId: string): Promise<BlobAccess> {
  if (!/^[a-f0-9]{8,64}$/i.test(blobId)) return { ok: false, error: "شناسه فایل نامعتبر است.", status: 400 };
  const data = await readStoreSnapshot();
  const group = data.groups.find((g) => g.id === groupId && !g.deletedAt);
  if (!group) return { ok: false, error: "گروه یافت نشد.", status: 404 };
  const member = group.members.find((m) => m.key === userId && !m.leftAt);
  if (!member) return { ok: false, error: "عضو این گروه نیستی.", status: 403 };
  if (group.bans.some((b) => b.key === userId && (b.until == null || b.until > Date.now()))) {
    return { ok: false, error: "از این گروه بن شده‌ای.", status: 403 };
  }
  const msg = data.groupMessages.find((m) => m.groupId === groupId && m.blobId === blobId && !m.deleted) as GroupMessage | undefined;
  if (!msg?.blobId) return { ok: false, error: "فایل در دسترس نیست.", status: 404 };
  if ((group.historyMode ?? "all") === "from-join" && rankRole(member.role) < 3 && msg.createdAt < member.joinedAt) {
    return { ok: false, error: "تاریخچه برای عضو جدید محدود است.", status: 403 };
  }
  return { ok: true, storageUserId: msg.senderKey, messageId: msg.id, kind: msg.kind ?? "file" };
}

export async function readAuthorizedChunk(storageUserId: string, fallbackUserId: string, blobId: string, index: number) {
  const primary = await readMediaChunk(storageUserId, blobId, index);
  if (primary) return primary;
  if (fallbackUserId !== storageUserId) return readMediaChunk(fallbackUserId, blobId, index);
  return null;
}

export function referencedBlobIds(data: StoreData): Set<string> {
  const ids = new Set<string>();
  for (const m of data.messages) {
    if (m.blobId && !m.deletedEverywhere && m.enc === "e2ee-v1") ids.add(`${m.ownerUserId}:${m.blobId}`);
    if (m.blobId && m.sender === "me" && !m.deletedEverywhere && m.enc === "e2ee-v1") ids.add(`${m.ownerUserId}:${m.blobId}`);
  }
  for (const m of data.groupMessages) {
    if (m.blobId && !m.deleted) ids.add(`${m.senderKey}:${m.blobId}`);
  }
  return ids;
}

export async function sweepOrphanMedia(now = Date.now()) {
  const data = await readStoreSnapshot();
  const live = referencedBlobIds(data);
  const stored = await listStoredBlobs();
  let removed = 0;
  for (const row of stored) {
    const key = `${row.userId}:${row.blobId}`;
    const stale = !live.has(key) && now - row.createdAt > incompleteTtlMs();
    if (stale) {
      await deleteMediaBlob(row.userId, row.blobId);
      removed += 1;
    }
  }
  return { ok: true as const, removed };
}

export async function enqueueMediaJob(userId: string, itemId: string, kind: MediaJob["kind"]) {
  return mutateStore((data) => {
    data.mediaJobs ??= [];
    const job: MediaJob = {
      id: randomId(),
      ownerUserId: userId,
      itemId,
      kind,
      status: "queued",
      retries: 0,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };
    data.mediaJobs.unshift(job);
    data.mediaJobs = data.mediaJobs.slice(0, 400);
    return job;
  });
}

export async function listMediaJobs(userId: string) {
  const data = await readStoreSnapshot();
  return (data.mediaJobs ?? []).filter((j) => j.ownerUserId === userId).slice(0, 40);
}

export async function processMediaJobs(userId: string) {
  return mutateStore((data) => {
    data.mediaJobs ??= [];
    const now = Date.now();
    let ran = 0;
    for (const job of data.mediaJobs) {
      if (job.ownerUserId !== userId) continue;
      if (job.status === "done") continue;
      if (job.status === "failed" && job.retries >= MEDIA_JOB_RETRY_MAX) continue;
      job.status = "running";
      job.updatedAt = now;
      const item = data.galleryItems.find((i) => i.id === job.itemId && i.ownerUserId === userId);
      if (!item || item.deletedAt) {
        job.status = "failed";
        job.lastError = "آیتم نیست.";
        job.retries += 1;
        continue;
      }
      if (job.kind === "scan" && item.mime === "application/octet-stream") {
        job.status = "failed";
        job.lastError = "اسکن نوع فایل ناموفق.";
        job.retries += 1;
        continue;
      }
      job.status = "done";
      job.lastError = undefined;
      ran += 1;
    }
    return { ok: true as const, ran };
  });
}

export async function retryFailedJobs(userId: string) {
  return mutateStore((data) => {
    let n = 0;
    for (const job of data.mediaJobs ?? []) {
      if (job.ownerUserId !== userId || job.status !== "failed") continue;
      if (job.retries >= MEDIA_JOB_RETRY_MAX) continue;
      job.status = "queued";
      n += 1;
    }
    return { ok: true as const, count: n };
  });
}

export function encodeMediaCursor(createdAt: number, id: string) {
  return Buffer.from(`${createdAt}:${id}`, "utf8").toString("base64url");
}

export function decodeMediaCursor(raw: string | undefined | null): { createdAt: number; id: string } | null {
  if (!raw) return null;
  try {
    const [a, b] = Buffer.from(raw, "base64url").toString("utf8").split(":");
    const createdAt = Number(a);
    if (!createdAt || !b) return null;
    return { createdAt, id: b };
  } catch {
    return null;
  }
}

export function applyCursor<T extends { createdAt: number; id: string }>(items: T[], cursor: { createdAt: number; id: string } | null): T[] {
  if (!cursor) return items;
  return items.filter((i) => i.createdAt < cursor.createdAt || (i.createdAt === cursor.createdAt && i.id < cursor.id));
}
