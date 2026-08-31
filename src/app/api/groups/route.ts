import { json, jsonError } from "@/lib/http";
import { requireActiveUser } from "@/lib/auth";
import { createGroup, listGroups } from "@/lib/groups";

export async function GET() {
  const user = await requireActiveUser();
  if (!user) return jsonError("نشست فعال نیست.", 401);
  const groups = await listGroups(user.id);
  return json({ ok: true, groups });
}

export async function POST(request: Request) {
  const user = await requireActiveUser();
  if (!user) return jsonError("نشست فعال نیست.", 401);
  const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
  if (!body) return jsonError("درخواست نامعتبر است.");
  const result = await createGroup(user.id, {
    name: String(body.name ?? ""),
    description: typeof body.description === "string" ? body.description : "",
    color: typeof body.color === "string" ? body.color : undefined,
    memberKeys: Array.isArray(body.memberKeys) ? body.memberKeys.map(String) : [],
    joinMode: body.joinMode === "open" || body.joinMode === "request" || body.joinMode === "invite" ? body.joinMode : "invite",
    username: typeof body.username === "string" ? body.username : undefined,
  });
  if (!result.ok) return jsonError(result.error, result.status);
  return json({ ok: true, group: result.group });
}
