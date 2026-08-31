import { json, jsonError } from "@/lib/http";
import { requireActiveUser } from "@/lib/auth";
import { listThreads } from "@/lib/chat";

export async function GET() {
  const user = await requireActiveUser();
  if (!user) return jsonError("نشست فعال نیست.", 401);
  const threads = await listThreads(user.id);
  return json({ ok: true, threads });
}
