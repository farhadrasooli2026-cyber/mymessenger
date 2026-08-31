export const BUSINESS_CATEGORIES = [
  { id: "restaurant", label: "Restaurant" },
  { id: "clothing", label: "Clothing" },
  { id: "electronics", label: "Electronics" },
  { id: "education", label: "Education" },
  { id: "technology", label: "Technology" },
  { id: "beauty", label: "Beauty" },
  { id: "travel", label: "Travel" },
  { id: "services", label: "Services" },
  { id: "other", label: "Other" },
] as const;

export type BusinessCategory = (typeof BUSINESS_CATEGORIES)[number]["id"];

export const WEEKDAYS = [
  { d: 0, en: "Sunday", fa: "یکشنبه" },
  { d: 1, en: "Monday", fa: "دوشنبه" },
  { d: 2, en: "Tuesday", fa: "سه‌شنبه" },
  { d: 3, en: "Wednesday", fa: "چهارشنبه" },
  { d: 4, en: "Thursday", fa: "پنجشنبه" },
  { d: 5, en: "Friday", fa: "جمعه" },
  { d: 6, en: "Saturday", fa: "شنبه" },
] as const;

export type DayHours = { day: number; closed: boolean; open: string; close: string };

export const DEFAULT_HOURS: DayHours[] = WEEKDAYS.map((w) =>
  w.d === 0 ? { day: 0, closed: true, open: "09:00", close: "18:00" } : { day: w.d, closed: false, open: "09:00", close: "18:00" },
);

export type BizPermKey =
  | "readMessages"
  | "reply"
  | "manageCustomers"
  | "manageProducts"
  | "manageOrders"
  | "manageProfile"
  | "managePayments"
  | "viewAnalytics";

export const ALL_BIZ_PERMS: BizPermKey[] = [
  "readMessages",
  "reply",
  "manageCustomers",
  "manageProducts",
  "manageOrders",
  "manageProfile",
  "managePayments",
  "viewAnalytics",
];

export const BIZ_PERM_FA: Record<BizPermKey, string> = {
  readMessages: "خواندن پیام",
  reply: "پاسخ",
  manageCustomers: "مدیریت مشتری",
  manageProducts: "محصول و خدمت",
  manageOrders: "سفارش",
  manageProfile: "پروفایل",
  managePayments: "پرداخت",
  viewAnalytics: "آمار",
};

export type BizPerms = Record<BizPermKey, boolean>;

export function ownerPerms(): BizPerms {
  return Object.fromEntries(ALL_BIZ_PERMS.map((k) => [k, true])) as BizPerms;
}

export function emptyStaffPerms(): BizPerms {
  return {
    readMessages: true,
    reply: true,
    manageCustomers: false,
    manageProducts: false,
    manageOrders: false,
    manageProfile: false,
    managePayments: false,
    viewAnalytics: false,
  };
}

export const INBOX_LABELS = ["New Customer", "Paid", "Pending", "VIP", "Support"] as const;
export type InboxLabel = (typeof INBOX_LABELS)[number];

export const ORDER_STATUSES = [
  "pending",
  "payment_pending",
  "paid",
  "processing",
  "shipped",
  "delivered",
  "cancelled",
  "refunded",
] as const;
export type OrderStatus = (typeof ORDER_STATUSES)[number];

export const FULFILL_STATUSES = ["processing", "shipped", "delivered", "cancelled"] as const;

export const SHOP_REPORTS = [
  { id: "scam", label: "Scam" },
  { id: "fake_product", label: "Fake Product" },
  { id: "fraud", label: "Fraud" },
  { id: "illegal", label: "Illegal Content" },
  { id: "spam", label: "Spam" },
  { id: "other", label: "Other" },
] as const;

export const BIZ_REPORTS = [
  { id: "scam", label: "Scam" },
  { id: "fake", label: "Fake Business" },
  { id: "spam", label: "Spam" },
  { id: "fraud", label: "Fraud" },
  { id: "harassment", label: "Harassment" },
  { id: "other", label: "Other" },
] as const;

export type BusinessRecord = {
  id: string;
  ownerUserId: string;
  name: string;
  username: string;
  category: BusinessCategory;
  description: string;
  website: string;
  phone: string;
  email: string;
  address: string;
  lat: number | null;
  lng: number | null;
  hours: DayHours[];
  logoKind: "default" | "upload";
  welcome: string;
  away: string;
  autoReply: string;
  botId: string | null;
  channelId: string | null;
  verified: boolean;
  verification: "none" | "pending" | "rejected";
  verificationHash: string | null;
  createdAt: number;
  updatedAt: number;
  views: number;
};

export type BusinessStaff = {
  businessId: string;
  userId: string;
  role: "owner" | "admin";
  perms: BizPerms;
  name: string;
};

export type VariantDef = { name: string; values: string[] };
export type VariantRow = { key: string; stock: number | null; priceDelta: number };
export type ProductDiscount = { kind: "percent" | "amount"; value: number };

export type BizProduct = {
  id: string;
  businessId: string;
  kind: "product" | "service";
  name: string;
  description: string;
  price: number;
  currency: string;
  stock: number | null;
  category: string;
  code: string;
  photoKind: "default" | "upload";
  views: number;
  createdAt: number;
  variants: VariantDef[];
  variantRows: VariantRow[];
  discount: ProductDiscount | null;
};

export type BizCartItem = { productId: string; qty: number; variantKey: string };

export type BizOrderItem = {
  productId: string;
  name: string;
  qty: number;
  price: number;
  variantKey: string;
  discount: number;
};

export type BizOrder = {
  id: string;
  businessId: string;
  customerId: string;
  items: BizOrderItem[];
  subtotal: number;
  discountTotal: number;
  deliveryFee: number;
  fee: number;
  total: number;
  currency: string;
  status: OrderStatus;
  paymentStatus: "unpaid" | "pending" | "paid" | "failed";
  delivery: string;
  deliveryMethodId: string;
  addressSnapshot: string;
  couponCode: string;
  invoiceId: string | null;
  createdAt: number;
};

export type BizThread = {
  id: string;
  businessId: string;
  customerId: string;
  unread: boolean;
  important: boolean;
  archived: boolean;
  spam: boolean;
  label: InboxLabel | null;
  updatedAt: number;
};

export type BizMessage = {
  id: string;
  threadId: string;
  from: "customer" | "business";
  text: string;
  createdAt: number;
};

export type BizQuickReply = { id: string; businessId: string; command: string; text: string };

export type BizCart = { userId: string; businessId: string; items: BizCartItem[] };
