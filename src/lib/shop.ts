import "server-only";
import { createHmac, timingSafeEqual } from "node:crypto";
import { config } from "@/lib/config";
import { randomId } from "@/lib/crypto-utils";
import { hitRateLimit } from "@/lib/rate-limit";
import { mutateStore, readStoreSnapshot, type StoreData } from "@/lib/store";
import { can } from "@/lib/business";
import type { BizOrder, BizProduct } from "@/lib/business-types";
import {
  DEFAULT_DELIVERY,
  FX_SOURCE,
  convertAmount,
  seedShop,
  type CouponRecord,
  type DeliveryOption,
  type InvoiceRecord,
  type LedgerTx,
  type PayMethod,
  type PaymentRecord,
  type ShopRecord,
  type UserAddress,
} from "@/lib/shop-types";

const CARD_KEYS = ["cardNumber", "pan", "cvv", "cvc", "card", "expiry", "exp"];

export function rejectCardPlain(body: Record<string, unknown> | null) {
  if (!body) return false;
  return CARD_KEYS.some((k) => typeof body[k] === "string" && String(body[k]).replace(/\s/g, "").length >= 12);
}

export function payWebhookSignature(raw: string) {
  return createHmac("sha256", config.pepper).update(raw).digest("hex");
}

function sigOk(raw: string, header: string) {
  const a = Buffer.from(payWebhookSignature(raw));
  const b = Buffer.from(header);
  return a.length === b.length && a.length > 0 && timingSafeEqual(a, b);
}

function notice(data: StoreData, userId: string, kind: "payment" | "refund" | "transfer" | "order", text: string) {
  data.shopNotices ??= [];
  data.shopNotices.unshift({ id: randomId(), userId, kind, text, createdAt: Date.now(), read: false });
  data.shopNotices = data.shopNotices.slice(0, 200);
}

function audit(data: StoreData, userId: string, kind: string, detail: string) {
  data.shopAudit ??= [];
  data.shopAudit.unshift({ id: randomId(), at: Date.now(), userId, kind, detail });
  data.shopAudit = data.shopAudit.slice(0, 400);
}

function walletOf(data: StoreData, userId: string) {
  data.wallets ??= [];
  let w = data.wallets.find((x) => x.userId === userId);
  if (!w) {
    w = { userId, balances: { USD: 0, EUR: 0, TRY: 0 } };
    data.wallets.push(w);
  }
  return w;
}

function ledger(data: StoreData, row: Omit<LedgerTx, "id" | "createdAt">) {
  data.ledger ??= [];
  const tx: LedgerTx = { ...row, id: `NIXO-TX-${randomId().slice(0, 10).toUpperCase()}`, createdAt: Date.now() };
  data.ledger.unshift(tx);
  return tx;
}

export function ensureShop(data: StoreData, businessId: string): ShopRecord {
  data.shops ??= [];
  let s = data.shops.find((x) => x.businessId === businessId);
  if (!s) {
    const b = data.businesses.find((x) => x.id === businessId);
    s = seedShop(businessId, b?.name ?? "Shop", b?.category ?? "other");
    data.shops.push(s);
  }
  if (!s.delivery?.length) s.delivery = DEFAULT_DELIVERY.map((d) => ({ ...d }));
  return s;
}

function unitOf(p: BizProduct, variantKey: string) {
  const delta = p.variantRows?.find((r) => r.key === variantKey)?.priceDelta ?? 0;
  return p.price + delta;
}

function productDisc(unit: number, qty: number, p: BizProduct) {
  const d = p.discount;
  if (!d) return 0;
  const gross = unit * qty;
  if (d.kind === "percent") return Math.min(gross, (gross * Math.max(0, d.value)) / 100);
  return Math.min(gross, Math.max(0, d.value));
}

function couponOff(subtotal: number, coupon: CouponRecord | undefined, now: number) {
  if (!coupon) return 0;
  if (coupon.expiresAt < now) return 0;
  if (coupon.used >= coupon.usageLimit) return 0;
  if (subtotal < coupon.minOrder) return 0;
  let off = coupon.kind === "percent" ? (subtotal * coupon.value) / 100 : coupon.value;
  if (coupon.maxDiscount != null) off = Math.min(off, coupon.maxDiscount);
  return Math.max(0, Math.min(subtotal, off));
}

export function quoteLines(data: StoreData, businessId: string, userId: string, couponCode = "", deliveryId = "pickup") {
  const shop = ensureShop(data, businessId);
  const cart = (data.bizCarts ?? []).find((c) => c.userId === userId && c.businessId === businessId);
  const items = (cart?.items ?? []).map((i) => {
    const p = (data.bizProducts ?? []).find((x) => x.id === i.productId && x.businessId === businessId);
    if (!p) return null;
    const variantKey = i.variantKey || "";
    const unit = unitOf(p, variantKey);
    const discount = productDisc(unit, i.qty, p);
    return {
      productId: p.id,
      name: p.name,
      qty: i.qty,
      price: unit,
      variantKey,
      discount,
      line: unit * i.qty - discount,
      currency: shop.currency,
    };
  }).filter((x): x is NonNullable<typeof x> => Boolean(x));
  const subtotal = items.reduce((s, i) => s + i.price * i.qty, 0);
  const productDiscount = items.reduce((s, i) => s + i.discount, 0);
  const afterProduct = subtotal - productDiscount;
  const coupon = (data.coupons ?? []).find(
    (c) => c.businessId === businessId && c.code === couponCode.trim().toUpperCase(),
  );
  const couponDiscount = couponOff(afterProduct, coupon, Date.now());
  const delivery = shop.delivery.find((d) => d.id === deliveryId) ?? shop.delivery[0];
  const deliveryFee = delivery?.fee ?? 0;
  const discountTotal = productDiscount + couponDiscount;
  const net = afterProduct - couponDiscount + deliveryFee;
  const fee = Math.round((net * shop.feeBps) / 10000 * 100) / 100;
  const total = Math.round((net + fee) * 100) / 100;
  return {
    shop,
    items,
    subtotal,
    discountTotal,
    couponDiscount,
    deliveryFee,
    fee,
    feeBps: shop.feeBps,
    total,
    currency: shop.currency,
    delivery,
    fxSource: FX_SOURCE,
  };
}

export async function upsertShop(userId: string, businessId: string, patch: Partial<ShopRecord>) {
  return mutateStore((data) => {
    if (!can(data, businessId, userId, "manageProfile")) return { ok: false as const, status: 403, error: "اجازهٔ فروشگاه نداری." };
    const s = ensureShop(data, businessId);
    if (typeof patch.name === "string") s.name = patch.name.slice(0, 60);
    if (typeof patch.description === "string") s.description = patch.description.slice(0, 800);
    if (typeof patch.category === "string") s.category = patch.category.slice(0, 40);
    if (typeof patch.currency === "string" && ["USD", "EUR", "TRY"].includes(patch.currency)) s.currency = patch.currency;
    if (Array.isArray(patch.delivery) && patch.delivery.length) s.delivery = patch.delivery.slice(0, 8);
    if (patch.cancelUntil) s.cancelUntil = patch.cancelUntil;
    audit(data, userId, "shop_update", s.businessId);
    return { ok: true as const, shop: s };
  });
}

export async function getShopPublic(businessId: string) {
  const data = await readStoreSnapshot();
  const b = data.businesses.find((x) => x.id === businessId);
  if (!b) return null;
  const shop = (data.shops ?? []).find((s) => s.businessId === businessId) ?? seedShop(businessId, b.name, b.category);
  return { shop, businessName: b.name, verified: b.verified };
}

export async function quote(userId: string, businessId: string, couponCode = "", deliveryId = "pickup") {
  const data = await readStoreSnapshot();
  return { ok: true as const, quote: quoteLines(data, businessId, userId, couponCode, deliveryId) };
}

export async function saveAddress(userId: string, input: { id?: string; label: string; line: string; city: string; country: string; isDefault?: boolean }) {
  return mutateStore((data) => {
    data.addresses ??= [];
    const id = input.id || randomId();
    let row = data.addresses.find((a) => a.id === id && a.userId === userId);
    if (!row) {
      row = { id, userId, label: "", line: "", city: "", country: "", isDefault: false };
      data.addresses.push(row);
    }
    row.label = input.label.slice(0, 40);
    row.line = input.line.slice(0, 200);
    row.city = input.city.slice(0, 80);
    row.country = input.country.slice(0, 80);
    if (input.isDefault) {
      for (const a of data.addresses) if (a.userId === userId) a.isDefault = a.id === id;
      row.isDefault = true;
    }
    return { ok: true as const, address: row };
  });
}

export async function listAddresses(userId: string) {
  const data = await readStoreSnapshot();
  return (data.addresses ?? []).filter((a) => a.userId === userId);
}

export async function deleteAddress(userId: string, id: string) {
  return mutateStore((data) => {
    data.addresses = (data.addresses ?? []).filter((a) => !(a.id === id && a.userId === userId));
    return { ok: true as const };
  });
}

export async function upsertCoupon(
  userId: string,
  businessId: string,
  input: { code: string; kind: "percent" | "amount"; value: number; days: number; usageLimit: number; minOrder: number; maxDiscount?: number | null },
) {
  return mutateStore((data) => {
    if (!can(data, businessId, userId, "managePayments") && !can(data, businessId, userId, "manageProducts")) {
      return { ok: false as const, status: 403, error: "اجازهٔ کوپن نداری." };
    }
    const code = input.code.trim().toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 16);
    if (code.length < 4) return { ok: false as const, status: 400, error: "کد کوپن کوتاه است." };
    data.coupons ??= [];
    const row: CouponRecord = {
      id: randomId(),
      businessId,
      code,
      kind: input.kind,
      value: Math.max(0, input.value),
      expiresAt: Date.now() + Math.max(1, input.days) * 86400_000,
      usageLimit: Math.max(1, input.usageLimit),
      used: 0,
      minOrder: Math.max(0, input.minOrder),
      maxDiscount: input.maxDiscount ?? null,
    };
    data.coupons = data.coupons.filter((c) => !(c.businessId === businessId && c.code === code));
    data.coupons.push(row);
    return { ok: true as const, coupon: { ...row } };
  });
}

export async function checkout(
  userId: string,
  businessId: string,
  input: { addressId: string; deliveryId: string; couponCode?: string; method: PayMethod; clientTotal?: number; idempotencyKey?: string },
) {
  return mutateStore((data) => {
    const flood = hitRateLimit(data, `checkout:${userId}`, 60_000, 12);
    if (!flood.allowed) return { ok: false as const, status: 429, error: "سقف سفارش." };
    const key = input.idempotencyKey?.slice(0, 80);
    if (key) {
      const existingPay = (data.payments ?? []).find((p) => p.idempotencyKey === key);
      if (existingPay) {
        const existingOrder = data.bizOrders.find((o) => o.id === existingPay.orderId);
        if (existingOrder) {
          const q0 = quoteLines(data, businessId, userId, input.couponCode ?? "", input.deliveryId);
          return { ok: true as const, order: publicOrder(data, existingOrder), payment: publicPay(existingPay), quote: q0, duplicate: true };
        }
      }
    }
    const q = quoteLines(data, businessId, userId, input.couponCode ?? "", input.deliveryId);
    if (!q.items.length) return { ok: false as const, status: 400, error: "سبد خالی است." };
    if (typeof input.clientTotal === "number" && Math.abs(input.clientTotal - q.total) > 0.009) {
      audit(data, userId, "price_tamper", `${input.clientTotal}!=${q.total}`);
      return { ok: false as const, status: 409, error: "قیمت سمت سرور با مقدار ارسالی یکی نیست. سفارش ثبت نشد." };
    }
    const addr = (data.addresses ?? []).find((a) => a.id === input.addressId && a.userId === userId);
    if (!addr && input.deliveryId !== "pickup") return { ok: false as const, status: 400, error: "آدرس را انتخاب کن." };
    const cart = (data.bizCarts ?? []).find((c) => c.userId === userId && c.businessId === businessId);
    if (!cart) return { ok: false as const, status: 400, error: "سبد خالی است." };
    for (const i of q.items) {
      const p = data.bizProducts.find((x) => x.id === i.productId)!;
      const row = p.variantRows?.find((r) => r.key === i.variantKey);
      const stock = row ? row.stock : p.stock;
      if (stock !== null && stock < i.qty) return { ok: false as const, status: 400, error: `موجودی ${p.name} کافی نیست.` };
      if (row && row.stock !== null) row.stock -= i.qty;
      else if (p.stock !== null) p.stock -= i.qty;
    }
    if (q.couponDiscount > 0) {
      const c = (data.coupons ?? []).find((x) => x.businessId === businessId && x.code === (input.couponCode ?? "").trim().toUpperCase());
      if (c) c.used += 1;
    }
    const order: BizOrder = {
      id: `NIXO-ORDER-${randomId().slice(0, 8).toUpperCase()}`,
      businessId,
      customerId: userId,
      items: q.items.map(({ productId, name, qty, price, variantKey, discount }) => ({ productId, name, qty, price, variantKey, discount })),
      subtotal: q.subtotal,
      discountTotal: q.discountTotal,
      deliveryFee: q.deliveryFee,
      fee: q.fee,
      total: q.total,
      currency: q.currency,
      status: "payment_pending",
      paymentStatus: "pending",
      delivery: q.delivery?.name ?? "",
      deliveryMethodId: q.delivery?.id ?? input.deliveryId,
      addressSnapshot: addr ? `${addr.label}: ${addr.line}, ${addr.city}, ${addr.country}` : "Pickup",
      couponCode: (input.couponCode ?? "").trim().toUpperCase(),
      invoiceId: null,
      createdAt: Date.now(),
    };
    data.bizOrders ??= [];
    data.bizOrders.unshift(order);
    cart.items = [];
    const pay = createPaymentRow(data, order, input.method, input.idempotencyKey);
    notice(data, userId, "order", `سفارش ${order.id} ثبت شد. پرداخت در انتظار تأیید است.`);
    audit(data, userId, "checkout", order.id);
    return { ok: true as const, order: publicOrder(data, order), payment: publicPay(pay), quote: q };
  });
}

function createPaymentRow(data: StoreData, order: BizOrder, method: PayMethod, idem?: string): PaymentRecord {
  data.payments ??= [];
  const key = idem?.slice(0, 80) || `auto:${order.id}`;
  const existing = data.payments.find((p) => p.idempotencyKey === key);
  if (existing) return existing;
  const pay: PaymentRecord = {
    id: randomId(),
    orderId: order.id,
    businessId: order.businessId,
    userId: order.customerId,
    method,
    amount: order.total,
    currency: order.currency,
    fee: order.fee,
    status: "pending",
    providerTxId: `pay_${randomId()}`,
    idempotencyKey: key,
    last4: method === "card" ? "4242" : null,
    webhookVerified: false,
    createdAt: Date.now(),
    updatedAt: Date.now(),
  };
  data.payments.unshift(pay);
  return pay;
}

function publicPay(p: PaymentRecord) {
  return {
    id: p.id,
    orderId: p.orderId,
    method: p.method,
    amount: p.amount,
    currency: p.currency,
    fee: p.fee,
    status: p.status,
    providerTxId: p.providerTxId,
    last4: p.last4,
    createdAt: p.createdAt,
  };
}

function publicOrder(data: StoreData, o: BizOrder) {
  const u = data.users.find((x) => x.id === o.customerId);
  return {
    ...o,
    customer: { id: o.customerId, displayName: u?.displayName || u?.username || "مشتری", username: u?.username ?? null },
  };
}

function applyPaid(data: StoreData, order: BizOrder, pay: PaymentRecord, webhookVerified: boolean) {
  pay.status = "confirmed";
  pay.webhookVerified = webhookVerified;
  pay.updatedAt = Date.now();
  order.status = "paid";
  order.paymentStatus = "paid";
  const inv: InvoiceRecord = {
    id: `INV-${randomId().slice(0, 8).toUpperCase()}`,
    orderId: order.id,
    userId: order.customerId,
    businessId: order.businessId,
    lines: order.items.map((i) => ({ name: i.name, qty: i.qty, price: i.price, discount: i.discount })),
    subtotal: order.subtotal,
    discountTotal: order.discountTotal,
    deliveryFee: order.deliveryFee,
    fee: order.fee,
    total: order.total,
    currency: order.currency,
    paymentStatus: "paid",
    createdAt: Date.now(),
  };
  data.invoices ??= [];
  data.invoices.unshift(inv);
  order.invoiceId = inv.id;
  data.settlements ??= [];
  data.settlements.unshift({
    id: randomId(),
    businessId: order.businessId,
    orderId: order.id,
    amount: Math.round((order.total - order.fee) * 100) / 100,
    fee: order.fee,
    currency: order.currency,
    status: "available",
    createdAt: Date.now(),
  });
  const biz = data.businesses.find((b) => b.id === order.businessId);
  notice(data, order.customerId, "payment", `پرداخت ${order.id} تأیید شد.`);
  if (biz) notice(data, biz.ownerUserId, "payment", `پرداخت سفارش ${order.id} تأیید شد.`);
}

function applyFailed(data: StoreData, order: BizOrder, pay: PaymentRecord) {
  pay.status = "failed";
  pay.updatedAt = Date.now();
  order.paymentStatus = "failed";
  if (order.status === "paid") return;
  order.status = "payment_pending";
  notice(data, order.customerId, "payment", `پرداخت ${order.id} ناموفق بود. سفارش Paid نشد.`);
}

export async function confirmSandboxPay(userId: string, paymentId: string, outcome: "success" | "fail" | "pending") {
  return mutateStore((data) => {
    const pay = (data.payments ?? []).find((p) => p.id === paymentId);
    if (!pay || pay.userId !== userId) return { ok: false as const, status: 404, error: "پرداخت نیست." };
    const order = data.bizOrders.find((o) => o.id === pay.orderId);
    if (!order) return { ok: false as const, status: 404, error: "سفارش نیست." };
    if (pay.method === "wallet") return { ok: false as const, status: 400, error: "کیف پول از مسیر Wallet پرداخت می‌شود." };
    if (outcome === "pending") {
      pay.status = "pending";
      order.status = "payment_pending";
      order.paymentStatus = "pending";
      return { ok: true as const, payment: publicPay(pay), order: publicOrder(data, order), state: "Payment Pending" };
    }
    if (outcome === "fail") {
      applyFailed(data, order, pay);
      audit(data, userId, "pay_fail", pay.id);
      return { ok: true as const, payment: publicPay(pay), order: publicOrder(data, order), state: "Payment Failed" };
    }
    applyPaid(data, order, pay, false);
    audit(data, userId, "pay_ok", pay.id);
    return { ok: true as const, payment: publicPay(pay), order: publicOrder(data, order), invoice: data.invoices.find((i) => i.id === order.invoiceId), state: "Payment Successful" };
  });
}

export async function payWithWallet(userId: string, paymentId: string, confirm: boolean) {
  return mutateStore((data) => {
    if (!confirm) return { ok: false as const, status: 401, error: "پرداخت از کیف پول نیاز به تأیید نشست دارد." };
    const flood = hitRateLimit(data, `walletpay:${userId}`, 60_000, 8);
    if (!flood.allowed) return { ok: false as const, status: 429, error: "سقف کیف پول." };
    const pay = (data.payments ?? []).find((p) => p.id === paymentId && p.userId === userId);
    if (!pay) return { ok: false as const, status: 404, error: "پرداخت نیست." };
    const order = data.bizOrders.find((o) => o.id === pay.orderId);
    if (!order) return { ok: false as const, status: 404, error: "سفارش نیست." };
    const w = walletOf(data, userId);
    const have = w.balances[pay.currency] ?? 0;
    if (have < pay.amount) return { ok: false as const, status: 400, error: "موجودی کیف پول کافی نیست (سندباکس)." };
    w.balances[pay.currency] = Math.round((have - pay.amount) * 100) / 100;
    ledger(data, {
      userId,
      amount: -pay.amount,
      currency: pay.currency,
      type: "payment",
      status: "completed",
      note: order.id,
      counterparty: order.businessId,
    });
    applyPaid(data, order, pay, true);
    audit(data, userId, "wallet_pay", pay.id);
    return { ok: true as const, payment: publicPay(pay), order: publicOrder(data, order), state: "Payment Successful" };
  });
}

export async function handlePayWebhook(raw: string, signature: string) {
  if (!sigOk(raw, signature)) {
    return { ok: false as const, status: 401, error: "امضای Webhook نامعتبر است." };
  }
  let body: { providerTxId?: string; status?: string; amount?: number; orderId?: string };
  try {
    body = JSON.parse(raw) as typeof body;
  } catch {
    return { ok: false as const, status: 400, error: "بدنه نامعتبر." };
  }
  return mutateStore((data) => {
    const pay = (data.payments ?? []).find((p) => p.providerTxId === body.providerTxId);
    if (!pay) return { ok: false as const, status: 404, error: "تراکنش نیست." };
    if (typeof body.amount === "number" && Math.abs(body.amount - pay.amount) > 0.009) {
      audit(data, pay.userId, "webhook_amount", `${body.amount}`);
      return { ok: false as const, status: 409, error: "مبلغ Webhook با تراکنش یکی نیست." };
    }
    const order = data.bizOrders.find((o) => o.id === pay.orderId);
    if (!order) return { ok: false as const, status: 404, error: "سفارش نیست." };
    if (pay.status === "confirmed" && body.status === "confirmed") {
      return { ok: true as const, duplicate: true, payment: publicPay(pay) };
    }
    if (body.status === "failed") {
      applyFailed(data, order, pay);
      return { ok: true as const, payment: publicPay(pay) };
    }
    if (body.status === "confirmed") {
      applyPaid(data, order, pay, true);
      return { ok: true as const, payment: publicPay(pay) };
    }
    pay.status = "pending";
    order.paymentStatus = "pending";
    return { ok: true as const, payment: publicPay(pay) };
  });
}

export async function getOrder(userId: string, orderId: string) {
  const data = await readStoreSnapshot();
  const o = (data.bizOrders ?? []).find((x) => x.id === orderId);
  if (!o) return { ok: false as const, status: 404, error: "سفارش نیست." };
  const staff = can(data, o.businessId, userId, "manageOrders");
  if (o.customerId !== userId && !staff) return { ok: false as const, status: 403, error: "این سفارش مال تو نیست." };
  const pay = (data.payments ?? []).find((p) => p.orderId === o.id);
  const inv = (data.invoices ?? []).find((i) => i.orderId === o.id);
  return { ok: true as const, order: publicOrder(data, o), payment: pay ? publicPay(pay) : null, invoice: inv ?? null };
}

export async function pollPayment(userId: string, paymentId: string) {
  const data = await readStoreSnapshot();
  const pay = (data.payments ?? []).find((p) => p.id === paymentId);
  if (!pay) return { ok: false as const, status: 404, error: "پرداخت نیست." };
  if (pay.userId !== userId && !can(data, pay.businessId, userId, "managePayments")) {
    return { ok: false as const, status: 403, error: "اجازه نداری." };
  }
  return { ok: true as const, payment: publicPay(pay) };
}

export async function cancelOrder(userId: string, orderId: string) {
  return mutateStore((data) => {
    const o = (data.bizOrders ?? []).find((x) => x.id === orderId);
    if (!o || o.customerId !== userId) return { ok: false as const, status: 404, error: "سفارش نیست." };
    const shop = ensureShop(data, o.businessId);
    const rank = ["payment_pending", "paid", "processing"];
    const limit = rank.indexOf(shop.cancelUntil);
    const cur = rank.indexOf(o.status === "pending" ? "payment_pending" : o.status);
    if (o.status === "shipped" || o.status === "delivered" || o.status === "refunded") {
      return { ok: false as const, status: 400, error: "در این وضعیت لغو ممکن نیست." };
    }
    if (cur >= 0 && limit >= 0 && cur > limit) {
      return { ok: false as const, status: 400, error: "طبق قانون فروشگاه دیگر قابل لغو نیست." };
    }
    if (o.paymentStatus === "paid") {
      return { ok: false as const, status: 400, error: "پس از پرداخت از مسیر Refund اقدام کن." };
    }
    o.status = "cancelled";
    notice(data, userId, "order", `سفارش ${o.id} لغو شد.`);
    return { ok: true as const, order: publicOrder(data, o) };
  });
}

export async function requestRefund(userId: string, orderId: string) {
  return mutateStore((data) => {
    const o = (data.bizOrders ?? []).find((x) => x.id === orderId);
    if (!o) return { ok: false as const, status: 404, error: "سفارش نیست." };
    const staff = can(data, o.businessId, userId, "managePayments");
    if (o.customerId !== userId && !staff) return { ok: false as const, status: 403, error: "اجازهٔ Refund نداری." };
    if (o.paymentStatus !== "paid") return { ok: false as const, status: 400, error: "فقط سفارش پرداخت‌شده Refund می‌شود." };
    data.refunds ??= [];
    const row = {
      id: randomId(),
      orderId: o.id,
      businessId: o.businessId,
      amount: o.total,
      currency: o.currency,
      status: "requested" as const,
      createdAt: Date.now(),
    };
    data.refunds.unshift(row);
    notice(data, o.customerId, "refund", `Refund برای ${o.id} ثبت شد.`);
    return { ok: true as const, refund: row };
  });
}

export async function processRefund(userId: string, refundId: string, outcome: "completed" | "failed") {
  return mutateStore((data) => {
    const r = (data.refunds ?? []).find((x) => x.id === refundId);
    if (!r) return { ok: false as const, status: 404, error: "Refund نیست." };
    if (!can(data, r.businessId, userId, "managePayments")) return { ok: false as const, status: 403, error: "اجازهٔ پرداخت نداری." };
    r.status = "processing";
    const o = data.bizOrders.find((x) => x.id === r.orderId);
    if (!o) return { ok: false as const, status: 404, error: "سفارش نیست." };
    if (outcome === "failed") {
      r.status = "failed";
      return { ok: true as const, refund: r };
    }
    r.status = "completed";
    o.status = "refunded";
    const w = walletOf(data, o.customerId);
    w.balances[r.currency] = Math.round(((w.balances[r.currency] ?? 0) + r.amount) * 100) / 100;
    ledger(data, {
      userId: o.customerId,
      amount: r.amount,
      currency: r.currency,
      type: "refund",
      status: "completed",
      note: o.id,
      counterparty: o.businessId,
    });
    notice(data, o.customerId, "refund", `Refund ${o.id} انجام شد.`);
    audit(data, userId, "refund_ok", r.id);
    return { ok: true as const, refund: r };
  });
}

export async function walletAction(
  userId: string,
  input: { action: "add" | "withdraw" | "transfer"; amount: number; currency: string; confirm: boolean; toUsername?: string },
) {
  return mutateStore((data) => {
    if (!input.confirm) return { ok: false as const, status: 401, error: "عملیات کیف پول نیاز به تأیید صریح دارد." };
    const flood = hitRateLimit(data, `wallet:${userId}:${input.action}`, 60_000, 6);
    if (!flood.allowed) return { ok: false as const, status: 429, error: "سقف کیف پول." };
    const cur = ["USD", "EUR", "TRY"].includes(input.currency) ? input.currency : "USD";
    const amount = Math.round(Math.max(0, input.amount) * 100) / 100;
    if (amount <= 0 || amount > 1000) return { ok: false as const, status: 400, error: "مبلغ سندباکس بین ۰ و ۱۰۰۰ است." };
    const w = walletOf(data, userId);
    if (input.action === "add") {
      w.balances[cur] = Math.round(((w.balances[cur] ?? 0) + amount) * 100) / 100;
      const tx = ledger(data, { userId, amount, currency: cur, type: "add", status: "completed", note: "sandbox issuer", counterparty: null });
      audit(data, userId, "wallet_add", tx.id);
      return { ok: true as const, wallet: w, tx };
    }
    if ((w.balances[cur] ?? 0) < amount) return { ok: false as const, status: 400, error: "موجودی کافی نیست." };
    if (input.action === "withdraw") {
      w.balances[cur] = Math.round(((w.balances[cur] ?? 0) - amount) * 100) / 100;
      const tx = ledger(data, { userId, amount: -amount, currency: cur, type: "withdraw", status: "completed", note: "sandbox", counterparty: null });
      return { ok: true as const, wallet: w, tx };
    }
    const to = data.users.find((u) => u.username === (input.toUsername ?? "").replace(/^@/, "") && u.status === "active");
    if (!to || to.id === userId) return { ok: false as const, status: 404, error: "گیرنده معتبر نیست." };
    w.balances[cur] = Math.round(((w.balances[cur] ?? 0) - amount) * 100) / 100;
    const dest = walletOf(data, to.id);
    dest.balances[cur] = Math.round(((dest.balances[cur] ?? 0) + amount) * 100) / 100;
    ledger(data, { userId, amount: -amount, currency: cur, type: "transfer_out", status: "completed", note: "transfer", counterparty: to.id });
    ledger(data, { userId: to.id, amount, currency: cur, type: "transfer_in", status: "completed", note: "transfer", counterparty: userId });
    notice(data, to.id, "transfer", "انتقال سندباکس دریافت شد.");
    audit(data, userId, "wallet_transfer", to.id);
    return { ok: true as const, wallet: w };
  });
}

export async function walletView(userId: string) {
  const data = await readStoreSnapshot();
  const w = (data.wallets ?? []).find((x) => x.userId === userId) ?? { userId, balances: { USD: 0, EUR: 0, TRY: 0 } };
  const txs = (data.ledger ?? []).filter((t) => t.userId === userId).slice(0, 50);
  return { wallet: w, txs, fxSource: FX_SOURCE, convert: convertAmount };
}

export async function payDashboard(userId: string, businessId: string) {
  const data = await readStoreSnapshot();
  if (!can(data, businessId, userId, "viewAnalytics") && !can(data, businessId, userId, "managePayments")) {
    return { ok: false as const, status: 403, error: "اجازهٔ داشبورد پرداخت نداری." };
  }
  const orders = (data.bizOrders ?? []).filter((o) => o.businessId === businessId);
  const pays = (data.payments ?? []).filter((p) => p.businessId === businessId);
  const refunds = (data.refunds ?? []).filter((r) => r.businessId === businessId);
  const settlements = (data.settlements ?? []).filter((s) => s.businessId === businessId);
  const revenue = pays.filter((p) => p.status === "confirmed").reduce((s, p) => s + p.amount - p.fee, 0);
  return {
    ok: true as const,
    sales: pays.filter((p) => p.status === "confirmed").length,
    orders: orders.length,
    payments: pays.map(publicPay),
    refunds,
    revenue,
    settlements,
    feeNote: "کارمزد قبل از تأیید روی خلاصهٔ سفارش نمایش داده می‌شود.",
  };
}

export async function openDispute(userId: string, orderId: string, reason: string) {
  return mutateStore((data) => {
    const o = (data.bizOrders ?? []).find((x) => x.id === orderId && x.customerId === userId);
    if (!o) return { ok: false as const, status: 404, error: "سفارش نیست." };
    data.disputes ??= [];
    const row = { id: randomId(), userId, orderId, reason: reason.slice(0, 400), status: "open" as const, createdAt: Date.now() };
    data.disputes.unshift(row);
    return { ok: true as const, dispute: row };
  });
}

export async function reportShopItem(userId: string, targetKind: "shop" | "product", targetKey: string, category: string, details: string) {
  return mutateStore((data) => {
    const limit = hitRateLimit(data, `report:${userId}`, 60 * 60_000, 8);
    if (!limit.allowed) return { ok: false as const, status: 429, error: "سقف گزارش." };
    if (targetKind === "shop" && !(data.businesses ?? []).some((b) => b.id === targetKey)) {
      return { ok: false as const, status: 404, error: "فروشگاه نیست." };
    }
    if (targetKind === "product" && !(data.bizProducts ?? []).some((p) => p.id === targetKey)) {
      return { ok: false as const, status: 404, error: "محصول نیست." };
    }
    data.reports.push({
      id: randomId(),
      reporterId: userId,
      targetKind: "business",
      targetKey,
      messageIds: [],
      category: category === "spam" || category === "harassment" ? category : "abuse",
      details: `${targetKind}:${category}:${details}`.slice(0, 500),
      createdAt: Date.now(),
    });
    return { ok: true as const };
  });
}

export async function myNotices(userId: string) {
  const data = await readStoreSnapshot();
  return (data.shopNotices ?? []).filter((n) => n.userId === userId).slice(0, 40);
}

export async function listCoupons(userId: string, businessId: string) {
  const data = await readStoreSnapshot();
  if (!can(data, businessId, userId, "manageProducts")) return [];
  return (data.coupons ?? []).filter((c) => c.businessId === businessId);
}

export function publicInvoice(inv: InvoiceRecord) {
  return inv;
}

export type { DeliveryOption, UserAddress };
