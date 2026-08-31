import { json, jsonError } from "@/lib/http";
import { requireActiveUser } from "@/lib/auth";
import { upsertProduct } from "@/lib/business";
import {
  cancelOrder,
  confirmSandboxPay,
  checkout,
  deleteAddress,
  getOrder,
  getShopPublic,
  listAddresses,
  listCoupons,
  myNotices,
  openDispute,
  payDashboard,
  payWithWallet,
  pollPayment,
  processRefund,
  quote,
  rejectCardPlain,
  reportShopItem,
  requestRefund,
  saveAddress,
  upsertCoupon,
  upsertShop,
  walletAction,
  walletView,
} from "@/lib/shop";
import { myOrders } from "@/lib/business";
import type { PayMethod } from "@/lib/shop-types";

export async function GET(request: Request) {
  const user = await requireActiveUser();
  if (!user) return jsonError("نشست فعال نیست.", 401);
  const url = new URL(request.url);
  const view = url.searchParams.get("view");
  const businessId = url.searchParams.get("businessId") ?? "";
  const orderId = url.searchParams.get("orderId") ?? "";
  const paymentId = url.searchParams.get("paymentId") ?? "";

  if (view === "shop" && businessId) {
    const row = await getShopPublic(businessId);
    if (!row) return jsonError("فروشگاه نیست.", 404);
    return json({ ok: true, ...row });
  }
  if (view === "quote" && businessId) {
    const q = await quote(user.id, businessId, url.searchParams.get("coupon") ?? "", url.searchParams.get("delivery") ?? "pickup");
    return json(q);
  }
  if (view === "addresses") return json({ ok: true, addresses: await listAddresses(user.id) });
  if (view === "orders") return json({ ok: true, orders: await myOrders(user.id) });
  if (view === "order" && orderId) {
    const row = await getOrder(user.id, orderId);
    if (!row.ok) return jsonError(row.error, row.status);
    return json(row);
  }
  if (view === "payment" && paymentId) {
    const row = await pollPayment(user.id, paymentId);
    if (!row.ok) return jsonError(row.error, row.status);
    return json(row);
  }
  if (view === "wallet") return json({ ok: true, ...(await walletView(user.id)) });
  if (view === "dashboard" && businessId) {
    const row = await payDashboard(user.id, businessId);
    if (!row.ok) return jsonError(row.error, row.status);
    return json(row);
  }
  if (view === "coupons" && businessId) return json({ ok: true, coupons: await listCoupons(user.id, businessId) });
  if (view === "notices") return json({ ok: true, notices: await myNotices(user.id) });
  return jsonError("view نامعتبر است.");
}

export async function POST(request: Request) {
  const user = await requireActiveUser();
  if (!user) return jsonError("نشست فعال نیست.", 401);
  const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
  if (!body || typeof body.action !== "string") return jsonError("درخواست نامعتبر است.");
  if (rejectCardPlain(body)) {
    return jsonError("شماره کارت و CVV در نیکسو ذخیره یا پذیرفته نمی‌شود. فقط توکن درگاه.", 400);
  }
  const businessId = String(body.businessId ?? "");

  if (body.action === "shop") {
    const result = await upsertShop(user.id, businessId, body as { name?: string });
    if (!result.ok) return jsonError(result.error, result.status);
    return json(result);
  }
  if (body.action === "productExtra") {
    const result = await upsertProduct(user.id, businessId, {
      id: typeof body.id === "string" ? body.id : undefined,
      kind: body.kind === "service" ? "service" : "product",
      name: String(body.name ?? ""),
      description: String(body.description ?? ""),
      price: Number(body.price ?? 0),
      stock: body.stock === null || body.stock === undefined ? undefined : Number(body.stock),
      currency: typeof body.currency === "string" ? body.currency : undefined,
      variants: Array.isArray(body.variants) ? (body.variants as { name: string; values: string[] }[]) : undefined,
      variantRows: Array.isArray(body.variantRows) ? (body.variantRows as { key: string; stock: number | null; priceDelta: number }[]) : undefined,
      discount: body.discount && typeof body.discount === "object" ? (body.discount as { kind: "percent" | "amount"; value: number }) : undefined,
    });
    if (!result.ok) return jsonError(result.error, result.status);
    return json(result);
  }
  if (body.action === "address") {
    const result = await saveAddress(user.id, {
      id: typeof body.id === "string" ? body.id : undefined,
      label: String(body.label ?? "خانه"),
      line: String(body.line ?? ""),
      city: String(body.city ?? ""),
      country: String(body.country ?? ""),
      isDefault: Boolean(body.isDefault),
    });
    return json(result);
  }
  if (body.action === "addressDelete") {
    return json(await deleteAddress(user.id, String(body.id ?? "")));
  }
  if (body.action === "coupon") {
    const result = await upsertCoupon(user.id, businessId, {
      code: String(body.code ?? ""),
      kind: body.kind === "amount" ? "amount" : "percent",
      value: Number(body.value ?? 0),
      days: Number(body.days ?? 30),
      usageLimit: Number(body.usageLimit ?? 100),
      minOrder: Number(body.minOrder ?? 0),
      maxDiscount: body.maxDiscount == null ? null : Number(body.maxDiscount),
    });
    if (!result.ok) return jsonError(result.error, result.status);
    return json(result);
  }
  if (body.action === "checkout") {
    const result = await checkout(user.id, businessId, {
      addressId: String(body.addressId ?? ""),
      deliveryId: String(body.deliveryId ?? "standard"),
      couponCode: String(body.couponCode ?? ""),
      method: (["card", "bank", "wallet", "other"].includes(String(body.method)) ? body.method : "card") as PayMethod,
      clientTotal: typeof body.clientTotal === "number" ? body.clientTotal : undefined,
      idempotencyKey: typeof body.idempotencyKey === "string" ? body.idempotencyKey : undefined,
    });
    if (!result.ok) return jsonError(result.error, result.status);
    return json(result);
  }
  if (body.action === "paySandbox") {
    const result = await confirmSandboxPay(user.id, String(body.paymentId ?? ""), body.outcome === "fail" ? "fail" : body.outcome === "pending" ? "pending" : "success");
    if (!result.ok) return jsonError(result.error, result.status);
    return json(result);
  }
  if (body.action === "payWallet") {
    const result = await payWithWallet(user.id, String(body.paymentId ?? ""), body.confirm === true);
    if (!result.ok) return jsonError(result.error, result.status);
    return json(result);
  }
  if (body.action === "cancel") {
    const result = await cancelOrder(user.id, String(body.orderId ?? ""));
    if (!result.ok) return jsonError(result.error, result.status);
    return json(result);
  }
  if (body.action === "refund") {
    const result = await requestRefund(user.id, String(body.orderId ?? ""));
    if (!result.ok) return jsonError(result.error, result.status);
    return json(result);
  }
  if (body.action === "refundProcess") {
    const result = await processRefund(user.id, String(body.refundId ?? ""), body.outcome === "failed" ? "failed" : "completed");
    if (!result.ok) return jsonError(result.error, result.status);
    return json(result);
  }
  if (body.action === "wallet") {
    const result = await walletAction(user.id, {
      action: body.op === "withdraw" ? "withdraw" : body.op === "transfer" ? "transfer" : "add",
      amount: Number(body.amount ?? 0),
      currency: String(body.currency ?? "USD"),
      confirm: body.confirm === true,
      toUsername: typeof body.toUsername === "string" ? body.toUsername : undefined,
    });
    if (!result.ok) return jsonError(result.error, result.status);
    return json(result);
  }
  if (body.action === "dispute") {
    const result = await openDispute(user.id, String(body.orderId ?? ""), String(body.reason ?? ""));
    if (!result.ok) return jsonError(result.error, result.status);
    return json(result);
  }
  if (body.action === "report") {
    const result = await reportShopItem(
      user.id,
      body.targetKind === "product" ? "product" : "shop",
      String(body.targetKey ?? ""),
      String(body.category ?? "other"),
      String(body.details ?? ""),
    );
    if (!result.ok) return jsonError(result.error, result.status);
    return json(result);
  }
  return jsonError("عملیات ناشناخته است.");
}
