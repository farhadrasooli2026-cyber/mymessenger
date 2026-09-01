import { json, jsonError } from "@/lib/http";
import { requireActiveUser } from "@/lib/auth";
import { discoverGroups, recommendGroups } from "@/lib/group-discovery";

export async function GET(request: Request) {
  const user = await requireActiveUser();
  if (!user) return jsonError("نشست فعال نیست.", 401);
  const url = new URL(request.url);
  const q = url.searchParams.get("q") ?? "";
  const category = url.searchParams.get("category") ?? undefined;
  const tag = url.searchParams.get("tag") ?? undefined;
  const mode = url.searchParams.get("mode");
  if (mode === "recommend") {
    const groups = await recommendGroups(user.id);
    return json({ ok: true, groups });
  }
  const groups = await discoverGroups(user.id, { q, category, tag });
  return json({ ok: true, groups });
}
