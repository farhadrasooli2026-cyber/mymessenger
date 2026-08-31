import { json, jsonError } from "@/lib/http";
import { requireActiveUser } from "@/lib/auth";
import { joinByToken, peekCallLink } from "@/lib/group-calls";

type Ctx = { params: Promise<{ token: string }> };

export async function GET(_request: Request, ctx: Ctx) {
  const user = await requireActiveUser();
  if (!user) return jsonError("برای ورود به تماس باید وارد حساب NIXO شوید.", 401);
  const { token } = await ctx.params;
  const peek = await peekCallLink(user.id, token);
  if (!peek.ok) return jsonError(peek.error, peek.status);
  return json({ ok: true, peek });
}

export async function POST(_request: Request, ctx: Ctx) {
  const user = await requireActiveUser();
  if (!user) return jsonError("برای ورود به تماس باید وارد حساب NIXO شوید.", 401);
  const { token } = await ctx.params;
  const r = await joinByToken(user.id, token);
  if (!r.ok) return jsonError(r.error, r.status);
  return json({ ok: true, call: r.call });
}
