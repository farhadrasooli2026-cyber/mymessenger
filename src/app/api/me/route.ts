import { json, jsonError } from "@/lib/http";
import { requireActiveUser } from "@/lib/auth";
import { clearSession } from "@/lib/session";

export async function GET() {
  const user = await requireActiveUser();
  if (!user) return jsonError("نشست فعال نیست.", 401);
  return json({ ok: true, user });
}

export async function DELETE() {
  await clearSession();
  return json({ ok: true });
}
