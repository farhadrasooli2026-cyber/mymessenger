/** Monetization types. No PAN, CVV, or provider secrets. */

export const BILLING_CURRENCIES = ["USD", "EUR", "TRY"] as const;
export type BillingCurrency = (typeof BILLING_CURRENCIES)[number];

export const CURRENCY_SCALE: Record<string, number> = { USD: 2, EUR: 2, TRY: 2, IRR: 0, JPY: 0 };

export function roundMoney(amount: number, currency: string) {
  const scale = CURRENCY_SCALE[currency] ?? 2;
  const f = 10 ** scale;
  return Math.round(amount * f) / f;
}

export const BILLING_INTERVALS = ["month", "year", "custom"] as const;
export type BillingInterval = (typeof BILLING_INTERVALS)[number];

export const SUB_STATUSES = ["trial", "active", "past_due", "cancelled", "expired", "suspended"] as const;
export type SubStatus = (typeof SUB_STATUSES)[number];

export const INTENT_STATUSES = ["pending", "processing", "succeeded", "failed", "cancelled", "refunded"] as const;
export type IntentStatus = (typeof INTENT_STATUSES)[number];

export const INVOICE_STATUSES = ["draft", "open", "paid", "void", "uncollectible"] as const;
export type InvoiceStatus = (typeof INVOICE_STATUSES)[number];

export const REFUND_STATUSES = ["requested", "processing", "completed", "failed"] as const;
export type BillingRefundStatus = (typeof REFUND_STATUSES)[number];

export const BILLING_PROVIDERS = ["sandbox", "nixo_pay"] as const;
export type BillingProviderId = (typeof BILLING_PROVIDERS)[number];

export const ENTITLEMENTS = [
  "core.messaging",
  "stories.extended",
  "storage.plus",
  "ai.plus",
  "calls.hd",
  "live.extended",
  "team.seats",
] as const;
export type EntitlementKey = (typeof ENTITLEMENTS)[number];

export type PlanLimits = {
  storiesPerDay: number;
  storageBonusMb: number;
  aiMessagesPerDay: number;
  aiFilesPerDay: number;
  aiImagesPerDay: number;
  seats: number;
  extraSeatPrice: number;
};

export type PlanRecord = {
  id: string;
  name: string;
  description: string;
  status: "active" | "archived";
  intervalPrices: Partial<Record<BillingInterval, Partial<Record<BillingCurrency, number>>>>;
  customDays: number | null;
  trialDays: number;
  entitlements: EntitlementKey[];
  limits: PlanLimits;
  family: boolean;
  giftEligible: boolean;
  regions: string[];
};

export type TaxRule = { country: string; bps: number; label: string };

export type BillingCustomer = {
  userId: string;
  display: string;
  country: string;
  taxIdMasked: string;
  addressLine: string;
  city: string;
  updatedAt: number;
};

export type PaymentMethodRow = {
  id: string;
  userId: string;
  provider: BillingProviderId;
  brand: string;
  last4: string;
  tokenRef: string;
  isDefault: boolean;
  createdAt: number;
};

export type SubscriptionRow = {
  id: string;
  userId: string;
  planId: string;
  status: SubStatus;
  interval: BillingInterval;
  currency: BillingCurrency;
  price: number;
  taxBps: number;
  taxAmount: number;
  fxRate: number;
  fxSource: string;
  fxAt: number;
  autoRenew: boolean;
  cancelAtPeriodEnd: boolean;
  periodStart: number;
  periodEnd: number;
  trialEndsAt: number | null;
  graceUntil: number | null;
  cancelledAt: number | null;
  expiredAt: number | null;
  seats: number;
  memberIds: string[];
  giftedBy: string | null;
  couponCode: string | null;
  provider: BillingProviderId;
  createdAt: number;
  updatedAt: number;
};

export type PaymentIntentRow = {
  id: string;
  userId: string;
  subId: string | null;
  kind: "subscribe" | "renew" | "upgrade" | "downgrade" | "seat" | "gift";
  amount: number;
  currency: BillingCurrency;
  tax: number;
  status: IntentStatus;
  provider: BillingProviderId;
  providerRef: string;
  idempotencyKey: string;
  retryable: boolean;
  review: boolean;
  riskScore: number;
  expiresAt: number;
  createdAt: number;
  updatedAt: number;
  webhookEventIds: string[];
  checkoutMeta: {
    planId: string;
    interval: BillingInterval;
    beneficiary: string;
    couponCode: string | null;
    seats: number;
    trial: boolean;
  } | null;
};

export type BillingInvoice = {
  id: string;
  number: string;
  userId: string;
  intentId: string;
  subId: string | null;
  status: InvoiceStatus;
  lines: { name: string; amount: number }[];
  subtotal: number;
  tax: number;
  taxLabel: string;
  total: number;
  currency: BillingCurrency;
  paidAt: number | null;
  createdAt: number;
};

export type BillingRefund = {
  id: string;
  intentId: string;
  userId: string;
  amount: number;
  currency: BillingCurrency;
  status: BillingRefundStatus;
  reason: string;
  actorHint: string;
  createdAt: number;
};

export type ChargebackRow = {
  id: string;
  intentId: string;
  status: "open" | "won" | "lost";
  amount: number;
  currency: BillingCurrency;
  createdAt: number;
};

export type CreditEntry = {
  id: string;
  userId: string;
  delta: number;
  currency: BillingCurrency;
  type: "promo" | "proration" | "referral" | "refund" | "spend" | "grant";
  ref: string;
  createdAt: number;
};

export type BillingCoupon = {
  code: string;
  percent: number;
  expiresAt: number;
  maxRedemptions: number;
  used: number;
  newOnly: boolean;
  planIds: string[];
  perUser: number;
};

export type PromotionRow = {
  id: string;
  name: string;
  percent: number;
  startsAt: number;
  endsAt: number;
  planIds: string[];
  countries: string[];
};

export type ReferralRow = {
  code: string;
  ownerUserId: string;
  grants: number;
  createdAt: number;
};

export type BillingAudit = {
  id: string;
  at: number;
  actorHint: string;
  action: string;
  detail: string;
  prevHash: string;
  chainHash: string;
};

export type WebhookLog = {
  id: string;
  at: number;
  provider: string;
  eventId: string;
  kind: string;
  ok: boolean;
};

export type WebhookJob = {
  id: string;
  at: number;
  attempts: number;
  nextAt: number;
  eventId: string;
  kind: string;
  payloadDigest: string;
};

export type SubHistory = {
  id: string;
  subId: string;
  at: number;
  from: string;
  to: string;
  note: string;
};

export type BillingPersist = {
  plans: PlanRecord[];
  taxRules: TaxRule[];
  customers: BillingCustomer[];
  methods: PaymentMethodRow[];
  subs: SubscriptionRow[];
  intents: PaymentIntentRow[];
  invoices: BillingInvoice[];
  refunds: BillingRefund[];
  chargebacks: ChargebackRow[];
  credits: CreditEntry[];
  coupons: BillingCoupon[];
  promotions: PromotionRow[];
  referrals: ReferralRow[];
  referralClaims: { code: string; userId: string; at: number }[];
  trialsUsed: string[];
  couponUses: { code: string; userId: string; at: number }[];
  audit: BillingAudit[];
  webhooks: WebhookLog[];
  webhookJobs: WebhookJob[];
  history: SubHistory[];
  spendingLimits: { userId: string; daily: number; currency: BillingCurrency }[];
};

export type BillingStoreSlice = {
  billing: BillingPersist;
  users: { id: string; identifierHash?: string; prefs?: { country?: string | null } }[];
};

export const FX_BILLING_SOURCE = "NIXO sandbox FX table (not a live market feed)";

const FREE_LIMITS: PlanLimits = {
  storiesPerDay: 24,
  storageBonusMb: 0,
  aiMessagesPerDay: 48,
  aiFilesPerDay: 8,
  aiImagesPerDay: 6,
  seats: 1,
  extraSeatPrice: 0,
};

export function defaultPlans(): PlanRecord[] {
  return [
    {
      id: "free",
      name: "NIXO Free",
      description: "پیام، گروه، کانال و تماس پایه بدون هزینه.",
      status: "active",
      intervalPrices: { month: { USD: 0, EUR: 0, TRY: 0 }, year: { USD: 0, EUR: 0, TRY: 0 } },
      customDays: null,
      trialDays: 0,
      entitlements: ["core.messaging"],
      limits: FREE_LIMITS,
      family: false,
      giftEligible: false,
      regions: [],
    },
    {
      id: "plus",
      name: "NIXO Plus",
      description: "سهمیهٔ بیشتر استوری، فضای اضافه و سقف بالاتر AI.",
      status: "active",
      intervalPrices: { month: { USD: 4.99, EUR: 4.99, TRY: 149 }, year: { USD: 49, EUR: 49, TRY: 1490 } },
      customDays: null,
      trialDays: 7,
      entitlements: ["core.messaging", "stories.extended", "storage.plus", "ai.plus"],
      limits: { ...FREE_LIMITS, storiesPerDay: 48, storageBonusMb: 200, aiMessagesPerDay: 96, aiFilesPerDay: 16, aiImagesPerDay: 12 },
      family: false,
      giftEligible: true,
      regions: [],
    },
    {
      id: "premium",
      name: "NIXO Premium",
      description: "کیفیت تماس بالاتر، Live گسترده‌تر و فضای بیشتر.",
      status: "active",
      intervalPrices: { month: { USD: 9.99, EUR: 9.99, TRY: 299 }, year: { USD: 99, EUR: 99, TRY: 2990 } },
      customDays: null,
      trialDays: 7,
      entitlements: ["core.messaging", "stories.extended", "storage.plus", "ai.plus", "calls.hd", "live.extended"],
      limits: { ...FREE_LIMITS, storiesPerDay: 120, storageBonusMb: 800, aiMessagesPerDay: 200, aiFilesPerDay: 24, aiImagesPerDay: 20 },
      family: false,
      giftEligible: true,
      regions: [],
    },
    {
      id: "team",
      name: "NIXO Team",
      description: "پلن چندنفره با صندلی و صورت‌حساب جدا.",
      status: "active",
      intervalPrices: { month: { USD: 19.99, EUR: 19.99, TRY: 599 }, year: { USD: 199, EUR: 199, TRY: 5990 } },
      customDays: null,
      trialDays: 14,
      entitlements: ["core.messaging", "stories.extended", "storage.plus", "ai.plus", "calls.hd", "live.extended", "team.seats"],
      limits: { ...FREE_LIMITS, storiesPerDay: 120, storageBonusMb: 2048, aiMessagesPerDay: 200, aiFilesPerDay: 24, aiImagesPerDay: 20, seats: 5, extraSeatPrice: 4 },
      family: true,
      giftEligible: false,
      regions: [],
    },
  ];
}

export function defaultTaxRules(): TaxRule[] {
  return [
    { country: "IR", bps: 0, label: "معاف" },
    { country: "DE", bps: 1900, label: "MwSt 19%" },
    { country: "US", bps: 0, label: "sales tax not collected (sandbox)" },
    { country: "TR", bps: 2000, label: "KDV 20%" },
  ];
}

export function emptyBillingPersist(): BillingPersist {
  return {
    plans: defaultPlans(),
    taxRules: defaultTaxRules(),
    customers: [],
    methods: [],
    subs: [],
    intents: [],
    invoices: [],
    refunds: [],
    chargebacks: [],
    credits: [],
    coupons: [
      {
        code: "WELCOME10",
        percent: 10,
        expiresAt: Date.now() + 365 * 24 * 60 * 60_000,
        maxRedemptions: 500,
        used: 0,
        newOnly: true,
        planIds: ["plus", "premium"],
        perUser: 1,
      },
    ],
    promotions: [],
    referrals: [],
    referralClaims: [],
    trialsUsed: [],
    couponUses: [],
    audit: [],
    webhooks: [],
    webhookJobs: [],
    history: [],
    spendingLimits: [],
  };
}

export function periodMs(interval: BillingInterval, customDays: number | null) {
  if (interval === "year") return 365 * 24 * 60 * 60_000;
  if (interval === "custom") return Math.max(1, customDays ?? 30) * 24 * 60 * 60_000;
  return 30 * 24 * 60 * 60_000;
}

export const GRACE_MS = 3 * 24 * 60 * 60_000;
export const INTENT_TTL_MS = 30 * 60_000;
export const BILLING_RAW_KEEP_MS = 400 * 24 * 60 * 60_000;
