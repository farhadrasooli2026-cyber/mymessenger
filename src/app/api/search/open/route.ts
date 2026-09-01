import { json, jsonError } from "@/lib/http";
import { requireActiveUser } from "@/lib/auth";
import { openSearchResult } from "@/lib/search";

export async function GET(request: Request) {
  const user = await requireActiveUser();
  if (!user) return jsonError("نشست فعال نیست.", 401);
  const id = new URL(request.url).searchParams.get("id") ?? "";
  const result = await openSearchResult(user.id, id);
  if (!result.ok) return jsonError(result.error, result.status);
  return json(result);
}
