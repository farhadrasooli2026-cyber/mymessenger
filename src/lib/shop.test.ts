import { afterEach, describe, expect, it } from "vitest";
import { hashIp } from "./crypto-utils";
import { completeProfile } from "./profile";
import { getOutbox } from "./outbox";
import { ackHumanChallenge, issueHumanChallenge, startRegistration, verifyOtp } from "./registration";
import { resetStoreForTests } from "./store";
import { cartAdd, createBusiness, setOrderStatus, upsertProduct } from "./business";
import {
  cancelOrder,
  checkout,
  confirmSandboxPay,
  getOrder,
  handlePayWebhook,
  payWebhookSignature,
  payWithWallet,
  rejectCardPlain,
  saveAddress,
  upsertCoupon,
  walletAction,
} from "./shop";

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
    firstName: "خرید",
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

async function shopReady() {
  const owner = await activeUser("pay_own");
  const biz = await createBusiness(owner, {
    name: "Pay Shop",
    username: "pay_shop",
    category: "electronics",
    description: "فروشگاه پرداخت آزمایشی نیکسو.",
    website: "https://nixo.example",
    phone: "09001112233",
    email: "pay@nixo.test",
    address: "تهران",
  });
  if (!biz.ok) throw new Error("biz");
  const product = await upsertProduct(owner, biz.business.id, {
    kind: "product",
    name: "هودی",
    description: "هودی نیکسو",
    price: 100,
    stock: 10,
    currency: "USD",
    variants: [
      { name: "Size", values: ["S", "M", "L"] },
      { name: "Color", values: ["Black", "White"] },
    ],
    variantRows: [{ key: "M|Black", stock: 5, priceDelta: 4 }],
    discount: { kind: "percent", value: 10 },
  });
  if (!product.ok) throw new Error("product");
  await upsertCoupon(owner, biz.business.id, {
    code: "NIXO20",
    kind: "percent",
    value: 20,
    days: 10,
    usageLimit: 5,
    minOrder: 10,
    maxDiscount: 30,
  });
  return { owner, businessId: biz.business.id, productId: product.product.id };
}

describe("NIXO shop and payments", () => {
  afterEach(async () => {
    await resetStoreForTests();
  });

  it("rejects plaintext card data and client-set paid status", async () => {
    expect(rejectCardPlain({ cardNumber: "4242424242424242", action: "pay" })).toBe(true);
    const { owner, businessId, productId } = await shopReady();
    const buyer = await activeUser("pay_buy");
    await cartAdd(buyer, businessId, productId, 1, "M|Black");
    const addr = await saveAddress(buyer, { label: "خانه", line: "خیابان یک", city: "تهران", country: "IR", isDefault: true });
    const co = await checkout(buyer, businessId, {
      addressId: addr.address.id,
      deliveryId: "standard",
      couponCode: "NIXO20",
      method: "card",
      clientTotal: 1,
    });
    expect(co.ok).toBe(false);
    await cartAdd(buyer, businessId, productId, 1, "M|Black");
    const ok = await checkout(buyer, businessId, {
      addressId: addr.address.id,
      deliveryId: "standard",
      couponCode: "NIXO20",
      method: "card",
    });
    expect(ok.ok).toBe(true);
    if (!ok.ok) return;
    expect(ok.order.id.startsWith("NIXO-ORDER-")).toBe(true);
    expect(ok.order.status).toBe("payment_pending");
    const fake = await setOrderStatus(owner, ok.order.id, "paid");
    expect(fake.ok).toBe(false);
    const other = await activeUser("nosy");
    const peek = await getOrder(other, ok.order.id);
    expect(peek.ok).toBe(false);
  });

  it("confirms payment only after provider verification and is idempotent", async () => {
    const { businessId, productId } = await shopReady();
    const buyer = await activeUser("pay_hook");
    await cartAdd(buyer, businessId, productId, 1, "M|Black");
    const addr = await saveAddress(buyer, { label: "a", line: "b", city: "c", country: "IR", isDefault: true });
    const first = await checkout(buyer, businessId, {
      addressId: addr.address.id,
      deliveryId: "pickup",
      method: "card",
      idempotencyKey: "same-key-1",
    });
    expect(first.ok).toBe(true);
    if (!first.ok) return;
    const again = await checkout(buyer, businessId, {
      addressId: addr.address.id,
      deliveryId: "pickup",
      method: "card",
      idempotencyKey: "same-key-1",
    });
    expect(again.ok).toBe(true);
    if (again.ok) expect(again.order.id).toBe(first.order.id);
    const unsigned = await handlePayWebhook(
      JSON.stringify({ providerTxId: first.payment.providerTxId, status: "confirmed", amount: first.payment.amount }),
      "deadbeef",
    );
    expect(unsigned.ok).toBe(false);
    const raw = JSON.stringify({ providerTxId: first.payment.providerTxId, status: "confirmed", amount: first.payment.amount });
    const signed = await handlePayWebhook(raw, payWebhookSignature(raw));
    expect(signed.ok).toBe(true);
    const paid = await getOrder(buyer, first.order.id);
    expect(paid.ok).toBe(true);
    if (paid.ok) {
      expect(paid.order.paymentStatus).toBe("paid");
      expect(paid.invoice).toBeTruthy();
    }
    const replay = await handlePayWebhook(raw, payWebhookSignature(raw));
    expect(replay.ok).toBe(true);
    if (replay.ok && "duplicate" in replay) expect(replay.duplicate).toBe(true);
  });

  it("does not mark paid on failed sandbox pay and supports wallet + cancel rules", async () => {
    const { businessId, productId } = await shopReady();
    const buyer = await activeUser("pay_fail");
    await cartAdd(buyer, businessId, productId, 1, "M|Black");
    const addr = await saveAddress(buyer, { label: "a", line: "b", city: "c", country: "IR", isDefault: true });
    const co = await checkout(buyer, businessId, { addressId: addr.address.id, deliveryId: "pickup", method: "card" });
    expect(co.ok).toBe(true);
    if (!co.ok) return;
    const failed = await confirmSandboxPay(buyer, co.payment.id, "fail");
    expect(failed.ok).toBe(true);
    if (failed.ok) expect(failed.order.paymentStatus).toBe("failed");
    const still = await getOrder(buyer, co.order.id);
    if (still.ok) expect(still.order.status).not.toBe("paid");
    await walletAction(buyer, { action: "add", amount: 500, currency: "USD", confirm: true });
    await cartAdd(buyer, businessId, productId, 1, "M|Black");
    const wco = await checkout(buyer, businessId, { addressId: addr.address.id, deliveryId: "pickup", method: "wallet" });
    expect(wco.ok).toBe(true);
    if (!wco.ok) return;
    const unpaid = await payWithWallet(buyer, wco.payment.id, false);
    expect(unpaid.ok).toBe(false);
    const paid = await payWithWallet(buyer, wco.payment.id, true);
    expect(paid.ok).toBe(true);
    if (paid.ok) expect(paid.state).toBe("Payment Successful");
    const cancelPaid = await cancelOrder(buyer, wco.order.id);
    expect(cancelPaid.ok).toBe(false);
  });
});
