import "server-only";
import { randomId } from "@/lib/crypto-utils";
import { SEED_PEERS } from "@/lib/chat-copy";
import { blockState } from "@/lib/safety";
import { mutateStore, readStoreSnapshot } from "@/lib/store";
import type { ChatMessage, StoreData } from "@/lib/store";
import { DELETE_EVERYONE_MS, VOICE_CIPHER_MAX, VOICE_MAX_MS } from "@/lib/voice";

export type CipherPayload = {
  enc: "e2ee-v1";
  ciphertext: string;
  nonce: string;
  kind?: "text" | "voice";
  durationMs?: number;
  viewOnce?: boolean;
  disappearAfterMs?: number | null;
  forwarded?: boolean;
};

const B64 = /^[A-Za-z0-9+/]+=*$/;

export function parseCipherPayload(body: unknown): CipherPayload | null {
  if (!body || typeof body !== "object") return null;
  const rec = body as Record<string, unknown>;
  if ("text" in rec && rec.text != null && rec.text !== "") return null;
  if (rec.enc !== "e2ee-v1") return null;
  if (typeof rec.ciphertext !== "string" || typeof rec.nonce !== "string") return null;
  const ciphertext = rec.ciphertext.trim();
  const nonce = rec.nonce.trim();
  const kind = rec.kind === "voice" ? "voice" : "text";
  const max = kind === "voice" ? VOICE_CIPHER_MAX : 24_000;
  if (ciphertext.length < 8 || ciphertext.length > max) return null;
  if (nonce.length < 8 || nonce.length > 128) return null;
  if (!B64.test(ciphertext) || !B64.test(nonce)) return null;
  let disappearAfterMs: number | null = null;
  if (typeof rec.disappearAfterMs === "number" && rec.disappearAfterMs > 0) {
    disappearAfterMs = Math.min(7 * 24 * 60 * 60 * 1000, Math.floor(rec.disappearAfterMs));
  }
  let durationMs: number | undefined;
  if (kind === "voice" && typeof rec.durationMs === "number") {
    durationMs = Math.min(VOICE_MAX_MS, Math.max(0, Math.floor(rec.durationMs)));
  }
  return {
    enc: "e2ee-v1",
    ciphertext,
    nonce,
    kind,
    durationMs,
    viewOnce: kind === "voice" ? Boolean(rec.viewOnce) : false,
    disappearAfterMs,
    forwarded: Boolean(rec.forwarded),
  };
}

function expireIfNeeded(message: ChatMessage, now: number): ChatMessage {
  if (message.enc !== "e2ee-v1") return message;
  if (message.expiresAt && now >= message.expiresAt) {
    return purgeContent(message, now);
  }
  if (message.disappearAfterMs && message.disappearAfterMs > 0 && now >= message.createdAt + message.disappearAfterMs) {
    return purgeContent(message, now);
  }
  return message;
}

function purgeContent(message: ChatMessage, now: number): ChatMessage {
  message.enc = "purged";
  message.ciphertext = "";
  message.nonce = "";
  message.expiresAt = message.expiresAt ?? now;
  return message;
}

export function publicMessage(message: ChatMessage, userId: string, now = Date.now()) {
  const live = expireIfNeeded(message, now);
  if (live.hiddenFor?.includes(userId)) return null;
  const expired = live.enc !== "e2ee-v1";
  return {
    id: live.id,
    threadId: live.threadId,
    sender: live.sender,
    createdAt: live.createdAt,
    enc: live.enc,
    ciphertext: expired ? "" : live.ciphertext,
    nonce: expired ? "" : live.nonce,
    kind: live.kind ?? "text",
    durationMs: live.durationMs ?? null,
    viewOnce: Boolean(live.viewOnce),
    disappearAfterMs: live.disappearAfterMs ?? null,
    expiresAt: live.expiresAt ?? null,
    viewedAt: live.viewedAt ?? null,
    playCount: live.playCount ?? 0,
    deletedEverywhere: Boolean(live.deletedEverywhere),
    expired,
    forwarded: Boolean(live.forwarded),
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
  return mutateStore((data) => {
    seedInbox(data, userId);
    const now = Date.now();
    const threads = data.threads
      .filter((t) => t.ownerUserId === userId)
      .sort((a, b) => b.updatedAt - a.updatedAt)
      .map((thread) => {
        const msgs = data.messages
          .filter((m) => m.threadId === thread.id && m.ownerUserId === userId && !m.hiddenFor?.includes(userId))
          .sort((a, b) => a.createdAt - b.createdAt);
        const last = msgs[msgs.length - 1];
        const live = last ? expireIfNeeded(last, now) : null;
        const safety = blockState(data, userId, thread.peerKey);
        return {
          ...thread,
          lastKind: live?.kind ?? null,
          lastEnc: live?.enc ?? null,
          lastCiphertext: live?.kind === "voice" || live?.enc !== "e2ee-v1" ? null : live?.ciphertext ?? null,
          lastNonce: live?.kind === "voice" || live?.enc !== "e2ee-v1" ? null : live?.nonce ?? null,
          lastAt: live?.createdAt ?? thread.updatedAt,
          ...safety,
        };
      });
    return threads;
  });
}

export async function listMessages(userId: string, threadId: string) {
  return mutateStore((data) => {
    const thread = data.threads.find((t) => t.id === threadId && t.ownerUserId === userId);
    if (!thread) return null;
    const now = Date.now();
    const messages = data.messages
      .filter((m) => m.threadId === threadId && m.ownerUserId === userId)
      .sort((a, b) => a.createdAt - b.createdAt)
      .map((m) => publicMessage(m, userId, now))
      .filter((m): m is NonNullable<typeof m> => Boolean(m));
    return { thread, messages, ...blockState(data, userId, thread.peerKey) };
  });
}

export async function sendMessage(userId: string, threadId: string, payload: CipherPayload) {
  return mutateStore((data) => {
    seedInbox(data, userId);
    const thread = data.threads.find((t) => t.id === threadId && t.ownerUserId === userId);
    if (!thread) return { ok: false as const, error: "گفتگو یافت نشد.", status: 404 };
    const safety = blockState(data, userId, thread.peerKey);
    if (!safety.messagesAllowed) {
      return {
        ok: false as const,
        error: "پیام، تماس و تعامل با این شخص محدود شده است.",
        status: 403,
      };
    }
    if (payload.viewOnce && payload.kind !== "voice") {
      return { ok: false as const, error: "View Once فقط برای پیام صوتی این برش است.", status: 400 };
    }
    const now = Date.now();
    const mine: ChatMessage = {
      id: randomId(),
      threadId,
      ownerUserId: userId,
      sender: "me",
      enc: "e2ee-v1",
      ciphertext: payload.ciphertext,
      nonce: payload.nonce,
      createdAt: now,
      kind: payload.kind ?? "text",
      durationMs: payload.durationMs,
      viewOnce: Boolean(payload.viewOnce),
      disappearAfterMs: payload.disappearAfterMs ?? null,
      expiresAt: payload.disappearAfterMs ? now + payload.disappearAfterMs : null,
      viewedAt: null,
      playCount: 0,
      hiddenFor: [],
      deletedEverywhere: false,
      forwarded: Boolean(payload.forwarded),
    };
    data.messages.push(mine);
    thread.updatedAt = now;
    const messages = data.messages
      .filter((m) => m.threadId === threadId && m.ownerUserId === userId)
      .sort((a, b) => a.createdAt - b.createdAt)
      .map((m) => publicMessage(m, userId, now))
      .filter((m): m is NonNullable<typeof m> => Boolean(m));
    return { ok: true as const, thread, messages, ...safety };
  });
}

export async function deleteMessage(
  userId: string,
  threadId: string,
  messageId: string,
  scope: "me" | "everyone",
) {
  return mutateStore((data) => {
    const thread = data.threads.find((t) => t.id === threadId && t.ownerUserId === userId);
    if (!thread) return { ok: false as const, error: "گفتگو یافت نشد.", status: 404 };
    const message = data.messages.find((m) => m.id === messageId && m.threadId === threadId && m.ownerUserId === userId);
    if (!message) return { ok: false as const, error: "پیام یافت نشد.", status: 404 };
    const now = Date.now();
    if (scope === "everyone") {
      if (message.sender !== "me") {
        return { ok: false as const, error: "فقط فرستنده می‌تواند برای همه حذف کند.", status: 403 };
      }
      if (now - message.createdAt > DELETE_EVERYONE_MS) {
        return { ok: false as const, error: "مهلت حذف برای همه گذشته است.", status: 403 };
      }
      purgeContent(message, now);
      message.deletedEverywhere = true;
    } else {
      if (!message.hiddenFor) message.hiddenFor = [];
      if (!message.hiddenFor.includes(userId)) message.hiddenFor.push(userId);
    }
    return { ok: true as const };
  });
}

export async function markVoicePlayed(userId: string, threadId: string, messageId: string) {
  return mutateStore((data) => {
    const message = data.messages.find((m) => m.id === messageId && m.threadId === threadId && m.ownerUserId === userId);
    if (!message) return { ok: false as const, error: "پیام یافت نشد.", status: 404 };
    if (message.kind !== "voice") return { ok: false as const, error: "این پیام صوتی نیست.", status: 400 };
    const now = Date.now();
    message.viewedAt = message.viewedAt ?? now;
    message.playCount = (message.playCount ?? 0) + 1;
    if (message.viewOnce) {
      purgeContent(message, now);
    }
    expireIfNeeded(message, now);
    return { ok: true as const, message: publicMessage(message, userId, now) };
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
