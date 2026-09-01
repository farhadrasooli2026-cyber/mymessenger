import { json, jsonError } from "@/lib/http";
import { requireActiveUser } from "@/lib/auth";
import { joinLiveInvite, peekLiveInvite } from "@/lib/live";

type Ctx = { params: Promise<{ token: string }> };

export async function GET(_req: Request, ctx: Ctx) {
  const user = await requireActiveUser();
  const { token } = await ctx.params;
  const result = await peekLiveInvite(user?.id ?? null, token);
  if (!result.ok) return jsonError(result.error, result.status);
  return json(result);
}

export async function POST(_req: Request, ctx: Ctx) {
  const user = await requireActiveUser();
  if (!user) return jsonError("برای ورود به Live باید وارد حساب NIXO شوی.", 401);
  const { token } = await ctx.params;
  const result = await joinLiveInvite(user.id, token);
  if (!result.ok) return jsonError(result.error, result.status);
  return json({ ok: true, live: result.live });
}
