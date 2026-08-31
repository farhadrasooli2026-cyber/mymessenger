import { json, jsonError } from "@/lib/http";
import { requireActiveUser } from "@/lib/auth";
import { publishAnnouncement } from "@/lib/communities";

type Ctx = { params: Promise<{ id: string }> };

export async function POST(request: Request, ctx: Ctx) {
  const user = await requireActiveUser();
  if (!user) return jsonError("نشست فعال نیست.", 401);
  const { id } = await ctx.params;
  const body = (await request.json().catch(() => null)) as { body?: string } | null;
  const result = await publishAnnouncement(user.id, id, String(body?.body ?? ""));
  if (!result.ok) return jsonError(result.error, result.status);
  return json({ ok: true, community: result.community });
}
