/** Offline / on-device search of decrypted private chat copies. */

import { loadLocalMessages, loadOrCreateThreadKey } from "@/lib/e2ee";
import type { SearchHit, SearchKind } from "@/lib/search-types";
import { blobMatches, booleanMatches, exactPhraseMatches } from "@/lib/search-match";
import { parseSearchQuery } from "@/lib/search-query";

export type LocalThreadHint = {
  id: string;
  peerName: string;
  peerKey: string;
};

function kindOfText(text: string, hint?: string): string {
  if (hint && hint !== "text") return hint;
  if (/https?:\/\//i.test(text)) return "link";
  return "text";
}

function matchesKind(kind: SearchKind, itemKind: string) {
  if (kind === "all" || kind === "messages" || kind === "hashtags" || kind === "mentions") return itemKind === "text" || itemKind === "message" || itemKind === "link";
  if (kind === "photos" || kind === "gifs" || kind === "images") return itemKind === "photo" || itemKind === "gif";
  if (kind === "voice" || kind === "music" || kind === "audio") return itemKind === "voice";
  if (kind === "media") return ["photo", "gif", "video", "voice", "file"].includes(itemKind);
  if (kind === "users" || kind === "groups" || kind === "channels" || kind === "communities" || kind === "bots" || kind === "business" || kind === "products" || kind === "mini") {
    return false;
  }
  if (kind === "chats") return true;
  return true;
}

export async function searchLocalChats(
  threads: LocalThreadHint[],
  q: string,
  opts?: { kind?: SearchKind; from?: string; fromDate?: number; toDate?: number; chatId?: string; exact?: boolean },
): Promise<SearchHit[]> {
  const parsed = parseSearchQuery(q);
  const needle = parsed.needle;
  if ((needle.length < 2 && !parsed.exact && !opts?.exact) || typeof window === "undefined") return [];
  const kind = opts?.kind ?? "all";
  const hits: SearchHit[] = [];
  const pool = opts?.chatId ? threads.filter((t) => t.id === opts.chatId) : threads;
  if (kind === "chats" || kind === "all") {
    for (const thread of pool) {
      if (!blobMatches(`${thread.peerName} ${thread.peerKey}`, needle) && !parsed.exact) continue;
      hits.push({
        id: `chatname:${thread.id}`,
        scope: "chatLocal",
        title: thread.peerName,
        preview: "Search Chats",
        sender: thread.peerName,
        chatName: "چت‌ها",
        date: Date.now(),
        kind: "chat",
        target: { type: "chat", id: thread.id },
      });
    }
    if (kind === "chats") return hits.slice(0, 40);
  }
  for (const thread of pool.slice(0, 80)) {
    try {
      const key = await loadOrCreateThreadKey(thread.id);
      const local = await loadLocalMessages(thread.id, key);
      for (const msg of local) {
        if (opts?.fromDate && msg.createdAt < opts.fromDate) continue;
        if (opts?.toDate && msg.createdAt > opts.toDate) continue;
        const sender = msg.sender === "me" ? "من" : thread.peerName;
        if (opts?.from) {
          const f = opts.from.replace(/^@/, "").toLowerCase();
          if (!sender.toLowerCase().includes(f) && !thread.peerName.toLowerCase().includes(f)) continue;
        }
        const itemKind = kindOfText(msg.text);
        if (!matchesKind(kind, itemKind) && kind !== "all") continue;
        const phrase = opts?.exact || parsed.exact;
        const ok = parsed.bool
          ? booleanMatches(msg.text, parsed.bool)
          : phrase
            ? exactPhraseMatches(msg.text, typeof phrase === "string" ? phrase : needle)
            : msg.text.toLowerCase().includes(needle) || blobMatches(msg.text, needle);
        if (!ok) continue;
        hits.push({
          id: `local:${thread.id}:${msg.id}`,
          scope: "chatLocal",
          title: thread.peerName,
          preview: msg.text.slice(0, 140),
          sender,
          chatName: thread.peerName,
          date: msg.createdAt,
          kind: itemKind,
          target: { type: "chat", id: thread.id, messageId: msg.id },
        });
      }
    } catch {
      /* skip unreadable thread */
    }
  }
  return hits.sort((a, b) => b.date - a.date).slice(0, 40);
}

export function searchDecryptedMessages(
  messages: { id: string; text: string; createdAt: number; sender: "me" | "peer"; kind?: string }[],
  chatName: string,
  threadId: string,
  q: string,
  opts?: { kind?: SearchKind; from?: "me" | "peer"; fromDate?: number; toDate?: number },
) {
  const needle = q.trim().toLowerCase();
  if (needle.length < 1) return [];
  return messages.filter((m) => {
    if (opts?.from && m.sender !== opts.from) return false;
    if (opts?.fromDate && m.createdAt < opts.fromDate) return false;
    if (opts?.toDate && m.createdAt > opts.toDate) return false;
    const kind = m.kind ?? "text";
    if (opts?.kind && opts.kind !== "all" && !matchesKind(opts.kind, kind) && opts.kind !== "messages") {
      if (!(opts.kind === "links" && /https?:\/\//i.test(m.text))) return false;
    }
    const blob = `${m.text} ${kind}`.toLowerCase();
    return blob.includes(needle) || kind === needle || blobMatches(m.text, q);
  }).map((m) => ({
    id: m.id,
    preview: (m.text || m.kind || "").slice(0, 140),
    sender: m.sender === "me" ? "من" : chatName,
    date: m.createdAt,
    kind: m.kind ?? "text",
    threadId,
  }));
}
