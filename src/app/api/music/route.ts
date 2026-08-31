import { json, jsonError } from "@/lib/http";
import { requireActiveUser } from "@/lib/auth";
import {
  addMusicTrack,
  catalogPublic,
  clearMusicCache,
  deleteTracks,
  listMusic,
  markPlayed,
  reportMusic,
  savePlaylist,
  toggleFavorite,
  updateMusicPrefs,
} from "@/lib/music";
import type { MusicKind } from "@/lib/music-types";

const KINDS: MusicKind[] = ["music", "song", "podcast", "voice", "file"];

export async function GET(request: Request) {
  const user = await requireActiveUser();
  if (!user) return jsonError("نشست فعال نیست.", 401);
  const url = new URL(request.url);
  const kindRaw = url.searchParams.get("kind");
  const kind = kindRaw && KINDS.includes(kindRaw as MusicKind) ? (kindRaw as MusicKind) : kindRaw === "all" ? "all" : undefined;
  const result = await listMusic(user.id, {
    kind,
    q: url.searchParams.get("q") ?? undefined,
    filter: url.searchParams.get("filter") ?? undefined,
  });
  return json({ ...result, catalog: result.catalog.length ? result.catalog : catalogPublic() });
}

export async function POST(request: Request) {
  const user = await requireActiveUser();
  if (!user) return jsonError("نشست فعال نیست.", 401);
  const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
  if (!body) return jsonError("درخواست نامعتبر است.");
  if (body.action === "prefs") {
    const result = await updateMusicPrefs(user.id, {
      autoWifi: typeof body.autoWifi === "boolean" ? body.autoWifi : undefined,
      autoMobile: typeof body.autoMobile === "boolean" ? body.autoMobile : undefined,
      autoRoaming: typeof body.autoRoaming === "boolean" ? body.autoRoaming : undefined,
      quality: body.quality === "standard" || body.quality === "high" || body.quality === "original" ? body.quality : undefined,
      speed: typeof body.speed === "number" ? body.speed : undefined,
      dataSaver: typeof body.dataSaver === "boolean" ? body.dataSaver : undefined,
      notifyPlayback: typeof body.notifyPlayback === "boolean" ? body.notifyPlayback : undefined,
      lastQueue: Array.isArray(body.lastQueue) ? body.lastQueue.map(String) : undefined,
    });
    return json(result);
  }
  if (body.action === "playlist") {
    const result = await savePlaylist(user.id, {
      id: typeof body.id === "string" ? body.id : undefined,
      name: String(body.name ?? ""),
      trackIds: Array.isArray(body.trackIds) ? body.trackIds.map(String) : undefined,
      delete: Boolean(body.delete),
    });
    if (!result.ok) return jsonError(result.error, result.status);
    return json({ ok: true, playlist: "playlist" in result ? result.playlist : undefined });
  }
  if (body.action === "favorite") {
    const result = await toggleFavorite(user.id, String(body.id ?? ""));
    if (!result.ok) return jsonError(result.error, result.status);
    return json(result);
  }
  if (body.action === "delete") {
    const result = await deleteTracks(user.id, Array.isArray(body.ids) ? body.ids.map(String) : []);
    return json(result);
  }
  if (body.action === "clear-cache") {
    return json(await clearMusicCache(user.id));
  }
  if (body.action === "played") {
    return json(await markPlayed(user.id, String(body.id ?? ""), Boolean(body.catalog), Number(body.positionMs ?? 0)));
  }
  if (body.action === "report") {
    return json(
      await reportMusic(user.id, {
        trackId: typeof body.trackId === "string" ? body.trackId : undefined,
        catalogId: typeof body.catalogId === "string" ? body.catalogId : undefined,
        reason: String(body.reason ?? "other"),
      }),
    );
  }
  if (typeof body.dataUrl !== "string") return jsonError("فایل صوتی لازم است.");
  const result = await addMusicTrack(user.id, {
    name: String(body.name ?? "audio"),
    mime: typeof body.mime === "string" ? body.mime : undefined,
    dataUrl: body.dataUrl,
    kind: typeof body.kind === "string" ? body.kind : undefined,
    title: typeof body.title === "string" ? body.title : undefined,
    artist: typeof body.artist === "string" ? body.artist : undefined,
    album: typeof body.album === "string" ? body.album : undefined,
    durationMs: typeof body.durationMs === "number" ? body.durationMs : undefined,
    cache: Boolean(body.cache),
  });
  if (!result.ok) return jsonError(result.error, result.status);
  return json({ ok: true, item: result.item });
}
