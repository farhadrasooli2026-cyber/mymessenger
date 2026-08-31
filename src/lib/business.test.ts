import { afterEach, describe, expect, it } from "vitest";
import { hashIp } from "./crypto-utils";
import { completeProfile } from "./profile";
import { getOutbox } from "./outbox";
import { ackHumanChallenge, issueHumanChallenge, startRegistration, verifyOtp } from "./registration";
import { resetStoreForTests } from "./store";
import {
  addStaff,
  cartAdd,
  createBusiness,
  customerMessage,
  nixoReviewVerification,
  placeOrder,
  reportBusiness,
  requestVerification,
  setOrderStatus,
  setQuickReply,
  threadMessages,
  updateBusiness,
  upsertProduct,
} from "./business";
import { DEFAULT_HOURS } from "./business-types";
import { checkUsername } from "./profile";
import { createBot } from "./bots";

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
    firstName: "کسب",
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

const baseBiz = {
  name: "NIXO Store",
  username: "nixo_store",
  category: "electronics",
  description: "فروشگاه آزمایشی نیکسو برای قطعات.",
  website: "https://nixo.example",
  phone: "09000000000",
  email: "store@nixo.test",
  address: "تهران",
};

describe("NIXO Business", () => {
  afterEach(async () => {
    await resetStoreForTests();
  });

  it("converts the same account and rejects a second business", async () => {
    const owner = await activeUser("biz_owner");
    const first = await createBusiness(owner, baseBiz);
    expect(first.ok).toBe(true);
    const second = await createBusiness(owner, { ...baseBiz, username: "nixo_store2", name: "دیگر" });
    expect(second.ok).toBe(false);
  });

  it("keeps business usernames unique against users and bots", async () => {
    await activeUser("taken_name");
    const owner = await activeUser("biz_uniq");
    const clashUser = await createBusiness(owner, { ...baseBiz, username: "taken_name" });
    expect(clashUser.ok).toBe(false);
    const owner2 = await activeUser("bot_owner_b");
    const bot = await createBot(owner2, { name: "فروش", username: "shop_bot_x", description: "ربات فروش آزمایشی نیکسو" });
    expect(bot.ok).toBe(true);
    const clashBot = await createBusiness(owner, { ...baseBiz, username: "shop_bot_x" });
    expect(clashBot.ok).toBe(false);
    const ok = await createBusiness(owner, baseBiz);
    expect(ok.ok).toBe(true);
    const userCheck = await checkUsername("nixo_store");
    expect(userCheck.available).toBe(false);
  });

  it("sends welcome, away when closed, and /price quick reply", async () => {
    const owner = await activeUser("biz_hours");
    const closed = DEFAULT_HOURS.map((h) => ({ ...h, closed: true }));
    const created = await createBusiness(owner, { ...baseBiz, username: "closed_shop", hours: closed });
    expect(created.ok).toBe(true);
    if (!created.ok) return;
    await setQuickReply(owner, created.business.id, "price", "قیمت محصول از کاتالوگ است.");
    const customer = await activeUser("cust_one");
    const sent = await customerMessage(customer, created.business.id, "/price");
    expect(sent.ok).toBe(true);
    if (!sent.ok) return;
    const thread = await threadMessages(owner, sent.threadId);
    expect(thread.ok).toBe(true);
    if (!thread.ok) return;
    const texts = thread.messages.map((m) => m.text);
    expect(texts.some((t) => t.includes("خوش آمدید") || t.includes("سلام"))).toBe(true);
    expect(texts.some((t) => t.includes("خارج از ساعت"))).toBe(true);
    expect(texts).toContain("قیمت محصول از کاتالوگ است.");
    expect(thread.customer).toEqual({
      id: customer,
      displayName: expect.any(String),
      username: "cust_one",
    });
    expect("phone" in thread.customer).toBe(false);
  });

  it("places an order from cart and blocks staff without manageOrders", async () => {
    const owner = await activeUser("shop_own");
    const staff = await activeUser("shop_staff");
    const created = await createBusiness(owner, { ...baseBiz, username: "cart_shop" });
    expect(created.ok).toBe(true);
    if (!created.ok) return;
    const product = await upsertProduct(owner, created.business.id, {
      kind: "product",
      name: "کابل",
      description: "کابل شارژ نیکسو",
      price: 12,
      stock: 4,
      code: "CBL1",
    });
    expect(product.ok).toBe(true);
    if (!product.ok) return;
    const customer = await activeUser("buyer_one");
    const cart = await cartAdd(customer, created.business.id, product.product.id, 2);
    expect(cart.ok).toBe(true);
    const order = await placeOrder(customer, created.business.id, "تحویل محل کار");
    expect(order.ok).toBe(true);
    if (!order.ok) return;
    expect(order.order.status).toBe("pending");
    await addStaff(owner, created.business.id, "shop_staff", { readMessages: true, reply: true });
    const denied = await setOrderStatus(staff, order.order.id, "confirmed");
    expect(denied.ok).toBe(false);
    const allowed = await setOrderStatus(owner, order.order.id, "confirmed");
    expect(allowed.ok).toBe(true);
  });

  it("does not grant Verified from the client and only after NIXO review", async () => {
    const owner = await activeUser("kyc_own");
    const created = await createBusiness(owner, { ...baseBiz, username: "kyc_shop" });
    expect(created.ok).toBe(true);
    if (!created.ok) return;
    const fake = await updateBusiness(owner, created.business.id, { verified: true });
    expect(fake.ok).toBe(false);
    const req = await requestVerification(owner, created.business.id, "شناسه ثبت شرکت آزمایشی نیکسو");
    expect(req.ok).toBe(true);
    if (!req.ok) return;
    expect(req.verification).toBe("pending");
    const again = await updateBusiness(owner, created.business.id, { name: "Kyc Shop" });
    expect(again.ok).toBe(true);
    if (again.ok) expect(again.business.verified).toBe(false);
    const reviewed = await nixoReviewVerification(created.business.id, true);
    expect(reviewed.ok).toBe(true);
    if (reviewed.ok) expect(reviewed.verified).toBe(true);
  });

  it("stores a business report for scam categories", async () => {
    const owner = await activeUser("rep_own");
    const created = await createBusiness(owner, { ...baseBiz, username: "rep_shop" });
    expect(created.ok).toBe(true);
    if (!created.ok) return;
    const reporter = await activeUser("rep_user");
    const filed = await reportBusiness(reporter, created.business.id, "scam", "فروشگاه جعلی");
    expect(filed.ok).toBe(true);
  });
});
