import { json, jsonError } from "@/lib/http";
import { requireActiveUser } from "@/lib/auth";
import {
  addStaff,
  analytics,
  attachBot,
  attachChannel,
  businessAi,
  cartAdd,
  createBusiness,
  createBusinessSchema,
  customerChat,
  customerMessage,
  dashboard,
  getBusiness,
  getCart,
  inbox,
  listBusinesses,
  listOrders,
  mineBusiness,
  myOrders,
  patchThread,
  payStub,
  placeOrder,
  publishBusinessStory,
  reportBusiness,
  requestVerification,
  searchProducts,
  setOrderStatus,
  setQuickReply,
  staffReply,
  threadMessages,
  updateBusiness,
  upsertProduct,
  viewProduct,
} from "@/lib/business";
import type { BizPerms, DayHours, InboxLabel, OrderStatus } from "@/lib/business-types";
import { ORDER_STATUSES } from "@/lib/business-types";

export async function GET(request: Request) {
  const user = await requireActiveUser();
  if (!user) return jsonError("نشست فعال نیست.", 401);
  const url = new URL(request.url);
  const mine = url.searchParams.get("mine") === "1";
  const id = url.searchParams.get("id");
  const username = url.searchParams.get("username");
  const q = url.searchParams.get("q") ?? "";
  const category = url.searchParams.get("category") ?? "";
  const view = url.searchParams.get("view");
  const businessId = url.searchParams.get("businessId") ?? id ?? "";

  if (mine) {
    const rows = await mineBusiness(user.id);
    return json({ ok: true, businesses: rows });
  }
  if (view === "dashboard" && businessId) {
    const dash = await dashboard(user.id, businessId);
    if (!dash) return jsonError("اجازهٔ داشبورد نداری.", 403);
    return json({ ok: true, ...dash });
  }
  if (view === "inbox" && businessId) {
    const result = await inbox(user.id, businessId, url.searchParams.get("filter") ?? undefined);
    if (!result.ok) return jsonError(result.error, result.status);
    return json(result);
  }
  if (view === "thread") {
    const result = await threadMessages(user.id, url.searchParams.get("threadId") ?? "");
    if (!result.ok) return jsonError(result.error, result.status);
    return json(result);
  }
  if (view === "customerChat" && businessId) {
    const result = await customerChat(user.id, businessId);
    return json(result);
  }
  if (view === "cart" && businessId) {
    const cart = await getCart(user.id, businessId);
    return json({ ok: true, cart });
  }
  if (view === "orders" && businessId) {
    const result = await listOrders(user.id, businessId);
    if (!result.ok) return jsonError(result.error, result.status);
    return json(result);
  }
  if (view === "myOrders") {
    const orders = await myOrders(user.id);
    return json({ ok: true, orders });
  }
  if (view === "analytics" && businessId) {
    const result = await analytics(user.id, businessId);
    if (!result.ok) return jsonError(result.error, result.status);
    return json(result);
  }
  if (view === "products" && businessId) {
    const products = await searchProducts(businessId, q, url.searchParams.get("kind") ?? undefined);
    return json({ ok: true, products });
  }
  if (id || username) {
    const row = await getBusiness(id || username || "", user.id);
    if (!row) return jsonError("کسب‌وکار یافت نشد.", 404);
    return json({ ok: true, ...row });
  }
  const businesses = await listBusinesses(q, category || undefined);
  return json({ ok: true, businesses });
}

export async function POST(request: Request) {
  const user = await requireActiveUser();
  if (!user) return jsonError("نشست فعال نیست.", 401);
  const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
  if (!body || typeof body.action !== "string") return jsonError("درخواست نامعتبر است.");
  const action = body.action;
  const businessId = String(body.businessId ?? "");

  if (action === "create") {
    const parsed = createBusinessSchema.safeParse(body);
    if (!parsed.success) return jsonError("نام، @username، دسته و توضیح لازم است.");
    const result = await createBusiness(user.id, parsed.data);
    if (!result.ok) return jsonError(result.error, result.status);
    return json(result);
  }
  if (action === "update") {
    const result = await updateBusiness(user.id, businessId, body as Partial<{ name: string }>);
    if (!result.ok) return jsonError(result.error, result.status);
    return json(result);
  }
  if (action === "hours") {
    const hours = body.hours as DayHours[];
    const result = await updateBusiness(user.id, businessId, { hours });
    if (!result.ok) return jsonError(result.error, result.status);
    return json(result);
  }
  if (action === "product") {
    const result = await upsertProduct(user.id, businessId, {
      id: typeof body.id === "string" ? body.id : undefined,
      kind: body.kind === "service" ? "service" : "product",
      name: String(body.name ?? ""),
      description: String(body.description ?? ""),
      price: Number(body.price ?? 0),
      currency: typeof body.currency === "string" ? body.currency : "USD",
      stock: body.stock === null || body.stock === undefined ? (body.kind === "service" ? null : Number(body.stock ?? 0)) : Number(body.stock),
      category: typeof body.category === "string" ? body.category : "general",
      code: typeof body.code === "string" ? body.code : undefined,
      photoDataUrl: typeof body.photoDataUrl === "string" ? body.photoDataUrl : undefined,
    });
    if (!result.ok) return jsonError(result.error, result.status);
    return json(result);
  }
  if (action === "viewProduct") {
    const result = await viewProduct(businessId, String(body.productId ?? ""));
    if (!result.ok) return jsonError(result.error, result.status);
    return json(result);
  }
  if (action === "staff") {
    const result = await addStaff(user.id, businessId, String(body.username ?? ""), (body.perms ?? {}) as Partial<BizPerms>);
    if (!result.ok) return jsonError(result.error, result.status);
    return json(result);
  }
  if (action === "quickReply") {
    const result = await setQuickReply(user.id, businessId, String(body.command ?? ""), String(body.text ?? ""));
    if (!result.ok) return jsonError(result.error, result.status);
    return json(result);
  }
  if (action === "message") {
    const result = await customerMessage(user.id, businessId, String(body.text ?? ""));
    if (!result.ok) return jsonError(result.error, result.status);
    return json(result);
  }
  if (action === "staffReply") {
    const result = await staffReply(user.id, String(body.threadId ?? ""), String(body.text ?? ""));
    if (!result.ok) return jsonError(result.error, result.status);
    return json(result);
  }
  if (action === "thread") {
    const result = await patchThread(user.id, String(body.threadId ?? ""), {
      important: typeof body.important === "boolean" ? body.important : undefined,
      archived: typeof body.archived === "boolean" ? body.archived : undefined,
      spam: typeof body.spam === "boolean" ? body.spam : undefined,
      unread: typeof body.unread === "boolean" ? body.unread : undefined,
      label: typeof body.label === "string" ? (body.label as InboxLabel) : undefined,
    });
    if (!result.ok) return jsonError(result.error, result.status);
    return json(result);
  }
  if (action === "cart") {
    const result = await cartAdd(user.id, businessId, String(body.productId ?? ""), Math.max(1, Number(body.qty ?? 1)));
    if (!result.ok) return jsonError(result.error, result.status);
    return json(result);
  }
  if (action === "order") {
    const result = await placeOrder(user.id, businessId, String(body.delivery ?? ""));
    if (!result.ok) return jsonError(result.error, result.status);
    return json(result);
  }
  if (action === "orderStatus") {
    const status = String(body.status ?? "") as OrderStatus;
    if (!ORDER_STATUSES.includes(status)) return jsonError("وضعیت سفارش نامعتبر است.");
    const result = await setOrderStatus(user.id, String(body.orderId ?? ""), status);
    if (!result.ok) return jsonError(result.error, result.status);
    return json(result);
  }
  if (action === "verify") {
    const result = await requestVerification(user.id, businessId, String(body.documents ?? ""));
    if (!result.ok) return jsonError(result.error, result.status);
    return json(result);
  }
  if (action === "attachBot") {
    const result = await attachBot(user.id, businessId, String(body.botId ?? ""));
    if (!result.ok) return jsonError(result.error, result.status);
    return json(result);
  }
  if (action === "attachChannel") {
    const result = await attachChannel(user.id, businessId, String(body.channelId ?? ""));
    if (!result.ok) return jsonError(result.error, result.status);
    return json(result);
  }
  if (action === "story") {
    const result = await publishBusinessStory(user.id, businessId, String(body.body ?? ""));
    if (!result.ok) return jsonError(result.error, "status" in result ? result.status : 400);
    return json(result);
  }
  if (action === "ai") {
    const task = body.task as "reply" | "translate" | "summary" | "ad" | "product" | "faq";
    const result = await businessAi(user.id, businessId, task, String(body.text ?? ""));
    if (!result.ok) return jsonError(result.error, result.status);
    return json(result);
  }
  if (action === "pay") {
    const result = await payStub();
    return jsonError(result.error, result.status);
  }
  if (action === "report") {
    const result = await reportBusiness(user.id, businessId, String(body.category ?? "other"), String(body.details ?? ""));
    if (!result.ok) return jsonError(result.error, result.status);
    return json(result);
  }
  return jsonError("عملیات ناشناخته است.");
}
