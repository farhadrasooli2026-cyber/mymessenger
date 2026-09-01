import { afterEach, describe, expect, it } from "vitest";
import { hashIp } from "./crypto-utils";
import { completeProfile, updateProfile } from "./profile";
import { updatePrivacy } from "./privacy";
import { ackHumanChallenge, issueHumanChallenge, startRegistration, verifyOtp } from "./registration";
import { getOutbox } from "./outbox";
import { mutateStore, resetStoreForTests } from "./store";
import { createChannel, createPost } from "./channels";
import { createGroup } from "./groups";
import { clearSearchHistory, exportSearchHistory, globalSearch, rebuildSearchIndex, removeSearchHistoryItem } from "./search";
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

  it("hides users who disable username discovery and drops deleted accounts", async () => {
    const a = await activeUser("sr_find_a");
    const b = await activeUser("sr_find_b");
    await updatePrivacy(b, { privacyFindUsername: "nobody" });
    const hidden = await globalSearch(a, { q: "sr_find_b", kind: "people" });
    expect(hidden.ok && hidden.hits.every((h) => h.target.id !== b)).toBe(true);
    await updatePrivacy(b, { privacyFindUsername: "everyone" });
    const shown = await globalSearch(a, { q: "@sr_find_b", kind: "people" });
    expect(shown.ok && shown.hits.some((h) => h.target.id === b && h.verified === false)).toBe(true);
    await mutateStore((data) => {
      const u = data.users.find((x) => x.id === b);
      if (u) u.accountStatus = "pending_deletion";
    });
    const gone = await globalSearch(a, { q: "sr_find_b", kind: "users" });
    expect(gone.ok && gone.hits.every((h) => h.target.id !== b)).toBe(true);
  });

  it("does not leak extra data on phone lookup and can delete one history item", async () => {
    const owner = await activeUser("sr_phown");
    await mutateStore((data) => {
      const u = data.users.find((x) => x.id === owner);
      if (u) {
        u.channel = "phone";
        u.identifierHash = "deadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeef";
      }
    });
    const stranger = await activeUser("sr_phstr");
    const miss = await globalSearch(stranger, { q: "09120001111", kind: "people" });
    expect(miss.ok && miss.hits.length === 0).toBe(true);
    const run = await globalSearch(stranger, { q: "sr_phown" });
    expect(run.ok).toBe(true);
    const cut = await removeSearchHistoryItem(stranger, "sr_phown");
    expect(cut.ok && cut.history.includes("sr_phown")).toBe(false);
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

  it("does not resolve a previous username to the same account", async () => {
    const a = await activeUser("sr_oldnm");
    const b = await activeUser("sr_chgfrom");
    const changed = await updateProfile(b, { username: "sr_chgto" });
    expect(changed.ok).toBe(true);
    const old = await globalSearch(a, { q: "@sr_chgfrom", kind: "people" });
    expect(old.ok && old.hits.every((h) => h.target.id !== b)).toBe(true);
    const neu = await globalSearch(a, { q: "@sr_chgto", kind: "people" });
    expect(neu.ok && neu.hits.some((h) => h.target.id === b)).toBe(true);
  });

  it("filters products by price and category and does not index E2EE group text", async () => {
    const owner = await activeUser("sr_shop");
    const buyer = await activeUser("sr_buy");
    const biz = await createBusiness(owner, {
      name: "NIXO Store",
      username: "nixo_sr_store",
      category: "electronics",
      description: "فروشگاه آزمایشی جستجو نیکسو.",
      website: "https://nixo.example",
      phone: "09001112233",
      email: "store@nixo.test",
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

  it("matches exact quotes, hashtags for authorized posts only, and file names", async () => {
    const owner = await activeUser("sr_exown");
    const fan = await activeUser("sr_exfan");
    const pub = await createChannel(owner, { name: "کانال هشتگ", username: "nixo_hash_sr", visibility: "public" });
    const priv = await createChannel(owner, { name: "کانال هشتگ خصوصی", visibility: "private" });
    expect(pub.ok && priv.ok).toBe(true);
    if (!pub.ok || !priv.ok) return;
    await createPost(owner, pub.channel.id, { body: "گزارش فوری #nixoalpha سلام نیکسو", kind: "text" });
    await createPost(owner, pub.channel.id, { body: "فایل پیوست", caption: "invoice-nixo.pdf", kind: "file", fileName: "invoice-nixo.pdf" });
    await createPost(owner, priv.channel.id, { body: "مخفی #nixoalpha", kind: "text" });
    const exact = await globalSearch(fan, { q: '"گزارش فوری"', kind: "messages" });
    expect(exact.ok && exact.hits.some((h) => h.preview.includes("گزارش فوری"))).toBe(true);
    const loose = await globalSearch(fan, { q: '"گزارش فوری نیست"', kind: "messages" });
    expect(loose.ok && loose.hits.every((h) => !h.preview.includes("گزارش فوری"))).toBe(true);
    const tags = await globalSearch(fan, { q: "nixoalpha", kind: "hashtags" });
    expect(tags.ok && tags.hits.some((h) => h.target.id === pub.channel.id)).toBe(true);
    expect(tags.ok && tags.hits.every((h) => h.target.id !== priv.channel.id)).toBe(true);
    const files = await globalSearch(fan, { q: "invoice-nixo", kind: "files" });
    expect(files.ok && files.hits.some((h) => h.preview.includes("invoice-nixo"))).toBe(true);
  });

  it("refuses channelId IDOR, search-by-id without access, and regex/oversize queries", async () => {
    const owner = await activeUser("sr_idorown");
    const stranger = await activeUser("sr_idorstr");
    const priv = await createChannel(owner, { name: "اتاق شناسه مخفی", visibility: "private" });
    expect(priv.ok).toBe(true);
    if (!priv.ok) return;
    await createPost(owner, priv.channel.id, { body: "secret-idor-body-nixo", kind: "text" });
    const scoped = await globalSearch(stranger, { q: "secret-idor-body-nixo", kind: "messages", channelId: priv.channel.id });
    expect(scoped.ok && scoped.hits.length === 0).toBe(true);
    const byId = await globalSearch(stranger, { q: priv.channel.id, kind: "channels" });
    expect(byId.ok && byId.hits.every((h) => h.target.id !== priv.channel.id)).toBe(true);
    const ownerId = await globalSearch(owner, { q: `nixo:channel:${priv.channel.id}` });
    expect(ownerId.ok && ownerId.hits.some((h) => h.target.id === priv.channel.id)).toBe(true);
    const regex = await globalSearch(stranger, { q: "(a+)+" });
    expect(regex.ok).toBe(false);
    const huge = await globalSearch(stranger, { q: "x".repeat(250) });
    expect(huge.ok).toBe(false);
  });

  it("keeps discovery public-only, sorts by recency, and isolates history export", async () => {
    const owner = await activeUser("sr_discown");
    const stranger = await activeUser("sr_discstr");
    const priv = await createChannel(owner, { name: "کشف خصوصی نکسو", visibility: "private" });
    const pub = await createChannel(owner, { name: "کشف عمومی نکسو", username: "nixo_disc_pub", visibility: "public" });
    expect(priv.ok && pub.ok).toBe(true);
    if (!pub.ok || !priv.ok) return;
    await createPost(owner, pub.channel.id, { body: "پست کهنه", kind: "text" });
    await createPost(owner, pub.channel.id, { body: "پست تازه نکسو", kind: "text" });
    const feed = await globalSearch(stranger, { q: "", feed: "discovery", recordHistory: false });
    expect(feed.ok && feed.hits.some((h) => h.target.id === pub.channel.id)).toBe(true);
    expect(feed.ok && feed.hits.every((h) => h.target.id !== priv.channel.id)).toBe(true);
    const newest = await globalSearch(stranger, { q: "نکسو", kind: "messages", sort: "newest" });
    expect(newest.ok).toBe(true);
    if (newest.ok && newest.hits.length >= 2) {
      expect(newest.hits[0]!.date).toBeGreaterThanOrEqual(newest.hits[1]!.date);
    }
    await globalSearch(owner, { q: "تاریخچه اختصاصی مالک" });
    const mine = await exportSearchHistory(owner);
    const theirs = await exportSearchHistory(stranger);
    expect(mine.ok && mine.export.queries.some((q) => q.includes("تاریخچه اختصاصی"))).toBe(true);
    expect(theirs.ok && theirs.export.queries.every((q) => !q.includes("تاریخچه اختصاصی"))).toBe(true);
    const ops = await activeUser("nixo_ops");
    const rebuilt = await rebuildSearchIndex(ops);
    expect(rebuilt.ok).toBe(true);
    const denied = await rebuildSearchIndex(stranger);
    expect(denied.ok).toBe(false);
  });

  it("applies operators, rejects injection, and keeps member search membership-bound", async () => {
    const owner = await activeUser("sr_opown");
    const fan = await activeUser("sr_opfan");
    const stranger = await activeUser("sr_opstr");
    const pub = await createChannel(owner, { name: "کانال عملگر", username: "nixo_op_pub", visibility: "public" });
    expect(pub.ok).toBe(true);
    if (!pub.ok) return;
    await createPost(owner, pub.channel.id, { body: "لینک عمومی https://nixo.example/ops", kind: "text" });
    const links = await globalSearch(fan, { q: "has:link nixo", kind: "messages" });
    expect(links.ok && links.hits.some((h) => h.preview.includes("https://nixo.example"))).toBe(true);
    const inject = await globalSearch(fan, { q: "$where" });
    expect(inject.ok).toBe(false);
    const g = await createGroup(owner, { name: "گروه اعضا سرچ", joinMode: "invite", memberKeys: [fan] });
    expect(g.ok).toBe(true);
    if (!g.ok) return;
    const members = await globalSearch(owner, { q: "جستجو", kind: "members", groupId: g.group.id });
    expect(members.ok && members.hits.some((h) => h.scope === "member")).toBe(true);
    const leak = await globalSearch(stranger, { q: "جستجو", kind: "members", groupId: g.group.id });
    expect(leak.ok && leak.hits.every((h) => h.scope !== "member")).toBe(true);
    const stickers = await globalSearch(fan, { q: "nixo", kind: "stickers" });
    expect(stickers.ok && stickers.hits.some((h) => h.kind === "sticker")).toBe(true);
    const emoji = await globalSearch(fan, { q: "heart", kind: "emoji" });
    expect(emoji.ok).toBe(true);
  });

  it("folds Turkish letters for matching", async () => {
    expect(foldText("İstanbul")).toContain("stanbul");
    expect(blobMatches("fotoğraf mağaza", "fotograf")).toBe(true);
  });

  it("indexes only public docs, hides recommendations, and authorizes search open", async () => {
    const owner = await activeUser("sr_idxown");
    const stranger = await activeUser("sr_idxstr");
    const priv = await createChannel(owner, { name: "ایندکس خصوصی", visibility: "private" });
    const pub = await createChannel(owner, { name: "ایندکس عمومی", username: "nixo_idx_pub", visibility: "public" });
    expect(priv.ok && pub.ok).toBe(true);
    if (!pub.ok || !priv.ok) return;
    const ops = await activeUser("nixo_ops");
    const rebuilt = await rebuildSearchIndex(ops);
    expect(rebuilt.ok).toBe(true);
    await mutateStore((data) => {
      expect(data.searchDocs.some((d) => d.entityId === pub.channel.id && d.kind === "channel")).toBe(true);
      expect(data.searchDocs.every((d) => d.entityId !== priv.channel.id)).toBe(true);
    });
    const closed = await createGroup(owner, { name: "گروه خصوصی ایندکس", joinMode: "invite" });
    const pubGroup = await createGroup(owner, { name: "گروه عمومی ایندکس", joinMode: "open", username: "nixo_idx_g" });
    expect(closed.ok && pubGroup.ok).toBe(true);
    await rebuildSearchIndex(ops);
    if (closed.ok && pubGroup.ok) {
      await mutateStore((data) => {
        expect(data.searchDocs.some((d) => d.entityId === pubGroup.group.id && d.kind === "group")).toBe(true);
        expect(data.searchDocs.every((d) => d.entityId !== closed.group.id)).toBe(true);
      });
    }
    const { hideSearchRecommendation, openSearchResult } = await import("./search");
    await hideSearchRecommendation(stranger, pub.channel.id);
    const feed = await globalSearch(stranger, { q: "", feed: "discovery", recordHistory: false });
    expect(feed.ok && feed.hits.every((h) => h.target.id !== pub.channel.id)).toBe(true);
    const opened = await openSearchResult(stranger, `cpost:not-a-real-id`);
    expect(opened.ok).toBe(false);
    const chOpen = await openSearchResult(stranger, `channel:${priv.channel.id}`);
    expect(chOpen.ok).toBe(false);
    const okOpen = await openSearchResult(stranger, `channel:${pub.channel.id}`);
    expect(okOpen.ok).toBe(true);
    const paged = await globalSearch(stranger, { q: "ایندکس", kind: "channels", limit: 1 });
    expect(paged.ok && (paged.nextCursor === null || typeof paged.nextCursor === "string")).toBe(true);
  });

  it("searches friends only, keeps private stories out of global search, and never trends private queries", async () => {
    const a = await activeUser("sr_fr_a");
    const friend = await activeUser("sr_fr_b");
    const stranger = await activeUser("sr_fr_c");
    await mutateStore((data) => {
      const ua = data.users.find((u) => u.id === a);
      const ub = data.users.find((u) => u.id === friend);
      if (ua && ub) {
        ua.friendIds.push(friend);
        ub.friendIds.push(a);
      }
    });
    const friends = await globalSearch(a, { q: "sr_fr_b", kind: "friends" });
    expect(friends.ok && friends.hits.some((h) => h.target.id === friend && h.scope === "friend")).toBe(true);
    const notFriend = await globalSearch(a, { q: "sr_fr_c", kind: "friends" });
    expect(notFriend.ok && notFriend.hits.every((h) => h.target.id !== stranger)).toBe(true);

    const { createStory, deleteStory, editStory } = await import("./stories");
    const { openSearchResult, searchHealth } = await import("./search");
    const pub = await createStory(friend, { kind: "text", body: "استوری عمومی نکسو طلوع", visibility: "everyone" });
    expect(pub.ok).toBe(true);
    const priv = await createStory(friend, { kind: "text", body: "استوری محرمانه دوستان نزدیک", visibility: "closeFriends" });
    expect(priv.ok).toBe(true);
    const found = await globalSearch(a, { q: "طلوع", kind: "stories" });
    expect(found.ok && found.hits.some((h) => h.scope === "story")).toBe(true);
    const leak = await globalSearch(a, { q: "محرمانه دوستان", kind: "stories" });
    expect(leak.ok && leak.hits.every((h) => h.preview !== "استوری محرمانه دوستان نزدیک" && !h.title.includes("محرمانه"))).toBe(true);
    if (priv.ok) {
      const idor = await openSearchResult(a, `story:${priv.story.id}`);
      expect(idor.ok).toBe(false);
    }
    if (pub.ok) {
      const okOpen = await openSearchResult(a, `story:${pub.story.id}`);
      expect(okOpen.ok).toBe(true);
      await mutateStore((data) => {
        const s = data.userStories.find((x) => x.id === pub.story.id);
        if (s) s.expiresAt = Date.now() - 1000;
      });
      const expired = await globalSearch(a, { q: "طلوع", kind: "stories" });
      expect(expired.ok && expired.hits.every((h) => h.target.id !== pub.story.id)).toBe(true);
    }
    const again = await createStory(friend, { kind: "text", body: "استوری حذف‌شونده نکسو", visibility: "everyone" });
    expect(again.ok).toBe(true);
    if (again.ok) {
      await deleteStory(friend, again.story.id);
      const gone = await globalSearch(a, { q: "حذف‌شونده", kind: "stories" });
      expect(gone.ok && gone.hits.every((h) => h.target.id !== again.story.id)).toBe(true);
    }
    await globalSearch(a, { q: "#نکسوجستجو" });
    await globalSearch(a, { q: "پیام خصوصی خودم برای روند" });
    await mutateStore((data) => {
      expect(Object.keys(data.searchPopular ?? {}).some((t) => t.includes("نکسوجستجو"))).toBe(true);
      expect(Object.values(data.searchPopular ?? {}).every((n) => typeof n === "number")).toBe(true);
      expect(JSON.stringify(data.searchPopular ?? {})).not.toContain("پیام خصوصی خودم");
    });
    const trend = await globalSearch(stranger, { q: "", feed: "trending", recordHistory: false });
    expect(trend.ok && trend.hits.every((h) => !`${h.title}${h.preview}`.includes("پیام خصوصی خودم"))).toBe(true);
    const health = await searchHealth();
    expect(health.queries).toBeGreaterThan(0);
    expect(typeof health.resultHits).toBe("number");
    expect(typeof health.errorRate).toBe("number");
    if (priv.ok) {
      await editStory(friend, priv.story.id, { visibility: "everyone", caption: "اکنون عمومی شد نکسو" });
    }
  });

  it("applies boolean AND/OR/NOT, mention filter, tombstones, and hybrid without leaking private posts", async () => {
    const owner = await activeUser("sr_boolown");
    const fan = await activeUser("sr_boolfan");
    const stranger = await activeUser("sr_boolstr");
    const pub = await createChannel(owner, { name: "کانال بولی نکسو", username: "nixo_bool_pub", visibility: "public" });
    const priv = await createChannel(owner, { name: "کانال بولی خصوصی", visibility: "private" });
    expect(pub.ok && priv.ok).toBe(true);
    if (!pub.ok || !priv.ok) return;
    await createPost(owner, pub.channel.id, { body: "سلام کانال نیکسو @sr_boolfan گزارش", kind: "text" });
    await createPost(owner, pub.channel.id, { body: "فقط هواشناسی بدون گزارش", kind: "text" });
    await createPost(owner, priv.channel.id, { body: "سلام کانال نیکسو محرمانه", kind: "text" });
    const andQ = await globalSearch(fan, { q: "سلام AND گزارش", kind: "messages" });
    expect(andQ.ok && andQ.hits.some((h) => h.preview.includes("گزارش"))).toBe(true);
    expect(andQ.ok && andQ.hits.every((h) => !h.preview.includes("هواشناسی"))).toBe(true);
    const orQ = await globalSearch(fan, { q: "هواشناسی OR گزارش", kind: "messages" });
    expect(orQ.ok && orQ.hits.length >= 2).toBe(true);
    const notQ = await globalSearch(fan, { q: "نیکسو NOT هواشناسی", kind: "messages" });
    expect(notQ.ok && notQ.hits.every((h) => !h.preview.includes("هواشناسی"))).toBe(true);
    expect(andQ.ok && andQ.hits.every((h) => h.target.id !== priv.channel.id)).toBe(true);
    const mention = await globalSearch(fan, { q: "has:mention نیکسو", kind: "messages" });
    expect(mention.ok && mention.hits.some((h) => h.preview.includes("@sr_boolfan"))).toBe(true);
    const hybrid = await globalSearch(stranger, { q: "سلام کانال", kind: "messages", semantic: true });
    expect(hybrid.ok && hybrid.hits.every((h) => h.target.id !== priv.channel.id)).toBe(true);
    const tooComplex = await globalSearch(fan, { q: "a AND b AND c AND d AND e AND f" });
    expect(tooComplex.ok).toBe(false);
    const ops = await activeUser("nixo_ops");
    await rebuildSearchIndex(ops);
    await mutateStore((data) => {
      const pubDoc = data.searchDocs.find((d) => d.entityId === pub.channel.id && d.kind === "channel");
      expect(pubDoc && (pubDoc.tokens?.length ?? 0) > 0).toBe(true);
      expect(data.searchDocs.every((d) => d.public === true)).toBe(true);
      expect(data.searchDocs.every((d) => d.entityId !== priv.channel.id)).toBe(true);
    });
    const { tombstoneSearchDoc, searchHealth, evaluateSearchQuality } = await import("./search");
    const stone = await tombstoneSearchDoc(ops, `channel:${pub.channel.id}`, "test");
    expect(stone.ok).toBe(true);
    await mutateStore((data) => {
      expect(data.searchDocs.every((d) => d.entityId !== pub.channel.id || d.kind !== "channel")).toBe(true);
    });
    const afterStone = await globalSearch(stranger, { q: "بولی نکسو", kind: "channels" });
    expect(afterStone.ok && afterStone.hits.every((h) => h.target.id !== pub.channel.id)).toBe(true);
    const rebuilt = await rebuildSearchIndex(ops);
    expect(rebuilt.ok).toBe(true);
    const stillGone = await globalSearch(stranger, { q: "بولی نکسو", kind: "channels" });
    expect(stillGone.ok && stillGone.hits.every((h) => h.target.id !== pub.channel.id)).toBe(true);
    const ev = await evaluateSearchQuality(ops);
    expect(ev.ok && ev.leaked === 0).toBe(true);
    if (ev.ok) expect(ev.suggest.recall).toBeGreaterThan(0);
    const deniedEval = await evaluateSearchQuality(stranger);
    expect(deniedEval.ok).toBe(false);
    const health = await searchHealth();
    expect(health.p95).toBeGreaterThanOrEqual(0);
    expect(health.p99).toBeGreaterThanOrEqual(0);
    expect(health.tombstones).toBeGreaterThan(0);
    expect(health.indexVersion).toBeGreaterThan(0);
    const { booleanMatches } = await import("./search-match");
    expect(booleanMatches("سلام گزارش نیکسو", { must: [], should: [["سلام", "گزارش"]], not: [] })).toBe(true);
    expect(booleanMatches("سلام گزارش نیکسو", { must: [], should: [["سلام"]], not: ["گزارش"] })).toBe(false);
    await mutateStore((data) => {
      const aCache = (data.searchQueryCache ?? []).filter((c) => c.userId === fan);
      const bCache = (data.searchQueryCache ?? []).filter((c) => c.userId === stranger);
      expect(aCache.every((c) => c.userId === fan)).toBe(true);
      expect(bCache.every((c) => c.userId === stranger)).toBe(true);
    });
  });
});
