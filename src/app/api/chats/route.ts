import { json, jsonError } from "@/lib/http";
import { requireActiveUser } from "@/lib/auth";
import { listThreads, openDm } from "@/lib/chat";

export async function GET() {
  const user = await requireActiveUser();
  if (!user) return jsonError("نشست فعال نیست.", 401);
  const threads = await listThreads(user.id);
  return json({ ok: true, threads });
}

export async function POST(request: Request) {
  const user = await requireActiveUser();
  if (!user) return jsonError("نشست فعال نیست.", 401);
  const body = (await request.json().catch(() => null)) as { peerId?: string } | null;
  if (!body?.peerId) return jsonError("کاربر نامعتبر است.");
  const result = await openDm(user.id, body.peerId);
  if (!result.ok) return jsonError(result.error, result.status);
  return json(result);
}
