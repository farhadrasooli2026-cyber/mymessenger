import { afterEach, describe, expect, it } from "vitest";
import { hashIp } from "./crypto-utils";
import { completeProfile } from "./profile";
import { getOutbox } from "./outbox";
import { ackHumanChallenge, issueHumanChallenge, startRegistration, verifyOtp } from "./registration";
import { mutateStore, readStoreSnapshot, resetStoreForTests } from "./store";
import { enableTwoStep } from "./security";
import { rejectCardPlain } from "./shop";
import {
  billingWebhookSignature,
  checkoutAndAttach,
  claimReferral,
  confirmSandboxIntent,
  createReferral,
  financeMutate,
  handleBillingWebhook,
  myBilling,
  requestRefund,
  cancelSubscription,
} from "./billing";
import { hasEntitlement, invalidateBillingCache, syncBillingLifecycle } from "./billing-access";
import { clearStaffCookie, setStaffRole, staffLogin, writeStaffCookie } from "./admin-moderation";

async function activeUser(username: string) {
  const ip = hashIp(`test-ip:${username}`);
  const issued = await issueHumanChallenge(ip);
  await ackHumanChallenge(issued.token, ip);
  const start = await startRegistration(
    { channel: "email", identifier: `${username}@nixo.test`, humanToken: issued.token, website: "" },
    ip,
  );
  if (!start.ok) throw new Error("start");
  const code = getOutbox(start.challengeId)?.body.match(/\b(\d{6})\b/)?.[1] ?? "";
  const verified = await verifyOtp(start.challengeId, code, ip);
  if (!verified.ok) throw new Error("verify");
  const done = await completeProfile(verified.userId, {
    firstName: "صورتحساب",
    lastName: "آزمایش",
    username,
    bio: "بیو",
    privacyPhoto: "everyone",
    privacyBio: "everyone",
    photoAllowIds: [],
    bioAllowIds: [],
  });
  if (!done.ok) throw new Error("profile");
  return verified.userId;
}

describe("billing monetization", () => {
  afterEach(async () => {
    await clearStaffCookie();
    await resetStoreForTests();
  });

  it("enforces entitlements server-side, idempotency, webhooks, trial, coupon, cancel, expire, refund RBAC, referral", async () => {
    const uid = await activeUser("bill_user");
    const peer = await activeUser("bill_peer");
    let snap = await readStoreSnapshot();
    expect(hasEntitlement(snap, uid, "ai.plus")).toBe(false);
    expect(hasEntitlement(snap, uid, "core.messaging")).toBe(true);

    expect(rejectCardPlain({ cardNumber: "4111111111111111", action: "checkout" })).toBe(true);

    const first = await checkoutAndAttach(uid, { planId: "plus", interval: "month", idempotencyKey: "idem-plus-1", trial: true });
    expect(first.ok).toBe(true);
    if (!first.ok) throw new Error("checkout");
    const again = await checkoutAndAttach(uid, { planId: "plus", interval: "month", idempotencyKey: "idem-plus-1", trial: true });
    expect(again.ok && again.duplicate).toBe(true);

    const confirmed = await confirmSandboxIntent(uid, first.intent.id, "success");
    expect(confirmed.ok).toBe(true);
    snap = await readStoreSnapshot();
    expect(hasEntitlement(snap, uid, "ai.plus")).toBe(true);
    expect(snap.billing.invoices[0]?.number.startsWith("NIXO-INV-")).toBe(true);
    expect(snap.billing.subs[0]?.status).toBe("trial");

    const secondTrial = await checkoutAndAttach(uid, { planId: "premium", interval: "year", idempotencyKey: "idem-prem-1", trial: true });
    expect(secondTrial.ok).toBe(true);
    if (!secondTrial.ok) throw new Error("t2");
    await confirmSandboxIntent(uid, secondTrial.intent.id, "success");
    snap = await readStoreSnapshot();
    expect(snap.billing.subs[0]?.status).toBe("active");
    expect(hasEntitlement(snap, uid, "calls.hd")).toBe(true);

    await mutateStore((data) => {
      const c = data.billing.coupons.find((x: { code: string }) => x.code === "WELCOME10");
      if (c) c.expiresAt = Date.now() - 1000;
    });
    const expiredCoupon = await checkoutAndAttach(uid, {
      planId: "plus",
      interval: "month",
      coupon: "WELCOME10",
      idempotencyKey: "idem-coupon-dead",
    });
    expect(expiredCoupon.ok).toBe(false);

    const period = await cancelSubscription(uid, "period_end");
    expect(period.ok).toBe(true);
    snap = await readStoreSnapshot();
    expect(hasEntitlement(snap, uid, "calls.hd")).toBe(true);

    await mutateStore((data) => {
      const sub = data.billing.subs.find((s: { userId: string }) => s.userId === uid);
      if (sub) {
        sub.periodEnd = Date.now() - 1000;
        sub.cancelAtPeriodEnd = true;
        sub.status = "cancelled";
      }
    });
    invalidateBillingCache(uid);
    snap = await readStoreSnapshot();
    syncBillingLifecycle(snap);
    expect(hasEntitlement(snap, uid, "calls.hd")).toBe(false);
    expect(snap.users.some((u) => u.id === uid)).toBe(true);

    const pay = await checkoutAndAttach(uid, { planId: "plus", interval: "month", idempotencyKey: "idem-plus-2" });
    expect(pay.ok).toBe(true);
    if (!pay.ok) throw new Error("pay");
    const paid = await confirmSandboxIntent(uid, pay.intent.id, "success");
    expect(paid.ok).toBe(true);
    snap = await readStoreSnapshot();
    const intent = snap.billing.intents.find((i: { id: string }) => i.id === pay.intent.id)!;
    const raw = JSON.stringify({ eventId: "evt-1", providerRef: intent.providerRef, status: "succeeded" });
    const bad = await handleBillingWebhook(raw, "deadbeef");
    expect(bad.ok).toBe(false);
    expect(bad.status).toBe(401);
    const okHook = await handleBillingWebhook(raw, billingWebhookSignature(raw));
    expect(okHook.ok).toBe(true);
    const dupHook = await handleBillingWebhook(raw, billingWebhookSignature(raw));
    expect(dupHook.ok && "duplicate" in dupHook && dupHook.duplicate).toBe(true);
    expect(hasEntitlement(snap, uid, "ai.plus")).toBe(true);

    const asked = await requestRefund(uid, pay.intent.id);
    expect(asked.ok).toBe(true);
    if (!asked.ok) throw new Error(asked.error);

    const ops = await activeUser("nixo_ops");
    const pw = "NixoAdminPass12";
    await enableTwoStep(ops, pw, "127.0.0.1");
    const login = await staffLogin(ops, pw, undefined, "127.0.0.1", "vitest");
    if (!login.ok) throw new Error(login.error);
    await writeStaffCookie(ops, login.sid);
    const done = await financeMutate({ action: "refund.complete", id: asked.refund.id });
    expect(done.ok).toBe(true);
    const againRefund = await financeMutate({ action: "refund.complete", id: asked.refund.id });
    expect(againRefund.ok && "duplicate" in againRefund).toBe(true);

    const analyst = await activeUser("bill_analyst");
    await enableTwoStep(analyst, "CivilianPass12", "127.0.0.1");
    const grant = await setStaffRole(analyst, "analyst", pw, "ROLE");
    expect(grant.ok).toBe(true);
    await clearStaffCookie();
    const aLogin = await staffLogin(analyst, "CivilianPass12", undefined, "127.0.0.1", "vitest");
    if (!aLogin.ok) throw new Error(aLogin.error);
    await writeStaffCookie(analyst, aLogin.sid);
    const denied = await financeMutate({ action: "refund.complete", id: asked.refund.id });
    expect(denied.ok).toBe(false);

    const ref = await createReferral(uid);
    expect(ref.ok).toBe(true);
    if (!ref.ok) throw new Error("ref");
    const self = await claimReferral(uid, ref.referral.code);
    expect(self.ok).toBe(false);
    const claim = await claimReferral(peer, ref.referral.code);
    expect(claim.ok).toBe(true);

    const mine = await myBilling(uid);
    expect(mine.intents.every((i: { id: string }) => !("tokenRef" in i))).toBe(true);
    const blob = JSON.stringify(mine);
    expect(blob).not.toMatch(/4111111111111111/);
    expect(blob).not.toMatch(/tok_/);
  });
});
