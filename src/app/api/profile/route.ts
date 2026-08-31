import { json, jsonError } from "@/lib/http";
import { requireActiveUser } from "@/lib/auth";
import { profileInputSchema, updateProfile } from "@/lib/profile";

export async function PATCH(request: Request) {
  const me = await requireActiveUser();
  if (!me) return jsonError("نشست فعال نیست.", 401);
  const body = await request.json().catch(() => null);
  const parsed = profileInputSchema.partial().safeParse(body);
  if (!parsed.success) return jsonError("اطلاعات پروفایل معتبر نیست.");
  const result = await updateProfile(me.id, parsed.data);
  if (!result.ok) return jsonError(result.error, result.status);
  return json({ ok: true, user: result.user });
}
