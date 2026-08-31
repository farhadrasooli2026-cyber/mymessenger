import { json, jsonError } from "@/lib/http";
import { requireActiveUser, requireVerifiedUser } from "@/lib/auth";
import { appearanceSchema, getAppearance, resetAppearance, updateAppearance } from "@/lib/appearance";

export async function GET() {
  const me = (await requireActiveUser()) ?? (await requireVerifiedUser());
  if (!me) return jsonError("نشست معتبر نیست.", 401);
  const appearance = await getAppearance(me.id);
  return json({ ok: true, appearance });
}

export async function PATCH(request: Request) {
  const me = (await requireActiveUser()) ?? (await requireVerifiedUser());
  if (!me) return jsonError("نشست معتبر نیست.", 401);
  const body = await request.json().catch(() => null);
  const parsed = appearanceSchema.safeParse(body);
  if (!parsed.success) return jsonError("تنظیمات ظاهر معتبر نیست.");
  const result = await updateAppearance(me.id, parsed.data);
  if (!result.ok) return jsonError(result.error, result.status);
  return json({ ok: true, appearance: result.appearance });
}

export async function DELETE() {
  const me = await requireActiveUser();
  if (!me) return jsonError("نشست فعال نیست.", 401);
  const result = await resetAppearance(me.id);
  if (!result.ok) return jsonError(result.error, result.status);
  return json({ ok: true, appearance: result.appearance });
}
