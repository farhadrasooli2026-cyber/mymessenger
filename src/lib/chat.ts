import "server-only";
import { randomId } from "@/lib/crypto-utils";
import { SEED_PEERS } from "@/lib/chat-copy";
import { blockState } from "@/lib/safety";
import { mutateStore, readStoreSnapshot } from "@/lib/store";
import type { ChatMessage, StoreData } from "@/lib/store";

export const envelopeSchemaShape = {
  enc: "e2ee-v1",
  ciphertextMin: 8,
  ciphertextMax: 24_000,
  nonceMin: 8,
  nonceMax: 128,
} as const;

export type CipherPayload = {
  enc: "e2ee-v1";
  ciphertext: string;
  nonce: string;
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
  if (ciphertext.length < 8 || ciphertext.length > 24_000) return null;
  if (nonce.length < 8 || nonce.length > 128) return null;
  if (!B64.test(ciphertext) || !B64.test(nonce)) return null;
  return { enc: "e2ee-v1", ciphertext, nonce };
}

export function publicMessage(message: ChatMessage) {
  return {
    id: message.id,
    threadId: message.threadId,
    sender: message.sender,
    createdAt: message.createdAt,
    enc: message.enc,
    ciphertext: message.ciphertext,
    nonce: message.nonce,
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
    const threads = data.threads
      .filter((t) => t.ownerUserId === userId)
      .sort((a, b) => b.updatedAt - a.updatedAt)
      .map((thread) => {
        const msgs = data.messages
          .filter((m) => m.threadId === thread.id && m.ownerUserId === userId)
          .sort((a, b) => a.createdAt - b.createdAt);
        const last = msgs[msgs.length - 1];
        const safety = blockState(data, userId, thread.peerKey);
        return {
          ...thread,
          lastEnc: last?.enc ?? null,
          lastCiphertext: last?.ciphertext ?? null,
          lastNonce: last?.nonce ?? null,
          lastAt: last?.createdAt ?? thread.updatedAt,
          ...safety,
        };
      });
    return threads;
  });
}

export async function listMessages(userId: string, threadId: string) {
  const data = await readStoreSnapshot();
  const thread = data.threads.find((t) => t.id === threadId && t.ownerUserId === userId);
  if (!thread) return null;
  const messages = data.messages
    .filter((m) => m.threadId === threadId && m.ownerUserId === userId)
    .sort((a, b) => a.createdAt - b.createdAt)
    .map(publicMessage);
  return { thread, messages, ...blockState(data, userId, thread.peerKey) };
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
    };
    data.messages.push(mine);
    thread.updatedAt = now;
    const messages = data.messages
      .filter((m) => m.threadId === threadId && m.ownerUserId === userId)
      .sort((a, b) => a.createdAt - b.createdAt)
      .map(publicMessage);
    return { ok: true as const, thread, messages, ...safety };
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
