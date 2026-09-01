import { json, jsonError } from "@/lib/http";
import { requireActiveUser } from "@/lib/auth";
import {
  createPack,
  deleteOwnedSticker,
  exportStickerData,
  installPack,
  patchStickerPrefs,
  reportSticker,
  sharePack,
  snapshotStickers,
  toggleFavoriteSticker,
  touchEmoji,
  uploadSticker,
} from "@/lib/stickers";
import { hitRateLimit } from "@/lib/rate-limit";
import { mutateStore } from "@/lib/store";

export async function GET(request: Request) {
  const user = await requireActiveUser();
  if (!user) return jsonError("نشست فعال نیست.", 401);
  const url = new URL(request.url);
  if (url.searchParams.get("export") === "1") {
    return json({ ok: true, export: await exportStickerData(user.id) });
  }
  const q = url.searchParams.get("q") ?? undefined;
  if (q) {
    const limited = await mutateStore((data) => hitRateLimit(data, `stsearch:${user.id}`, 60_000, 40));
    if (!limited.allowed) return jsonError("جستجو محدود شد.", 429);
  }
  const suggest = url.searchParams.get("suggest") ?? undefined;
  const snap = await snapshotStickers(user.id, q, suggest);
  return json(snap);
}

export async function POST(request: Request) {
  const user = await requireActiveUser();
  if (!user) return jsonError("نشست فعال نیست.", 401);
  const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
  if (!body) return jsonError("درخواست نامعتبر است.");
  const action = String(body.action ?? "");
  if (action === "prefs") {
    const result = await patchStickerPrefs(user.id, body as never);
    return json(result);
  }
  if (action === "emoji") {
    const result = await touchEmoji(user.id, String(body.emoji ?? ""), typeof body.favorite === "boolean" ? body.favorite : undefined);
    if (!result.ok) return jsonError(result.error, result.status);
    return json(result);
  }
  if (action === "install" || action === "uninstall") {
    const result = await installPack(user.id, String(body.packId ?? body.token ?? ""), action === "install");
    if (!result.ok) return jsonError(result.error, result.status);
    return json(result);
  }
  if (action === "createPack") {
    const result = await createPack(user.id, String(body.name ?? ""), body.privacy === "private" ? "private" : "public");
    if (!result.ok) return jsonError(result.error, result.status);
    return json(result);
  }
  if (action === "upload") {
    const result = await uploadSticker(user.id, String(body.packId ?? ""), {
      name: String(body.name ?? ""),
      emoji: typeof body.emoji === "string" ? body.emoji : undefined,
      dataUrl: String(body.dataUrl ?? ""),
      kind: body.kind === "animated" ? "animated" : "static",
      tags: Array.isArray(body.tags) ? body.tags.map(String) : undefined,
    });
    if (!result.ok) return jsonError(result.error, result.status);
    return json(result);
  }
  if (action === "deleteSticker") {
    const result = await deleteOwnedSticker(user.id, String(body.stickerId ?? ""));
    if (!result.ok) return jsonError(result.error, result.status);
    return json(result);
  }
  if (action === "share") {
    const result = await sharePack(user.id, String(body.packId ?? ""), typeof body.memberId === "string" ? body.memberId : undefined);
    if (!result.ok) return jsonError(result.error, result.status);
    return json(result);
  }
  if (action === "favoriteSticker") {
    const result = await toggleFavoriteSticker(user.id, String(body.stickerId ?? ""));
    if (!result.ok) return jsonError(result.error, result.status);
    return json(result);
  }
  if (action === "report") {
    const result = await reportSticker(user.id, String(body.packId ?? ""), typeof body.stickerId === "string" ? body.stickerId : undefined, String(body.reason ?? "abuse"));
    if (!result.ok) return jsonError(result.error, result.status);
    return json({ ok: true });
  }
  return jsonError("عملیات نامعتبر است.");
}
