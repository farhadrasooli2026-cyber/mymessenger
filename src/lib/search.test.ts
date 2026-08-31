import { afterEach, describe, expect, it } from "vitest";
import { hashIp } from "./crypto-utils";
import { completeProfile, updateProfile } from "./profile";
import { ackHumanChallenge, issueHumanChallenge, startRegistration, verifyOtp } from "./registration";
import { getOutbox } from "./outbox";
import { mutateStore, resetStoreForTests } from "./store";
import { createChannel, createPost } from "./channels";
import { createGroup } from "./groups";
import { clearSearchHistory, globalSearch } from "./search";
import { blobMatches, foldText, matchScore, suggestTerms } from "./search-match";
import { listSaved, saveItem } from "./saved";
import { createBusiness, upsertProduct } from "./business";
import { sendAiMessage } from "./ai";

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
    firstName: "جستجو",
    lastName: "آزمایش",
    username,
    bio: "",
    privacyPhoto: "everyone",
    privacyBio: "everyone",
    photoAllowIds: [],
    bioAllowIds: [],
  });
  if (!done.ok) throw new Error("profile");
  return verified.userId;
}

describe("NIXO search and saved messages", () => {
  afterEach(async () => {
    await resetStoreForTests();
  });

  it("finds public usernames and hides blocked accounts", async () => {
    const a = await activeUser("sr_alpha");
    const b = await activeUser("sr_beta");
    const found = await globalSearch(a, { q: "sr_beta", kind: "users" });
    expect(found.ok).toBe(true);
    if (!found.ok) return;
    expect(found.hits.some((h) => h.target.id === b)).toBe(true);
    await mutateStore((data) => {
      data.users.find((u) => u.id === a)?.blockedPeerKeys.push(b);
    });
    const hidden = await globalSearch(a, { q: "sr_beta", kind: "users" });
    expect(hidden.ok).toBe(true);
    if (!hidden.ok) return;
    expect(hidden.hits.some((h) => h.target.id === b)).toBe(false);
  });

  it("does not leak private channels or invite-only groups", async () => {
    const owner = await activeUser("sr_own");
    const stranger = await activeUser("sr_str");
    const priv = await createChannel(owner, { name: "اتاق داخلی نکسو", visibility: "private" });
    expect(priv.ok).toBe(true);
    const pub = await createChannel(owner, { name: "اخبار عمومی نکسو", username: "nixo_pub_sr", visibility: "public" });
    expect(pub.ok).toBe(true);
    const secret = await createGroup(owner, { name: "اتاق مخفی نکسو", joinMode: "invite" });
    expect(secret.ok).toBe(true);
    const open = await createGroup(owner, { name: "باشگاه باز نکسو", joinMode: "open", username: "nixo_open_sr" });
    expect(open.ok).toBe(true);
    const result = await globalSearch(stranger, { q: "نکسو", kind: "all" });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    if (priv.ok) expect(result.hits.some((h) => h.target.id === priv.channel.id)).toBe(false);
    if (pub.ok) expect(result.hits.some((h) => h.target.id === pub.channel.id)).toBe(true);
    if (secret.ok) expect(result.hits.some((h) => h.target.id === secret.group.id)).toBe(false);
    if (open.ok) expect(result.hits.some((h) => h.target.id === open.group.id)).toBe(true);
  });

  it("searches published channel posts for people who can see the channel", async () => {
    const owner = await activeUser("sr_chown");
    const fan = await activeUser("sr_fan");
    const created = await createChannel(owner, { name: "پخش نکسو", username: "nixo_cast_sr", visibility: "public" });
    expect(created.ok).toBe(true);
    if (!created.ok) return;
    const post = await createPost(owner, created.channel.id, { body: "سلام از کانال نیکسو", kind: "text" });
    expect(post.ok).toBe(true);
    const found = await globalSearch(fan, { q: "سلام از کانال", kind: "messages" });
    expect(found.ok).toBe(true);
    if (!found.ok) return;
    expect(found.hits.some((h) => h.preview.includes("سلام"))).toBe(true);
  });

  it("keeps Saved Messages private, tagged, pinned, and paginated", async () => {
    const owner = await activeUser("sv_own");
    const other = await activeUser("sv_oth");
    const first = await saveItem(owner, { kind: "text", body: "یادداشت کاری", tag: "Work" });
    expect(first.ok).toBe(true);
    const pin = await saveItem(owner, { kind: "link", linkUrl: "https://nixo.example/docs", body: "مستند", tag: "Important", pinned: true });
    expect(pin.ok).toBe(true);
    const mine = await listSaved(owner, { q: "" });
    expect(mine.items[0]?.pinned).toBe(true);
    const theirs = await listSaved(other, { q: "" });
    expect(theirs.items.length).toBe(0);
    for (let i = 0; i < 5; i += 1) {
      await saveItem(owner, { kind: "text", body: `صفحه ${i}` });
    }
    const page = await listSaved(owner, { limit: 3, offset: 0 });
    expect(page.items.length).toBe(3);
    expect(page.hasMore).toBe(true);
  });

  it("records and clears search history", async () => {
    const user = await activeUser("sr_hist");
    const run = await globalSearch(user, { q: "نیکسو" });
    expect(run.ok).toBe(true);
    if (!run.ok) return;
    expect(run.history[0]).toBe("نیکسو");
    const cleared = await clearSearchHistory(user);
    expect(cleared.ok).toBe(true);
    const empty = await globalSearch(user, { q: "" });
    expect(empty.ok).toBe(true);
    if (!empty.ok) return;
    expect(empty.history.length).toBe(0);
  });

  it("hides private bio, skips two-letter user enumeration, and ranks fuzzy terms", async () => {
    const a = await activeUser("sr_enum");
    const b = await activeUser("sr_secretbio");
    await updateProfile(b, { bio: "شماره مخفی آزمایشی ۹۹۹", privacyBio: "nobody" });
    const byUser = await globalSearch(a, { q: "sr_secretbio", kind: "users" });
    expect(byUser.ok).toBe(true);
    if (byUser.ok) {
      const hit = byUser.hits.find((h) => h.target.id === b);
      expect(hit).toBeTruthy();
      expect(hit?.preview).not.toMatch(/۹۹۹|مخفی آزمایشی/);
    }
    const enumQ = await globalSearch(a, { q: "sr", kind: "users" });
    expect(enumQ.ok).toBe(true);
    if (enumQ.ok) expect(enumQ.hits.filter((h) => h.kind === "user").length).toBe(0);
    const atQ = await globalSearch(a, { q: "@sr_secretbio", kind: "users" });
    expect(atQ.ok && atQ.hits.some((h) => h.target.id === b)).toBe(true);
    expect(foldText("يك")).toBe("یک");
    expect(matchScore("photography", "pho")).toBeGreaterThan(60);
    expect(blobMatches("Phone Case", "phne")).toBe(true);
    expect(suggestTerms("pho")).toEqual(expect.arrayContaining(["photo", "phone", "photography"]));
  });

  it("filters products by price and category and does not index E2EE group text", async () => {
    const owner = await activeUser("sr_shop");
    const buyer = await activeUser("sr_buy");
    const biz = await createBusiness(owner, {
      name: "NIXO Store",
      username: "nixo_sr_store",
      category: "electronics",
      description: "فروشگاه آزمایشی جستجو نیکسو.",
      address: "تهران",
    });
    expect(biz.ok).toBe(true);
    if (!biz.ok) return;
    await upsertProduct(owner, biz.business.id, {
      kind: "product",
      name: "Phone Case",
      description: "قاب گوشی",
      price: 25,
      stock: 4,
      category: "accessories",
    });
    await upsertProduct(owner, biz.business.id, {
      kind: "product",
      name: "Laptop Stand",
      description: "پایه لپتاپ",
      price: 90,
      stock: 2,
      category: "office",
    });
    const cheap = await globalSearch(buyer, { q: "Phone", kind: "products", maxPrice: 30, category: "accessories" });
    expect(cheap.ok && cheap.hits.some((h) => h.title === "Phone Case")).toBe(true);
    const pricey = await globalSearch(buyer, { q: "Phone", kind: "products", minPrice: 80 });
    expect(pricey.ok && pricey.hits.every((h) => h.title !== "Phone Case")).toBe(true);
    const open = await createGroup(owner, { name: "گروه جستجو", joinMode: "open", username: "sr_g_open" });
    expect(open.ok).toBe(true);
    if (!open.ok) return;
    await mutateStore((data) => {
      data.groupMessages.push({
        id: "gm-secret",
        groupId: open.group.id,
        senderKey: owner,
        senderName: "مالک",
        enc: "e2ee-v1",
        ciphertext: "meeting-secret-e2ee-plain",
        nonce: "n",
        createdAt: Date.now(),
        kind: "text",
        reactions: [],
      });
    });
    const leak = await globalSearch(owner, { q: "meeting-secret-e2ee-plain", kind: "messages" });
    expect(leak.ok && leak.hits.every((h) => !h.preview.includes("meeting-secret"))).toBe(true);
  });

  it("lets AI search only through the same permissioned index", async () => {
    const owner = await activeUser("sr_aiown");
    const stranger = await activeUser("sr_aistr");
    const priv = await createChannel(owner, { name: "اتاق داخلی نکسو AI", visibility: "private" });
    expect(priv.ok).toBe(true);
    const pub = await createChannel(owner, { name: "اخبار عمومی نکسو AI", username: "nixo_ai_pub", visibility: "public" });
    expect(pub.ok).toBe(true);
    if (pub.ok) await createPost(owner, pub.channel.id, { body: "Hello from public nixo", kind: "text" });
    const ai = await sendAiMessage(stranger, { text: "جستجو نکسو AI" });
    expect(ai.ok).toBe(true);
    if (!ai.ok) return;
    expect(ai.assistant.text).toMatch(/اخبار عمومی نکسو AI/);
    expect(ai.assistant.text).not.toMatch(/اتاق داخلی نکسو AI/);
  });
});
