import {
  BILLING_CURRENCIES,
  BILLING_INTERVALS,
  BILLING_PROVIDERS,
  ENTITLEMENTS,
  INTENT_STATUSES,
  INVOICE_STATUSES,
  REFUND_STATUSES,
  SUB_STATUSES,
  defaultPlans,
  defaultTaxRules,
  emptyBillingPersist,
  type BillingPersist,
  type EntitlementKey,
  type PlanRecord,
} from "@/lib/billing-types";

export type { BillingPersist };
export { emptyBillingPersist };

function str(v: unknown, max = 120) {
  return typeof v === "string" ? v.slice(0, max) : "";
}

export function hydrateBillingPersist(raw: unknown): BillingPersist {
  const base = emptyBillingPersist();
  if (!raw || typeof raw !== "object") return base;
  const rec = raw as Record<string, unknown>;
  const plans = Array.isArray(rec.plans) && rec.plans.length ? (rec.plans as PlanRecord[]) : defaultPlans();
  return {
    ...base,
    plans: plans.map(sanitizePlan),
    taxRules: Array.isArray(rec.taxRules) && rec.taxRules.length ? (rec.taxRules as BillingPersist["taxRules"]) : defaultTaxRules(),
    customers: arr<BillingPersist["customers"][number]>(rec.customers),
    methods: arr<BillingPersist["methods"][number]>(rec.methods).map((m) => ({
      ...m,
      tokenRef: (() => {
        const t = str(m.tokenRef, 80);
        return t.startsWith("tok_") ? t : `tok_${t.slice(0, 24)}`;
      })(),
      last4: str(m.last4, 4),
    })),
    subs: arr<BillingPersist["subs"][number]>(rec.subs),
    intents: arr<BillingPersist["intents"][number]>(rec.intents).map((row) => ({
      ...row,
      checkoutMeta: row.checkoutMeta ?? null,
      webhookEventIds: row.webhookEventIds ?? [],
    })),
    invoices: arr<BillingPersist["invoices"][number]>(rec.invoices),
    refunds: arr<BillingPersist["refunds"][number]>(rec.refunds),
    chargebacks: arr<BillingPersist["chargebacks"][number]>(rec.chargebacks),
    credits: arr<BillingPersist["credits"][number]>(rec.credits).slice(-4000),
    coupons: arr<BillingPersist["coupons"][number]>(rec.coupons).length ? arr<BillingPersist["coupons"][number]>(rec.coupons) : base.coupons,
    promotions: arr<BillingPersist["promotions"][number]>(rec.promotions),
    referrals: arr<BillingPersist["referrals"][number]>(rec.referrals),
    referralClaims: arr<BillingPersist["referralClaims"][number]>(rec.referralClaims),
    trialsUsed: Array.isArray(rec.trialsUsed) ? rec.trialsUsed.filter((x): x is string => typeof x === "string").slice(-4000) : [],
    couponUses: arr<BillingPersist["couponUses"][number]>(rec.couponUses),
    audit: arr<BillingPersist["audit"][number]>(rec.audit).slice(-2000),
    webhooks: arr<BillingPersist["webhooks"][number]>(rec.webhooks).slice(-400),
    webhookJobs: arr<BillingPersist["webhookJobs"][number]>(rec.webhookJobs).slice(-200),
    history: arr<BillingPersist["history"][number]>(rec.history).slice(-2000),
    spendingLimits: arr<BillingPersist["spendingLimits"][number]>(rec.spendingLimits),
  };
}

function arr<T>(v: unknown): T[] {
  return Array.isArray(v) ? (v as T[]) : [];
}

function sanitizePlan(p: PlanRecord): PlanRecord {
  const ents = (p.entitlements ?? []).filter((e): e is EntitlementKey => (ENTITLEMENTS as readonly string[]).includes(e));
  return {
    ...p,
    id: str(p.id, 40),
    entitlements: ents.length ? ents : ["core.messaging"],
    status: p.status === "archived" ? "archived" : "active",
  };
}

export function isKnownInterval(v: string): v is (typeof BILLING_INTERVALS)[number] {
  return (BILLING_INTERVALS as readonly string[]).includes(v);
}
export function isKnownCurrency(v: string): v is (typeof BILLING_CURRENCIES)[number] {
  return (BILLING_CURRENCIES as readonly string[]).includes(v);
}
export function isKnownProvider(v: string): v is (typeof BILLING_PROVIDERS)[number] {
  return (BILLING_PROVIDERS as readonly string[]).includes(v);
}
export function isSubStatus(v: string): v is (typeof SUB_STATUSES)[number] {
  return (SUB_STATUSES as readonly string[]).includes(v);
}
export function isIntentStatus(v: string): v is (typeof INTENT_STATUSES)[number] {
  return (INTENT_STATUSES as readonly string[]).includes(v);
}
export function isInvoiceStatus(v: string): v is (typeof INVOICE_STATUSES)[number] {
  return (INVOICE_STATUSES as readonly string[]).includes(v);
}
export function isRefundStatus(v: string): v is (typeof REFUND_STATUSES)[number] {
  return (REFUND_STATUSES as readonly string[]).includes(v);
}
