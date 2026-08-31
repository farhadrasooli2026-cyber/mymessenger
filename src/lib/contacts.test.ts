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
});
