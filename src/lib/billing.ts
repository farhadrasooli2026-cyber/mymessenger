import "server-only";
import { createHmac, timingSafeEqual } from "node:crypto";
import { config } from "@/lib/config";
import { hmacIdentifier, randomId } from "@/lib/crypto-utils";
import { emitNotification } from "@/lib/notify";
import { hitRateLimit } from "@/lib/rate-limit";
import { mutateStore, readStoreSnapshot, type StoreData } from "@/lib/store";
import { convertAmount, FX_SOURCE } from "@/lib/shop-types";
import { rejectCardPlain } from "@/lib/shop";
import {
  FX_BILLING_SOURCE,
  INTENT_TTL_MS,
  periodMs,
  roundMoney,
  type BillingCurrency,
  type BillingInterval,
  type BillingPersist,
  type BillingProviderId,
  type BillingStoreSlice,
  type PaymentIntentRow,
} from "@/lib/billing-types";
import { isKnownCurrency, isKnownInterval } from "@/lib/billing-persist";
import {
  creditBalance,
  currentSubscription,
  ensureBilling,
  entitlementsOf,
  invalidateBillingCache,
  planById,
  publicSub,
  syncBillingLifecycle,
  userHint,
} from "@/lib/billing-access";

export { rejectCardPlain };
export {
  entitlementsOf,
  hasEntitlement,
  storyDailyCap,
  syncBillingLifecycle,
  userVaultQuota,
  aiDailyCaps,
} from "@/lib/billing-access";

const pendingMeta = new Map<
  string,
  { planId: string; interval: BillingInterval; beneficiary: string; couponCode: string | null; seats: number; trial: boolean }
>();

function billOf(data: StoreData): BillingPersist {
  ensureBilling(data as BillingStoreSlice);
  return (data as BillingStoreSlice).billing;
}

export function billingWebhookSignature(raw: string) {
  return createHmac("sha256", config.pepper).update(`billing:${raw}`).digest("hex");
}

function sigOk(raw: string, header: string) {
  const a = Buffer.from(billingWebhookSignature(raw));
  const b = Buffer.from(header);
  return a.length === b.length && a.length > 0 && timingSafeEqual(a, b);
}

function hint(id: string) {
  return hmacIdentifier(`bill-actor:${id}`).slice(0, 12);
}

function audit(data: StoreData, actorHint: string, action: string, detail: string) {
  ensureBilling(data);
  const prev = billOf(data).audit[0]?.chainHash ?? "genesis";
  const id = randomId();
  const at = Date.now();
  const chainHash = hmacIdentifier(`bill-audit:${prev}:${id}:${action}:${at}:${detail}`);
  billOf(data).audit.unshift({ id, at, actorHint, action, detail: detail.slice(0, 180), prevHash: prev, chainHash });
  billOf(data).audit = billOf(data).audit.slice(0, 2000);
}

function notify(data: StoreData, userId: string, title: string, body: string) {
  emitNotification(data, {
    userId,
    category: "payments",
    kind: "system",
    title,
    body,
    senderName: "NIXO Billing",
    sourceId: `billing:${title}:${userId}`,
    target: { type: "order", id: userId, href: "/app/settings/billing" },
  });
}

function taxFor(data: StoreData, country: string) {
  ensureBilling(data);
  return billOf(data).taxRules.find((t) => t.country === country.toUpperCase()) ?? { country, bps: 0, label: "—" };
}

function customerCountry(data: StoreData, userId: string) {
  ensureBilling(data);
  const c = billOf(data).customers.find((x) => x.userId === userId);
  if (c?.country) return c.country;
  return (data.users.find((u) => u.id === userId)?.prefs?.country || "IR").toUpperCase();
}

function priceOf(data: StoreData, planId: string, interval: BillingInterval, currency: BillingCurrency, country: string) {
  const plan = planById(data, planId);
  const table = plan.intervalPrices[interval] ?? plan.intervalPrices.month ?? {};
  let amount = table[currency] ?? table.USD ?? 0;
  if (country === "TR" && currency === "USD") amount = roundMoney(amount * 0.95, currency);
  return roundMoney(amount, currency);
}

function applyCoupon(data: StoreData, userId: string, planId: string, code: string, amount: number, currency: BillingCurrency) {
  const now = Date.now();
  const coupon = billOf(data).coupons.find((c) => c.code === code.trim().toUpperCase());
  if (!coupon) return { amount, code: null as string | null, error: "کد تخفیف نامعتبر است." };
  if (coupon.expiresAt < now) return { amount, code: null, error: "کد منقضی است." };
  if (coupon.used >= coupon.maxRedemptions) return { amount, code: null, error: "سقف استفادهٔ کد تمام شد." };
  if (coupon.planIds.length && !coupon.planIds.includes(planId)) return { amount, code: null, error: "این کد برای این پلن نیست." };
  const mine = billOf(data).couponUses.filter((u) => u.code === coupon.code && u.userId === userId).length;
  if (mine >= coupon.perUser) return { amount, code: null, error: "این کد را قبلاً استفاده کرده‌ای." };
  if (coupon.newOnly && billOf(data).subs.some((s) => s.userId === userId && s.planId !== "free")) {
    return { amount, code: null, error: "کد فقط برای مشترک جدید است." };
  }
  const discount = roundMoney(amount * (coupon.percent / 100), currency);
  return { amount: roundMoney(amount - discount, currency), code: coupon.code, error: null as string | null };
}

function nextInvoiceNumber() {
  return `NIXO-INV-${new Date().getUTCFullYear()}-${randomId().slice(0, 8).toUpperCase()}`;
}

function addCredit(
  data: StoreData,
  userId: string,
  delta: number,
  currency: BillingCurrency,
  type: "promo" | "proration" | "referral" | "refund" | "spend" | "grant",
  ref: string,
) {
  billOf(data).credits.push({ id: randomId(), userId, delta: roundMoney(delta, currency), currency, type, ref, createdAt: Date.now() });
  billOf(data).credits = billOf(data).credits.slice(-4000);
}

function history(data: StoreData, subId: string, from: string, to: string, note: string) {
  billOf(data).history.unshift({ id: randomId(), subId, at: Date.now(), from, to, note });
  billOf(data).history = billOf(data).history.slice(0, 2000);
}

function publicIntent(i: PaymentIntentRow) {
  return {
    id: i.id,
    kind: i.kind,
    amount: i.amount,
    currency: i.currency,
    tax: i.tax,
    status: i.status,
    provider: i.provider,
    review: i.review,
    createdAt: i.createdAt,
    expiresAt: i.expiresAt,
  };
}

function riskScore(data: StoreData, userId: string, now: number) {
  const day = billOf(data).intents.filter((i) => i.userId === userId && now - i.createdAt < 24 * 60 * 60_000);
  return Math.min(100, day.filter((i) => i.status === "failed").length * 12 + day.filter((i) => i.status === "pending").length * 4);
}

export async function listPublicPlans(userId?: string | null) {
  const data = await readStoreSnapshot();
  ensureBilling(data);
  const country = userId ? customerCountry(data, userId) : "IR";
  const currency = (country === "TR" ? "TRY" : "USD") as BillingCurrency;
  return {
    ok: true as const,
    currency,
    fxSource: FX_BILLING_SOURCE,
    tax: taxFor(data, country),
    plans: billOf(data).plans
      .filter((p) => p.status === "active")
      .map((p) => ({
        id: p.id,
        name: p.name,
        description: p.description,
        family: p.family,
        giftEligible: p.giftEligible,
        trialDays: p.trialDays,
        entitlements: p.entitlements,
        limits: p.limits,
        prices: { month: priceOf(data, p.id, "month", currency, country), year: priceOf(data, p.id, "year", currency, country) },
      })),
  };
}

export async function myBilling(userId: string) {
  const data = await readStoreSnapshot();
  ensureBilling(data);
  syncBillingLifecycle(data);
  const sub = currentSubscription(data, userId);
  const snap = entitlementsOf(data, userId);
  return {
    ok: true as const,
    subscription: publicSub(sub),
    entitlements: [...snap.entitlements],
    limits: snap.limits,
    status: snap.status,
    intents: billOf(data).intents.filter((i) => i.userId === userId).slice(0, 40).map(publicIntent),
    invoices: billOf(data).invoices.filter((i) => i.userId === userId).slice(0, 40),
    refunds: billOf(data).refunds.filter((r) => r.userId === userId).slice(0, 20),
    methods: billOf(data).methods
      .filter((m) => m.userId === userId)
      .map((m) => ({ id: m.id, brand: m.brand, last4: m.last4, provider: m.provider, isDefault: m.isDefault })),
    customer: billOf(data).customers.find((c) => c.userId === userId) ?? null,
    credits: {
      USD: creditBalance(data, userId, "USD"),
      EUR: creditBalance(data, userId, "EUR"),
      TRY: creditBalance(data, userId, "TRY"),
    },
    history: sub ? billOf(data).history.filter((h) => h.subId === sub.id).slice(0, 30) : [],
    referrals: billOf(data).referrals.filter((r) => r.ownerUserId === userId),
    note: "شماره کارت کامل ذخیره نمی‌شود. کیف پول فروشگاه جدا از اعتبار اشتراک است.",
  };
}

export async function upsertBillingProfile(
  userId: string,
  patch: { display?: string; country?: string; taxIdMasked?: string; addressLine?: string; city?: string },
) {
  return mutateStore((data) => {
    ensureBilling(data);
    let next = billOf(data).customers.find((c) => c.userId === userId);
    if (!next) {
      next = { userId, display: "", country: "IR", taxIdMasked: "", addressLine: "", city: "", updatedAt: 0 };
      billOf(data).customers.push(next);
    }
    if (typeof patch.display === "string") next.display = patch.display.slice(0, 80);
    if (typeof patch.country === "string") next.country = patch.country.slice(0, 2).toUpperCase();
    if (typeof patch.taxIdMasked === "string") next.taxIdMasked = patch.taxIdMasked.replace(/\d(?=\d{3})/g, "•").slice(0, 24);
    if (typeof patch.addressLine === "string") next.addressLine = patch.addressLine.slice(0, 120);
    if (typeof patch.city === "string") next.city = patch.city.slice(0, 60);
    next.updatedAt = Date.now();
    audit(data, hint(userId), "profile", "پروفایل صورتحساب");
    return { ok: true as const, customer: next };
  });
}

export async function savePaymentMethod(userId: string, input: { tokenRef: string; brand?: string; last4?: string; provider?: string }) {
  if (!input.tokenRef.startsWith("tok_")) return { ok: false as const, error: "فقط توکن درگاه پذیرفته می‌شود.", status: 400 };
  return mutateStore((data) => {
    ensureBilling(data);
    for (const m of billOf(data).methods) if (m.userId === userId) m.isDefault = false;
    const row = {
      id: randomId(),
      userId,
      provider: (input.provider === "nixo_pay" ? "nixo_pay" : "sandbox") as BillingProviderId,
      brand: (input.brand || "sandbox").slice(0, 20),
      last4: (input.last4 || "0000").slice(0, 4),
      tokenRef: input.tokenRef.slice(0, 80),
      isDefault: true,
      createdAt: Date.now(),
    };
    billOf(data).methods.unshift(row);
    audit(data, hint(userId), "method", row.last4);
    return { ok: true as const, method: { id: row.id, brand: row.brand, last4: row.last4, provider: row.provider } };
  });
}

export async function checkoutAndAttach(
  userId: string,
  input: {
    planId: string;
    interval: string;
    currency?: string;
    coupon?: string;
    provider?: string;
    idempotencyKey: string;
    giftToUserId?: string;
    trial?: boolean;
    seats?: number;
  },
) {
  if (!input.idempotencyKey || input.idempotencyKey.length < 8) {
    return { ok: false as const, error: "کلید تکرار لازم است.", status: 400 };
  }
  const started = await mutateStore((data) => {
    ensureBilling(data);
    const flood = hitRateLimit(data, `bill-co:${userId}`, 60_000, 8);
    if (!flood.allowed) return { ok: false as const, error: "سقف پرداخت.", status: 429 };
    const cap = billOf(data).spendingLimits.find((s) => s.userId === userId);
    if (cap) {
      const spent = billOf(data).intents
        .filter((i) => i.userId === userId && i.status === "succeeded" && Date.now() - i.createdAt < 24 * 60 * 60_000 && i.currency === cap.currency)
        .reduce((s, i) => s + i.amount, 0);
      if (spent >= cap.daily) return { ok: false as const, error: "سقف مصرف روزانه.", status: 429 };
    }
    const existing = billOf(data).intents.find((i) => i.userId === userId && i.idempotencyKey === input.idempotencyKey);
    if (existing) return { ok: true as const, duplicate: true as const, intent: publicIntent(existing), planId: input.planId, interval: input.interval, beneficiary: userId, couponCode: null as string | null, seats: 1, trial: false };
    if (!isKnownInterval(input.interval)) return { ok: false as const, error: "بازه نامعتبر است.", status: 400 };
    const currency = (input.currency && isKnownCurrency(input.currency) ? input.currency : "USD") as BillingCurrency;
    const plan = planById(data, input.planId);
    if (plan.id === "free") return { ok: false as const, error: "پلن رایگان نیاز به پرداخت ندارد.", status: 400 };
    const beneficiary = input.giftToUserId || userId;
    if (input.giftToUserId) {
      if (!plan.giftEligible) return { ok: false as const, error: "این پلن هدیه نمی‌شود.", status: 400 };
      if (input.giftToUserId === userId) return { ok: false as const, error: "هدیه به خود مجاز نیست.", status: 400 };
    }
    const country = customerCountry(data, userId);
    let amount = priceOf(data, plan.id, input.interval, currency, country);
    const seats = Math.max(plan.limits.seats, Math.min(25, Math.floor(input.seats ?? plan.limits.seats)));
    if (plan.family && seats > plan.limits.seats) {
      amount = roundMoney(amount + (seats - plan.limits.seats) * plan.limits.extraSeatPrice, currency);
    }
    let couponCode: string | null = null;
    if (input.coupon) {
      const c = applyCoupon(data, userId, plan.id, input.coupon, amount, currency);
      if (c.error) return { ok: false as const, error: c.error, status: 400 };
      amount = c.amount;
      couponCode = c.code;
    }
    const taxRule = taxFor(data, country);
    const tax = roundMoney(amount * (taxRule.bps / 10000), currency);
    const total = roundMoney(amount + tax, currency);
    const now = Date.now();
    const score = riskScore(data, userId, now);
    const intent: PaymentIntentRow = {
      id: randomId(),
      userId,
      subId: null,
      kind: input.giftToUserId ? "gift" : "subscribe",
      amount: total,
      currency,
      tax,
      status: score >= 80 ? "pending" : "processing",
      provider: input.provider === "nixo_pay" ? "nixo_pay" : "sandbox",
      providerRef: `pref_${randomId().slice(0, 12)}`,
      idempotencyKey: input.idempotencyKey.slice(0, 80),
      retryable: true,
      review: score >= 80,
      riskScore: score,
      expiresAt: now + INTENT_TTL_MS,
      createdAt: now,
      updatedAt: now,
      webhookEventIds: [],
      checkoutMeta: {
        planId: plan.id,
        interval: input.interval,
        beneficiary,
        couponCode,
        seats,
        trial: Boolean(input.trial) && plan.trialDays > 0,
      },
    };
    billOf(data).intents.unshift(intent);
    billOf(data).invoices.unshift({
      id: randomId(),
      number: nextInvoiceNumber(),
      userId,
      intentId: intent.id,
      subId: null,
      status: "open",
      lines: [{ name: `${plan.name} (${input.interval})`, amount }],
      subtotal: amount,
      tax,
      taxLabel: taxRule.label,
      total,
      currency,
      paidAt: null,
      createdAt: now,
    });
    audit(data, hint(userId), "intent", intent.id);
    return {
      ok: true as const,
      intent: publicIntent(intent),
      planId: plan.id,
      interval: input.interval,
      beneficiary,
      couponCode,
      seats,
      trial: Boolean(input.trial) && plan.trialDays > 0,
      review: intent.review,
    };
  });
  if (started.ok && started.intent && !started.duplicate) {
    pendingMeta.set(started.intent.id, {
      planId: started.planId,
      interval: started.interval as BillingInterval,
      beneficiary: started.beneficiary,
      couponCode: started.couponCode,
      seats: started.seats,
      trial: started.trial,
    });
  }
  return started;
}

function activateFromIntent(
  data: StoreData,
  intent: PaymentIntentRow,
  opts: { planId: string; interval: BillingInterval; beneficiary: string; couponCode: string | null; seats: number; trial: boolean },
) {
  const now = Date.now();
  const plan = planById(data, opts.planId);
  const ms = periodMs(opts.interval, plan.customDays);
  const existing = currentSubscription(data, opts.beneficiary, now);
  let sub = existing && existing.userId === opts.beneficiary ? existing : null;
  const trialOk = opts.trial && plan.trialDays > 0 && !billOf(data).trialsUsed.includes(opts.beneficiary);
  if (trialOk) billOf(data).trialsUsed.push(opts.beneficiary);
  const status = trialOk ? ("trial" as const) : ("active" as const);
  if (!sub) {
    sub = {
      id: randomId(),
      userId: opts.beneficiary,
      planId: plan.id,
      status,
      interval: opts.interval,
      currency: intent.currency,
      price: intent.amount - intent.tax,
      taxBps: taxFor(data, customerCountry(data, intent.userId)).bps,
      taxAmount: intent.tax,
      fxRate: convertAmount(1, intent.currency, "USD"),
      fxSource: FX_SOURCE,
      fxAt: now,
      autoRenew: true,
      cancelAtPeriodEnd: false,
      periodStart: now,
      periodEnd: now + ms,
      trialEndsAt: trialOk ? now + plan.trialDays * 24 * 60 * 60_000 : null,
      graceUntil: null,
      cancelledAt: null,
      expiredAt: null,
      seats: opts.seats,
      memberIds: [opts.beneficiary],
      giftedBy: opts.beneficiary === intent.userId ? null : intent.userId,
      couponCode: opts.couponCode,
      provider: intent.provider,
      createdAt: now,
      updatedAt: now,
    };
    billOf(data).subs.unshift(sub);
    history(data, sub.id, "none", status, "created");
  } else {
    const remain = Math.max(0, sub.periodEnd - now);
    const oldMs = Math.max(1, sub.periodEnd - sub.periodStart);
    const creditAmt = roundMoney((remain / oldMs) * sub.price, intent.currency);
    if (creditAmt > 0) addCredit(data, intent.userId, creditAmt, intent.currency, "proration", sub.id);
    history(data, sub.id, sub.planId, plan.id, "change");
    sub.planId = plan.id;
    sub.status = status;
    sub.interval = opts.interval;
    sub.currency = intent.currency;
    sub.price = intent.amount - intent.tax;
    sub.periodStart = now;
    sub.periodEnd = now + ms;
    sub.cancelledAt = null;
    sub.expiredAt = null;
    sub.cancelAtPeriodEnd = false;
    sub.autoRenew = true;
    sub.seats = opts.seats;
    sub.updatedAt = now;
  }
  if (opts.couponCode) {
    const coupon = billOf(data).coupons.find((c) => c.code === opts.couponCode);
    if (coupon) coupon.used += 1;
    billOf(data).couponUses.push({ code: opts.couponCode, userId: intent.userId, at: now });
  }
  intent.status = "succeeded";
  intent.subId = sub.id;
  intent.retryable = false;
  intent.updatedAt = now;
  const inv = billOf(data).invoices.find((i) => i.intentId === intent.id);
  if (inv) {
    inv.status = "paid";
    inv.paidAt = now;
    inv.subId = sub.id;
  }
  invalidateBillingCache(opts.beneficiary);
  invalidateBillingCache(intent.userId);
  notify(data, opts.beneficiary, "اشتراک فعال شد", `${plan.name} تا پایان دوره فعال است.`);
  audit(data, hint(intent.userId), "activate", sub.id);
  return sub;
}

export async function confirmSandboxIntent(userId: string, intentId: string, outcome: "success" | "fail") {
  return mutateStore((data) => {
    ensureBilling(data);
    const intent = billOf(data).intents.find((i) => i.id === intentId && i.userId === userId);
    if (!intent) return { ok: false as const, error: "پرداخت نیست.", status: 404 };
    if (intent.status === "succeeded") return { ok: true as const, duplicate: true, intent: publicIntent(intent) };
    if (intent.review) return { ok: false as const, error: "این پرداخت در بررسی دستی است.", status: 423 };
    if (intent.expiresAt < Date.now()) {
      intent.status = "cancelled";
      return { ok: false as const, error: "پرداخت منقضی شد.", status: 410 };
    }
    const meta = pendingMeta.get(intentId) ?? intent.checkoutMeta;
    if (outcome === "fail") {
      intent.status = "failed";
      intent.updatedAt = Date.now();
      notify(data, userId, "پرداخت ناموفق", "وضعیت اشتراک و داده‌های حساب حذف نشد.");
      audit(data, hint(userId), "pay_fail", intent.id);
      return { ok: true as const, intent: publicIntent(intent) };
    }
    if (!meta) return { ok: false as const, error: "جزئیات تسویه منقضی است. دوباره شروع کن.", status: 409 };
    const sub = activateFromIntent(data, intent, meta);
    pendingMeta.delete(intentId);
    return { ok: true as const, intent: publicIntent(intent), subscription: publicSub(sub) };
  });
}

export async function handleBillingWebhook(raw: string, signature: string) {
  if (!sigOk(raw, signature)) return { ok: false as const, error: "امضای Webhook نامعتبر است.", status: 401 };
  let body: { eventId?: string; providerRef?: string; status?: string; amount?: number };
  try {
    body = JSON.parse(raw) as typeof body;
  } catch {
    return { ok: false as const, error: "بدنه نامعتبر.", status: 400 };
  }
  const eventId = (body.eventId || "").slice(0, 80);
  return mutateStore((data) => {
    ensureBilling(data);
    if (eventId && billOf(data).webhooks.some((w) => w.eventId === eventId && w.ok)) {
      return { ok: true as const, duplicate: true };
    }
    const intent = billOf(data).intents.find((i) => i.providerRef === body.providerRef);
    if (!intent) {
      billOf(data).webhookJobs.push({
        id: randomId(),
        at: Date.now(),
        attempts: 1,
        nextAt: Date.now() + 60_000,
        eventId: eventId || randomId(),
        kind: "missing_intent",
        payloadDigest: hmacIdentifier(raw).slice(0, 16),
      });
      return { ok: false as const, error: "تراکنش نیست.", status: 404 };
    }
    if (typeof body.amount === "number" && Math.abs(body.amount - intent.amount) > 0.009) {
      audit(data, "webhook", "amount_mismatch", intent.id);
      return { ok: false as const, error: "مبلغ تطبیق ندارد.", status: 409 };
    }
    if (eventId) intent.webhookEventIds.push(eventId);
    billOf(data).webhooks.unshift({
      id: randomId(),
      at: Date.now(),
      provider: intent.provider,
      eventId: eventId || intent.id,
      kind: body.status || "unknown",
      ok: true,
    });
    if (intent.status === "succeeded" && body.status === "succeeded") return { ok: true as const, duplicate: true };
    if (body.status === "failed") {
      intent.status = "failed";
      notify(data, intent.userId, "پرداخت ناموفق", "داده‌های حساب حذف نشد.");
      return { ok: true as const, intent: publicIntent(intent) };
    }
    if (body.status === "succeeded") {
      const meta = pendingMeta.get(intent.id) ?? intent.checkoutMeta;
      if (meta && intent.status !== "succeeded") activateFromIntent(data, intent, meta);
      else if (intent.status !== "succeeded") {
        intent.status = "succeeded";
        const inv = billOf(data).invoices.find((i) => i.intentId === intent.id);
        if (inv) {
          inv.status = "paid";
          inv.paidAt = Date.now();
        }
      }
      pendingMeta.delete(intent.id);
      return { ok: true as const, intent: publicIntent(intent) };
    }
    return { ok: true as const, intent: publicIntent(intent) };
  });
}

export async function cancelSubscription(userId: string, mode: "period_end" | "immediate") {
  return mutateStore((data) => {
    ensureBilling(data);
    const sub = currentSubscription(data, userId);
    if (!sub || sub.userId !== userId) return { ok: false as const, error: "اشتراک فعال نیست.", status: 404 };
    if (mode === "immediate") {
      history(data, sub.id, sub.status, "cancelled", "immediate");
      sub.status = "cancelled";
      sub.cancelAtPeriodEnd = false;
      sub.cancelledAt = Date.now();
      sub.periodEnd = Date.now();
      sub.autoRenew = false;
    } else {
      history(data, sub.id, sub.status, sub.status, "cancel_at_period_end");
      sub.cancelAtPeriodEnd = true;
      sub.autoRenew = false;
      sub.cancelledAt = Date.now();
    }
    sub.updatedAt = Date.now();
    invalidateBillingCache(userId);
    notify(data, userId, "لغو اشتراک", "پیام و فایل حذف نشد.");
    audit(data, hint(userId), "cancel", mode);
    return { ok: true as const, subscription: publicSub(sub) };
  });
}

export async function reactivateSubscription(userId: string) {
  return mutateStore((data) => {
    ensureBilling(data);
    const sub = billOf(data).subs.filter((s) => s.userId === userId).sort((a, b) => b.updatedAt - a.updatedAt)[0];
    if (!sub) return { ok: false as const, error: "اشتراک نیست.", status: 404 };
    if (sub.status === "suspended") return { ok: false as const, error: "این اشتراک معلق است.", status: 403 };
    history(data, sub.id, sub.status, "active", "reactivate");
    sub.status = "active";
    sub.cancelAtPeriodEnd = false;
    sub.autoRenew = true;
    sub.expiredAt = null;
    sub.cancelledAt = null;
    if (sub.periodEnd < Date.now()) sub.periodEnd = Date.now() + periodMs(sub.interval, planById(data, sub.planId).customDays);
    sub.updatedAt = Date.now();
    invalidateBillingCache(userId);
    audit(data, hint(userId), "reactivate", sub.id);
    return { ok: true as const, subscription: publicSub(sub) };
  });
}

export async function changePlan(userId: string, planId: string, interval: string, idempotencyKey: string) {
  return checkoutAndAttach(userId, { planId, interval, idempotencyKey, trial: false });
}

export async function setSeats(userId: string, seats: number) {
  return mutateStore((data) => {
    ensureBilling(data);
    const sub = currentSubscription(data, userId);
    if (!sub || sub.userId !== userId) return { ok: false as const, error: "اشتراک نیست.", status: 404 };
    const plan = planById(data, sub.planId);
    if (!plan.family) return { ok: false as const, error: "این پلن صندلی ندارد.", status: 400 };
    const n = Math.max(1, Math.min(25, Math.floor(seats)));
    if (n < sub.memberIds.length) return { ok: false as const, error: "ابتدا عضو را حذف کن.", status: 400 };
    sub.seats = n;
    sub.updatedAt = Date.now();
    invalidateBillingCache(userId);
    return { ok: true as const, subscription: publicSub(sub) };
  });
}

export async function addTeamMember(userId: string, memberId: string) {
  return mutateStore((data) => {
    ensureBilling(data);
    const sub = currentSubscription(data, userId);
    if (!sub || sub.userId !== userId) return { ok: false as const, error: "اشتراک نیست.", status: 404 };
    if (!planById(data, sub.planId).family) return { ok: false as const, error: "پلن تیمی نیست.", status: 400 };
    if (sub.memberIds.includes(memberId)) return { ok: true as const, subscription: publicSub(sub) };
    if (sub.memberIds.length >= sub.seats) return { ok: false as const, error: "صندلی خالی نیست.", status: 400 };
    if (!data.users.some((u) => u.id === memberId)) return { ok: false as const, error: "کاربر نیست.", status: 404 };
    sub.memberIds.push(memberId);
    invalidateBillingCache(memberId);
    return { ok: true as const, subscription: publicSub(sub) };
  });
}

export async function claimReferral(userId: string, code: string) {
  return mutateStore((data) => {
    ensureBilling(data);
    const row = billOf(data).referrals.find((r) => r.code === code.trim().toUpperCase());
    if (!row) return { ok: false as const, error: "کد دعوت نیست.", status: 404 };
    if (row.ownerUserId === userId) return { ok: false as const, error: "دعوت خودت پذیرفته نمی‌شود.", status: 400 };
    const owner = data.users.find((u) => u.id === row.ownerUserId);
    const me = data.users.find((u) => u.id === userId);
    if (owner && me && owner.identifierHash === me.identifierHash) return { ok: false as const, error: "دعوت خودی مسدود است.", status: 400 };
    if (billOf(data).referralClaims.some((c) => c.userId === userId)) return { ok: false as const, error: "قبلاً پاداش دعوت گرفتی.", status: 400 };
    billOf(data).referralClaims.push({ code: row.code, userId, at: Date.now() });
    row.grants += 1;
    addCredit(data, userId, 2, "USD", "referral", row.code);
    addCredit(data, row.ownerUserId, 2, "USD", "referral", row.code);
    audit(data, hint(userId), "referral", row.code);
    return { ok: true as const };
  });
}

export async function createReferral(userId: string) {
  return mutateStore((data) => {
    ensureBilling(data);
    let row = billOf(data).referrals.find((r) => r.ownerUserId === userId);
    if (!row) {
      row = { code: `NX${randomId().slice(0, 6).toUpperCase()}`, ownerUserId: userId, grants: 0, createdAt: Date.now() };
      billOf(data).referrals.push(row);
    }
    return { ok: true as const, referral: { code: row.code, grants: row.grants } };
  });
}

export async function requestRefund(userId: string, intentId: string, amount?: number) {
  return mutateStore((data) => {
    ensureBilling(data);
    const intent = billOf(data).intents.find((i) => i.id === intentId && i.userId === userId);
    if (!intent || intent.status !== "succeeded") return { ok: false as const, error: "پرداخت قابل استرداد نیست.", status: 400 };
    const already = billOf(data).refunds.filter((r) => r.intentId === intentId && r.status !== "failed").reduce((s, r) => s + r.amount, 0);
    const want = roundMoney(amount ?? intent.amount, intent.currency);
    if (want <= 0 || already + want > intent.amount + 0.009) return { ok: false as const, error: "مبلغ استرداد نامعتبر است.", status: 400 };
    const row = {
      id: randomId(),
      intentId,
      userId,
      amount: want,
      currency: intent.currency,
      status: "requested" as const,
      reason: "user",
      actorHint: hint(userId),
      createdAt: Date.now(),
    };
    billOf(data).refunds.unshift(row);
    notify(data, userId, "درخواست استرداد", "وضعیت استرداد به‌زودی به‌روز می‌شود.");
    audit(data, hint(userId), "refund_ask", intentId);
    return { ok: true as const, refund: row };
  });
}

export async function financeDashboard() {
  const { requireStaff: rs } = await import("@/lib/admin-moderation");
  const staff = await rs("billing.view");
  if (!staff.ok) return staff;
  const data = await readStoreSnapshot();
  ensureBilling(data);
  syncBillingLifecycle(data);
  const intents = billOf(data).intents;
  const succeeded = intents.filter((i) => i.status === "succeeded");
  const revenue = succeeded.reduce((s, i) => s + convertAmount(i.amount, i.currency, "USD"), 0);
  const refunded = billOf(data).refunds.filter((r) => r.status === "completed");
  const subs = billOf(data).subs;
  return {
    ok: true as const,
    access: {
      canRefund: staff.perms.includes("billing.refund"),
      canManage: staff.perms.includes("billing.manage"),
      export: staff.perms.includes("billing.export"),
    },
    revenueUsd: roundMoney(revenue, "USD"),
    paymentOk: succeeded.length,
    paymentFail: intents.filter((i) => i.status === "failed").length,
    refunds: refunded.length,
    refundAmountUsd: roundMoney(refunded.reduce((s, r) => s + convertAmount(r.amount, r.currency, "USD"), 0), "USD"),
    counts: {
      trial: subs.filter((s) => s.status === "trial").length,
      active: subs.filter((s) => s.status === "active").length,
      pastDue: subs.filter((s) => s.status === "past_due").length,
      cancelled: subs.filter((s) => s.status === "cancelled").length,
      expired: subs.filter((s) => s.status === "expired").length,
      suspended: subs.filter((s) => s.status === "suspended").length,
    },
    review: intents.filter((i) => i.review && i.status === "pending").map(publicIntent),
    chargebacks: billOf(data).chargebacks.slice(0, 20),
    invoices: billOf(data).invoices.slice(0, 40).map((i) => ({
      number: i.number,
      status: i.status,
      total: i.total,
      currency: i.currency,
      userHint: userHint(i.userId),
      createdAt: i.createdAt,
    })),
    audit: billOf(data).audit.slice(0, 30).map((a) => ({ at: a.at, action: a.action, detail: a.detail, actorHint: a.actorHint })),
    webhooks: billOf(data).webhooks.slice(0, 20),
    note: "PAN، CVV و Secret در این نما نیست.",
  };
}

export async function financeMutate(input: {
  action: "refund.complete" | "refund.reject" | "review.clear" | "coupon.upsert" | "chargeback";
  id?: string;
  code?: string;
  percent?: number;
  days?: number;
}) {
  const { requireStaff: rs } = await import("@/lib/admin-moderation");
  const need = input.action.startsWith("refund") ? "billing.refund" : "billing.manage";
  const staff = await rs(need);
  if (!staff.ok) return staff;
  return mutateStore((data) => {
    ensureBilling(data);
    const actor = hint(staff.user.id);
    if (input.action === "refund.complete") {
      const row = billOf(data).refunds.find((r) => r.id === input.id);
      if (!row) return { ok: false as const, error: "استرداد نیست.", status: 404 };
      if (row.status === "completed") return { ok: true as const, duplicate: true };
      const intent = billOf(data).intents.find((i) => i.id === row.intentId);
      if (!intent) return { ok: false as const, error: "پرداخت نیست.", status: 404 };
      row.status = "completed";
      intent.status = row.amount >= intent.amount - 0.009 ? "refunded" : "succeeded";
      addCredit(data, row.userId, row.amount, row.currency, "refund", row.id);
      notify(data, row.userId, "استرداد انجام شد", `مبلغ ${row.amount} ${row.currency} برگشت.`);
      audit(data, actor, "refund_ok", row.id);
      return { ok: true as const };
    }
    if (input.action === "refund.reject") {
      const row = billOf(data).refunds.find((r) => r.id === input.id);
      if (!row) return { ok: false as const, error: "استرداد نیست.", status: 404 };
      row.status = "failed";
      notify(data, row.userId, "استرداد رد شد", "درخواست استرداد پذیرفته نشد.");
      audit(data, actor, "refund_no", row.id);
      return { ok: true as const };
    }
    if (input.action === "review.clear") {
      const intent = billOf(data).intents.find((i) => i.id === input.id);
      if (!intent) return { ok: false as const, error: "پرداخت نیست.", status: 404 };
      intent.review = false;
      intent.status = "processing";
      audit(data, actor, "review_clear", intent.id);
      return { ok: true as const };
    }
    if (input.action === "coupon.upsert") {
      const code = (input.code || "").trim().toUpperCase();
      if (!/^[A-Z0-9]{4,16}$/.test(code)) return { ok: false as const, error: "کد نامعتبر است.", status: 400 };
      const existing = billOf(data).coupons.find((c) => c.code === code);
      const days = Math.max(1, Math.floor(input.days ?? 30));
      const percent = Math.min(90, Math.max(1, Math.floor(input.percent ?? 10)));
      if (existing) {
        existing.percent = percent;
        existing.expiresAt = Date.now() + days * 24 * 60 * 60_000;
      } else {
        billOf(data).coupons.push({
          code,
          percent,
          expiresAt: Date.now() + days * 24 * 60 * 60_000,
          maxRedemptions: 200,
          used: 0,
          newOnly: false,
          planIds: [],
          perUser: 1,
        });
      }
      audit(data, actor, "coupon", code);
      return { ok: true as const };
    }
    if (input.action === "chargeback") {
      const intent = billOf(data).intents.find((i) => i.id === input.id);
      if (!intent) return { ok: false as const, error: "پرداخت نیست.", status: 404 };
      billOf(data).chargebacks.unshift({
        id: randomId(),
        intentId: intent.id,
        status: "open",
        amount: intent.amount,
        currency: intent.currency,
        createdAt: Date.now(),
      });
      audit(data, actor, "chargeback", intent.id);
      return { ok: true as const };
    }
    return { ok: false as const, error: "عملیات نامعتبر است.", status: 400 };
  });
}

export async function financeExport() {
  const dash = await financeDashboard();
  if (!dash.ok) return dash;
  const staff = await (await import("@/lib/admin-moderation")).requireStaff("billing.export");
  if (!staff.ok) return staff;
  const lines = [
    "metric,value",
    `revenue_usd,${dash.revenueUsd}`,
    `payments_ok,${dash.paymentOk}`,
    `payments_fail,${dash.paymentFail}`,
    `refunds,${dash.refunds}`,
    `active,${dash.counts.active}`,
    `trial,${dash.counts.trial}`,
  ];
  return { ok: true as const, csv: lines.join("\n") };
}

