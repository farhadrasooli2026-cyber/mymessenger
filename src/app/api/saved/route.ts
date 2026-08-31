import { json, jsonError } from "@/lib/http";
import { requireActiveUser } from "@/lib/auth";
import { deleteSaved, listSaved, saveItem } from "@/lib/saved";

export async function GET(request: Request) {
  const user = await requireActiveUser();
  if (!user) return jsonError("نشست فعال نیست.", 401);
  const url = new URL(request.url);
  const listed = await listSaved(user.id, {
    q: url.searchParams.get("q") ?? "",
    kind: url.searchParams.get("kind") ?? "all",
    tag: url.searchParams.get("tag") ?? undefined,
    offset: url.searchParams.get("offset") ? Number(url.searchParams.get("offset")) : 0,
  });
  return json({ ok: true, ...listed });
}

export async function POST(request: Request) {
  const user = await requireActiveUser();
  if (!user) return jsonError("نشست فعال نیست.", 401);
  const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
  if (!body) return jsonError("درخواست نامعتبر است.");
  if (body.action === "delete") {
    const ids = Array.isArray(body.ids) ? body.ids.map(String) : [];
    const result = await deleteSaved(user.id, ids);
    return json(result);
  }
  const kind =
    body.kind === "photo" ||
    body.kind === "video" ||
    body.kind === "voice" ||
    body.kind === "file" ||
    body.kind === "link" ||
    body.kind === "message" ||
    body.kind === "text"
      ? body.kind
      : "text";
  const source =
    body.source && typeof body.source === "object"
      ? (body.source as { type?: string; id?: string; name?: string; messageId?: string })
      : null;
  const result = await saveItem(user.id, {
    kind,
    body: typeof body.body === "string" ? body.body : "",
    linkUrl: typeof body.linkUrl === "string" ? body.linkUrl : "",
    fileName: typeof body.fileName === "string" ? body.fileName : "",
    fileType: typeof body.fileType === "string" ? body.fileType : "",
    fileSize: typeof body.fileSize === "number" ? body.fileSize : 0,
    media: typeof body.media === "string" ? body.media : "",
    tag: typeof body.tag === "string" ? body.tag : "",
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
