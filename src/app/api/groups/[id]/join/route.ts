import { json, jsonError } from "@/lib/http";
import { requireActiveUser } from "@/lib/auth";
import { joinGroup } from "@/lib/groups";

type Ctx = { params: Promise<{ id: string }> };

export async function POST(request: Request, ctx: Ctx) {
  const user = await requireActiveUser();
  if (!user) return jsonError("نشست فعال نیست.", 401);
  const { id } = await ctx.params;
  const body = (await request.json().catch(() => null)) as { acceptRules?: boolean } | null;
  const result = await joinGroup(user.id, id, { acceptRules: Boolean(body?.acceptRules) });
  if (!result.ok) return jsonError(result.error, result.status);
  return json({
    ok: true,
    pending: "pending" in result ? result.pending : undefined,
    already: "already" in result ? result.already : undefined,
    group: "group" in result ? result.group : undefined,
  });
}
