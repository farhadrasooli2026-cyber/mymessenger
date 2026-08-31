import { json, jsonError } from "@/lib/http";
import { requireActiveUser } from "@/lib/auth";
import { listBlocked } from "@/lib/safety";

export async function GET() {
  const user = await requireActiveUser();
  if (!user) return jsonError("نشست فعال نیست.", 401);
  const blocked = await listBlocked(user.id);
  return json({ ok: true, blocked });
}
