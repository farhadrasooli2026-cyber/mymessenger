import { json, jsonError } from "@/lib/http";
import { requireVerifiedUser } from "@/lib/auth";
import { listCatalog } from "@/lib/profile";

export async function GET() {
  const me = await requireVerifiedUser();
  if (!me) return jsonError("نشست معتبر نیست.", 401);
  const catalog = await listCatalog();
  return json({ ok: true, ...catalog });
}
