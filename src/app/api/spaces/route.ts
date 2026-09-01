import { json, jsonError } from "@/lib/http";
import { requireActiveUser } from "@/lib/auth";
import { searchSpaces, spacesDashboard } from "@/lib/spaces-center";

export async function GET(request: Request) {
  const user = await requireActiveUser();
  if (!user) return jsonError("نشست فعال نیست.", 401);
  const url = new URL(request.url);
  if (url.searchParams.get("view") === "center") {
    return json(await spacesDashboard(user.id));
  }
  const result = await searchSpaces(user.id, {
    q: url.searchParams.get("q") ?? undefined,
    kind: url.searchParams.get("kind") ?? undefined,
    limit: url.searchParams.get("limit") ? Number(url.searchParams.get("limit")) : undefined,
  });
  return json(result);
}
