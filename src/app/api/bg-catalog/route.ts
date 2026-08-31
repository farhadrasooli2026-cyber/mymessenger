import { json, jsonError } from "@/lib/http";
import { requireVerifiedUser } from "@/lib/auth";
import { listBgCatalog } from "@/lib/appearance";

export async function GET() {
  const me = await requireVerifiedUser();
  if (!me) return jsonError("نشست معتبر نیست.", 401);
  const catalog = await listBgCatalog();
  return json({ ok: true, ...catalog });
}
