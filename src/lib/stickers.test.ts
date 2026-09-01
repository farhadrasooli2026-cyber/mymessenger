import { afterEach, describe, expect, it } from "vitest";
import { hashIp } from "./crypto-utils";
import { completeProfile } from "./profile";
import { getOutbox } from "./outbox";
import { ackHumanChallenge, issueHumanChallenge, startRegistration, verifyOtp } from "./registration";
import { mutateStore, resetStoreForTests } from "./store";
import { encryptText, generateThreadKey } from "./e2ee";
import { listThreads, sendMessage } from "./chat";
import { createGroup, getGroup, reactToMessage, sendGroupMessage } from "./groups";
import { createChannel, reactPost } from "./channels";
import { applySkinTone, isLikelyEmoji } from "./emoji-data";
import {
  createPack,
  deleteOwnedPack,
  deleteOwnedSticker,
  installPack,
  reactOnDm,
  sendDmSticker,
  snapshotStickers,
  uploadSticker,
  validateStickerUpload,
} from "./stickers";

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
    firstName: "استیکر",
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

const PNG =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAACAAAAAgCAIAAAD8GO2jAAAAGUlEQVR4nO3BMQEAAADCoPVP7WENoAAAAG4MIAABt9NlCQAAAABJRU5ErkJggg==";

describe("NIXO reactions stickers emoji", () => {
  afterEach(async () => {
    await resetStoreForTests();
  });

  it("rejects svg and executable sticker uploads", () => {
    const svg = validateStickerUpload({
      name: "bad",
      mime: "image/svg+xml",
      dataUrl: "data:image/svg+xml;base64,PHN2ZyBvbmxvYWQ9YWxlcnQoMSk+PC9zdmc+",
      kind: "static",
    });
    expect(svg.ok).toBe(false);
    const exe = validateStickerUpload({
      name: "x.exe",
      mime: "application/octet-stream",
      dataUrl: "data:application/octet-stream;base64,TVoAAAA=",
      kind: "static",
    });
    expect(exe.ok).toBe(false);
  });

  it("isolates DM reactions (IDOR) and supports change/remove", async () => {
    const a = await activeUser("st_a");
    const b = await activeUser("st_b");
    const threads = await listThreads(a);
    const thread = threads[0];
    expect(thread).toBeTruthy();
    const envelope = await encryptText(await generateThreadKey(), "سلام واکنش");
    const sent = await sendMessage(a, thread.id, { ...envelope, enc: "e2ee-v1" });
    expect(sent.ok).toBe(true);
    if (!sent.ok) return;
    const msg = sent.messages[sent.messages.length - 1]!;
    const stolen = await reactOnDm(b, thread.id, msg.id, "👍");
    expect(stolen.ok).toBe(false);
    const add = await reactOnDm(a, thread.id, msg.id, "❤️");
    expect(add.ok).toBe(true);
    if (!add.ok) return;
    expect(add.reactions.some((r) => r.emoji === "❤️" && r.mine && r.count === 1)).toBe(true);
    const change = await reactOnDm(a, thread.id, msg.id, "👍");
    expect(change.ok).toBe(true);
    if (!change.ok) return;
    expect(change.reactions.some((r) => r.emoji === "👍" && r.mine)).toBe(true);
    expect(change.reactions.some((r) => r.emoji === "❤️")).toBe(false);
    const remove = await reactOnDm(a, thread.id, msg.id, "👍");
    expect(remove.ok).toBe(true);
    if (!remove.ok) return;
    expect(remove.action).toBe("remove");
    expect(remove.reactions.every((r) => r.emoji !== "👍" || !r.mine)).toBe(true);
  });

  it("honors group reaction disable and does not delete owner pack on uninstall", async () => {
    const a = await activeUser("st_g");
    const g = await createGroup(a, { name: "گروه واکنش", memberKeys: [] });
    expect(g.ok).toBe(true);
    if (!g.ok) return;
    const key = await generateThreadKey();
    const envelope = await encryptText(key, "متن");
    const sent = await sendGroupMessage(a, g.group.id, { ...envelope, kind: "text" });
    expect(sent.ok).toBe(true);
    if (!sent.ok) return;
    await mutateStore((data) => {
      const row = data.groups.find((x) => x.id === g.group.id);
      if (row) row.reactionsEnabled = false;
    });
    const blocked = await reactToMessage(a, g.group.id, sent.message.id, "🔥");
    expect(blocked.ok).toBe(false);
    const listed = await getGroup(a, g.group.id);
    expect(listed?.group.reactionsEnabled).toBe(false);

    const pack = await createPack(a, "بسته من", "public");
    expect(pack.ok).toBe(true);
    if (!pack.ok) return;
    const up = await uploadSticker(a, pack.pack.id, { name: "چهره", dataUrl: PNG, kind: "static" });
    expect(up.ok).toBe(true);
    const gone = await installPack(a, pack.pack.id, false);
    expect(gone.ok).toBe(true);
    const snap = await snapshotStickers(a);
    expect(snap.packs.some((p) => p.id === pack.pack.id && p.owner)).toBe(true);
  });

  it("respects channel reactionsEnabled", async () => {
    const a = await activeUser("st_ch");
    const ch = await createChannel(a, { name: "کانال واکنش", username: "stchanx", visibility: "public" });
    expect(ch.ok).toBe(true);
    if (!ch.ok) return;
    await mutateStore((data) => {
      const row = data.pubChannels.find((c) => c.id === ch.channel.id);
      if (row) {
        data.channelPosts.push({
          id: "post1",
          channelId: row.id,
          authorKey: a,
          authorName: "مالک",
          kind: "text",
          body: "پست",
          caption: "",
          status: "published",
          scheduledAt: null,
          publishedAt: Date.now(),
          editedAt: null,
          reactions: [],
          comments: [],
          album: [],
          views: [],
          forwards: 0,
          createdAt: Date.now(),
        });
        row.reactionsEnabled = false;
      }
    });
    const r = await reactPost(a, ch.channel.id, "post1", "👍");
    expect(r.ok).toBe(false);
  });

  it("applies fitzpatrick skin tone without breaking search", () => {
    const toned = applySkinTone("👍", "\u{1F3FB}");
    expect(toned).not.toBe("👍");
    expect(isLikelyEmoji(toned)).toBe(true);
  });

  it("does not install a private pack by guessing pack id", async () => {
    const a = await activeUser("st_priv_a");
    const b = await activeUser("st_priv_b");
    const pack = await createPack(a, "خصوصی من", "private");
    expect(pack.ok).toBe(true);
    if (!pack.ok) return;
    const stolen = await installPack(b, pack.pack.id, true);
    expect(stolen.ok).toBe(false);
    const snap = await snapshotStickers(b);
    expect(snap.prefs.installedPackIds.includes(pack.pack.id)).toBe(false);
  });

  it("keeps historical sticker after soft-delete and blocks new send", async () => {
    const a = await activeUser("st_del_a");
    const threads = await listThreads(a);
    const thread = threads[0];
    expect(thread).toBeTruthy();
    const pack = await createPack(a, "بسته حذف", "public");
    expect(pack.ok).toBe(true);
    if (!pack.ok) return;
    const up = await uploadSticker(a, pack.pack.id, { name: "چهره", dataUrl: PNG, kind: "static" });
    expect(up.ok).toBe(true);
    if (!up.ok) return;
    const sent = await sendDmSticker(a, thread.id, up.sticker!.id);
    expect(sent.ok).toBe(true);
    const gone = await deleteOwnedSticker(a, up.sticker!.id);
    expect(gone.ok).toBe(true);
    const again = await sendDmSticker(a, thread.id, up.sticker!.id);
    expect(again.ok).toBe(false);
    const listed = await mutateStore((data) => data.messages.filter((m) => m.ownerUserId === a && m.stickerId === up.sticker!.id));
    expect(listed.length).toBeGreaterThan(0);
  });

  it("replays the same reaction clientNonce without toggling twice", async () => {
    const a = await activeUser("st_nonce");
    const threads = await listThreads(a);
    const thread = threads[0];
    const envelope = await encryptText(await generateThreadKey(), "nonce react");
    const sent = await sendMessage(a, thread.id, { ...envelope, enc: "e2ee-v1" });
    expect(sent.ok).toBe(true);
    if (!sent.ok) return;
    const msg = sent.messages[sent.messages.length - 1]!;
    const first = await reactOnDm(a, thread.id, msg.id, "🔥", { intent: "add", clientNonce: "react-nonce-aaaa" });
    expect(first.ok).toBe(true);
    if (!first.ok) return;
    expect(first.action).toBe("add");
    const retry = await reactOnDm(a, thread.id, msg.id, "🔥", { intent: "add", clientNonce: "react-nonce-aaaa" });
    expect(retry.ok).toBe(true);
    if (!retry.ok) return;
    expect(retry.idempotent).toBe(true);
    expect(retry.reactions.filter((r) => r.emoji === "🔥" && r.mine).length).toBe(1);
    const addAgain = await reactOnDm(a, thread.id, msg.id, "🔥", { intent: "add", clientNonce: "react-nonce-bbbb" });
    expect(addAgain.ok).toBe(true);
    if (!addAgain.ok) return;
    expect(addAgain.action).toBe("noop");
  });

  it("soft-deletes a pack without destroying prior sticker message rows", async () => {
    const a = await activeUser("st_packdel");
    const pack = await createPack(a, "برای حذف", "public");
    expect(pack.ok).toBe(true);
    if (!pack.ok) return;
    const up = await uploadSticker(a, pack.pack.id, { name: "چهره", dataUrl: PNG, kind: "static" });
    expect(up.ok).toBe(true);
    if (!up.ok) return;
    const threads = await listThreads(a);
    await sendDmSticker(a, threads[0]!.id, up.sticker!.id);
    const del = await deleteOwnedPack(a, pack.pack.id);
    expect(del.ok).toBe(true);
    const snap = await snapshotStickers(a);
    expect(snap.packs.some((p) => p.id === pack.pack.id)).toBe(false);
    const rows = await mutateStore((data) => data.messages.filter((m) => m.stickerId === up.sticker!.id));
    expect(rows.length).toBeGreaterThan(0);
  });

  it("rejects group custom emoji pack from a stranger", async () => {
    const a = await activeUser("st_gpack_a");
    const b = await activeUser("st_gpack_b");
    const g = await createGroup(a, { name: "گروه ایموجی", memberKeys: [] });
    expect(g.ok).toBe(true);
    if (!g.ok) return;
    const ok = await createPack(a, "ایموجی گروه", "private", { groupId: g.group.id });
    expect(ok.ok).toBe(true);
    const stolen = await createPack(b, "دزدی", "private", { groupId: g.group.id });
    expect(stolen.ok).toBe(false);
  });
});
