export const SHOP_CURRENCIES = ["USD", "EUR", "TRY"] as const;
export type ShopCurrency = (typeof SHOP_CURRENCIES)[number];

/** Sandbox FX table — not a live market feed. Pivot USD. */
export const FX_TO_USD: Record<string, number> = { USD: 1, EUR: 1.08, TRY: 0.029 };
export const FX_SOURCE = "NIXO sandbox FX table (not a live market feed)";

export function convertAmount(amount: number, from: string, to: string) {
  if (from === to) return Math.round(amount * 100) / 100;
  const usd = amount * (FX_TO_USD[from] ?? 1);
  const out = usd / (FX_TO_USD[to] ?? 1);
  return Math.round(out * 100) / 100;
}

export type DeliveryKind = "standard" | "express" | "pickup";

export type DeliveryOption = {
  id: string;
  kind: DeliveryKind;
  name: string;
  fee: number;
  eta: string;
};

export const DEFAULT_DELIVERY: DeliveryOption[] = [
  { id: "standard", kind: "standard", name: "Standard Delivery", fee: 5, eta: "۳ تا ۵ روز" },
  { id: "express", kind: "express", name: "Express Delivery", fee: 12, eta: "۱ روز" },
  { id: "pickup", kind: "pickup", name: "Pickup", fee: 0, eta: "تحویل حضوری" },
];

export type ShopRecord = {
  businessId: string;
  name: string;
  description: string;
  category: string;
  currency: string;
  delivery: DeliveryOption[];
  cancelUntil: "payment_pending" | "paid" | "processing";
  feeBps: number;
  createdAt: number;
};

export function seedShop(businessId: string, name: string, category: string, currency = "USD"): ShopRecord {
  return {
    businessId,
    name: `${name} Shop`,
    description: `فروشگاه ${name} روی نیکسو.`,
    category,
    currency,
    delivery: DEFAULT_DELIVERY.map((d) => ({ ...d })),
    cancelUntil: "paid",
    feeBps: 250,
    createdAt: Date.now(),
  };
}

export type UserAddress = {
  id: string;
  userId: string;
  label: string;
  line: string;
  city: string;
  country: string;
  isDefault: boolean;
};

export type CouponRecord = {
  id: string;
  businessId: string;
  code: string;
  kind: "percent" | "amount";
  value: number;
  expiresAt: number;
  usageLimit: number;
  used: number;
  minOrder: number;
  maxDiscount: number | null;
};

export type PayMethod = "card" | "bank" | "wallet" | "other";

export type PaymentRecord = {
  id: string;
  orderId: string;
  businessId: string;
  userId: string;
  method: PayMethod;
  amount: number;
  currency: string;
  fee: number;
  status: "pending" | "confirmed" | "failed";
  providerTxId: string;
  idempotencyKey: string;
  last4: string | null;
  webhookVerified: boolean;
  createdAt: number;
  updatedAt: number;
};

export type InvoiceRecord = {
  id: string;
  orderId: string;
  userId: string;
  businessId: string;
  lines: { name: string; qty: number; price: number; discount: number }[];
  subtotal: number;
  discountTotal: number;
  deliveryFee: number;
  fee: number;
  total: number;
  currency: string;
  paymentStatus: string;
  createdAt: number;
};

export type RefundRecord = {
  id: string;
  orderId: string;
  businessId: string;
  amount: number;
  currency: string;
  status: "requested" | "processing" | "completed" | "failed";
  createdAt: number;
};

export type WalletRecord = {
  userId: string;
  balances: Record<string, number>;
};

export type LedgerTx = {
  id: string;
  userId: string;
  amount: number;
  currency: string;
  type: "add" | "withdraw" | "transfer_in" | "transfer_out" | "payment" | "refund" | "settlement";
  status: "pending" | "completed" | "failed";
  createdAt: number;
  note: string;
  counterparty: string | null;
};

export type SettlementRecord = {
  id: string;
  businessId: string;
  orderId: string;
  amount: number;
  fee: number;
  currency: string;
  status: "pending" | "available" | "paid_out";
  createdAt: number;
};

export type ShopNotice = {
  id: string;
  userId: string;
  kind: "payment" | "refund" | "transfer" | "order";
  text: string;
  createdAt: number;
  read: boolean;
};

export type DisputeRecord = {
  id: string;
  userId: string;
  orderId: string;
  reason: string;
  status: "open" | "review";
  createdAt: number;
};

export type ShopAudit = {
  id: string;
  at: number;
  userId: string;
  kind: string;
  detail: string;
};
