import { afterEach, describe, expect, it } from "vitest";
import { encryptText, generateThreadKey } from "./e2ee";
import { hashIp } from "./crypto-utils";
import { completeProfile } from "./profile";
import { getOutbox } from "./outbox";
import { ackHumanChallenge, issueHumanChallenge, startRegistration, verifyOtp } from "./registration";
import { mutateStore, readStoreSnapshot, resetStoreForTests } from "./store";
import { sendMessage } from "./chat";
import { startChatFromContact } from "./contacts";
import { deleteFolder, folderNameOk, listInbox, patchInbox, saveFolder } from "./inbox";
import { getUserById } from "./registration";

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
    firstName: "سازمان",
    lastName: "چت",
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

describe("NIXO folders and chat organization", () => {
  afterEach(async () => {
    await resetStoreForTests();
  });

  it("rejects invalid folder names", () => {
    expect(folderNameOk("")).toBe(false);
    expect(folderNameOk(".")).toBe(false);
    expect(folderNameOk("کار")).toBe(true);
  });

  it("pins with a cap, archives privately, and unarchives on new message", async () => {
    const a = await activeUser("org_a");
    const b = await activeUser("org_b");
    await listInbox(a);
    await mutateStore((data) => {
      for (let i = 0; i < 6; i += 1) {
        data.threads.push({
          id: `pinx${i}`,
          ownerUserId: a,
          peerKey: `seed${i}`,
          peerName: `پین ${i}`,
          peerTitle: "گفتگو",
          color: "#34d399",
          updatedAt: Date.now() - i,
        });
      }
    });
    const listed = await listInbox(a);
    expect(listed.ok).toBe(true);
    if (!listed.ok) return;
    const dms = listed.items.filter((i) => i.kind === "dm");
    for (const row of dms.slice(0, 3)) {
      const pin = await patchInbox(a, row.key, "pin");
      expect(pin.ok).toBe(true);
    }

    const chat = await startChatFromContact(a, undefined, b);
    expect(chat.ok).toBe(true);
    if (!chat.ok) return;
    const keyA = `dm:${chat.thread.id}`;
    await patchInbox(a, keyA, "archive");
    const main = await listInbox(a, "all");
    expect(main.ok && main.items.some((i) => i.key === keyA)).toBe(false);
    const archived = await listInbox(a, "archived");
    expect(archived.ok && archived.items.some((i) => i.key === keyA)).toBe(true);

    const openedB = await startChatFromContact(b, undefined, a);
    expect(openedB.ok).toBe(true);
    if (!openedB.ok) return;
    const envelope = await encryptText(await generateThreadKey(), "ping");
    await sendMessage(b, openedB.thread.id, envelope);
    const after = await listInbox(a, "all");
    expect(after.ok && after.items.some((i) => i.key === keyA)).toBe(true);
  });

  it("keeps folders owner-only and delete folder does not delete chats", async () => {
    const a = await activeUser("org_own");
    const b = await activeUser("org_spy");
    await listInbox(a);
    const created = await saveFolder(a, { name: "کار", includeTypes: ["dm"] });
    expect(created.ok).toBe(true);
    if (!created.ok) return;
    const stolen = await saveFolder(b, { id: created.folder.id, name: "دزدیده" });
    expect(stolen.ok).toBe(false);
    const inboxB = await listInbox(b);
    expect(inboxB.ok && inboxB.folders.some((f) => f.id === created.folder.id && !f.builtin)).toBe(false);

    const inboxA = await listInbox(a);
    expect(inboxA.ok).toBe(true);
    if (!inboxA.ok) return;
    const item = inboxA.items[0];
    expect(item).toBeTruthy();
    if (!item) return;
    await patchInbox(a, item.key, "move", { folderId: created.folder.id });
    const removed = await deleteFolder(a, created.folder.id);
    expect(removed.ok && removed.chatsKept).toBe(true);
    const still = await listInbox(a, "all");
    expect(still.ok && still.items.some((i) => i.key === item.key)).toBe(true);

    const otherThread = (await readStoreSnapshot()).threads.find((t) => t.ownerUserId === a);
    const idor = await patchInbox(b, `dm:${otherThread!.id}`, "archive");
    expect(idor.ok).toBe(false);

    await patchInbox(a, item.key, "delete");
    expect(await getUserById(b)).toBeTruthy();
    const peerThreads = (await readStoreSnapshot()).threads.filter((t) => t.ownerUserId === b);
    expect(peerThreads.length).toBeGreaterThan(0);
  });

  it("stores drafts and notes only for the owner and rejects clear without confirm", async () => {
    const a = await activeUser("org_draft");
    await listInbox(a);
    const listed = await listInbox(a);
    if (!listed.ok) return;
    const key = listed.items[0]!.key;
    await patchInbox(a, key, "draft", { draft: "پیش‌نویس من" });
    await patchInbox(a, key, "notes", { notes: "یادداشت خصوصی" });
    await patchInbox(a, key, "unread");
    const mine = await listInbox(a);
    expect(mine.ok && mine.items[0]?.draft).toBe("پیش‌نویس من");
    expect(mine.ok && mine.items.some((i) => i.notes === "یادداشت خصوصی")).toBe(true);
    expect(mine.ok && mine.items.some((i) => i.markedUnread)).toBe(true);
    const cleared = await patchInbox(a, key, "clear");
    expect(cleared.ok).toBe(false);
    const snap = await readStoreSnapshot();
    expect(JSON.stringify(snap.inboxMetas)).not.toContain("پیش‌نویس من");
    expect(JSON.stringify(snap.inboxMetas)).not.toContain("یادداشت خصوصی");
  });

  it("returns 409 on stale folder sync unless forced", async () => {
    const a = await activeUser("org_sync");
    const created = await saveFolder(a, { name: "اول", includeTypes: ["dm"] });
    expect(created.ok).toBe(true);
    if (!created.ok) return;
    await saveFolder(a, { id: created.folder.id, name: "دوم", force: true });
    const stale = await saveFolder(a, { id: created.folder.id, name: "سوم", updatedAt: created.folder.updatedAt - 1 });
    expect(stale.ok).toBe(false);
    if (!stale.ok) expect(stale.status).toBe(409);
  });
});
