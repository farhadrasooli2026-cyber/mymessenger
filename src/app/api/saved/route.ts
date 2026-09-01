import { json, jsonError } from "@/lib/http";
import { requireActiveUser } from "@/lib/auth";
import {
  bulkMove,
  deleteAllSaved,
  deleteFolder,
  deleteSaved,
  exportSaved,
  listSaved,
  restoreBackup,
  restoreSaved,
  saveFolder,
  saveItem,
} from "@/lib/saved";
import { SAVED_KINDS, type SavedKind, type SavedSort } from "@/lib/saved-types";

export async function GET(request: Request) {
  const user = await requireActiveUser();
  if (!user) return jsonError("نشست فعال نیست.", 401);
  const url = new URL(request.url);
  if (url.searchParams.get("export") === "1") {
    const result = await exportSaved(user.id);
    if (!result.ok) return jsonError(result.error, result.status);
    return json(result);
  }
  const sort = url.searchParams.get("sort") as SavedSort | null;
  const listed = await listSaved(user.id, {
    q: url.searchParams.get("q") ?? "",
    kind: url.searchParams.get("kind") ?? "all",
    tag: url.searchParams.get("tag") ?? undefined,
    folder: url.searchParams.get("folder") ?? undefined,
    chatId: url.searchParams.get("chatId") ?? undefined,
    fromDate: url.searchParams.get("fromDate") ? Number(url.searchParams.get("fromDate")) : undefined,
    toDate: url.searchParams.get("toDate") ? Number(url.searchParams.get("toDate")) : undefined,
    sort: sort ?? undefined,
    trash: url.searchParams.get("trash") === "1",
    offset: url.searchParams.get("offset") ? Number(url.searchParams.get("offset")) : 0,
  });
  if (!listed.ok) return jsonError(listed.error, listed.status);
  return json(listed);
}

export async function POST(request: Request) {
  const user = await requireActiveUser();
  if (!user) return jsonError("نشست فعال نیست.", 401);
  const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
  if (!body) return jsonError("درخواست نامعتبر است.");
  const action = String(body.action ?? "");
  if (action === "delete") {
    const ids = Array.isArray(body.ids) ? body.ids.map(String) : [];
    const mode = body.permanent ? "permanent" : "trash";
    const result = await deleteSaved(user.id, ids, mode);
    return json(result);
  }
  if (action === "restore") {
    const ids = Array.isArray(body.ids) ? body.ids.map(String) : [];
    return json(await restoreSaved(user.id, ids));
  }
  if (action === "delete-all") {
    const result = await deleteAllSaved(user.id, String(body.confirm ?? ""));
    if (!result.ok) return jsonError(result.error, result.status);
    return json(result);
  }
  if (action === "folder-save") {
    const result = await saveFolder(user.id, body);
    if (!result.ok) return jsonError(result.error, result.status);
    return json(result);
  }
  if (action === "folder-delete") {
    const result = await deleteFolder(user.id, String(body.id ?? ""));
    if (!result.ok) return jsonError(result.error, result.status);
    return json(result);
  }
  if (action === "bulk-move") {
    const ids = Array.isArray(body.ids) ? body.ids.map(String) : [];
    return json(await bulkMove(user.id, ids, body.folderId == null ? null : String(body.folderId)));
  }
  if (action === "restore-backup") {
    const bundle = body.bundle && typeof body.bundle === "object" ? (body.bundle as { items?: unknown[] }) : { items: [] };
    return json(await restoreBackup(user.id, bundle));
  }
  const kindRaw = String(body.kind ?? "text");
  const kind: SavedKind = (SAVED_KINDS as readonly string[]).includes(kindRaw) ? (kindRaw as SavedKind) : "text";
  const source =
    body.source && typeof body.source === "object"
      ? (body.source as { type?: string; id?: string; name?: string; messageId?: string })
      : null;
  const result = await saveItem(user.id, {
    kind,
    body: typeof body.body === "string" ? body.body : "",
    notes: typeof body.notes === "string" ? body.notes : "",
    linkUrl: typeof body.linkUrl === "string" ? body.linkUrl : "",
    fileName: typeof body.fileName === "string" ? body.fileName : "",
    fileType: typeof body.fileType === "string" ? body.fileType : "",
    fileSize: typeof body.fileSize === "number" ? body.fileSize : 0,
    media: typeof body.media === "string" ? body.media : "",
    tag: typeof body.tag === "string" ? body.tag : "",
    tags: Array.isArray(body.tags) ? body.tags.map(String) : undefined,
    bookmark: Boolean(body.bookmark),
    favorite: Boolean(body.favorite),
    folderId: typeof body.folderId === "string" ? body.folderId : null,
    source:
      source &&
      (source.type === "chat" ||
        source.type === "group" ||
        source.type === "channel" ||
        source.type === "community" ||
        source.type === "manual") &&
      source.id
        ? {
            type: source.type,
            id: String(source.id),
            name: String(source.name ?? ""),
            messageId: source.messageId ? String(source.messageId) : undefined,
          }
        : { type: "manual", id: "manual", name: "دستی" },
  });
  if (!result.ok) return jsonError(result.error, result.status);
  return json({ ok: true, item: result.item });
}
