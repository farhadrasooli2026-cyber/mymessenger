import { json, jsonError } from "@/lib/http";
import { config } from "@/lib/config";
import { grantAdmin, isAdmin } from "@/lib/admin";
import { adminAddCategory, adminAddItem, adminDeleteItem, adminUpdateItem, listCatalog } from "@/lib/profile";

export async function GET() {
  if (!(await isAdmin())) return jsonError("دسترسی مدیر لازم است.", 401);
  const catalog = await listCatalog();
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
    const result = await adminAddCategory(body.en || "New", body.fa || "جدید");
    return json(result);
  }
  if (body.action === "add-item") {
    const svg =
      body.svg ||
      `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><rect width="64" height="64" rx="20" fill="#102824"/><circle cx="32" cy="32" r="14" fill="#fbbf24"/></svg>`;
    const result = await adminAddItem(body.categoryId, body.title || "Avatar", svg);
    if (!result.ok) return jsonError(result.error);
    return json(result);
  }
  if (body.action === "delete-item") {
    await adminDeleteItem(body.id);
    return json({ ok: true });
  }
  if (body.action === "update-item") {
    const result = await adminUpdateItem(body.id, {
      title: body.title,
      categoryId: body.categoryId,
      sort: body.sort ? Number(body.sort) : undefined,
      svg: body.svg,
    });
    if (!result.ok) return jsonError(result.error ?? "به‌روز نشد.");
    return json(result);
  }
  return jsonError("عملیات ناشناخته است.");
}
