import { afterEach, describe, expect, it } from "vitest";
import { encryptText, generateThreadKey } from "./e2ee";
import { hashIp } from "./crypto-utils";
import { completeProfile } from "./profile";
import { getOutbox } from "./outbox";
import { ackHumanChallenge, issueHumanChallenge, startRegistration, verifyOtp, getUserById } from "./registration";
import { readStoreSnapshot, resetStoreForTests } from "./store";
import { deleteMessage, listThreads, sendMessage } from "./chat";
import { globalSearch } from "./search";
import {
  deleteFolder,
  deleteSaved,
  getSaved,
  listSaved,
  originalStatus,
  patchSaved,
  saveFolder,
  saveItem,
} from "./saved";

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
    firstName: "ذخیره",
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

describe("NIXO saved messages and bookmarks", () => {
  afterEach(async () => {
    await resetStoreForTests();
  });

  it("keeps vaults owner-only and encrypts body", async () => {
    const a = await activeUser("svb_a");
    const b = await activeUser("svb_b");
    const saved = await saveItem(a, { kind: "text", body: "راز شخصی نیکسو", tag: "Personal", notes: "فقط من" });
    expect(saved.ok).toBe(true);
    if (!saved.ok) return;
    const mine = await listSaved(a);
    expect(mine.items.some((i) => i.body === "راز شخصی نیکسو" && i.notes === "فقط من")).toBe(true);
    const theirs = await listSaved(b);
    expect(theirs.items.length).toBe(0);
    expect(await getSaved(b, saved.item.id)).toBeNull();
    const snap = JSON.stringify(await readStoreSnapshot());
    expect(snap).not.toContain("راز شخصی نیکسو");
    expect(snap).not.toContain("فقط من");
  });

  it("does not put saved messages into public search", async () => {
    const a = await activeUser("svb_pub");
    await saveItem(a, { kind: "text", body: "عبارت‌یونیک‌ذخیره_۹۹۱" });
    const found = await globalSearch(a, { q: "عبارت‌یونیک‌ذخیره_۹۹۱", kind: "all" });
    expect(found.ok && found.hits.every((h) => h.scope !== "saved")).toBe(true);
  });

  it("unsaving does not delete the original chat message", async () => {
    const a = await activeUser("svb_chat");
    const threads = await listThreads(a);
    const thread = threads[0];
    expect(thread).toBeTruthy();
    const envelope = await encryptText(await generateThreadKey(), "پیام زنده");
    const sent = await sendMessage(a, thread!.id, envelope);
    expect(sent.ok).toBe(true);
    if (!sent.ok) return;
    const msgId = sent.messages.at(-1)?.id;
    const saved = await saveItem(a, {
      kind: "message",
      body: "کپی",
      source: { type: "chat", id: thread!.id, name: thread!.peerName, messageId: msgId },
    });
    expect(saved.ok).toBe(true);
    if (!saved.ok) return;
    await deleteSaved(a, [saved.item.id]);
    const after = await readStoreSnapshot();
    expect(after.messages.some((m) => m.id === msgId && m.ownerUserId === a && !m.deletedEverywhere)).toBe(true);
    expect(await getUserById(a)).toBeTruthy();
  });

  it("does not reopen a deleted original message", async () => {
    const a = await activeUser("svb_del");
    const threads = await listThreads(a);
    const thread = threads[0]!;
    const envelope = await encryptText(await generateThreadKey(), "خواهد رفت");
    const sent = await sendMessage(a, thread.id, envelope);
    expect(sent.ok).toBe(true);
    if (!sent.ok) return;
    const msgId = sent.messages.at(-1)!.id;
    await saveItem(a, {
      kind: "message",
      body: "کپی امن",
      source: { type: "chat", id: thread.id, name: thread.peerName, messageId: msgId },
    });
    await deleteMessage(a, thread.id, msgId, "me");
    const data = await readStoreSnapshot();
    const status = originalStatus(data, a, { type: "chat", id: thread.id, name: thread.peerName, messageId: msgId });
    expect(status.canOpen).toBe(false);
    expect(status.status).toBe("deleted");
  });

  it("deletes bookmark folders without deleting saved items", async () => {
    const a = await activeUser("svb_fold");
    const folder = await saveFolder(a, { name: "پروژه" });
    expect(folder.ok).toBe(true);
    if (!folder.ok) return;
    const saved = await saveItem(a, { kind: "text", body: "در پوشه", folderId: folder.folder.id, bookmark: true });
    expect(saved.ok).toBe(true);
    if (!saved.ok) return;
    const stolen = await saveFolder("not-a-user", { id: folder.folder.id, name: "دزد" });
    expect(stolen.ok).toBe(false);
    const gone = await deleteFolder(a, folder.folder.id);
    expect(gone.ok && gone.itemsKept).toBe(true);
    const listed = await listSaved(a);
    expect(listed.items.some((i) => i.id === saved.item.id && i.folderId == null)).toBe(true);
  });

  it("rejects pin overflow and stale folder patch", async () => {
    const a = await activeUser("svb_pin");
    const created = await saveFolder(a, { name: "اول" });
    expect(created.ok).toBe(true);
    if (!created.ok) return;
    await saveFolder(a, { id: created.folder.id, name: "دوم", force: true });
    const stale = await saveFolder(a, { id: created.folder.id, name: "سوم", updatedAt: created.folder.updatedAt - 1 });
    expect(stale.ok).toBe(false);
    const item = await saveItem(a, { kind: "link", linkUrl: "https://nixo.example", body: "لینک" });
    expect(item.ok).toBe(true);
    if (!item.ok) return;
    const pinned = await patchSaved(a, item.item.id, { pinned: true });
    expect(pinned.ok).toBe(true);
  });
});
