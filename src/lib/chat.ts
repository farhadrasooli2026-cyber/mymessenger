import "server-only";
import { randomId } from "@/lib/crypto-utils";
import { SEED_PEERS } from "@/lib/chat-copy";
import { blockState } from "@/lib/safety";
import { canMessageUser } from "@/lib/privacy";
import { postingBlocked } from "@/lib/account-gate";
import { hitRateLimit } from "@/lib/rate-limit";
import { mutateStore, readStoreSnapshot } from "@/lib/store";
import type { ChatMessage, StoreData } from "@/lib/store";
import { DELETE_EVERYONE_MS, VOICE_CIPHER_MAX, VOICE_MAX_MS, VOICE_SEND_PER_MIN, validateVoiceDuration } from "@/lib/voice";
import { MEDIA_MAX_CHUNKS, MEDIA_MAX_BYTES } from "@/lib/media";
import { deleteMediaBlob } from "@/lib/media-files";
import { emitNotification } from "@/lib/notify";
import { publicReactionView, historicalStickerView } from "@/lib/stickers";
import { publishChatLive } from "@/lib/chat-live";
import { clampLimit, decodeCursor, encodeCursor } from "@/lib/db/query";
import {
  DISAPPEAR_MAX_MS,
  expireFromForKind,
  isMessageExpired,
} from "@/lib/disappear";

export type CipherPayload = {
  enc: "e2ee-v1";
  ciphertext: string;
  nonce: string;
  kind?: "text" | "voice" | "photo" | "video" | "file" | "location" | "contact";
  durationMs?: number;
  viewOnce?: boolean;
  clientNonce?: string;
  /** undefined = inherit chat timer; 0 = this message has no timer */
  disappearAfterMs?: number | null;
  forwarded?: boolean;
  blobId?: string;
  chunkCount?: number;
  byteLength?: number;
  mimeClass?: "image" | "video" | "file" | "audio";
  replyToId?: string;
};

export const TEXT_SEND_PER_MIN = 36;
export const TEXT_FLOOD_MAX = 10;
export const TEXT_FLOOD_MS = 8_000;
export const EDIT_LIMIT_MS = 15 * 60 * 1000;
export const MSG_PAGE_MAX = 80;

const B64 = /^[A-Za-z0-9+/]+=*$/;

export function parseCipherPayload(body: unknown): CipherPayload | null {
  if (!body || typeof body !== "object") return null;
  const rec = body as Record<string, unknown>;
  if ("text" in rec && rec.text != null && rec.text !== "") return null;
  if (rec.enc !== "e2ee-v1") return null;
  if (typeof rec.ciphertext !== "string" || typeof rec.nonce !== "string") return null;
  const ciphertext = rec.ciphertext.trim();
  const nonce = rec.nonce.trim();
  const kindRaw = rec.kind;
  const kind =
    kindRaw === "voice" ||
    kindRaw === "photo" ||
    kindRaw === "video" ||
    kindRaw === "file" ||
    kindRaw === "location" ||
    kindRaw === "contact"
      ? kindRaw
      : "text";
  const media = kind === "photo" || kind === "video" || kind === "file";
  const max = kind === "voice" ? VOICE_CIPHER_MAX : media ? 80_000 : 24_000;
  if (ciphertext.length < 8 || ciphertext.length > max) return null;
  if (nonce.length < 8 || nonce.length > 128) return null;
  if (!B64.test(ciphertext) || !B64.test(nonce)) return null;
  let blobId: string | undefined;
  let chunkCount: number | undefined;
  let byteLength: number | undefined;
  let mimeClass: CipherPayload["mimeClass"];
  if (media) {
    if (typeof rec.blobId !== "string" || !/^[a-f0-9]{8,64}$/i.test(rec.blobId)) return null;
    const chunks = Number(rec.chunkCount);
    const bytes = Number(rec.byteLength);
    if (!Number.isInteger(chunks) || chunks < 1 || chunks > MEDIA_MAX_CHUNKS) return null;
    if (!Number.isInteger(bytes) || bytes < 1 || bytes > MEDIA_MAX_BYTES) return null;
    blobId = rec.blobId;
    chunkCount = chunks;
    byteLength = bytes;
    mimeClass =
      rec.mimeClass === "image" || rec.mimeClass === "video" || rec.mimeClass === "audio" || rec.mimeClass === "file"
        ? rec.mimeClass
        : kind === "photo"
          ? "image"
          : kind === "video"
            ? "video"
            : "file";
  }
  let disappearAfterMs: number | null | undefined;
  if ("disappearAfterMs" in rec) {
    const raw = rec.disappearAfterMs;
    if (raw === null || raw === 0) disappearAfterMs = 0;
    else if (typeof raw === "number" && raw > 0) {
      disappearAfterMs = Math.min(DISAPPEAR_MAX_MS, Math.floor(raw));
    } else disappearAfterMs = 0;
  }
  let durationMs: number | undefined;
  if ((kind === "voice" || kind === "video") && typeof rec.durationMs === "number") {
    durationMs = Math.min(kind === "voice" ? VOICE_MAX_MS : 30 * 60 * 1000, Math.max(0, Math.floor(rec.durationMs)));
  }
  if (kind === "voice") {
    const d = validateVoiceDuration(durationMs);
    if (!d.ok) return null;
    durationMs = d.ms;
  }
  const clientNonce = typeof rec.clientNonce === "string" && rec.clientNonce.length >= 8 && rec.clientNonce.length <= 80 ? rec.clientNonce : undefined;
  const viewOnceOk = kind === "voice" || kind === "photo" || kind === "video";
  return {
    enc: "e2ee-v1",
    ciphertext,
    nonce,
    kind,
    durationMs,
    viewOnce: viewOnceOk ? Boolean(rec.viewOnce) : false,
    disappearAfterMs,
    forwarded: Boolean(rec.forwarded),
    blobId,
    chunkCount,
    byteLength,
    mimeClass,
    clientNonce,
    replyToId: typeof rec.replyToId === "string" && /^[a-zA-Z0-9_-]{8,80}$/.test(rec.replyToId) ? rec.replyToId : undefined,
  };
}

function expireIfNeeded(message: ChatMessage, now: number, blobs: string[]): ChatMessage {
  if (message.kind === "system") return message;
  if (message.enc !== "e2ee-v1") return message;
  if (!isMessageExpired(message, now)) return message;
  return purgeContent(message, now, blobs);
}

function purgeContent(message: ChatMessage, now: number, blobs: string[] = []): ChatMessage {
  if (message.blobId) blobs.push(message.blobId);
  message.enc = "purged";
  message.ciphertext = "";
  message.nonce = "";
  message.expiresAt = message.expiresAt ?? now;
  message.blobId = undefined;
  return message;
}

export function publicMessage(message: ChatMessage, userId: string, now = Date.now(), blobs: string[] = [], data?: StoreData) {
  const live = expireIfNeeded(message, now, blobs);
  if (live.hiddenFor?.includes(userId)) return null;
  const expired = live.kind !== "system" && live.kind !== "sticker" && live.enc !== "e2ee-v1";
  return {
    id: live.id,
    threadId: live.threadId,
    sender: live.sender,
    createdAt: live.createdAt,
    enc: live.kind === "system" || live.kind === "sticker" ? ("e2ee-v1" as const) : live.enc,
    ciphertext: expired || live.kind === "system" || live.kind === "sticker" ? "" : live.ciphertext,
    nonce: expired || live.kind === "system" ? "" : live.nonce,
    kind: live.kind ?? "text",
    durationMs: live.durationMs ?? null,
    viewOnce: Boolean(live.viewOnce),
    disappearAfterMs: live.disappearAfterMs ?? null,
    expireFrom: live.expireFrom ?? null,
    expiresAt: live.expiresAt ?? null,
    viewedAt: live.viewedAt ?? null,
    playCount: live.playCount ?? 0,
    deletedEverywhere: Boolean(live.deletedEverywhere),
    expired,
    forwarded: Boolean(live.forwarded),
    blobId: expired ? null : (live.blobId ?? null),
    chunkCount: expired ? null : (live.chunkCount ?? null),
    byteLength: live.byteLength ?? null,
    mimeClass: live.mimeClass ?? null,
    systemEvent: live.systemEvent ?? null,
    captureCount: live.captureCount ?? 0,
    stickerId: live.kind === "sticker" ? live.stickerId ?? null : null,
    stickerUrl:
      live.kind === "sticker" && live.stickerId
        ? historicalStickerView(data ?? ({} as StoreData), live.stickerId, userId).stickerUrl
        : null,
    stickerMissing:
      live.kind === "sticker" ? historicalStickerView(data ?? ({} as StoreData), live.stickerId, userId).stickerMissing : false,
    reactions: publicReactionView((data ?? ({} as unknown as StoreData)), live.reactions, userId),
    clientNonce: live.clientNonce ?? null,
    replyToId: live.replyToId ?? null,
    syncId: live.syncId ?? null,
    editedAt: live.editedAt ?? null,
    editCount: live.editCount ?? 0,
    deliveredAt: live.deliveredAt ?? null,
    readAt: live.readAt ?? null,
    state: live.deletedEverywhere
      ? ("deleted" as const)
      : live.readAt
        ? ("read" as const)
        : live.deliveredAt
          ? ("delivered" as const)
          : ("sent" as const),
  };
}

export function seedInbox(data: StoreData, userId: string, now = Date.now()): void {
  if (data.threads.some((t) => t.ownerUserId === userId)) return;
  SEED_PEERS.forEach((peer, index) => {
    data.threads.push({
      id: randomId(),
      ownerUserId: userId,
      peerKey: peer.peerKey,
      peerName: peer.peerName,
      peerTitle: peer.peerTitle,
      color: peer.color,
      updatedAt: now - (SEED_PEERS.length - index) * 60_000,
    });
  });
}

export async function listThreads(userId: string) {
  const blobs: string[] = [];
  const threads = await mutateStore((data) => {
    seedInbox(data, userId);
    const now = Date.now();
    return data.threads
      .filter((t) => t.ownerUserId === userId)
      .sort((a, b) => b.updatedAt - a.updatedAt)
      .map((thread) => {
        const msgs = data.messages
          .filter((m) => m.threadId === thread.id && m.ownerUserId === userId && !m.hiddenFor?.includes(userId))
          .sort((a, b) => a.createdAt - b.createdAt);
        const last = msgs[msgs.length - 1];
        const live = last ? expireIfNeeded(last, now, blobs) : null;
        const safety = blockState(data, userId, thread.peerKey);
        return {
          ...thread,
          disappearAfterMs: thread.disappearAfterMs ?? null,
          lastKind: live?.kind ?? null,
          lastEnc: live?.enc ?? null,
          lastCiphertext: !live || live.kind !== "text" || live.enc !== "e2ee-v1" ? null : live.ciphertext,
          lastNonce: !live || live.kind !== "text" || live.enc !== "e2ee-v1" ? null : live.nonce,
          lastAt: live?.createdAt ?? thread.updatedAt,
          ...safety,
        };
      });
  });
  await Promise.all(blobs.map((id) => deleteMediaBlob(userId, id)));
  return threads;
}

const PEER_COLORS = ["#34d399", "#7dd3fc", "#fbbf24", "#c4b5fd", "#fda4af", "#67e8f9"];

function ensurePeerThread(data: StoreData, fromId: string, toUser: { id: string; displayName?: string; username?: string | null }, now: number) {
  let thread = data.threads.find((t) => t.ownerUserId === toUser.id && t.peerKey === fromId);
  if (thread) return thread;
  const from = data.users.find((u) => u.id === fromId);
  thread = {
    id: randomId(),
    ownerUserId: toUser.id,
    peerKey: fromId,
    peerName: from?.displayName || from?.username || "کاربر نیکسو",
    peerTitle: from?.username ? `@${from.username}` : "گفتگوی خصوصی",
    color: PEER_COLORS[fromId.charCodeAt(0) % PEER_COLORS.length]!,
    updatedAt: now,
  };
  data.threads.push(thread);
  return thread;
}

function twinsOf(data: StoreData, message: ChatMessage): ChatMessage[] {
  if (message.syncId) return data.messages.filter((m) => m.syncId === message.syncId);
  return data.messages.filter(
    (m) => m.nonce === message.nonce && m.ciphertext === message.ciphertext && m.createdAt === message.createdAt,
  );
}

export type ChatLiveHit = { userId: string; threadId: string; type: "message" | "edit" | "delete" | "read" | "typing" | "ack" };

function threadPublic(data: StoreData, userId: string, threadId: string, now: number, blobs: string[]) {
  return data.messages
    .filter((m) => m.threadId === threadId && m.ownerUserId === userId)
    .sort((a, b) => a.createdAt - b.createdAt || a.id.localeCompare(b.id))
    .map((m) => publicMessage(m, userId, now, blobs, data))
    .filter((m): m is NonNullable<typeof m> => Boolean(m));
}

function peerTypingInThisChat(data: StoreData, userId: string, peerId: string, now: number) {
  const peer = data.users.find((u) => u.id === peerId);
  if (!peer?.showTyping || peer.typingUntil <= now || !peer.typingThreadId) return false;
  const theirThread = data.threads.find((t) => t.id === peer.typingThreadId && t.ownerUserId === peer.id);
  return Boolean(theirThread && theirThread.peerKey === userId);
}

export async function listMessages(
  userId: string,
  threadId: string,
  opts?: { cursor?: string | null; limit?: number; since?: number },
) {
  const blobs: string[] = [];
  const result = await readStoreSnapshot().then((data) => {
    const thread = data.threads.find((t) => t.id === threadId && t.ownerUserId === userId);
    if (!thread) return null;
    const now = Date.now();
    let rows = data.messages
      .filter((m) => m.threadId === threadId && m.ownerUserId === userId)
      .sort((a, b) => a.createdAt - b.createdAt || a.id.localeCompare(b.id));
    if (opts?.since && Number.isFinite(opts.since)) {
      rows = rows.filter((m) => m.createdAt > opts.since!);
    }
    const mapped = rows
      .map((m) => publicMessage(m, userId, now, blobs, data))
      .filter((m): m is NonNullable<typeof m> => Boolean(m));
    const limit = Math.min(MSG_PAGE_MAX, clampLimit(opts?.limit ?? 80));
    const unread = rows.filter((m) => m.sender === "peer" && !m.readAt && !m.deletedEverywhere && m.enc === "e2ee-v1").length;
    const typing = peerTypingInThisChat(data, userId, thread.peerKey, now);
    const safety = blockState(data, userId, thread.peerKey);
    if (opts?.since && Number.isFinite(opts.since) && !opts.cursor) {
      const page = mapped.slice(0, limit);
      const last = page[page.length - 1];
      return {
        thread,
        messages: page,
        nextCursor: mapped.length > page.length && last ? encodeCursor(last.createdAt, last.id) : null,
        unreadCount: unread,
        typing,
        ...safety,
      };
    }
    const desc = [...mapped].reverse();
    const cur = decodeCursor(opts?.cursor);
    const after = cur
      ? desc.filter((m) => m.createdAt < cur.createdAt || (m.createdAt === cur.createdAt && m.id < cur.id))
      : desc;
    const pageDesc = after.slice(0, limit);
    const last = pageDesc[pageDesc.length - 1];
    const messages = [...pageDesc].reverse();
    return {
      thread,
      messages,
      nextCursor: after.length > pageDesc.length && last ? encodeCursor(last.createdAt, last.id) : null,
      unreadCount: unread,
      typing,
      ...safety,
    };
  });
  await Promise.all(blobs.map((id) => deleteMediaBlob(userId, id)));
  return result;
}

export async function sendMessage(userId: string, threadId: string, payload: CipherPayload) {
  const blobs: string[] = [];
  const result = await mutateStore((data) => {
    seedInbox(data, userId);
    const thread = data.threads.find((t) => t.id === threadId && t.ownerUserId === userId);
    if (!thread) return { ok: false as const, error: "گفتگو یافت نشد.", status: 404 };
    const gated = postingBlocked(data.users.find((u) => u.id === userId));
    if (gated.blocked) return { ok: false as const, error: gated.error, status: 403 };
    const safety = blockState(data, userId, thread.peerKey);
    if (!safety.messagesAllowed) {
      return {
        ok: false as const,
        error: "پیام، تماس و تعامل با این شخص محدود شده است.",
        status: 403,
      };
    }
    if (!canMessageUser(data, userId, thread.peerKey)) {
      return { ok: false as const, error: "این کاربر پیام مستقیم را محدود کرده است.", status: 403 };
    }
    if (payload.viewOnce && payload.kind !== "voice" && payload.kind !== "photo" && payload.kind !== "video") {
      return { ok: false as const, error: "View Once فقط برای صوت، عکس و ویدیو است.", status: 400 };
    }
    const now = Date.now();
    if (payload.clientNonce) {
      const existing = data.messages.find(
        (m) => m.ownerUserId === userId && m.threadId === threadId && m.clientNonce === payload.clientNonce && !m.deletedEverywhere,
      );
      if (existing) {
        return {
          ok: true as const,
          thread,
          messages: threadPublic(data, userId, threadId, now, blobs),
          ...safety,
          duplicate: true,
          ack: { serverId: existing.id, clientNonce: payload.clientNonce, createdAt: existing.createdAt },
          live: [] as ChatLiveHit[],
        };
      }
    }
    const inherit =
      typeof thread.disappearAfterMs === "number" && thread.disappearAfterMs > 0 ? thread.disappearAfterMs : null;
    const disappearAfterMs =
      payload.disappearAfterMs === undefined
        ? inherit
        : payload.disappearAfterMs && payload.disappearAfterMs > 0
          ? payload.disappearAfterMs
          : null;
    const kind = payload.kind ?? "text";
    if (kind === "text" || kind === "location" || kind === "contact") {
      const flood = hitRateLimit(data, `text:up:${userId}`, 60_000, TEXT_SEND_PER_MIN, now);
      if (!flood.allowed) return { ok: false as const, error: "ارسال پیام پیاپی محدود شد.", status: 429 };
      const burst = hitRateLimit(data, `text:flood:${userId}`, TEXT_FLOOD_MS, TEXT_FLOOD_MAX, now);
      if (!burst.allowed) return { ok: false as const, error: "ارسال سریع شناسایی شد.", status: 429 };
    }
    if (kind === "photo" || kind === "video" || kind === "file") {
      const flood = hitRateLimit(data, `file:up:${userId}`, 60_000, 24, now);
      if (!flood.allowed) return { ok: false as const, error: "ارسال فایل پیاپی محدود شد.", status: 429 };
      const dup = data.messages.find(
        (m) =>
          m.ownerUserId === userId &&
          Boolean(m.blobId) &&
          m.blobId === payload.blobId &&
          !m.deletedEverywhere &&
          now - m.createdAt < 180_000,
      );
      if (dup) {
        return {
          ok: true as const,
          thread,
          messages: threadPublic(data, userId, threadId, now, blobs),
          ...safety,
          duplicate: true,
          ack: { serverId: dup.id, clientNonce: dup.clientNonce ?? null, createdAt: dup.createdAt },
          live: [] as ChatLiveHit[],
        };
      }
    }
    if (kind === "voice") {
      const d = validateVoiceDuration(payload.durationMs);
      if (!d.ok) return { ok: false as const, error: d.error, status: 400 };
      const flood = hitRateLimit(data, `voice:up:${userId}`, 60_000, VOICE_SEND_PER_MIN, now);
      if (!flood.allowed) return { ok: false as const, error: "ارسال صوت پیاپی محدود شد.", status: 429 };
      const dup = data.messages.find(
        (m) =>
          m.ownerUserId === userId &&
          m.kind === "voice" &&
          m.nonce === payload.nonce &&
          m.ciphertext === payload.ciphertext &&
          !m.deletedEverywhere &&
          !(m.hiddenFor ?? []).includes(userId) &&
          now - m.createdAt < 120_000,
      );
      if (dup) {
        return {
          ok: true as const,
          thread,
          messages: threadPublic(data, userId, threadId, now, blobs),
          ...safety,
          duplicate: true,
          ack: { serverId: dup.id, clientNonce: dup.clientNonce ?? null, createdAt: dup.createdAt },
          live: [] as ChatLiveHit[],
        };
      }
    }
    let replyToId: string | undefined;
    if (payload.replyToId) {
      const orig = data.messages.find(
        (m) => m.id === payload.replyToId && m.threadId === threadId && m.ownerUserId === userId && !m.deletedEverywhere,
      );
      if (!orig || orig.hiddenFor?.includes(userId)) {
        return { ok: false as const, error: "پیام اصلی در این گفتگو نیست.", status: 400 };
      }
      replyToId = orig.id;
    }
    const viewOnce = Boolean(payload.viewOnce);
    const expireFrom = expireFromForKind(kind === "location" || kind === "contact" ? "text" : kind, viewOnce, disappearAfterMs);
    const expiresAt = expireFrom === "send" && disappearAfterMs ? now + disappearAfterMs : null;
    const syncId = randomId();
    const mine: ChatMessage = {
      id: randomId(),
      threadId,
      ownerUserId: userId,
      sender: "me",
      enc: "e2ee-v1",
      ciphertext: payload.ciphertext,
      nonce: payload.nonce,
      createdAt: now,
      kind,
      durationMs: payload.durationMs,
      viewOnce,
      disappearAfterMs,
      expireFrom,
      expiresAt,
      viewedAt: null,
      playCount: 0,
      hiddenFor: [],
      deletedEverywhere: false,
      forwarded: Boolean(payload.forwarded),
      blobId: payload.blobId,
      chunkCount: payload.chunkCount,
      byteLength: payload.byteLength,
      mimeClass: payload.mimeClass,
      clientNonce: payload.clientNonce,
      replyToId: replyToId ?? null,
      syncId,
      deliveredAt: null,
      readAt: null,
      editCount: 0,
      editedAt: null,
    };
    data.messages.push(mine);
    thread.updatedAt = now;
    const live: ChatLiveHit[] = [{ userId, threadId, type: "message" }];
    const peer = data.users.find((u) => u.id === thread.peerKey && u.status === "active");
    const meUser = data.users.find((u) => u.id === userId);
    data.inboxMetas ??= [];
    const myMeta = data.inboxMetas.find((m) => m.ownerUserId === userId && m.id === `dm:${threadId}`);
    if (myMeta?.archivedAt && meUser?.archiveUnarchiveOnNew !== false) myMeta.archivedAt = null;
    if (peer) {
      const peerThread = ensurePeerThread(data, userId, peer, now);
      let peerReply: string | undefined;
      if (replyToId) {
        const orig = data.messages.find((m) => m.id === replyToId);
        if (orig?.syncId) {
          const twin = data.messages.find((m) => m.ownerUserId === peer.id && m.syncId === orig.syncId);
          peerReply = twin?.id;
        }
      }
      data.messages.push({
        ...mine,
        id: randomId(),
        threadId: peerThread.id,
        ownerUserId: peer.id,
        sender: "peer",
        clientNonce: undefined,
        replyToId: peerReply ?? null,
        deliveredAt: now,
      });
      mine.deliveredAt = now;
      peerThread.updatedAt = now;
      live.push({ userId: peer.id, threadId: peerThread.id, type: "message" });
      const key = `dm:${peerThread.id}`;
      const meta = data.inboxMetas.find((m) => m.ownerUserId === peer.id && m.id === key);
      if (meta?.archivedAt && peer.archiveUnarchiveOnNew !== false) meta.archivedAt = null;
      const sender = data.users.find((u) => u.id === userId);
      const label = sender?.displayName || sender?.username || "مخاطب";
      emitNotification(data, {
        userId: peer.id,
        category: "messages",
        kind: kind === "voice" ? "voice" : "message",
        title: label,
        senderName: label,
        body:
          kind === "voice"
            ? "پیام صوتی جدید"
            : kind === "file" || kind === "photo" || kind === "video"
              ? "فایل جدید"
              : "پیام رمزنگاری‌شده جدید",
        e2ee: true,
        sourceId: `chat:${userId}`,
        muteType: "chat",
        muteId: peerThread.id,
        target: { type: "chat", id: peerThread.id },
      });
    }
    return {
      ok: true as const,
      thread,
      messages: threadPublic(data, userId, threadId, now, blobs),
      ...safety,
      ack: { serverId: mine.id, clientNonce: payload.clientNonce ?? null, createdAt: now, state: mine.deliveredAt ? "delivered" : "sent" },
      live,
      duplicate: false,
    };
  });
  await Promise.all(blobs.map((id) => deleteMediaBlob(userId, id)));
  if (result.ok) {
    for (const hit of result.live) publishChatLive(hit.userId, hit.threadId, hit.type);
  }
  return result;
}

export async function deleteMessage(
  userId: string,
  threadId: string,
  messageId: string,
  scope: "me" | "everyone",
) {
  const result = await mutateStore(async (data) => {
    const thread = data.threads.find((t) => t.id === threadId && t.ownerUserId === userId);
    if (!thread) return { ok: false as const, error: "گفتگو یافت نشد.", status: 404 };
    const message = data.messages.find((m) => m.id === messageId && m.threadId === threadId && m.ownerUserId === userId);
    if (!message) return { ok: false as const, error: "پیام یافت نشد.", status: 404 };
    const now = Date.now();
    const live: ChatLiveHit[] = [{ userId, threadId, type: "delete" }];
    if (scope === "everyone") {
      if (message.sender !== "me") {
        return { ok: false as const, error: "فقط فرستنده می‌تواند برای همه حذف کند.", status: 403 };
      }
      if (now - message.createdAt > DELETE_EVERYONE_MS) {
        return { ok: false as const, error: "مهلت حذف برای همه گذشته است.", status: 403 };
      }
      const blobId = message.blobId;
      for (const copy of twinsOf(data, message)) {
        purgeContent(copy, now);
        copy.deletedEverywhere = true;
        live.push({ userId: copy.ownerUserId, threadId: copy.threadId, type: "delete" });
      }
      if (blobId) {
        for (const copy of data.messages) {
          if (copy.blobId === blobId) {
            purgeContent(copy, now);
            copy.deletedEverywhere = true;
          }
        }
        await deleteMediaBlob(userId, blobId);
      }
    } else {
      if (!message.hiddenFor) message.hiddenFor = [];
      if (!message.hiddenFor.includes(userId)) message.hiddenFor.push(userId);
    }
    return { ok: true as const, live };
  });
  if (result.ok) {
    for (const hit of result.live) publishChatLive(hit.userId, hit.threadId, hit.type);
  }
  return result;
}

export async function editMessage(userId: string, threadId: string, messageId: string, payload: CipherPayload) {
  const result = await mutateStore((data) => {
    const now = Date.now();
    const limit = hitRateLimit(data, `edit:${userId}`, 60_000, 24, now);
    if (!limit.allowed) return { ok: false as const, error: "ویرایش محدود شد.", status: 429 };
    const thread = data.threads.find((t) => t.id === threadId && t.ownerUserId === userId);
    if (!thread) return { ok: false as const, error: "گفتگو یافت نشد.", status: 404 };
    const message = data.messages.find((m) => m.id === messageId && m.threadId === threadId && m.ownerUserId === userId);
    if (!message) return { ok: false as const, error: "پیام یافت نشد.", status: 404 };
    if (message.sender !== "me") return { ok: false as const, error: "فقط صاحب پیام می‌تواند ویرایش کند.", status: 403 };
    if (message.deletedEverywhere || message.enc !== "e2ee-v1") {
      return { ok: false as const, error: "این پیام قابل ویرایش نیست.", status: 409 };
    }
    const kind = message.kind ?? "text";
    if (kind !== "text" && kind !== "location" && kind !== "contact") {
      return { ok: false as const, error: "فقط متن قابل ویرایش است.", status: 400 };
    }
    if (now - message.createdAt > EDIT_LIMIT_MS) {
      return { ok: false as const, error: "مهلت ویرایش گذشته است.", status: 403 };
    }
    const live: ChatLiveHit[] = [];
    for (const copy of twinsOf(data, message)) {
      copy.ciphertext = payload.ciphertext;
      copy.nonce = payload.nonce;
      copy.editedAt = now;
      copy.editCount = (copy.editCount ?? 0) + 1;
      live.push({ userId: copy.ownerUserId, threadId: copy.threadId, type: "edit" });
    }
    return {
      ok: true as const,
      message: publicMessage(message, userId, now, [], data),
      live,
    };
  });
  if (result.ok) {
    for (const hit of result.live) publishChatLive(hit.userId, hit.threadId, hit.type);
  }
  return result;
}

export async function markThreadRead(userId: string, threadId: string, upTo?: number) {
  const result = await mutateStore((data) => {
    const now = Date.now();
    const flood = hitRateLimit(data, `read:${userId}`, 60_000, 90, now);
    if (!flood.allowed) return { ok: false as const, error: "علامت خوانده‌شده محدود شد.", status: 429 };
    const thread = data.threads.find((t) => t.id === threadId && t.ownerUserId === userId);
    if (!thread) return { ok: false as const, error: "گفتگو یافت نشد.", status: 404 };
    const cap = typeof upTo === "number" && Number.isFinite(upTo) && upTo > 0 ? Math.min(Math.floor(upTo), now) : now;
    const reader = data.users.find((u) => u.id === userId);
    const shareReceipts = reader?.readReceipts !== false;
    const live: ChatLiveHit[] = [{ userId, threadId, type: "read" }];
    const touched: ChatMessage[] = [];
    for (const m of data.messages) {
      if (m.threadId !== threadId || m.ownerUserId !== userId) continue;
      if (m.sender !== "peer") continue;
      if (m.createdAt > cap) continue;
      if (m.deletedEverywhere) continue;
      m.deliveredAt = m.deliveredAt ?? now;
      if (!m.readAt) {
        m.readAt = now;
        touched.push(m);
      }
    }
    data.inboxMetas ??= [];
    const meta = data.inboxMetas.find((row) => row.ownerUserId === userId && row.id === `dm:${threadId}`);
    if (meta) {
      meta.lastReadAt = Math.max(meta.lastReadAt, cap);
      meta.markedUnread = false;
    }
    if (shareReceipts) {
      for (const m of touched) {
        for (const twin of twinsOf(data, m)) {
          if (twin.ownerUserId === userId) continue;
          twin.deliveredAt = twin.deliveredAt ?? now;
          twin.readAt = twin.readAt ?? now;
          live.push({ userId: twin.ownerUserId, threadId: twin.threadId, type: "read" });
        }
      }
    }
    return { ok: true as const, marked: touched.length, live };
  });
  if (result.ok) {
    for (const hit of result.live) publishChatLive(hit.userId, hit.threadId, hit.type);
  }
  return result;
}

export async function markAllDirectRead(userId: string) {
  const data = await readStoreSnapshot();
  const mine = data.threads.filter((t) => t.ownerUserId === userId);
  let marked = 0;
  for (const thread of mine) {
    const r = await markThreadRead(userId, thread.id);
    if (r.ok) marked += r.marked;
  }
  return { ok: true as const, marked };
}

export async function markVoicePlayed(userId: string, threadId: string, messageId: string) {
  const blobs: string[] = [];
  const result = await mutateStore((data) => {
    const message = data.messages.find((m) => m.id === messageId && m.threadId === threadId && m.ownerUserId === userId);
    if (!message) return { ok: false as const, error: "پیام یافت نشد.", status: 404 };
    if (message.kind !== "voice" && message.kind !== "photo" && message.kind !== "video") {
      return { ok: false as const, error: "این پیام یک‌بارمصرف نیست.", status: 400 };
    }
    const playLimit = hitRateLimit(data, `voice:play:${userId}`, 60_000, 80, Date.now());
    if (!playLimit.allowed) return { ok: false as const, error: "درخواست پخش محدود شد.", status: 429 };
    const now = Date.now();
    if (isMessageExpired(message, now)) {
      expireIfNeeded(message, now, blobs);
      return { ok: false as const, error: "این پیام منقضی شده است.", status: 410 };
    }
    message.viewedAt = message.viewedAt ?? now;
    message.playCount = (message.playCount ?? 0) + 1;
    if (message.viewOnce) {
      purgeContent(message, now, blobs);
      message.deletedEverywhere = true;
    } else if (message.expireFrom === "view" && message.disappearAfterMs) {
      message.expiresAt = now + message.disappearAfterMs;
    }
    expireIfNeeded(message, now, blobs);
    return { ok: true as const, message: publicMessage(message, userId, now, blobs, data) };
  });
  await Promise.all(blobs.map((id) => deleteMediaBlob(userId, id)));
  return result;
}

export async function reportCapture(userId: string, threadId: string, messageId: string) {
  return mutateStore((data) => {
    const thread = data.threads.find((t) => t.id === threadId && t.ownerUserId === userId);
    if (!thread) return { ok: false as const, error: "گفتگو یافت نشد.", status: 404 };
    const message = data.messages.find((m) => m.id === messageId && m.threadId === threadId && m.ownerUserId === userId);
    if (!message) return { ok: false as const, error: "پیام یافت نشد.", status: 404 };
    if (!message.viewOnce) return { ok: false as const, error: "فقط محتوای یک‌بارمصرف.", status: 400 };
    const now = Date.now();
    message.captureCount = (message.captureCount ?? 0) + 1;
    data.messages.push({
      id: randomId(),
      threadId,
      ownerUserId: userId,
      sender: "peer",
      enc: "purged",
      ciphertext: "",
      nonce: "",
      createdAt: now,
      kind: "system",
      hiddenFor: [],
      systemEvent: { type: "capture", messageId },
    });
    thread.updatedAt = now;
    return { ok: true as const, captureCount: message.captureCount };
  });
}

export async function setChatDisappear(userId: string, threadId: string, ms: number | null) {
  if (ms !== null && (!Number.isFinite(ms) || ms < 0 || ms > DISAPPEAR_MAX_MS)) {
    return { ok: false as const, error: "زمان نامعتبر است.", status: 400 };
  }
  const next = !ms || ms <= 0 ? null : Math.floor(ms);
  return mutateStore((data) => {
    const thread = data.threads.find((t) => t.id === threadId && t.ownerUserId === userId);
    if (!thread) return { ok: false as const, error: "گفتگو یافت نشد.", status: 404 };
    const now = Date.now();
    thread.disappearAfterMs = next;
    thread.updatedAt = now;
    data.messages.push({
      id: randomId(),
      threadId,
      ownerUserId: userId,
      sender: "me",
      enc: "purged",
      ciphertext: "",
      nonce: "",
      createdAt: now,
      kind: "system",
      hiddenFor: [],
      systemEvent: { type: "disappear", ms: next },
    });
    return { ok: true as const, thread, disappearAfterMs: next };
  });
}

export async function listSharedMedia(userId: string, threadId: string) {
  const blobs: string[] = [];
  const listed = await mutateStore((data) => {
    const thread = data.threads.find((t) => t.id === threadId && t.ownerUserId === userId);
    if (!thread) return null;
    const now = Date.now();
    const items = data.messages
      .filter((m) => m.threadId === threadId && m.ownerUserId === userId)
      .sort((a, b) => a.createdAt - b.createdAt)
      .map((m) => publicMessage(m, userId, now, blobs, data))
      .filter((m): m is NonNullable<typeof m> => Boolean(m))
      .filter(
        (m) =>
          (m.kind === "photo" || m.kind === "video" || m.kind === "file" || m.kind === "voice") &&
          !m.expired &&
          !m.viewOnce,
      );
    return { thread, items, ...blockState(data, userId, thread.peerKey) };
  });
  await Promise.all(blobs.map((id) => deleteMediaBlob(userId, id)));
  return listed;
}

export async function openDm(userId: string, peerId: string) {
  return mutateStore((data) => {
    seedInbox(data, userId);
    if (!peerId || peerId === userId) return { ok: false as const, error: "کاربر نامعتبر است.", status: 400 };
    const from = data.users.find((u) => u.id === userId);
    const to = data.users.find((u) => u.id === peerId && u.status === "active");
    if (!from || !to) return { ok: false as const, error: "کاربر پیدا نشد.", status: 404 };
    const safety = blockState(data, userId, peerId);
    if (!safety.messagesAllowed) {
      return { ok: false as const, error: "پیام، تماس و تعامل با این شخص محدود شده است.", status: 403 };
    }
    if (!canMessageUser(data, userId, peerId)) {
      return { ok: false as const, error: "این کاربر پیام مستقیم را محدود کرده است.", status: 403 };
    }
    const existing = data.threads.find((t) => t.ownerUserId === userId && t.peerKey === peerId);
    const now = Date.now();
    if (existing) {
      existing.updatedAt = now;
      existing.peerName = to.displayName || to.username || existing.peerName;
      return { ok: true as const, thread: existing };
    }
    const thread = {
      id: randomId(),
      ownerUserId: userId,
      peerKey: peerId,
      peerName: to.displayName || to.username || "کاربر نیکسو",
      peerTitle: to.username ? `@${to.username}` : "گفتگوی خصوصی",
      color: PEER_COLORS[peerId.charCodeAt(0) % PEER_COLORS.length]!,
      updatedAt: now,
    };
    data.threads.push(thread);
    return { ok: true as const, thread };
  });
}

export const NIXO_STORY = {
  id: "nixo-origin",
  title: "چرا نیکسو؟",
  body: "نیکسو کپی واتساپ یا تلگرام نیست. یک پلتفرم مستقل برای ارتباط خصوصی، سریع و قابل‌توسعه است؛ از گفتگو تا کسب‌وکار، بدون اینکه کاربر در منو گم شود.",
};

export async function viewStory(userId: string, storyId: string) {
  return mutateStore((data) => {
    if (!data.storyViews.some((v) => v.ownerUserId === userId && v.storyId === storyId)) {
      data.storyViews.push({ ownerUserId: userId, storyId, viewedAt: Date.now() });
    }
    return { ok: true as const, storyId };
  });
}

export async function storyState(userId: string) {
  const data = await readStoreSnapshot();
  const viewed = data.storyViews.some((v) => v.ownerUserId === userId && v.storyId === NIXO_STORY.id);
  return { ...NIXO_STORY, viewed };
}
