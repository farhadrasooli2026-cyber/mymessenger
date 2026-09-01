import { json, jsonError } from "@/lib/http";
import { requireActiveUser } from "@/lib/auth";
import { rotateInvite } from "@/lib/groups";

type Ctx = { params: Promise<{ id: string }> };

export async function POST(request: Request, ctx: Ctx) {
  const user = await requireActiveUser();
  if (!user) return jsonError("نشست فعال نیست.", 401);
  const { id } = await ctx.params;
  const body = (await request.json().catch(() => null)) as {
    action?: string;
    expiresInHours?: number | null;
    maxUses?: number | null;
  } | null;
  const action = body?.action === "revoke" ? "revoke" : "new";
  const result = await rotateInvite(user.id, id, action, {
    expiresInHours: body?.expiresInHours === null ? null : typeof body?.expiresInHours === "number" ? body.expiresInHours : undefined,
    maxUses: body?.maxUses === null ? null : typeof body?.maxUses === "number" ? body.maxUses : undefined,
  });
  if (!result.ok) return jsonError(result.error, result.status);
  return json({ ok: true, inviteToken: result.inviteToken });
}
