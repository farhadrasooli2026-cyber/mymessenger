import "server-only";
import { createHmac, timingSafeEqual } from "node:crypto";
import { randomId } from "@/lib/crypto-utils";
import { config } from "@/lib/config";
import { hitRateLimit } from "@/lib/rate-limit";
import { mutateStore } from "@/lib/store";
import type { ChatMessage, StickerItem, StickerPack, StickerPrefs, StoreData } from "@/lib/store";
import { sniffMagic } from "@/lib/media";
import { emitNotification } from "@/lib/notify";
import { blockState } from "@/lib/safety";
import { canMessageUser } from "@/lib/privacy";
import { DEFAULT_REACTIONS, isLikelyEmoji, normalizeEmoji, reactionAllowed } from "@/lib/emoji-data";

export const STICKER_TOKEN_MS = 15 * 60_000;
export const STICKER_STATIC_MAX = 128 * 1024;
export const STICKER_ANIM_MAX = 256 * 1024;
export const STICKER_MAX_DIM = 512;
export const STICKER_MIN_DIM = 32;

const SVG_FACE = (fill: string, extra = "") =>
  `data:image/svg+xml;utf8,${encodeURIComponent(
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><circle cx="32" cy="32" r="30" fill="${fill}"/><circle cx="22" cy="26" r="4" fill="#102824"/><circle cx="42" cy="26" r="4" fill="#102824"/><path d="M18 40 Q32 52 46 40" fill="none" stroke="#102824" stroke-width="3"/>${extra}</svg>`,
  )}`;

const SVG_SPIN = `data:image/svg+xml;utf8,${encodeURIComponent(
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><circle cx="32" cy="32" r="28" fill="#34d399"><animateTransform attributeName="transform" type="rotate" from="0 32 32" to="360 32 32" dur="2s" repeatCount="indefinite"/></circle><text x="32" y="38" text-anchor="middle" font-size="18" fill="#102824">N</text></svg>`,
)}`;

export function defaultStickerPrefs(userId: string): StickerPrefs {
  return {
    userId,
    emojiRecent: [],
    emojiFavorites: [],
    stickerRecent: [],
    stickerFavorites: [],
    installedPackIds: [],
    reactionPrivacy: "everyone",
    reactionNotify: true,
    suggestions: true,
    customEmoji: true,
  };
}

export function prefsOf(data: StoreData, userId: string): StickerPrefs {
  data.stickerPrefs ??= [];
  let row = data.stickerPrefs.find((p) => p.userId === userId);
  if (!row) {
    row = defaultStickerPrefs(userId);
    data.stickerPrefs.push(row);
  }
  return row;
}

export function allowedReactionSet(list: string[] | null | undefined): string[] {
  if (list === null) return [...DEFAULT_REACTIONS];
  if (Array.isArray(list)) return list.filter((e) => isLikelyEmoji(e)).slice(0, 24);
  return [...DEFAULT_REACTIONS];
}

export type ReactionIntent = "add" | "remove" | "toggle";

export function applyUserReaction(
  rows: { id?: string; emoji: string; keys: string[] }[] | undefined,
  userId: string,
  emoji: string,
  allowed: string[],
  extra?: { intent?: ReactionIntent },
):
  | { ok: true; rows: { id?: string; emoji: string; keys: string[] }[]; action: "add" | "remove" | "change" | "noop" }
  | { ok: false; error: string } {
  const safe = normalizeEmoji(emoji).slice(0, 24);
  const intent = extra?.intent ?? "toggle";
  if (intent !== "remove" && !isLikelyEmoji(safe)) return { ok: false, error: "ایموجی نامعتبر است." };
  if (allowed.length === 0) return { ok: false, error: "واکنش در این گفتگو خاموش است." };
  if (intent !== "remove" && !reactionAllowed(allowed, safe)) return { ok: false, error: "این واکنش مجاز نیست." };
  const current = rows?.find((r) => r.keys.includes(userId))?.emoji ?? null;
  if (intent === "add" && current === safe) {
    return { ok: true, rows: rows ?? [], action: "noop" };
  }
  if (intent === "remove") {
    if (!current) return { ok: true, rows: rows ?? [], action: "noop" };
    if (safe && isLikelyEmoji(safe) && current !== safe) {
      return { ok: true, rows: rows ?? [], action: "noop" };
    }
  }
  const hadSame = Boolean(rows?.some((r) => r.emoji === safe && r.keys.includes(userId)));
  const hadOther = Boolean(current && current !== safe);
  if (intent === "toggle" && hadSame) {
    const nextOff = (rows ?? [])
      .map((r) => ({ ...r, keys: r.keys.filter((k) => k !== userId) }))
      .filter((r) => r.keys.length > 0);
    return { ok: true, rows: nextOff, action: "remove" };
  }
  if (intent === "remove") {
    const nextOff = (rows ?? [])
      .map((r) => ({ ...r, keys: r.keys.filter((k) => k !== userId) }))
      .filter((r) => r.keys.length > 0);
    return { ok: true, rows: nextOff, action: "remove" };
  }
  const next = (rows ?? []).map((r) => ({ ...r, keys: r.keys.filter((k) => k !== userId) })).filter((r) => r.keys.length > 0);
  const row = next.find((r) => r.emoji === safe);
  if (row) row.keys.push(userId);
  else next.push({ id: randomId(), emoji: safe, keys: [userId] });
  return { ok: true, rows: next, action: hadOther ? "change" : "add" };
}

export function rememberReactionNonce(data: StoreData, key: string, action: string) {
  data.reactionIdempotency = [
    { key, at: Date.now(), action },
    ...(data.reactionIdempotency ?? []).filter((x) => x.key !== key && Date.now() - x.at < 10 * 60_000),
  ].slice(0, 400);
}

export function replayReactionNonce(data: StoreData, key: string | null) {
  if (!key) return null;
  const hit = (data.reactionIdempotency ?? []).find((x) => x.key === key && Date.now() - x.at < 10 * 60_000);
  return hit ?? null;
}

export function putReactionCache(data: StoreData, targetKey: string, rows: { emoji: string; keys: string[] }[] | undefined) {
  const counts: Record<string, number> = {};
  for (const r of rows ?? []) counts[r.emoji] = r.keys.length;
  data.reactionCountCache = [
    { key: targetKey, counts, at: Date.now() },
    ...(data.reactionCountCache ?? []).filter((x) => x.key !== targetKey),
  ].slice(0, 400);
}

function bumpAnalytics(data: StoreData, userId: string, field: keyof StoreData["stickerAnalytics"]) {
  const user = data.users.find((u) => u.id === userId);
  if (!user?.prefs?.consents?.analytics) return;
  data.stickerAnalytics ??= { reactions: 0, stickersSent: 0, packsInstalled: 0, customOps: 0 };
  data.stickerAnalytics[field] += 1;
}

const PLACEHOLDER_STICKER = `data:image/svg+xml;utf8,${encodeURIComponent(
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><rect width="64" height="64" rx="12" fill="#1a3a34"/><text x="32" y="38" text-anchor="middle" font-size="11" fill="#9ca3af">حذف‌شده</text></svg>`,
)}`;

export function historicalStickerView(data: StoreData, stickerId: string | undefined, userId: string) {
  if (!stickerId) return { stickerMissing: true as const, stickerUrl: null as string | null };
  const item = data.stickers?.find((s) => s.id === stickerId);
  if (!item) {
    return { stickerMissing: true as const, stickerUrl: `/api/stickers/file/${stickerId}?t=${signStickerFile(stickerId, userId)}` };
  }
  const pack = data.stickerPacks?.find((p) => p.id === item.packId);
  const gone = Boolean(item.deletedAt) || Boolean(pack?.deletedAt);
  return {
    stickerMissing: gone,
    stickerUrl: `/api/stickers/file/${stickerId}?t=${signStickerFile(stickerId, userId)}`,
  };
}

export function publicReactionView(
  data: StoreData,
  rows: { emoji: string; keys: string[] }[] | undefined,
  viewerId: string,
) {
  const viewer = data.users.find((u) => u.id === viewerId);
  return (rows ?? []).map((r) => {
    const users = r.keys
      .map((id) => {
        if (id === viewerId) return { id, username: "شما", visible: true };
        const u = data.users.find((x) => x.id === id);
        const prefs = data.stickerPrefs?.find((p) => p.userId === id)?.reactionPrivacy ?? "everyone";
        const contact =
          Boolean(viewer?.contactIds?.includes(id)) || Boolean(u?.contactIds?.includes(viewerId));
        const visible = prefs === "everyone" || (prefs === "contacts" && contact);
        return {
          id: visible ? id : `hidden:${id.slice(0, 4)}`,
          username: visible ? u?.username || u?.displayName || "کاربر" : "پنهان",
          visible,
        };
      })
      .filter((u) => u.visible || u.id.startsWith("hidden:"));
    return {
      emoji: r.emoji,
      count: r.keys.length,
      mine: r.keys.includes(viewerId),
      users: users.filter((u) => u.visible),
    };
  });
}

function face(id: string, packId: string, name: string, emoji: string, fill: string, tags: string[]): StickerItem {
  return {
    id,
    packId,
    name,
    emoji,
    tags,
    kind: "static",
    mime: "image/svg+xml",
    payload: SVG_FACE(fill),
    w: 64,
    h: 64,
    bytes: 420,
  };
}

export function ensureOfficialPacks(data: StoreData) {
  data.stickerPacks ??= [];
  data.stickers ??= [];
  if (data.stickerPacks.some((p) => p.official && p.id === "pack-nixo-faces")) return;
  const now = Date.now();
  const faces: StickerPack = {
    id: "pack-nixo-faces",
    ownerUserId: "nixo-official",
    name: "NIXO Faces",
    description: "استیکرهای ثابت رسمی نیکسو",
    privacy: "public",
    shareToken: "nixo-faces",
    official: true,
    memberIds: [],
    createdAt: now,
  };
  const motion: StickerPack = {
    id: "pack-nixo-motion",
    ownerUserId: "nixo-official",
    name: "NIXO Motion",
    description: "استیکر پویا با محدودیت فرمت امن نیکسو — فایل اجرایی نیست.",
    privacy: "public",
    shareToken: "nixo-motion",
    official: true,
    memberIds: [],
    createdAt: now,
  };
  const custom: StickerPack = {
    id: "pack-nixo-custom-emoji",
    ownerUserId: "nixo-official",
    name: "NIXO Custom Emoji",
    description: "ایموجی سفارشی فقط اگر در تنظیمات فعال باشد.",
    privacy: "public",
    shareToken: "nixo-custom-emoji",
    official: true,
    memberIds: [],
    createdAt: now,
  };
  data.stickerPacks.push(faces, motion, custom);
  data.stickers.push(
    face("st-face-hi", faces.id, "سلام", "👋", "#fbbf24", ["hi", "سلام"]),
    face("st-face-love", faces.id, "قلب", "❤️", "#fda4af", ["love", "قلب"]),
    face("st-face-ok", faces.id, "تأیید", "👍", "#34d399", ["ok", "like"]),
    face("st-face-wow", faces.id, "شگفت", "😮", "#7dd3fc", ["wow"]),
    {
      id: "st-motion-n",
      packId: motion.id,
      name: "چرخش نیکسو",
      emoji: "✨",
      tags: ["spin", "nixo", "animated"],
      kind: "animated",
      mime: "image/svg+xml",
      payload: SVG_SPIN,
      w: 64,
      h: 64,
      bytes: 520,
    },
    {
      id: "st-custom-n",
      packId: custom.id,
      name: "N",
      emoji: "🟢",
      tags: ["custom", "nixo"],
      kind: "custom-emoji",
      mime: "image/svg+xml",
      payload: SVG_FACE("#34d399", `<text x="32" y="40" text-anchor="middle" font-size="16" fill="#102824">N</text>`),
      w: 64,
      h: 64,
      bytes: 480,
    },
  );
}

function spaceCanUsePack(data: StoreData, pack: StickerPack, userId: string) {
  if (pack.groupId) {
    const g = data.groups.find((x) => x.id === pack.groupId && !x.deletedAt);
    if (g?.members.some((m) => m.key === userId && !m.leftAt)) return true;
  }
  if (pack.channelId) {
    const c = data.pubChannels.find((x) => x.id === pack.channelId && !x.deletedAt);
    if (!c) return false;
    if (c.ownerUserId === userId) return true;
    if (c.staff.some((s) => s.userId === userId)) return true;
    if (c.subscribers.some((s) => s.userId === userId && !s.leftAt)) return true;
  }
  return false;
}

export function canSeePack(pack: StickerPack, userId: string, data?: StoreData, opts?: { history?: boolean }) {
  if (!opts?.history && pack.deletedAt) return false;
  if (pack.official || pack.privacy === "public") return true;
  if (pack.ownerUserId === userId) return true;
  if (pack.memberIds.includes(userId)) return true;
  if (data && spaceCanUsePack(data, pack, userId)) return true;
  return false;
}

function canManageSpacePack(data: StoreData, userId: string, groupId?: string, channelId?: string) {
  if (groupId) {
    const g = data.groups.find((x) => x.id === groupId && !x.deletedAt);
    const me = g?.members.find((m) => m.key === userId && !m.leftAt);
    return Boolean(me && (me.role === "owner" || me.role === "admin"));
  }
  if (channelId) {
    const c = data.pubChannels.find((x) => x.id === channelId && !x.deletedAt);
    if (!c) return false;
    if (c.ownerUserId === userId) return true;
    const staff = c.staff.find((s) => s.userId === userId);
    return Boolean(staff && (staff.role === "owner" || staff.role === "admin"));
  }
  return false;
}

export function signStickerFile(stickerId: string, userId: string, exp = Date.now() + STICKER_TOKEN_MS) {
  const sig = createHmac("sha256", config.pepper).update(`st.${stickerId}.${userId}.${exp}`).digest("hex").slice(0, 32);
  return `${exp}.${sig}`;
}

export function verifyStickerFile(stickerId: string, userId: string, token: string) {
  const [expRaw, sig] = token.split(".");
  const exp = Number(expRaw);
  if (!exp || !sig || Date.now() > exp) return false;
  const expected = signStickerFile(stickerId, userId, exp);
  try {
    return timingSafeEqual(Buffer.from(expected), Buffer.from(`${exp}.${sig}`));
  } catch {
    return false;
  }
}

function publicSticker(item: StickerItem, userId: string, prefs: StickerPrefs) {
  if (item.deletedAt) return null;
  if (item.kind === "custom-emoji" && !prefs.customEmoji) return null;
  return {
    id: item.id,
    packId: item.packId,
    name: item.name,
    emoji: item.emoji,
    tags: item.tags,
    kind: item.kind,
    mime: item.mime,
    w: item.w,
    h: item.h,
    url: `/api/stickers/file/${item.id}?t=${signStickerFile(item.id, userId)}`,
    favorite: prefs.stickerFavorites.includes(item.id),
  };
}

function publicPack(pack: StickerPack, items: ReturnType<typeof publicSticker>[], userId: string) {
  return {
    id: pack.id,
    name: pack.name,
    description: pack.description,
    privacy: pack.privacy,
    official: pack.official,
    owner: pack.ownerUserId === userId,
    groupId: pack.groupId ?? null,
    channelId: pack.channelId ?? null,
    shareToken: pack.privacy === "public" || pack.ownerUserId === userId ? pack.shareToken : null,
    stickerCount: items.filter(Boolean).length,
    stickers: items.filter((x): x is NonNullable<typeof x> => Boolean(x)),
  };
}

function pngSize(buf: Buffer): { w: number; h: number } | null {
  if (buf.length < 24) return null;
  if (buf[0] !== 0x89 || buf[1] !== 0x50) return null;
  return { w: buf.readUInt32BE(16), h: buf.readUInt32BE(20) };
}

export function validateStickerUpload(input: {
  name: string;
  mime: string;
  dataUrl: string;
  kind: "static" | "animated";
}): { ok: true; mime: string; payload: string; bytes: number; w: number; h: number } | { ok: false; error: string } {
  const name = input.name.trim().slice(0, 40);
  if (name.length < 1) return { ok: false, error: "نام استیکر لازم است." };
  const raw = input.dataUrl.trim();
  const m = /^data:([a-zA-Z0-9.+/-]+);base64,([A-Za-z0-9+/]+=*)$/.exec(raw);
  if (!m) return { ok: false, error: "فقط دادهٔ Base64 مجاز است." };
  const declared = m[1]!.toLowerCase();
  let buf: Buffer;
  try {
    buf = Buffer.from(m[2]!, "base64");
  } catch {
    return { ok: false, error: "فایل خراب است." };
  }
  const max = input.kind === "animated" ? STICKER_ANIM_MAX : STICKER_STATIC_MAX;
  if (buf.length < 32 || buf.length > max) return { ok: false, error: "حجم استیکر خارج از سقف نیکسو است." };
  const sniff = sniffMagic(new Uint8Array(buf));
  if (!sniff.ok) return { ok: false, error: sniff.warning ?? "امضای فایل پذیرفته نشد." };
  if (sniff.mime !== "image/png" && sniff.mime !== "image/webp") {
    return { ok: false, error: "فقط PNG یا WEBP مجاز است. SVG، HTML و اجرایی رد می‌شوند." };
  }
  if (declared.includes("svg") || declared.includes("html") || declared.includes("javascript")) {
    return { ok: false, error: "نوع ادعایی فایل با سیاست نیکسو سازگار نیست." };
  }
  const dim = sniff.mime === "image/png" ? pngSize(buf) : { w: 128, h: 128 };
  if (!dim || dim.w < STICKER_MIN_DIM || dim.h < STICKER_MIN_DIM || dim.w > STICKER_MAX_DIM || dim.h > STICKER_MAX_DIM) {
    return { ok: false, error: "ابعاد استیکر باید بین ۳۲ و ۵۱۲ پیکسل باشد." };
  }
  if (input.kind === "animated" && sniff.mime === "image/png") {
    return { ok: false, error: "استیکر پویا باید WEBP پویا باشد، نه PNG ایستا." };
  }
  return { ok: true, mime: sniff.mime, payload: raw.slice(0, max * 2), bytes: buf.length, w: dim.w, h: dim.h };
}

function pushRecent(list: string[], id: string, max = 24) {
  return [id, ...list.filter((x) => x !== id)].slice(0, max);
}

function notifyReaction(
  data: StoreData,
  targetUserId: string,
  actorId: string,
  category: "messages" | "groups" | "channels",
  target: { type: "chat" | "group" | "channel"; id: string },
  sourceId: string,
) {
  if (targetUserId === actorId) return;
  const prefs = prefsOf(data, targetUserId);
  if (!prefs.reactionNotify) return;
  const actor = data.users.find((u) => u.id === actorId);
  const lock = data.notifyPrefs?.find((p) => p.userId === targetUserId);
  const hidden = lock?.lockScreen === "hidden";
  emitNotification(data, {
    userId: targetUserId,
    category,
    kind: "reaction",
    title: hidden ? "NIXO" : actor?.displayName || "واکنش",
    senderName: hidden ? "NIXO" : actor?.displayName || "کاربر",
    body: hidden ? "" : "واکنش جدید",
    e2ee: category === "messages",
    sourceId,
    muteType: target.type === "chat" ? "chat" : target.type === "group" ? "group" : "channel",
    muteId: target.id,
    target,
  });
}

export async function snapshotStickers(userId: string, query?: string, suggest?: string, packFilter?: string) {
  return mutateStore((data) => {
    ensureOfficialPacks(data);
    const prefs = prefsOf(data, userId);
    const q = (query ?? "").trim().toLowerCase();
    const packs = data.stickerPacks.filter((p) => !p.deletedAt && canSeePack(p, userId, data));
    const installed = new Set([...prefs.installedPackIds, ...packs.filter((p) => p.official || p.groupId || p.channelId).map((p) => p.id)]);
    const mine = packs.filter((p) => installed.has(p.id) || p.ownerUserId === userId);
    const scoped = packFilter ? mine.filter((p) => p.id === packFilter) : mine;
    const liveStickers = data.stickers.filter((s) => !s.deletedAt);
    const visibleItems = liveStickers.filter((s) => packs.some((p) => p.id === s.packId));
    const mappedPacks = scoped.map((pack) => {
      const items = liveStickers.filter((s) => s.packId === pack.id).map((s) => publicSticker(s, userId, prefs));
      const filtered = q
        ? items.filter((s) => s && (s.name.toLowerCase().includes(q) || s.emoji.includes(q) || s.tags.some((t) => t.includes(q))))
        : items;
      return publicPack(pack, q ? filtered : items, userId);
    });
    let suggestions: ReturnType<typeof publicSticker>[] = [];
    if (suggest && prefs.suggestions) {
      const needle = suggest.trim().toLowerCase();
      suggestions = visibleItems
        .filter((s) => s.emoji.includes(needle) || s.tags.some((t) => t.includes(needle)) || s.name.toLowerCase().includes(needle))
        .slice(0, 8)
        .map((s) => publicSticker(s, userId, prefs));
    }
    const catalog = q
      ? visibleItems.filter(
          (s) => s.name.toLowerCase().includes(q) || s.emoji.includes(q) || s.tags.some((t) => t.includes(q)),
        )
      : [];
    return {
      ok: true as const,
      prefs,
      packs: mappedPacks,
      recent: prefs.stickerRecent.map((id) => visibleItems.find((s) => s.id === id)).filter(Boolean).map((s) => publicSticker(s!, userId, prefs)),
      favorites: prefs.stickerFavorites.map((id) => visibleItems.find((s) => s.id === id)).filter(Boolean).map((s) => publicSticker(s!, userId, prefs)),
      suggestions: suggestions.filter(Boolean),
      search: q ? catalog.map((s) => publicSticker(s, userId, prefs)).filter(Boolean) : null,
      defaultReactions: [...DEFAULT_REACTIONS],
    };
  });
}

export async function exportStickerData(userId: string) {
  const snap = await snapshotStickers(userId);
  return {
    exportedAt: Date.now(),
    prefs: snap.prefs,
    installedPackIds: snap.prefs.installedPackIds,
    favorites: snap.favorites,
    recent: snap.recent,
    ownedPacks: snap.packs.filter((p) => p.owner),
  };
}

export async function patchStickerPrefs(userId: string, patch: Partial<StickerPrefs>) {
  return mutateStore((data) => {
    const prefs = prefsOf(data, userId);
    if (Array.isArray(patch.emojiRecent)) prefs.emojiRecent = patch.emojiRecent.filter((e) => isLikelyEmoji(e)).slice(0, 32);
    if (Array.isArray(patch.emojiFavorites)) prefs.emojiFavorites = patch.emojiFavorites.filter((e) => isLikelyEmoji(e)).slice(0, 64);
    if (Array.isArray(patch.stickerFavorites)) prefs.stickerFavorites = patch.stickerFavorites.slice(0, 80);
    if (Array.isArray(patch.stickerRecent)) prefs.stickerRecent = patch.stickerRecent.slice(0, 32);
    if (patch.reactionPrivacy === "everyone" || patch.reactionPrivacy === "contacts" || patch.reactionPrivacy === "nobody") {
      prefs.reactionPrivacy = patch.reactionPrivacy;
    }
    if (typeof patch.reactionNotify === "boolean") prefs.reactionNotify = patch.reactionNotify;
    if (typeof patch.suggestions === "boolean") prefs.suggestions = patch.suggestions;
    if (typeof patch.customEmoji === "boolean") prefs.customEmoji = patch.customEmoji;
    if (Array.isArray(patch.installedPackIds)) prefs.installedPackIds = patch.installedPackIds.slice(0, 80);
    return { ok: true as const, prefs };
  });
}

export async function touchEmoji(userId: string, emoji: string, favorite?: boolean) {
  if (!isLikelyEmoji(emoji)) return { ok: false as const, error: "ایموجی نامعتبر است.", status: 400 };
  return mutateStore((data) => {
    const prefs = prefsOf(data, userId);
    prefs.emojiRecent = pushRecent(prefs.emojiRecent, normalizeEmoji(emoji).slice(0, 24), 32);
    if (favorite === true && !prefs.emojiFavorites.includes(emoji)) prefs.emojiFavorites = pushRecent(prefs.emojiFavorites, normalizeEmoji(emoji), 64);
    if (favorite === false) prefs.emojiFavorites = prefs.emojiFavorites.filter((e) => e !== emoji);
    return { ok: true as const, prefs };
  });
}

export async function installPack(userId: string, packIdOrToken: string, install: boolean) {
  return mutateStore((data) => {
    ensureOfficialPacks(data);
    const token = packIdOrToken.trim();
    const byToken = data.stickerPacks.find((p) => !p.deletedAt && p.shareToken && p.shareToken === token);
    const byId = data.stickerPacks.find((p) => !p.deletedAt && p.id === token);
    const viaToken = Boolean(byToken && (!byId || byId.id === byToken.id));
    const pack = viaToken ? byToken : byId;
    if (!pack) return { ok: false as const, error: "بسته یافت نشد.", status: 404 };
    if (!viaToken && !canSeePack(pack, userId, data)) {
      return { ok: false as const, error: "بسته یافت نشد.", status: 404 };
    }
    if (pack.privacy === "private" && !viaToken && !canSeePack(pack, userId, data)) {
      return { ok: false as const, error: "این بسته خصوصی است.", status: 403 };
    }
    if (pack.privacy === "private" && !viaToken && pack.ownerUserId !== userId && !pack.memberIds.includes(userId) && !spaceCanUsePack(data, pack, userId)) {
      return { ok: false as const, error: "این بسته خصوصی است.", status: 403 };
    }
    const prefs = prefsOf(data, userId);
    if (install) {
      if (pack.privacy === "private" && viaToken && !pack.memberIds.includes(userId)) pack.memberIds.push(userId);
      if (!prefs.installedPackIds.includes(pack.id)) prefs.installedPackIds.push(pack.id);
      bumpAnalytics(data, userId, "packsInstalled");
    } else {
      prefs.installedPackIds = prefs.installedPackIds.filter((id) => id !== pack.id);
    }
    return { ok: true as const, prefs, packId: pack.id };
  });
}

export async function createPack(
  userId: string,
  name: string,
  privacy: "public" | "private",
  extra?: { groupId?: string; channelId?: string },
) {
  return mutateStore((data) => {
    const limit = hitRateLimit(data, `stpack:${userId}`, 60 * 60_000, 5);
    if (!limit.allowed) return { ok: false as const, error: "ساخت بسته محدود شد.", status: 429 };
    const title = name.trim().slice(0, 40);
    if (title.length < 2) return { ok: false as const, error: "نام بسته کوتاه است.", status: 400 };
    const groupId = extra?.groupId?.trim() || undefined;
    const channelId = extra?.channelId?.trim() || undefined;
    if (groupId && channelId) return { ok: false as const, error: "بسته فقط به یک فضا وصل می‌شود.", status: 400 };
    if ((groupId || channelId) && !canManageSpacePack(data, userId, groupId, channelId)) {
      return { ok: false as const, error: "اجازهٔ ساخت ایموجی سفارشی این فضا را نداری.", status: 403 };
    }
    const pack: StickerPack = {
      id: randomId(),
      ownerUserId: userId,
      name: title,
      description: "",
      privacy: groupId || channelId ? "private" : privacy,
      shareToken: randomId().slice(0, 12),
      official: false,
      memberIds: [userId],
      createdAt: Date.now(),
      groupId,
      channelId,
    };
    data.stickerPacks.push(pack);
    const prefs = prefsOf(data, userId);
    if (!prefs.installedPackIds.includes(pack.id)) prefs.installedPackIds.push(pack.id);
    bumpAnalytics(data, userId, "customOps");
    return { ok: true as const, pack: publicPack(pack, [], userId) };
  });
}

export async function deleteOwnedSticker(userId: string, stickerId: string) {
  return mutateStore((data) => {
    const item = data.stickers.find((s) => s.id === stickerId);
    if (!item) return { ok: false as const, error: "استیکر یافت نشد.", status: 404 };
    const pack = data.stickerPacks.find((p) => p.id === item.packId);
    if (!pack) return { ok: false as const, error: "استیکر یافت نشد.", status: 404 };
    const spaceOk = Boolean((pack.groupId || pack.channelId) && canManageSpacePack(data, userId, pack.groupId, pack.channelId));
    if (pack.official || (pack.ownerUserId !== userId && !spaceOk)) {
      return { ok: false as const, error: "فقط مالک بسته می‌تواند استیکر را حذف کند.", status: 403 };
    }
    item.deletedAt = Date.now();
    bumpAnalytics(data, userId, "customOps");
    return { ok: true as const };
  });
}

export async function deleteOwnedPack(userId: string, packId: string) {
  return mutateStore((data) => {
    const pack = data.stickerPacks.find((p) => p.id === packId);
    if (!pack || pack.deletedAt) return { ok: false as const, error: "بسته یافت نشد.", status: 404 };
    if (pack.official) return { ok: false as const, error: "بستهٔ رسمی حذف نمی‌شود.", status: 403 };
    const spaceOk = (pack.groupId || pack.channelId) && canManageSpacePack(data, userId, pack.groupId, pack.channelId);
    if (pack.ownerUserId !== userId && !spaceOk) {
      return { ok: false as const, error: "فقط مالک یا ادمین فضا می‌تواند بسته را حذف کند.", status: 403 };
    }
    pack.deletedAt = Date.now();
    for (const s of data.stickers) {
      if (s.packId === pack.id && !s.deletedAt) s.deletedAt = pack.deletedAt;
    }
    bumpAnalytics(data, userId, "customOps");
    return { ok: true as const };
  });
}

export async function uploadSticker(
  userId: string,
  packId: string,
  input: { name: string; emoji?: string; dataUrl: string; kind?: "static" | "animated"; tags?: string[] },
) {
  return mutateStore((data) => {
    const limit = hitRateLimit(data, `stup:${userId}`, 60_000, 10);
    if (!limit.allowed) return { ok: false as const, error: "آپلود محدود شد.", status: 429 };
    const pack = data.stickerPacks.find((p) => p.id === packId && !p.deletedAt);
    if (!pack) return { ok: false as const, error: "بسته یافت نشد.", status: 404 };
    if (pack.official) return { ok: false as const, error: "اجازهٔ آپلود نداری.", status: 403 };
    const manager = pack.ownerUserId === userId || canManageSpacePack(data, userId, pack.groupId, pack.channelId);
    if (!manager) return { ok: false as const, error: "اجازهٔ آپلود نداری.", status: 403 };
    const owned = data.stickers.filter((s) => s.packId === packId && !s.deletedAt).length;
    if (owned >= 40) return { ok: false as const, error: "سقف استیکر این بسته پر است.", status: 413 };
    const kind = input.kind === "animated" ? "animated" : "static";
    const check = validateStickerUpload({ name: input.name, mime: "", dataUrl: input.dataUrl, kind });
    if (!check.ok) return { ok: false as const, error: check.error, status: 400 };
    const item: StickerItem = {
      id: randomId(),
      packId,
      name: input.name.trim().slice(0, 40),
      emoji: isLikelyEmoji(input.emoji ?? "") ? normalizeEmoji(input.emoji as string).slice(0, 24) : "✨",
      tags: (input.tags ?? []).map((t) => t.slice(0, 24)).slice(0, 8),
      kind,
      mime: check.mime,
      payload: check.payload,
      w: check.w,
      h: check.h,
      bytes: check.bytes,
    };
    data.stickers.push(item);
    bumpAnalytics(data, userId, "customOps");
    return { ok: true as const, sticker: publicSticker(item, userId, prefsOf(data, userId)) };
  });
}

export async function sharePack(userId: string, packId: string, memberId?: string) {
  return mutateStore((data) => {
    const limit = hitRateLimit(data, `stshare:${userId}`, 60_000, 20);
    if (!limit.allowed) return { ok: false as const, error: "اشتراک محدود شد.", status: 429 };
    const pack = data.stickerPacks.find((p) => p.id === packId && !p.deletedAt);
    if (!pack) return { ok: false as const, error: "بسته یافت نشد.", status: 404 };
    if (pack.ownerUserId !== userId) return { ok: false as const, error: "فقط مالک می‌تواند اشتراک بگذارد.", status: 403 };
    if (memberId) {
      if (pack.privacy !== "private") return { ok: false as const, error: "افزودن عضو فقط برای بستهٔ خصوصی است.", status: 400 };
      if (!data.users.some((u) => u.id === memberId && u.status === "active")) {
        return { ok: false as const, error: "کاربر یافت نشد.", status: 404 };
      }
      if (!pack.memberIds.includes(memberId)) pack.memberIds.push(memberId);
    }
    if (!pack.shareToken) pack.shareToken = randomId().slice(0, 12);
    return { ok: true as const, shareToken: pack.shareToken, privacy: pack.privacy };
  });
}

export async function reportSticker(userId: string, packId: string, stickerId: string | undefined, reason: string) {
  return mutateStore((data) => {
    const pack = data.stickerPacks.find((p) => p.id === packId);
    if (!pack) return { ok: false as const, error: "بسته یافت نشد.", status: 404 };
    if (!canSeePack(pack, userId, data)) return { ok: false as const, error: "بسته یافت نشد.", status: 404 };
    data.stickerReports.push({
      id: randomId(),
      packId,
      stickerId,
      reporterUserId: userId,
      reason: reason.slice(0, 200),
      createdAt: Date.now(),
      status: "open",
    });
    data.reports.push({
      id: randomId(),
      reporterId: userId,
      targetKind: "sticker",
      targetKey: stickerId ? `${packId}:${stickerId}` : packId,
      messageIds: [],
      category: reason.includes("copyright") ? "other" : "abuse",
      details: reason.slice(0, 500),
      createdAt: Date.now(),
    });
    if (/nsfw|illegal|child|copyright/i.test(reason) && !pack.official) {
      pack.privacy = "private";
    }
    return { ok: true as const };
  });
}

export async function toggleFavoriteSticker(userId: string, stickerId: string) {
  return mutateStore((data) => {
    ensureOfficialPacks(data);
    const item = data.stickers.find((s) => s.id === stickerId);
    if (!item || item.deletedAt) return { ok: false as const, error: "استیکر یافت نشد.", status: 404 };
    const pack = data.stickerPacks.find((p) => p.id === item.packId);
    if (!pack || !canSeePack(pack, userId, data)) return { ok: false as const, error: "اجازه نداری.", status: 403 };
    const prefs = prefsOf(data, userId);
    if (prefs.stickerFavorites.includes(stickerId)) prefs.stickerFavorites = prefs.stickerFavorites.filter((id) => id !== stickerId);
    else prefs.stickerFavorites = pushRecent(prefs.stickerFavorites, stickerId, 80);
    return { ok: true as const, prefs };
  });
}

export async function getStickerFile(userId: string, stickerId: string, token: string) {
  return mutateStore((data) => {
    if (!verifyStickerFile(stickerId, userId, token)) return null;
    ensureOfficialPacks(data);
    const item = data.stickers.find((s) => s.id === stickerId);
    if (!item) {
      return {
        id: stickerId,
        packId: "",
        name: "حذف‌شده",
        emoji: "⬜",
        tags: [],
        kind: "static" as const,
        mime: "image/svg+xml",
        payload: PLACEHOLDER_STICKER,
        w: 64,
        h: 64,
        bytes: 200,
      };
    }
    const pack = data.stickerPacks.find((p) => p.id === item.packId);
    if (!pack || !canSeePack(pack, userId, data, { history: true })) return null;
    if (item.deletedAt || pack.deletedAt) {
      return { ...item, mime: "image/svg+xml", payload: PLACEHOLDER_STICKER };
    }
    const prefs = prefsOf(data, userId);
    if (item.kind === "custom-emoji" && !prefs.customEmoji) return null;
    return item;
  });
}

export function canUseSticker(data: StoreData, userId: string, stickerId: string) {
  const item = data.stickers.find((s) => s.id === stickerId);
  if (!item || item.deletedAt) return { ok: false as const, error: "استیکر یافت نشد.", status: 404 };
  const pack = data.stickerPacks.find((p) => p.id === item.packId && !p.deletedAt);
  if (!pack || !canSeePack(pack, userId, data)) return { ok: false as const, error: "بسته در دسترس نیست.", status: 403 };
  const prefs = prefsOf(data, userId);
  if (item.kind === "custom-emoji" && !prefs.customEmoji) {
    return { ok: false as const, error: "ایموجی سفارشی برای این حساب خاموش است.", status: 403 };
  }
  return { ok: true as const, item, prefs };
}

export async function reactOnDm(
  userId: string,
  threadId: string,
  messageId: string,
  emoji: string,
  extra?: { intent?: ReactionIntent; clientNonce?: string },
) {
  return mutateStore((data) => {
    const nonce = typeof extra?.clientNonce === "string" ? extra.clientNonce.trim().slice(0, 80) : "";
    const nonceKey = nonce.length >= 8 ? `dm:${userId}:${threadId}:${messageId}:${nonce}` : null;
    const replay = replayReactionNonce(data, nonceKey);
    const thread = data.threads.find((t) => t.id === threadId && t.ownerUserId === userId);
    if (!thread) return { ok: false as const, error: "گفتگو یافت نشد.", status: 404 };
    const safety = blockState(data, userId, thread.peerKey);
    if (!safety.interactionsAllowed) return { ok: false as const, error: "تعامل محدود است.", status: 403 };
    const message = data.messages.find((m) => m.id === messageId && m.threadId === threadId && m.ownerUserId === userId);
    if (!message) return { ok: false as const, error: "پیام یافت نشد.", status: 404 };
    if (replay) {
      return {
        ok: true as const,
        reactions: publicReactionView(data, message.reactions, userId),
        action: replay.action as "add" | "remove" | "change" | "noop",
        idempotent: true as const,
      };
    }
    const limit = hitRateLimit(data, `react:${userId}`, 60_000, 40);
    if (!limit.allowed) return { ok: false as const, error: "واکنش محدود شد.", status: 429 };
    const flood = hitRateLimit(data, `reactflood:${userId}`, 8_000, 12);
    if (!flood.allowed) return { ok: false as const, error: "ارسال پیاپی واکنش محدود شد.", status: 429 };
    const applied = applyUserReaction(message.reactions, userId, emoji, [...DEFAULT_REACTIONS], { intent: extra?.intent });
    if (!applied.ok) return { ok: false as const, error: applied.error, status: 400 };
    message.reactions = applied.rows;
    putReactionCache(data, `dm:${threadId}:${messageId}`, applied.rows);
    if (nonceKey) rememberReactionNonce(data, nonceKey, applied.action);
    if (applied.action !== "noop") bumpAnalytics(data, userId, "reactions");
    prefsOf(data, userId).emojiRecent = pushRecent(prefsOf(data, userId).emojiRecent, normalizeEmoji(emoji).slice(0, 24));
    const peer = data.users.find((u) => u.id === thread.peerKey);
    if (peer) {
      const peerThread = data.threads.find((t) => t.ownerUserId === peer.id && t.peerKey === userId);
      if (peerThread) {
        const twin = data.messages.find(
          (m) =>
            m.threadId === peerThread.id &&
            m.ownerUserId === peer.id &&
            (message.syncId ? m.syncId === message.syncId : m.nonce === message.nonce && m.ciphertext === message.ciphertext),
        );
        if (twin) {
          const twinApplied = applyUserReaction(twin.reactions, userId, emoji, [...DEFAULT_REACTIONS], { intent: extra?.intent });
          if (twinApplied.ok) twin.reactions = twinApplied.rows;
        }
      }
      if (applied.action !== "remove" && applied.action !== "noop") {
        notifyReaction(data, peer.id, userId, "messages", { type: "chat", id: peerThread?.id ?? threadId }, `react:${threadId}:${messageId}`);
      }
    }
    return { ok: true as const, reactions: publicReactionView(data, message.reactions, userId), action: applied.action };
  });
}

export async function sendDmSticker(userId: string, threadId: string, stickerId: string) {
  return mutateStore((data) => {
    ensureOfficialPacks(data);
    const limit = hitRateLimit(data, `stsend:${userId}`, 60_000, 30);
    if (!limit.allowed) return { ok: false as const, error: "ارسال استیکر محدود شد.", status: 429 };
    const thread = data.threads.find((t) => t.id === threadId && t.ownerUserId === userId);
    if (!thread) return { ok: false as const, error: "گفتگو یافت نشد.", status: 404 };
    const safety = blockState(data, userId, thread.peerKey);
    if (!safety.messagesAllowed) return { ok: false as const, error: "ارسال محدود است.", status: 403 };
    if (!canMessageUser(data, userId, thread.peerKey)) return { ok: false as const, error: "پیام مستقیم محدود شده است.", status: 403 };
    const use = canUseSticker(data, userId, stickerId);
    if (!use.ok) return use;
    bumpAnalytics(data, userId, "stickersSent");
    const now = Date.now();
    const nonce = randomId();
    const syncId = randomId();
    const mine: ChatMessage = {
      id: randomId(),
      threadId,
      ownerUserId: userId,
      sender: "me",
      enc: "e2ee-v1",
      ciphertext: "",
      nonce,
      createdAt: now,
      kind: "sticker",
      stickerId,
      reactions: [],
      hiddenFor: [],
      deletedEverywhere: false,
      syncId,
    };
    data.messages.push(mine);
    thread.updatedAt = now;
    use.prefs.stickerRecent = pushRecent(use.prefs.stickerRecent, stickerId);
    const peer = data.users.find((u) => u.id === thread.peerKey && u.status === "active");
    if (peer) {
      let peerThread = data.threads.find((t) => t.ownerUserId === peer.id && t.peerKey === userId);
      if (!peerThread) {
        peerThread = {
          id: randomId(),
          ownerUserId: peer.id,
          peerKey: userId,
          peerName: data.users.find((u) => u.id === userId)?.displayName || "مخاطب",
          peerTitle: "",
          color: thread.color,
          updatedAt: now,
        };
        data.threads.push(peerThread);
      }
      data.messages.push({
        ...mine,
        id: randomId(),
        threadId: peerThread.id,
        ownerUserId: peer.id,
        sender: "peer",
      });
      peerThread.updatedAt = now;
      emitNotification(data, {
        userId: peer.id,
        category: "messages",
        kind: "sticker",
        title: data.users.find((u) => u.id === userId)?.displayName || "استیکر",
        senderName: data.users.find((u) => u.id === userId)?.displayName || "مخاطب",
        body: "استیکر جدید",
        e2ee: false,
        sourceId: `chat:${userId}`,
        muteType: "chat",
        muteId: peerThread.id,
        target: { type: "chat", id: peerThread.id },
      });
    }
    return { ok: true as const, message: { id: mine.id, kind: "sticker" as const, stickerId, createdAt: now, sender: "me" as const } };
  });
}

export async function reportReaction(
  userId: string,
  target: { type: "chat" | "group" | "channel"; id: string; messageId: string },
  reason: string,
) {
  return mutateStore((data) => {
    const limit = hitRateLimit(data, `reactreport:${userId}`, 60_000, 8);
    if (!limit.allowed) return { ok: false as const, error: "گزارش محدود شد.", status: 429 };
    if (target.type === "chat") {
      const thread = data.threads.find((t) => t.id === target.id && t.ownerUserId === userId);
      const message = data.messages.find((m) => m.id === target.messageId && m.threadId === target.id && m.ownerUserId === userId);
      if (!thread || !message) return { ok: false as const, error: "پیام یافت نشد.", status: 404 };
    } else if (target.type === "group") {
      const group = data.groups.find((g) => g.id === target.id && !g.deletedAt);
      if (!group?.members.some((m) => m.key === userId && !m.leftAt)) return { ok: false as const, error: "اجازه نداری.", status: 403 };
      const msg = data.groupMessages.find((m) => m.id === target.messageId && m.groupId === target.id);
      if (!msg) return { ok: false as const, error: "پیام یافت نشد.", status: 404 };
    } else {
      const channel = data.pubChannels.find((c) => c.id === target.id && !c.deletedAt);
      const allowed =
        channel &&
        (channel.ownerUserId === userId ||
          channel.staff.some((s) => s.userId === userId) ||
          channel.subscribers.some((s) => s.userId === userId && !s.leftAt) ||
          channel.visibility === "public");
      if (!channel || !allowed) return { ok: false as const, error: "اجازه نداری.", status: 403 };
      const post = data.channelPosts.find((p) => p.id === target.messageId && p.channelId === target.id);
      if (!post) return { ok: false as const, error: "پست یافت نشد.", status: 404 };
    }
    data.reports.push({
      id: randomId(),
      reporterId: userId,
      targetKind: target.type === "chat" ? "chat" : target.type === "group" ? "group" : "channel",
      targetKey: `reaction:${target.id}:${target.messageId}`,
      messageIds: [target.messageId],
      category: "abuse",
      details: reason.slice(0, 500),
      createdAt: Date.now(),
    });
    return { ok: true as const };
  });
}

export { DEFAULT_REACTIONS };
