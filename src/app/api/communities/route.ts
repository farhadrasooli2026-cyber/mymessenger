import { json, jsonError } from "@/lib/http";
import { requireActiveUser } from "@/lib/auth";
import { createCommunity, listCommunities } from "@/lib/communities";

export async function GET() {
  const user = await requireActiveUser();
  if (!user) return jsonError("نشست فعال نیست.", 401);
  const communities = await listCommunities(user.id);
  return json({ ok: true, communities });
}

export async function POST(request: Request) {
  const user = await requireActiveUser();
  if (!user) return jsonError("نشست فعال نیست.", 401);
  const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
  if (!body) return jsonError("درخواست نامعتبر است.");
  const result = await createCommunity(user.id, {
    name: String(body.name ?? ""),
    description: typeof body.description === "string" ? body.description : "",
    color: typeof body.color === "string" ? body.color : undefined,
    username: typeof body.username === "string" ? body.username : undefined,
    joinMode: body.joinMode === "open" || body.joinMode === "request" || body.joinMode === "invite" ? body.joinMode : "invite",
    groupIds: Array.isArray(body.groupIds) ? body.groupIds.map(String) : [],
    channelNames: Array.isArray(body.channelNames) ? body.channelNames.map(String) : [],
  });
  if (!result.ok) return jsonError(result.error, result.status);
  return json({ ok: true, community: result.community });
}
