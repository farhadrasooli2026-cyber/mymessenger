import { afterEach, describe, expect, it } from "vitest";
import { hashIp } from "./crypto-utils";
import { completeProfile } from "./profile";
import { getOutbox } from "./outbox";
import { ackHumanChallenge, getUserById, issueHumanChallenge, startRegistration, verifyOtp } from "./registration";
import { resetStoreForTests, mutateStore, readStoreSnapshot } from "./store";
import { updatePrivacy, findByIdentifier } from "./privacy";
import {
  saveContact,
  deleteContact,
  listContacts,
  mergeContacts,
  ingestPhoneBook,
  suggestions,
  viewPerson,
  createInvite,
  acceptInvite,
  startChatFromContact,
  blockPerson,
  sendRequest,
  resolveRequest,
  listSocialGraph,
  followUser,
  muteUser,
  cancelRequest,
  removeFriend,
  revokeInvite,
  previewInvite,
  hideSuggestion,
  unfollowUser,
} from "./contacts";

async function activeUser(username: string, channel: "email" | "phone" = "email", identifier?: string) {
  const ip = hashIp(`test-ip:${username}`);
  const issued = await issueHumanChallenge(ip);
  await ackHumanChallenge(issued.token, ip);
  const id = identifier ?? (channel === "email" ? `${username}@nixo.test` : "09121110000");
  const start = await startRegistration(
    { channel, identifier: id, humanToken: issued.token, website: "" },
    ip,
  );
  if (!start.ok) throw new Error("start");
  const code = getOutbox(start.challengeId)?.body.match(/\b(\d{6})\b/)?.[1] ?? "";
  const verified = await verifyOtp(start.challengeId, code, ip);
  if (!verified.ok) throw new Error("verify");
  const done = await completeProfile(verified.userId, {
    firstName: "مخاطب",
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

describe("NIXO contacts", () => {
  afterEach(async () => {
    await resetStoreForTests();
  });

  it("keeps address books owner-only and delete does not close the other account", async () => {
    const a = await activeUser("ct_own");
    const b = await activeUser("ct_peer");
    const saved = await saveContact(a, { name: "دوست", username: "ct_peer", notes: "فقط برای من" });
    expect(saved.ok).toBe(true);
    if (!saved.ok) return;
    const listedA = await listContacts(a);
    const listedB = await listContacts(b);
    expect(listedA.ok && listedA.contacts.some((c) => c.id === saved.contact.id)).toBe(true);
    expect(listedB.ok && listedB.contacts.length).toBe(0);
    const stolen = await mutateStore((data) => data.contacts.find((c) => c.id === saved.contact.id && c.ownerUserId === b));
    expect(stolen).toBeUndefined();
    const del = await deleteContact(a, saved.contact.id);
    expect(del.ok).toBe(true);
    if (del.ok) expect(del.accountKept).toBe(true);
    expect(await getUserById(b)).toBeTruthy();
  });

  it("does not suggest a user who disabled find-by-phone", async () => {
    const owner = await activeUser("ct_host", "phone", "09125550001");
    const hidden = await activeUser("ct_hide", "phone", "09125550002");
    await updatePrivacy(hidden, { privacyFindPhone: "nobody" });
    await updatePrivacy(owner, { contactSyncEnabled: true, contactOsPermission: "limited" });
    const sync = await ingestPhoneBook(owner, [{ name: "مخفی", phone: "09125550002" }], "limited");
    expect(sync.ok).toBe(true);
    const sug = await suggestions(owner);
    expect(sug.ok && sug.suggestions.some((s) => s.id === hidden)).toBe(false);
  });

  it("returns the same empty discovery when the account is hidden", async () => {
    const owner = await activeUser("ct_ph", "phone", "09126660001");
    const stranger = await activeUser("ct_str");
    await updatePrivacy(owner, { privacyFindPhone: "nobody" });
    const hidden = await findByIdentifier(stranger, "09126660001");
    const missing = await findByIdentifier(stranger, "09126669999");
    expect(hidden.ok && hidden.user).toBeNull();
    expect(missing.ok && missing.user).toBeNull();
  });

  it("requires merge confirmation and refuses stale edits without force", async () => {
    const a = await activeUser("ct_mrg");
    const one = await saveContact(a, { name: "علی", phone: "09127770001" });
    const two = await saveContact(a, { name: "Ali", phone: "09127770001" });
    expect(one.ok && two.ok).toBe(true);
    if (!one.ok || !two.ok) return;
    const denied = await mergeContacts(a, one.contact.id, two.contact.id, false);
    expect(denied.ok).toBe(false);
    const merged = await mergeContacts(a, one.contact.id, two.contact.id, true);
    expect(merged.ok).toBe(true);
    const stale = await saveContact(a, { id: one.contact.id, name: "کهنه", updatedAt: 1, force: false });
    expect(stale.ok).toBe(false);
  });

  it("invite accept adds a local contact without exposing the inviter phone book", async () => {
    const host = await activeUser("ct_inv");
    const guest = await activeUser("ct_gst");
    await saveContact(host, { name: "محرمانه", phone: "09128880001" });
    const inv = await createInvite(host, 2, 60_000);
    expect(inv.ok).toBe(true);
    if (!inv.ok) return;
    const acc = await acceptInvite(guest, inv.invite.token);
    expect(acc.ok).toBe(true);
    const view = await viewPerson(guest, "ct_inv");
    expect(view.ok).toBe(true);
    if (view.ok) {
      expect(view.othersContactsHidden).toBe(true);
      expect(JSON.stringify(view)).not.toContain("09128880001");
    }
  });

  it("opens a dm for real users and block stops it", async () => {
    const a = await activeUser("ct_dm_a");
    const b = await activeUser("ct_dm_b");
    const opened = await startChatFromContact(a, undefined, b);
    expect(opened.ok).toBe(true);
    await blockPerson(b, a, true);
    const again = await startChatFromContact(a, undefined, b);
    expect(again.ok).toBe(false);
    const snap = await readStoreSnapshot();
    expect(snap.users.find((u) => u.id === b)?.status).toBe("active");
  });

  it("keeps friend, follow, mute, and contact IDs owner-scoped", async () => {
    const a = await activeUser("ct_soc_a");
    const b = await activeUser("ct_soc_b");
    const c = await activeUser("ct_soc_c");
    const first = await saveContact(a, { name: "دوست", username: "ct_soc_b" });
    const again = await saveContact(a, { name: "همان", username: "ct_soc_b" });
    expect(first.ok && again.ok && "reused" in again && again.reused).toBe(true);
    if (first.ok && again.ok) expect(again.contact.id).toBe(first.contact.id);
    const req = await sendRequest(a, b);
    expect(req.ok).toBe(true);
    if (!req.ok) return;
    const stolen = await resolveRequest(c, req.requestId, "accept");
    expect(stolen.ok).toBe(false);
    const listed = await listContacts(b);
    expect(listed.ok && listed.requestsIn.some((r) => r.id === req.requestId)).toBe(true);
    const accepted = await resolveRequest(b, req.requestId, "accept");
    expect(accepted.ok).toBe(true);
    const friendsA = await listSocialGraph(a, a, "friends");
    expect(friendsA.ok && friendsA.people.some((p) => p.id === b)).toBe(true);
    const friendsC = await listSocialGraph(c, a, "friends");
    expect(friendsC.ok && friendsC.hidden && friendsC.people.length === 0).toBe(true);
    await followUser(a, b);
    await updatePrivacy(b, { hideFollowers: true });
    const hidden = await listSocialGraph(a, b, "followers");
    expect(hidden.ok && hidden.hidden).toBe(true);
    const ownFollowers = await listSocialGraph(b, b, "followers");
    expect(ownFollowers.ok && ownFollowers.people.some((p) => p.id === a)).toBe(true);
    await muteUser(b, a, true);
    const opened = await startChatFromContact(a, undefined, b);
    expect(opened.ok).toBe(true);
    await blockPerson(b, a, true);
    const afterBlock = await startChatFromContact(a, undefined, b);
    expect(afterBlock.ok).toBe(false);
    const paged = await listContacts(a, { limit: 1 });
    expect(paged.ok && (paged.nextCursor === null || typeof paged.nextCursor === "string")).toBe(true);
  });

  it("expires friend requests, revokes QR, and keeps friendship IDs owner-scoped", async () => {
    const a = await activeUser("ct_exp_a");
    const b = await activeUser("ct_exp_b");
    const c = await activeUser("ct_exp_c");
    const self = await sendRequest(a, a);
    expect(self.ok).toBe(false);
    const req = await sendRequest(a, b);
    expect(req.ok).toBe(true);
    if (!req.ok) return;
    const dup = await sendRequest(a, b);
    expect(dup.ok && dup.requestId === req.requestId).toBe(true);
    await mutateStore((data) => {
      const row = data.contactRequests.find((r) => r.id === req.requestId);
      if (row) {
        row.createdAt = Date.now() - 20 * 24 * 60 * 60_000;
        row.expiresAt = Date.now() - 1000;
      }
      return true;
    });
    const listed = await listContacts(b);
    expect(listed.ok && listed.requestsIn.every((r) => r.id !== req.requestId)).toBe(true);
    const again = await sendRequest(a, b);
    expect(again.ok && again.requestId !== req.requestId).toBe(true);
    if (!again.ok) return;
    const accepted = await resolveRequest(b, again.requestId, "accept");
    expect(accepted.ok && "friendshipId" in accepted && Boolean(accepted.friendshipId)).toBe(true);
    const stolenFriend = await removeFriend(c, "", accepted.ok ? accepted.friendshipId ?? undefined : undefined);
    expect(stolenFriend.ok).toBe(false);
    const view = await viewPerson(c, "ct_exp_b");
    expect(view.ok && view.friendCount === null && view.mutualFriends.length === 0).toBe(true);
    await updatePrivacy(b, { privacyFriendCount: "everyone" });
    const viewCount = await viewPerson(c, "ct_exp_b");
    expect(viewCount.ok && viewCount.friendCount === 1 && viewCount.mutualFriends.length === 0).toBe(true);
    const inv = await createInvite(a, 1, 60_000);
    expect(inv.ok).toBe(true);
    if (!inv.ok) return;
    const stolenRevoke = await revokeInvite(c, inv.invite.token);
    expect(stolenRevoke.ok).toBe(false);
    const revoked = await revokeInvite(a, inv.invite.token);
    expect(revoked.ok).toBe(true);
    const preview = await previewInvite(inv.invite.token);
    expect(preview.ok).toBe(false);
  });

  it("hides nicknames, suggestions, and tears down friendship on block", async () => {
    const a = await activeUser("ct_nick_a");
    const b = await activeUser("ct_nick_b", "phone", "09123330001");
    const c = await activeUser("ct_nick_c");
    await saveContact(a, { name: "رسمی", username: "ct_nick_b", nickname: "راز خصوصی", notes: "یادداشت من" });
    const otherView = await viewPerson(c, "ct_nick_b");
    expect(otherView.ok).toBe(true);
    if (otherView.ok) {
      expect(JSON.stringify(otherView)).not.toContain("راز خصوصی");
      expect(JSON.stringify(otherView)).not.toContain("یادداشت من");
    }
    const mine = await viewPerson(a, "ct_nick_b");
    expect(mine.ok && mine.localContact?.nickname === "راز خصوصی").toBe(true);
    const extra = await activeUser("ct_sug_e", "phone", "09123330009");
    await updatePrivacy(extra, { privacyFindPhone: "everyone" });
    await mutateStore((data) => {
      const me = data.users.find((u) => u.id === a);
      const peer = data.users.find((u) => u.id === extra);
      if (me && peer) me.syncedContactHashes = [...(me.syncedContactHashes ?? []), peer.identifierHash];
      return true;
    });
    const sug = await suggestions(a);
    expect(sug.ok && sug.suggestions.some((s) => s.id === extra)).toBe(true);
    await hideSuggestion(a, extra, "not-interested");
    const after = await suggestions(a);
    expect(after.ok && after.suggestions.every((s) => s.id !== extra)).toBe(true);
    const req = await sendRequest(a, b);
    if (req.ok && req.requestId !== "friends") await resolveRequest(b, req.requestId, "accept");
    await followUser(c, b);
    await blockPerson(b, a, true);
    const friendsA = await listSocialGraph(a, a, "friends");
    expect(friendsA.ok && friendsA.people.every((p) => p.id !== b)).toBe(true);
    const followAgain = await followUser(a, b);
    expect(followAgain.ok).toBe(false);
    const stolenFollow = await unfollowUser(c, b, "not-a-real-follow");
    expect(stolenFollow.ok).toBe(false);
    await cancelRequest(c, "missing");
  });
});
