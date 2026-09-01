import { hmacIdentifier } from "@/lib/crypto-utils";
import { VAULT_USER_QUOTA } from "@/lib/storage-types";
import {
  GRACE_MS,
  defaultPlans,
  type BillingStoreSlice,
  type EntitlementKey,
  type PlanLimits,
  type PlanRecord,
  type SubStatus,
  type SubscriptionRow,
} from "@/lib/billing-types";
import { hydrateBillingPersist } from "@/lib/billing-persist";

const cache = new Map<string, { at: number; entitlements: Set<EntitlementKey>; limits: PlanLimits; status: SubStatus | "free"; subId: string | null }>();

export function invalidateBillingCache(userId?: string) {
  if (userId) cache.delete(userId);
  else cache.clear();
}

export function ensureBilling(data: BillingStoreSlice) {
  if (!data.billing || !Array.isArray(data.billing.plans) || !Array.isArray(data.billing.intents) || !Array.isArray(data.billing.subs)) {
    data.billing = hydrateBillingPersist(data.billing);
  }
}

export function planById(data: BillingStoreSlice, id: string): PlanRecord {
  ensureBilling(data);
  return data.billing.plans.find((p) => p.id === id && p.status === "active") ?? defaultPlans()[0]!;
}

export function freePlan(data: BillingStoreSlice) {
  return planById(data, "free");
}

export function syncBillingLifecycle(data: BillingStoreSlice, now = Date.now()) {
  ensureBilling(data);
  for (const intent of data.billing.intents) {
    if ((intent.status === "pending" || intent.status === "processing") && intent.expiresAt < now) {
      intent.status = "cancelled";
      intent.updatedAt = now;
    }
  }
  for (const sub of data.billing.subs) {
    const prev = sub.status;
    if (sub.status === "cancelled" && sub.cancelAtPeriodEnd && now < sub.periodEnd) {
      /* still entitled until period end */
    } else if (sub.status === "cancelled" && now >= sub.periodEnd && !sub.expiredAt) {
      sub.status = "expired";
      sub.expiredAt = now;
      sub.updatedAt = now;
    } else if (sub.status === "trial" && sub.trialEndsAt && now >= sub.trialEndsAt) {
      if (sub.autoRenew) {
        sub.status = "past_due";
        sub.graceUntil = now + GRACE_MS;
      } else {
        sub.status = "expired";
        sub.expiredAt = now;
      }
      sub.updatedAt = now;
    } else if (sub.status === "active" && now >= sub.periodEnd) {
      if (sub.cancelAtPeriodEnd || !sub.autoRenew) {
        sub.status = "expired";
        sub.expiredAt = now;
      } else {
        sub.status = "past_due";
        sub.graceUntil = now + GRACE_MS;
      }
      sub.updatedAt = now;
    } else if (sub.status === "past_due") {
      const until = sub.graceUntil ?? sub.periodEnd + GRACE_MS;
      if (now >= until) {
        sub.status = "expired";
        sub.expiredAt = now;
        sub.updatedAt = now;
      }
    }
    if (prev !== sub.status) {
      data.billing.history.unshift({
        id: `h_${sub.id}_${now}`,
        subId: sub.id,
        at: now,
        from: prev,
        to: sub.status,
        note: "lifecycle",
      });
      invalidateBillingCache(sub.userId);
    }
  }
  data.billing.history = data.billing.history.slice(0, 2000);
}

function entitledStatus(sub: SubscriptionRow, now: number) {
  if (sub.status === "suspended" || sub.status === "expired") return false;
  if (sub.status === "cancelled") return sub.cancelAtPeriodEnd && now < sub.periodEnd;
  if (sub.status === "past_due") return now < (sub.graceUntil ?? sub.periodEnd + GRACE_MS);
  return sub.status === "active" || sub.status === "trial";
}

export function currentSubscription(data: BillingStoreSlice, userId: string, now = Date.now()): SubscriptionRow | null {
  ensureBilling(data);
  syncBillingLifecycle(data, now);
  const rows = data.billing.subs.filter((s) => s.userId === userId || s.memberIds.includes(userId));
  const live = rows.filter((s) => entitledStatus(s, now));
  live.sort((a, b) => b.updatedAt - a.updatedAt);
  return live[0] ?? rows.sort((a, b) => b.updatedAt - a.updatedAt)[0] ?? null;
}

export function entitlementsOf(data: BillingStoreSlice, userId: string, now = Date.now()) {
  const hit = cache.get(userId);
  if (hit && now - hit.at < 4000) return hit;
  ensureBilling(data);
  syncBillingLifecycle(data, now);
  const sub = currentSubscription(data, userId, now);
  const entitled = sub && entitledStatus(sub, now);
  const plan = entitled ? planById(data, sub.planId) : freePlan(data);
  const snap = {
    at: now,
    entitlements: new Set(plan.entitlements),
    limits: plan.limits,
    status: (entitled ? sub!.status : "free") as SubStatus | "free",
    subId: entitled ? sub!.id : null,
  };
  cache.set(userId, snap);
  return snap;
}

export function hasEntitlement(data: BillingStoreSlice, userId: string, key: EntitlementKey) {
  if (key === "core.messaging") return true;
  return entitlementsOf(data, userId).entitlements.has(key);
}

export function userVaultQuota(data: BillingStoreSlice, userId: string) {
  const extra = entitlementsOf(data, userId).limits.storageBonusMb * 1024 * 1024;
  return VAULT_USER_QUOTA + extra;
}

export function storyDailyCap(data: BillingStoreSlice, userId: string) {
  return entitlementsOf(data, userId).limits.storiesPerDay;
}

export function aiDailyCaps(data: BillingStoreSlice, userId: string) {
  const l = entitlementsOf(data, userId).limits;
  return { messages: l.aiMessagesPerDay, files: l.aiFilesPerDay, images: l.aiImagesPerDay };
}

export function creditBalance(data: BillingStoreSlice, userId: string, currency: string) {
  ensureBilling(data);
  return data.billing.credits.filter((c) => c.userId === userId && c.currency === currency).reduce((s, c) => s + c.delta, 0);
}

export function publicSub(sub: SubscriptionRow | null) {
  if (!sub) return null;
  return {
    id: sub.id,
    planId: sub.planId,
    status: sub.status,
    interval: sub.interval,
    currency: sub.currency,
    price: sub.price,
    autoRenew: sub.autoRenew,
    cancelAtPeriodEnd: sub.cancelAtPeriodEnd,
    periodEnd: sub.periodEnd,
    trialEndsAt: sub.trialEndsAt,
    seats: sub.seats,
    memberCount: sub.memberIds.length,
    provider: sub.provider,
  };
}

export function anonymizeBilling(data: BillingStoreSlice, userId: string) {
  ensureBilling(data);
  const ghost = `closed:${hmacIdentifier(`bill-closed:${userId}`).slice(0, 16)}`;
  for (const s of data.billing.subs) {
    if (s.userId === userId) {
      s.userId = ghost;
      s.status = "cancelled";
    }
    s.memberIds = s.memberIds.map((id) => (id === userId ? ghost : id));
  }
  for (const i of data.billing.intents) if (i.userId === userId) i.userId = ghost;
  for (const i of data.billing.invoices) if (i.userId === userId) i.userId = ghost;
  data.billing.methods = data.billing.methods.filter((m) => m.userId !== userId);
  data.billing.customers = data.billing.customers.filter((c) => c.userId !== userId);
  invalidateBillingCache(userId);
}

export function userHint(userId: string) {
  return hmacIdentifier(`bill-user:${userId}`).slice(0, 12);
}
