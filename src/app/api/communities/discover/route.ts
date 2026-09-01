import { json, jsonError } from "@/lib/http";
import { requireActiveUser } from "@/lib/auth";
import { discoverCommunities } from "@/lib/communities";

export async function GET(request: Request) {
  const user = await requireActiveUser();
  if (!user) return jsonError("نشست فعال نیست.", 401);
  const q = new URL(request.url).searchParams.get("q") ?? "";
  const communities = await discoverCommunities(user.id, q);
  return json({ ok: true, communities });
}
