import { json, jsonError } from "@/lib/http";
import { requireActiveUser } from "@/lib/auth";
import { addContact, searchUsers } from "@/lib/profile";

export async function GET(request: Request) {
  const me = await requireActiveUser();
  if (!me) return jsonError("نشست فعال نیست.", 401);
  const q = new URL(request.url).searchParams.get("q") ?? "";
  const users = await searchUsers(q, me.id);
  return json({ ok: true, users });
}

export async function POST(request: Request) {
  const me = await requireActiveUser();
  if (!me) return jsonError("نشست فعال نیست.", 401);
  const body = (await request.json().catch(() => null)) as { userId?: string } | null;
  if (!body?.userId) return jsonError("کاربر نامعتبر است.");
  await addContact(me.id, body.userId);
  return json({ ok: true });
}
