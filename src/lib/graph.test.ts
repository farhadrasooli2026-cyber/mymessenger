import { afterEach, describe, expect, it } from "vitest";
import { hashIp } from "./crypto-utils";
import { completeProfile } from "./profile";
import { getOutbox } from "./outbox";
import { ackHumanChallenge, issueHumanChallenge, startRegistration, verifyOtp } from "./registration";
import { mutateStore, readStoreSnapshot, resetStoreForTests } from "./store";
import { updatePrivacy } from "./privacy";
import { blockPerson, saveContact, sendRequest, resolveRequest } from "./contacts";
import { createGroup } from "./groups";
import { createChannel } from "./channels";
import {
  evaluateGraph,
  exportSocialGraph,
  recFeedback,
  recommendFeed,
  setRecPrefs,
} from "./graph";
import { hydrateGraphPersist } from "./graph-types";

async function activeUser(username: string, channel: "email" | "phone" = "email", identifier?: string) {
  const ip = hashIp(`test-ip:${username}`);
  const issued = await issueHumanChallenge(ip);
  await ackHumanChallenge(issued.token, ip);
  const id = identifier ?? (channel === "email" ? `${username}@nixo.test` : "09123330000");
  const start = await startRegistration({ channel, identifier: id, humanToken: issued.token, website: "" }, ip);
  if (!start.ok) throw new Error("start");
  const code = getOutbox(start.challengeId)?.body.match(/\b(\d{6})\b/)?.[1] ?? "";
  const verified = await verifyOtp(start.challengeId, code, ip);
  if (!verified.ok) throw new Error("verify");
  const done = await completeProfile(verified.userId, {
    firstName: "گراف",
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

describe("NIXO social graph", () => {
  afterEach(async () => {
    await resetStoreForTests();
  });

  it("does not recommend private groups or private channels", async () => {
    const owner = await activeUser("gr_own");
    const viewer = await activeUser("gr_view");
    const privG = await createGroup(owner, { name: "حلقه خصوصی", joinMode: "invite", username: "grprivloop" });
    const pubG = await createGroup(owner, { name: "گروه عمومی", joinMode: "open", username: "grpubloop" });
    const privC = await createChannel(owner, { name: "کانال خصوصی", visibility: "private" });
    const pubC = await createChannel(owner, { name: "کانال عمومی", visibility: "public", username: "grpubchan" });
    expect(privG.ok && pubG.ok && privC.ok && pubC.ok).toBe(true);
    if (!privG.ok || !pubG.ok || !privC.ok || !pubC.ok) return;
    const feed = await recommendFeed(viewer);
    expect(feed.ok).toBe(true);
    if (!feed.ok) return;
    expect(feed.items.some((i) => i.id === privG.group.id)).toBe(false);
    expect(feed.items.some((i) => i.id === privC.channel.id)).toBe(false);
    expect(feed.items.some((i) => i.id === pubG.group.id)).toBe(true);
    expect(feed.items.some((i) => i.id === pubC.channel.id)).toBe(true);
  });

  it("hides blocked people from recommendations", async () => {
    const a = await activeUser("gr_blk_a");
    const b = await activeUser("gr_blk_b");
    const before = await recommendFeed(a);
    expect(before.ok && before.items.some((i) => i.id === b)).toBe(true);
    await blockPerson(a, b, true);
    const after = await recommendFeed(a);
    expect(after.ok).toBe(true);
    if (!after.ok) return;
    expect(after.items.some((i) => i.id === b)).toBe(false);
  });

  it("applies hide and not-interested to later feeds", async () => {
    const a = await activeUser("gr_hide_a");
    const b = await activeUser("gr_hide_b");
    const first = await recommendFeed(a);
    expect(first.ok && first.items.some((i) => i.id === b)).toBe(true);
    await recFeedback(a, "follow", b, "hide");
    const hidden = await recommendFeed(a);
    expect(hidden.ok).toBe(true);
    if (!hidden.ok) return;
    expect(hidden.items.some((i) => i.id === b)).toBe(false);
    const c = await activeUser("gr_hide_c");
    await recFeedback(a, "follow", c, "not-interested");
    const ni = await recommendFeed(a);
    expect(ni.ok).toBe(true);
    if (!ni.ok) return;
    expect(ni.items.some((i) => i.id === c)).toBe(false);
  });

  it("does not serve another user cache as recommendations", async () => {
    const a = await activeUser("gr_cache_a");
    const owner = await activeUser("gr_cache_o");
    const priv = await createGroup(owner, { name: "گراف محرمانه", joinMode: "invite", username: "grcachepriv" });
    expect(priv.ok).toBe(true);
    if (!priv.ok) return;
    await mutateStore((data) => {
      data.graph = hydrateGraphPersist(data.graph);
      data.graph.cache.unshift({
        userId: a,
        gen: 9_999_999,
        at: Date.now(),
        itemIds: [priv.group.id],
      });
    });
    const feed = await recommendFeed(a);
    expect(feed.ok).toBe(true);
    if (!feed.ok) return;
    expect(feed.items.some((i) => i.id === priv.group.id)).toBe(false);
    const snap = await readStoreSnapshot();
    expect(snap.graph.cache.every((row) => row.userId === a || row.userId === owner)).toBe(true);
  });

  it("export lists usernames only and never phone or email", async () => {
    const a = await activeUser("gr_ex_a");
    const b = await activeUser("gr_ex_b", "phone", "09124441111");
    await saveContact(a, { name: "دوست", username: "gr_ex_b", phone: "09124441111", notes: "محرمانه" });
    const req = await sendRequest(a, b);
    if (req.ok && req.requestId !== "friends") await resolveRequest(b, req.requestId, "accept");
    const exp = await exportSocialGraph(a);
    expect(exp.ok).toBe(true);
    if (!exp.ok) return;
    const blob = JSON.stringify(exp);
    expect(blob).not.toMatch(/0912/);
    expect(blob).not.toMatch(/@nixo\.test/);
    expect(blob).not.toMatch(/محرمانه/);
    expect(exp.friends).toContain("gr_ex_b");
  });

  it("keeps public groups when personalization is off", async () => {
    const owner = await activeUser("gr_pers_o");
    const viewer = await activeUser("gr_pers_v");
    const pub = await createGroup(owner, { name: "عمومی سرد", joinMode: "open", username: "grcoldpub" });
    expect(pub.ok).toBe(true);
    if (!pub.ok) return;
    await setRecPrefs(viewer, { personalize: false });
    const feed = await recommendFeed(viewer);
    expect(feed.ok).toBe(true);
    if (!feed.ok) return;
    expect(feed.personalize).toBe(false);
    expect(feed.items.some((i) => i.id === pub.group.id)).toBe(true);
    expect(feed.items.some((i) => i.kind === "follow" || i.kind === "people")).toBe(false);
  });

  it("eval is ops-only and reports zero private leaks", async () => {
    const stranger = await activeUser("gr_eval_x");
    const denied = await evaluateGraph(stranger);
    expect(denied.ok).toBe(false);
    if (!denied.ok) expect(denied.status).toBe(403);
    const ops = await activeUser("nixo_ops");
    const owner = await activeUser("gr_eval_o");
    await createGroup(owner, { name: "مخفی eval", joinMode: "invite", username: "grevalpriv" });
    const ev = await evaluateGraph(ops);
    expect(ev.ok).toBe(true);
    if (!ev.ok) return;
    expect(ev.leaked).toBe(0);
  });

  it("does not expose a user who disabled username discovery", async () => {
    const a = await activeUser("gr_priv_a");
    const hidden = await activeUser("gr_priv_h");
    await updatePrivacy(hidden, { privacyFindUsername: "nobody" });
    const feed = await recommendFeed(a);
    expect(feed.ok).toBe(true);
    if (!feed.ok) return;
    expect(feed.items.some((i) => i.id === hidden)).toBe(false);
  });
});
