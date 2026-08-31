import { json, jsonError } from "@/lib/http";
import { config } from "@/lib/config";
import { grantAdmin, isAdmin } from "@/lib/admin";
import { adminAddBgCategory, adminAddBgItem, adminDeleteBgItem, listBgCatalog } from "@/lib/appearance";

export async function GET() {
  if (!(await isAdmin())) return jsonError("دسترسی مدیر لازم است.", 401);
  const catalog = await listBgCatalog();
  return json({ ok: true, ...catalog });
}

export async function POST(request: Request) {
  const body = (await request.json().catch(() => null)) as Record<string, string> | null;
  if (!body) return jsonError("درخواست نامعتبر است.");
  if (body.action === "login") {
    if (body.key !== config.adminKey) return jsonError("کلید نادرست است.", 401);
    await grantAdmin();
    return json({ ok: true });
  }
  if (!(await isAdmin())) return jsonError("دسترسی مدیر لازم است.", 401);
  if (body.action === "add-category") {
    return json(await adminAddBgCategory(body.en || "New", body.fa || "جدید"));
  }
  if (body.action === "add-item") {
    const svg =
      body.svg ||
      `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 96 64"><rect width="96" height="64" fill="#102824"/></svg>`;
    const result = await adminAddBgItem(body.categoryId, body.title || "Background", svg);
    if (!result.ok) return jsonError(result.error);
    return json(result);
  }
  if (body.action === "delete-item") {
    await adminDeleteBgItem(body.id);
    return json({ ok: true });
  }
  return jsonError("عملیات ناشناخته است.");
}
