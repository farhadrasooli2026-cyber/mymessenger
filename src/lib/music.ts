import "server-only";
import { createHmac, timingSafeEqual } from "node:crypto";
import { randomId } from "@/lib/crypto-utils";
import { config } from "@/lib/config";
import { hitRateLimit } from "@/lib/rate-limit";
import { mutateStore, readStoreSnapshot } from "@/lib/store";
import type { MusicPlaylist, MusicTrack, StoreData } from "@/lib/store";
import { sniffMagic } from "@/lib/media";
import { deleteMusicBlob, licensedTone, readMusicBlob, toneWav, writeMusicBlob } from "@/lib/music-files";
import {
  DEFAULT_MUSIC_PREFS,
  MUSIC_CACHE_MAX,
  MUSIC_MAX_BYTES,
  MUSIC_TOKEN_MS,
  NIXO_TONES,
  type MusicKind,
  type MusicPrefs,
} from "@/lib/music-types";

function prefsOf(data: StoreData, userId: string): MusicPrefs {
  data.musicPrefs ??= [];
  data.musicTracks ??= [];
  data.musicPlaylists ??= [];
  data.musicClaims ??= [];
  let row = data.musicPrefs.find((p) => p.userId === userId);
  if (!row) {
    row = { userId, ...DEFAULT_MUSIC_PREFS };
    data.musicPrefs.push(row);
  }
  if (typeof row.backgroundPlayback !== "boolean") row.backgroundPlayback = true;
  return row;
}

export function signMusic(itemId: string, userId: string, exp = Date.now() + MUSIC_TOKEN_MS) {
  const sig = createHmac("sha256", config.pepper).update(`m.${itemId}.${userId}.${exp}`).digest("hex").slice(0, 32);
  return `${exp}.${sig}`;
}

export function verifyMusic(itemId: string, userId: string, token: string) {
  const [expRaw, sig] = token.split(".");
  const exp = Number(expRaw);
  if (!exp || !sig || Date.now() > exp) return false;
  const expected = signMusic(itemId, userId, exp);
  try {
    return timingSafeEqual(Buffer.from(expected), Buffer.from(`${exp}.${sig}`));
  } catch {
    return false;
  }
}

function kindFrom(name: string, mime: string, hint?: string): MusicKind {
  if (hint === "podcast" || hint === "voice" || hint === "song" || hint === "music" || hint === "file") return hint;
  const n = name.toLowerCase();
  if (/podcast|پادکست/.test(n)) return "podcast";
  if (/voice|ضبط|پیام/.test(n)) return "voice";
  if (mime.startsWith("audio/")) return "song";
  return "file";
}

function parseMeta(name: string) {
  const base = name.replace(/\.[^.]+$/, "").slice(0, 80);
  const parts = base.split(/\s[-–—]\s/);
  if (parts.length >= 2) return { artist: parts[0]!.slice(0, 60), title: parts.slice(1).join(" - ").slice(0, 80) };
  return { artist: "ناشناخته", title: base || "بدون عنوان" };
}

function publicTrack(item: MusicTrack, userId: string) {
  return {
    id: item.id,
    catalog: false as const,
    kind: item.kind,
    title: item.title,
    artist: item.artist,
    album: item.album,
    mime: item.mime,
    size: item.size,
    durationMs: item.durationMs,
    favorite: item.favorite,
    cache: item.cache,
    privacy: item.privacy,
    lastPositionMs: item.lastPositionMs,
    createdAt: item.createdAt,
    streamUrl: item.blocked || item.deletedAt ? "" : `/api/music/file?id=${item.id}&t=${signMusic(item.id, userId)}`,
    format: item.mime.split("/")[1] ?? "audio",
  };
}

export function catalogPublic() {
  return NIXO_TONES.map((t) => ({
    id: t.id,
    catalog: true as const,
    kind: "music" as MusicKind,
    title: t.title,
    artist: t.artist,
    album: t.album,
    mime: "audio/wav",
    size: 0,
    durationMs: t.durationMs,
    favorite: false,
    cache: false,
    privacy: "shared" as const,
    lastPositionMs: 0,
    createdAt: 0,
    streamUrl: `/api/music/file?catalog=${t.id}`,
    format: "wav",
    licensed: true,
  }));
}

export async function listMusic(
  userId: string,
  opts?: { kind?: MusicKind | "all"; q?: string; filter?: string },
) {
  const data = await readStoreSnapshot();
  const prefs = data.musicPrefs?.find((p) => p.userId === userId) ?? { userId, ...DEFAULT_MUSIC_PREFS };
  const live = (data.musicTracks ?? []).filter((i) => i.ownerUserId === userId && !i.deletedAt && !i.blocked);
  let items = live;
  if (opts?.kind && opts.kind !== "all") items = items.filter((i) => i.kind === opts.kind);
  if (opts?.q) {
    const n = opts.q.toLowerCase();
    items = items.filter((i) => `${i.title} ${i.artist} ${i.album}`.toLowerCase().includes(n));
  }
  if (opts?.filter === "favorites") items = items.filter((i) => i.favorite);
  const playlists = (data.musicPlaylists ?? []).filter((p) => p.ownerUserId === userId && !p.deletedAt);
  const playlistHits = opts?.q
    ? playlists.filter((p) => p.name.toLowerCase().includes(opts.q!.toLowerCase()))
    : playlists;
  const stats = {
    audio: live.reduce((n, i) => n + i.size, 0),
    music: live.filter((i) => i.kind === "music" || i.kind === "song").reduce((n, i) => n + i.size, 0),
    voice: live.filter((i) => i.kind === "voice").reduce((n, i) => n + i.size, 0),
    files: live.filter((i) => i.kind === "file" || i.kind === "podcast").reduce((n, i) => n + i.size, 0),
    cache: live.filter((i) => i.cache).reduce((n, i) => n + i.size, 0),
    count: live.length,
  };
  const large = live.filter((i) => i.size > 400_000).slice(0, 8).map((i) => ({ id: i.id, title: i.title, size: i.size, reason: "large" as const }));
  const old = live.filter((i) => Date.now() - i.createdAt > 14 * 24 * 60 * 60 * 1000).slice(0, 8).map((i) => ({ id: i.id, title: i.title, size: i.size, reason: "old" as const }));
  const voices = (data.messages ?? [])
    .filter((m) => m.ownerUserId === userId && m.kind === "voice" && !m.deletedEverywhere)
    .slice(-40)
    .reverse()
    .map((m) => ({
      id: m.id,
      kind: "voice" as const,
      peer: data.threads.find((t) => t.id === m.threadId)?.peerName ?? "چت",
      createdAt: m.createdAt,
      e2ee: true,
    }));
  const artists = [...new Set(live.map((i) => i.artist).filter(Boolean))];
  const albums = [...new Set(live.map((i) => i.album).filter(Boolean))];
  const byId = new Map(live.map((i) => [i.id, i]));
  const recentlyNamed = (prefs.recentlyPlayed ?? []).slice(0, 12).map((r) => ({
    ...r,
    title: r.catalog ? catalogPublic().find((c) => c.id === r.id)?.title ?? r.id : byId.get(r.id)?.title ?? r.id,
  }));
  return {
    ok: true as const,
    items: items.slice(0, 160).map((i) => publicTrack(i, userId)),
    catalog: catalogPublic().filter((c) => {
      if (!opts?.q) return true;
      const n = opts.q.toLowerCase();
      return `${c.title} ${c.artist} ${c.album}`.toLowerCase().includes(n);
    }),
    playlists: playlistHits.map((p) => ({ id: p.id, name: p.name, trackIds: p.trackIds, createdAt: p.createdAt })),
    prefs: {
      autoWifi: prefs.autoWifi,
      autoMobile: prefs.autoMobile,
      autoRoaming: prefs.autoRoaming,
      quality: prefs.quality,
      speed: prefs.speed,
      dataSaver: prefs.dataSaver,
      notifyPlayback: prefs.notifyPlayback,
      backgroundPlayback: prefs.backgroundPlayback !== false,
      lastTrackId: prefs.lastTrackId,
      lastPositionMs: prefs.lastPositionMs,
      lastQueue: prefs.lastQueue,
      recentlyPlayed: recentlyNamed,
    },
    stats,
    cleanup: { large, old, cacheBytes: stats.cache },
    voices,
    artists,
    albums,
  };
}

export async function addMusicTrack(
  userId: string,
  input: {
    name: string;
    mime?: string;
    dataUrl: string;
    kind?: string;
    title?: string;
    artist?: string;
    album?: string;
    durationMs?: number;
    cache?: boolean;
  },
) {
  const match = input.dataUrl.match(/^data:([^;]+);base64,(.+)$/);
  if (!match) return { ok: false as const, error: "فایل صوتی نامعتبر است.", status: 400 };
  let bytes: Buffer;
  try {
    bytes = Buffer.from(match[2]!, "base64");
  } catch {
    return { ok: false as const, error: "فایل صوتی نامعتبر است.", status: 400 };
  }
  if (bytes.length > MUSIC_MAX_BYTES) return { ok: false as const, error: "حجم از سقف صوت نیکسو بیشتر است.", status: 413 };
  const magic = sniffMagic(bytes);
  if (!magic.ok) return { ok: false as const, error: magic.warning ?? "فایل رد شد.", status: 400 };
  if (!magic.mime.startsWith("audio/") && magic.mime !== "application/octet-stream") {
    return { ok: false as const, error: "فقط فایل صوتی مجاز است.", status: 400 };
  }
  if (magic.mime === "application/octet-stream" && !/^(audio\/|application\/ogg)/.test(match[1] ?? "")) {
    return { ok: false as const, error: "امضای فایل صوتی شناخته نشد.", status: 400 };
  }
  const mime = magic.mime.startsWith("audio/") ? magic.mime : match[1] || "audio/mpeg";
  const parsed = parseMeta(input.name);
  return mutateStore(async (data) => {
    prefsOf(data, userId);
    const flood = hitRateLimit(data, `mus:${userId}`, 60_000, 16);
    if (!flood.allowed) return { ok: false as const, error: "آپلود پیاپی محدود شد.", status: 429 };
    const id = randomId();
    const written = await writeMusicBlob(userId, id, bytes);
    if (!written.ok) return { ok: false as const, error: written.error, status: 400 };
    const item: MusicTrack = {
      id,
      ownerUserId: userId,
      kind: kindFrom(input.name, mime, input.kind),
      title: (input.title ?? parsed.title).slice(0, 80),
      artist: (input.artist ?? parsed.artist).slice(0, 60),
      album: (input.album ?? "کتابخانه من").slice(0, 60),
      mime,
      size: bytes.length,
      durationMs: Math.max(0, Math.min(input.durationMs ?? 0, 6 * 60 * 60 * 1000)),
      favorite: false,
      cache: Boolean(input.cache),
      blocked: false,
      privacy: "private",
      lastPositionMs: 0,
      createdAt: Date.now(),
      deletedAt: null,
    };
    data.musicTracks.unshift(item);
    const cached = data.musicTracks.filter((i) => i.ownerUserId === userId && i.cache && !i.deletedAt);
    if (cached.length > MUSIC_CACHE_MAX) {
      for (const extra of cached.slice(MUSIC_CACHE_MAX)) extra.deletedAt = Date.now();
    }
    return { ok: true as const, item: publicTrack(item, userId) };
  });
}

export async function getMusicFile(userId: string, itemId: string, token: string) {
  const data = await readStoreSnapshot();
  const item = (data.musicTracks ?? []).find((i) => i.id === itemId);
  if (!item) return { ok: false as const, error: "یافت نشد.", status: 404 };
  if (item.ownerUserId !== userId) return { ok: false as const, error: "اجازه نداری.", status: 403 };
  if (item.deletedAt || item.blocked) return { ok: false as const, error: "این محتوا محدود یا حذف شده است.", status: 404 };
  if (!verifyMusic(itemId, userId, token)) return { ok: false as const, error: "لینک منقضی یا نامعتبر است.", status: 403 };
  const buf = await readMusicBlob(userId, itemId);
  if (!buf) return { ok: false as const, error: "فایل نیست.", status: 404 };
  return { ok: true as const, bytes: buf, mime: item.mime };
}

export async function getCatalogFile(userId: string, catalogId: string) {
  const tone = licensedTone(catalogId);
  if (!tone) return { ok: false as const, error: "یافت نشد.", status: 404 };
  const claims = await readStoreSnapshot();
  const blocked = (claims.musicClaims ?? []).some((c) => c.catalogId === catalogId && c.status === "removed");
  if (blocked) return { ok: false as const, error: "این محتوا طبق قوانین سرویس محدود است.", status: 404 };
  void userId;
  return { ok: true as const, bytes: toneWav(tone), mime: "audio/wav" };
}

export async function savePlaylist(userId: string, input: { id?: string; name: string; trackIds?: string[]; delete?: boolean }) {
  const name = input.name.trim().slice(0, 48);
  return mutateStore((data) => {
    prefsOf(data, userId);
    if (input.id && input.delete) {
      const album = data.musicPlaylists.find((a) => a.id === input.id && a.ownerUserId === userId);
      if (!album) return { ok: false as const, error: "پلی‌لیست نیست.", status: 404 };
      album.deletedAt = Date.now();
      return { ok: true as const };
    }
    if (input.id) {
      const album = data.musicPlaylists.find((a) => a.id === input.id && a.ownerUserId === userId && !a.deletedAt);
      if (!album) return { ok: false as const, error: "پلی‌لیست نیست.", status: 404 };
      if (name) album.name = name;
      if (Array.isArray(input.trackIds)) album.trackIds = input.trackIds.slice(0, 80);
      return { ok: true as const, playlist: { id: album.id, name: album.name, trackIds: album.trackIds } };
    }
    if (name.length < 1) return { ok: false as const, error: "نام پلی‌لیست خالی است.", status: 400 };
    const playlist: MusicPlaylist = {
      id: randomId(),
      ownerUserId: userId,
      name,
      trackIds: (input.trackIds ?? []).slice(0, 80),
      createdAt: Date.now(),
      deletedAt: null,
    };
    data.musicPlaylists.unshift(playlist);
    return { ok: true as const, playlist: { id: playlist.id, name: playlist.name, trackIds: playlist.trackIds } };
  });
}

export async function toggleFavorite(userId: string, id: string) {
  return mutateStore((data) => {
    const item = data.musicTracks.find((i) => i.id === id && i.ownerUserId === userId);
    if (!item) return { ok: false as const, error: "یافت نشد.", status: 404 };
    item.favorite = !item.favorite;
    return { ok: true as const, favorite: item.favorite };
  });
}

export async function deleteTracks(userId: string, ids: string[]) {
  return mutateStore(async (data) => {
    let n = 0;
    for (const id of ids.slice(0, 40)) {
      const item = data.musicTracks.find((i) => i.id === id && i.ownerUserId === userId);
      if (!item) continue;
      item.deletedAt = Date.now();
      data.musicTracks = data.musicTracks.filter((i) => i.id !== id);
      await deleteMusicBlob(userId, id);
      n += 1;
    }
    return { ok: true as const, count: n };
  });
}

export async function clearMusicCache(userId: string) {
  return mutateStore((data) => {
    let n = 0;
    for (const item of data.musicTracks.filter((i) => i.ownerUserId === userId && i.cache && !i.deletedAt)) {
      item.deletedAt = Date.now();
      n += 1;
    }
    return { ok: true as const, count: n };
  });
}

export async function markPlayed(userId: string, id: string, catalog: boolean, positionMs: number) {
  return mutateStore((data) => {
    const p = prefsOf(data, userId);
    p.lastTrackId = catalog ? `c:${id}` : id;
    p.lastPositionMs = Math.max(0, positionMs);
    p.recentlyPlayed = [{ id, catalog, at: Date.now() }, ...p.recentlyPlayed.filter((r) => r.id !== id)].slice(0, 40);
    if (!catalog) {
      const item = data.musicTracks.find((i) => i.id === id && i.ownerUserId === userId);
      if (item) item.lastPositionMs = Math.max(0, positionMs);
    }
    return { ok: true as const };
  });
}

export async function updateMusicPrefs(
  userId: string,
  patch: Partial<Pick<MusicPrefs, "autoWifi" | "autoMobile" | "autoRoaming" | "quality" | "speed" | "dataSaver" | "notifyPlayback" | "backgroundPlayback" | "lastQueue">>,
) {
  return mutateStore((data) => {
    const p = prefsOf(data, userId);
    if (typeof patch.autoWifi === "boolean") p.autoWifi = patch.autoWifi;
    if (typeof patch.autoMobile === "boolean") p.autoMobile = patch.autoMobile;
    if (typeof patch.autoRoaming === "boolean") p.autoRoaming = patch.autoRoaming;
    if (patch.quality === "standard" || patch.quality === "high" || patch.quality === "original") p.quality = patch.quality;
    if (typeof patch.speed === "number" && [0.5, 1, 1.5, 2].includes(patch.speed)) p.speed = patch.speed;
    if (typeof patch.dataSaver === "boolean") p.dataSaver = patch.dataSaver;
    if (typeof patch.notifyPlayback === "boolean") p.notifyPlayback = patch.notifyPlayback;
    if (typeof patch.backgroundPlayback === "boolean") p.backgroundPlayback = patch.backgroundPlayback;
    if (Array.isArray(patch.lastQueue)) p.lastQueue = patch.lastQueue.map(String).slice(0, 80);
    return { ok: true as const };
  });
}

export async function reportMusic(userId: string, input: { trackId?: string; catalogId?: string; reason: string }) {
  const reason = input.reason.trim().slice(0, 80) || "other";
  return mutateStore((data) => {
    data.musicClaims ??= [];
    data.musicClaims.unshift({
      id: randomId(),
      userId,
      trackId: input.trackId ?? null,
      catalogId: input.catalogId ?? null,
      reason,
      status: reason === "copyright" ? "review" : "open",
      createdAt: Date.now(),
    });
    if (input.trackId && reason === "malware") {
      const item = data.musicTracks.find((i) => i.id === input.trackId && i.ownerUserId === userId);
      if (item) item.blocked = true;
    }
    return { ok: true as const };
  });
}

export async function removeUnauthorized(userId: string, catalogId: string) {
  return mutateStore((data) => {
    data.musicClaims ??= [];
    data.musicClaims.unshift({
      id: randomId(),
      userId,
      trackId: null,
      catalogId,
      reason: "copyright",
      status: "removed",
      createdAt: Date.now(),
    });
    return { ok: true as const };
  });
}
