import { json, jsonError } from "@/lib/http";
import { requireActiveUser } from "@/lib/auth";
import { listFileIndex } from "@/lib/file-access";

export async function GET(request: Request) {
  const user = await requireActiveUser();
  if (!user) return jsonError("نشست فعال نیست.", 401);
  const url = new URL(request.url);
  const result = await listFileIndex(user.id, {
    q: url.searchParams.get("q") ?? undefined,
    type: url.searchParams.get("type") ?? undefined,
    chat: url.searchParams.get("chat") ?? undefined,
    minSize: url.searchParams.get("minSize") ? Number(url.searchParams.get("minSize")) : undefined,
    maxSize: url.searchParams.get("maxSize") ? Number(url.searchParams.get("maxSize")) : undefined,
    from: url.searchParams.get("from") ? Number(url.searchParams.get("from")) : undefined,
    to: url.searchParams.get("to") ? Number(url.searchParams.get("to")) : undefined,
    sort: url.searchParams.get("sort") ?? undefined,
    offset: url.searchParams.get("offset") ? Number(url.searchParams.get("offset")) : 0,
  });
  if (!result.ok) return jsonError(result.error, result.status);
  return json(result);
}
