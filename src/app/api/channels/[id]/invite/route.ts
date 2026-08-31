import { json, jsonError } from "@/lib/http";
import { requireActiveUser } from "@/lib/auth";
import { rotateInvite } from "@/lib/channels";

type Ctx = { params: Promise<{ id: string }> };

export async function POST(request: Request, ctx: Ctx) {
  const user = await requireActiveUser();
  if (!user) return jsonError("نشست فعال نیست.", 401);
  const { id } = await ctx.params;
  const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
  const action = body?.action === "revoke" ? "revoke" : "new";
  const result = await rotateInvite(user.id, id, action, {
    maxUses: body?.maxUses === null ? null : typeof body?.maxUses === "number" ? body.maxUses : undefined,
    expiresInMs: body?.expiresInMs === null ? null : typeof body?.expiresInMs === "number" ? body.expiresInMs : undefined,
  });
  if (!result.ok) return jsonError(result.error, result.status);
  return json({ ok: true, inviteToken: result.inviteToken, inviteMaxUses: result.inviteMaxUses, inviteExpiresAt: result.inviteExpiresAt });
}
