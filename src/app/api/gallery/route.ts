import { json, jsonError } from "@/lib/http";
import { requireActiveUser } from "@/lib/auth";
import {
  addGalleryItem,
  clearGalleryCache,
  listChatMediaIndex,
  listGallery,
  restoreItems,
  saveAlbum,
  setGalleryPrivacy,
  trashItems,
  unlockGallery,
  updateGalleryPrefs,
} from "@/lib/gallery";
import type { GalleryKind } from "@/lib/gallery-types";

const KINDS: GalleryKind[] = ["photo", "video", "gif", "voice", "audio", "document", "file", "link"];

export async function GET(request: Request) {
  const user = await requireActiveUser();
  if (!user) return jsonError("نشست فعال نیست.", 401);
  const url = new URL(request.url);
  if (url.searchParams.get("chats") === "1") {
    const chats = await listChatMediaIndex(user.id);
    return json({ ok: true, chats });
  }
  const kindRaw = url.searchParams.get("kind");
  const kind = kindRaw && KINDS.includes(kindRaw as GalleryKind) ? (kindRaw as GalleryKind) : kindRaw === "all" ? "all" : undefined;
  const result = await listGallery(user.id, {
    kind,
    q: url.searchParams.get("q") ?? undefined,
    from: url.searchParams.get("from") ? Number(url.searchParams.get("from")) : undefined,
    to: url.searchParams.get("to") ? Number(url.searchParams.get("to")) : undefined,
    chat: url.searchParams.get("chat") ?? undefined,
    albumId: url.searchParams.get("album") ?? undefined,
    trash: url.searchParams.get("trash") === "1",
    pin: url.searchParams.get("pin") ?? undefined,
  });
  if (!result.ok) return jsonError(result.error, result.status);
  return json(result);
}

export async function POST(request: Request) {
  const user = await requireActiveUser();
  if (!user) return jsonError("نشست فعال نیست.", 401);
  const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
  if (!body) return jsonError("درخواست نامعتبر است.");
  if (body.action === "unlock") {
    const result = await unlockGallery(user.id, String(body.pin ?? ""));
    if (!result.ok) return jsonError(result.error, result.status);
    return json({ ok: true });
  }
  if (body.action === "prefs") {
    const result = await updateGalleryPrefs(user.id, {
      autoWifi: typeof body.autoWifi === "boolean" ? body.autoWifi : undefined,
      autoMobile: typeof body.autoMobile === "boolean" ? body.autoMobile : undefined,
      autoRoaming: typeof body.autoRoaming === "boolean" ? body.autoRoaming : undefined,
      autoSave: typeof body.autoSave === "boolean" ? body.autoSave : undefined,
      uploadQuality: body.uploadQuality === "standard" || body.uploadQuality === "high" || body.uploadQuality === "original" ? body.uploadQuality : undefined,
      downloadQuality: body.downloadQuality === "standard" || body.downloadQuality === "high" || body.downloadQuality === "original" ? body.downloadQuality : undefined,
      dataSaver: typeof body.dataSaver === "boolean" ? body.dataSaver : undefined,
      autoFiles: body.autoFiles === "wifi" || body.autoFiles === "mobile" || body.autoFiles === "never" ? body.autoFiles : undefined,
      previewFiles: typeof body.previewFiles === "boolean" ? body.previewFiles : undefined,
      lockPin: typeof body.lockPin === "string" ? body.lockPin : undefined,
    });
    if (!result.ok) return jsonError("ذخیره نشد.");
    return json({ ok: true });
  }
  if (body.action === "album") {
    const result = await saveAlbum(user.id, {
      id: typeof body.id === "string" ? body.id : undefined,
      name: String(body.name ?? ""),
      itemIds: Array.isArray(body.itemIds) ? body.itemIds.map(String) : undefined,
      delete: Boolean(body.delete),
    });
    if (!result.ok) return jsonError(result.error, result.status);
    return json({ ok: true, album: "album" in result ? result.album : undefined });
  }
  if (body.action === "trash") {
    const result = await trashItems(user.id, Array.isArray(body.ids) ? body.ids.map(String) : [], Boolean(body.permanent));
    return json(result);
  }
  if (body.action === "restore") {
    const result = await restoreItems(user.id, Array.isArray(body.ids) ? body.ids.map(String) : []);
    return json(result);
  }
  if (body.action === "clear-cache") {
    const result = await clearGalleryCache(user.id);
    return json(result);
  }
  if (body.action === "privacy") {
    const privacy = body.privacy === "shared" || body.privacy === "public" ? body.privacy : "private";
    const result = await setGalleryPrivacy(user.id, Array.isArray(body.ids) ? body.ids.map(String) : [], privacy);
    return json(result);
  }
  const result = await addGalleryItem(user.id, {
    name: String(body.name ?? "file"),
    mime: typeof body.mime === "string" ? body.mime : undefined,
    dataUrl: typeof body.dataUrl === "string" ? body.dataUrl : undefined,
    linkUrl: typeof body.linkUrl === "string" ? body.linkUrl : undefined,
    caption: typeof body.caption === "string" ? body.caption : undefined,
    privacy: body.privacy === "shared" || body.privacy === "public" ? body.privacy : "private",
    sourceChat: typeof body.sourceChat === "string" ? body.sourceChat : undefined,
    cache: Boolean(body.cache),
    thumb: typeof body.thumb === "string" ? body.thumb : undefined,
  });
  if (!result.ok) return jsonError(result.error, result.status);
  return json({ ok: true, item: result.item, duplicate: "duplicate" in result ? result.duplicate : false });
}
