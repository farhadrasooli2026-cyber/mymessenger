import { json, jsonError } from "@/lib/http";
import { requireActiveUser } from "@/lib/auth";
import { bulkInbox, deleteFolder, listInbox, patchInbox, readAllInbox, reorderFolders, saveFolder, setOrgPrefs } from "@/lib/inbox";

export async function GET(request: Request) {
  const user = await requireActiveUser();
  if (!user) return jsonError("نشست فعال نیست.", 401);
  const url = new URL(request.url);
  const result = await listInbox(user.id, url.searchParams.get("folder") ?? "all", url.searchParams.get("q") ?? "", url.searchParams.get("scope") ?? "folder");
  if (!result.ok) return jsonError(result.error, result.status);
  return json(result);
}

export async function POST(request: Request) {
  const user = await requireActiveUser();
  if (!user) return jsonError("نشست فعال نیست.", 401);
  const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
  if (!body) return jsonError("درخواست نامعتبر است.");
  const action = String(body.action ?? "");
  if (action === "prefs") {
    const result = await setOrgPrefs(user.id, body);
    if (!result.ok) return jsonError(result.error, result.status);
    return json(result);
  }
  if (action === "folder-save") {
    const result = await saveFolder(user.id, body);
    if (!result.ok) return jsonError(result.error, result.status, "folder" in result ? { folder: result.folder } : undefined);
    return json(result);
  }
  if (action === "folder-delete") {
    const result = await deleteFolder(user.id, String(body.id ?? ""));
    if (!result.ok) return jsonError(result.error, result.status);
    return json(result);
  }
  if (action === "folder-reorder") {
    const ids = Array.isArray(body.ids) ? body.ids.map(String) : [];
    const result = await reorderFolders(user.id, ids);
    if (!result.ok) return jsonError(result.error, result.status);
    return json(result);
  }
  if (action === "read-all") {
    return json(await readAllInbox(user.id));
  }
  if (action === "bulk") {
    const keys = Array.isArray(body.keys) ? body.keys.map(String) : [];
    const result = await bulkInbox(user.id, keys, String(body.bulk ?? "read"), body);
    if (!result.ok) return jsonError(result.error, result.status);
    return json(result);
  }
  if (!body.key) return jsonError("گفتگو نامعتبر است.");
  const result = await patchInbox(user.id, String(body.key), action, body);
  if (!result.ok) return jsonError(result.error, result.status);
  return json(result);
}
