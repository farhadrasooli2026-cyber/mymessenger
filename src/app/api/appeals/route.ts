import { json, jsonError } from "@/lib/http";
import { requireVerifiedUser } from "@/lib/auth";
import { fileAppeal, listMyAppeals } from "@/lib/admin-moderation";

export async function GET() {
  const user = await requireVerifiedUser();
  if (!user) return jsonError("نشست فعال نیست.", 401);
  return json({ ok: true, appeals: await listMyAppeals(user.id) });
}

export async function POST(request: Request) {
  const user = await requireVerifiedUser();
  if (!user) return jsonError("نشست فعال نیست.", 401);
  const body = (await request.json().catch(() => null)) as { body?: string; kind?: "ban" | "suspend" | "content" | "warning"; targetId?: string } | null;
  const r = await fileAppeal(user.id, body?.kind ?? "ban", body?.body ?? "", body?.targetId ?? "");
  if (!r.ok) return jsonError(r.error, r.status);
  return json(r);
}
