import { json, jsonError } from "@/lib/http";
import { requireActiveUser } from "@/lib/auth";
import { joinByToken, previewInvite } from "@/lib/communities";

type Ctx = { params: Promise<{ token: string }> };

export async function GET(_req: Request, ctx: Ctx) {
  const { token } = await ctx.params;
  const preview = await previewInvite(token);
  if (!preview) return jsonError("لینک دعوت نامعتبر یا باطل است.", 404);
  return json({ ok: true, community: preview });
}

export async function POST(request: Request, ctx: Ctx) {
  const user = await requireActiveUser();
  if (!user) return jsonError("نشست فعال نیست.", 401);
  const { token } = await ctx.params;
  const body = (await request.json().catch(() => null)) as { acceptRules?: boolean } | null;
  const result = await joinByToken(user.id, token, { acceptRules: Boolean(body?.acceptRules) });
  if (!result.ok) return jsonError(result.error, result.status);
  return json({
    ok: true,
    pending: "pending" in result ? result.pending : undefined,
    already: "already" in result ? result.already : undefined,
    community: "community" in result ? result.community : undefined,
  });
}
