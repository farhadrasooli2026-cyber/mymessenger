import "server-only";
import { randomId } from "@/lib/crypto-utils";
import { hitRateLimit } from "@/lib/rate-limit";
import { mutateStore, readStoreSnapshot } from "@/lib/store";
import type { SavedItem } from "@/lib/store";
import { SAVED_MAX_MEDIA, SAVED_TAGS } from "@/lib/search-types";

function publicSaved(item: SavedItem) {
  return {
    id: item.id,
    kind: item.kind,
    body: item.body,
    linkUrl: item.linkUrl,
    fileName: item.fileName,
    fileType: item.fileType,
    fileSize: item.fileSize,
    media: item.media,
    tag: item.tag,
    pinned: item.pinned,
    source: item.source,
    createdAt: item.createdAt,
  };
}

export async function listSaved(
  userId: string,
  opts?: { q?: string; kind?: string; tag?: string; offset?: number; limit?: number },
) {
  const data = await readStoreSnapshot();
  const q = (opts?.q ?? "").trim().toLowerCase();
  const offset = Math.max(0, opts?.offset ?? 0);
  const limit = Math.min(50, Math.max(1, opts?.limit ?? 40));
  const items = data.savedItems
    .filter((s) => s.ownerUserId === userId && !s.deletedAt)
    .filter((s) => (opts?.kind && opts.kind !== "all" ? s.kind === opts.kind : true))
    .filter((s) => (opts?.tag ? s.tag === opts.tag : true))
    .filter((s) => {
      if (!q) return true;
      return `${s.body} ${s.linkUrl} ${s.fileName} ${s.tag} ${s.kind}`.toLowerCase().includes(q);
    })
    .sort((a, b) => Number(b.pinned) - Number(a.pinned) || b.createdAt - a.createdAt);
  return {
    items: items.slice(offset, offset + limit).map(publicSaved),
    hasMore: offset + limit < items.length,
    nextOffset: offset + Math.min(limit, items.length - offset),
  };
}

export async function saveItem(
  userId: string,
  input: Partial<SavedItem> & { kind: SavedItem["kind"] },
) {
  return mutateStore((data) => {
    const now = Date.now();
    const flood = hitRateLimit(data, `saved:${userId}`, 60_000, 40, now);
    if (!flood.allowed) return { ok: false as const, error: "ذخیره محدود شد.", status: 429 };
    const media = typeof input.media === "string" ? input.media : "";
    if (media.length > SAVED_MAX_MEDIA) return { ok: false as const, error: "حجم رسانه زیاد است.", status: 413 };
    const tag = SAVED_TAGS.includes(input.tag as (typeof SAVED_TAGS)[number]) ? (input.tag as string) : (input.tag ?? "").slice(0, 24);
    const item: SavedItem = {
      id: randomId(),
      ownerUserId: userId,
      kind: input.kind,
      body: (input.body ?? "").slice(0, 2000),
      linkUrl: /^https?:\/\//i.test(input.linkUrl ?? "") ? (input.linkUrl ?? "").slice(0, 400) : "",
      fileName: (input.fileName ?? "").slice(0, 120),
      fileType: (input.fileType ?? "").slice(0, 40),
      fileSize: Math.max(0, Number(input.fileSize) || 0),
      media,
      tag,
      pinned: Boolean(input.pinned),
      source: input.source ?? null,
      createdAt: now,
      deletedAt: null,
    };
    data.savedItems.push(item);
    return { ok: true as const, item: publicSaved(item) };
  });
}

export async function patchSaved(
  userId: string,
  id: string,
  patch: { tag?: string; pinned?: boolean },
) {
  return mutateStore((data) => {
    const item = data.savedItems.find((s) => s.id === id && s.ownerUserId === userId && !s.deletedAt);
    if (!item) return { ok: false as const, error: "یافت نشد.", status: 404 };
    if (typeof patch.tag === "string") item.tag = patch.tag.slice(0, 24);
    if (typeof patch.pinned === "boolean") item.pinned = patch.pinned;
    return { ok: true as const, item: publicSaved(item) };
  });
}

export async function deleteSaved(userId: string, ids: string[]) {
  return mutateStore((data) => {
    const now = Date.now();
    let n = 0;
    for (const id of ids.slice(0, 80)) {
      const item = data.savedItems.find((s) => s.id === id && s.ownerUserId === userId && !s.deletedAt);
      if (!item) continue;
      item.deletedAt = now;
      n += 1;
    }
    return { ok: true as const, removed: n };
  });
}

export async function getSaved(userId: string, id: string) {
  const data = await readStoreSnapshot();
  const item = data.savedItems.find((s) => s.id === id && s.ownerUserId === userId && !s.deletedAt);
  if (!item) return null;
  return publicSaved(item);
}
