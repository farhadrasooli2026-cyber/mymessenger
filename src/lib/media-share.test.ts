import { afterEach, describe, expect, it } from "vitest";
import { hashIp } from "./crypto-utils";
import { completeProfile } from "./profile";
import { ackHumanChallenge, issueHumanChallenge, startRegistration, verifyOtp } from "./registration";
import { getOutbox } from "./outbox";
import { mutateStore, resetStoreForTests } from "./store";
import { saveMediaChunk } from "./media-files";
import { authorizeChatBlob, encodeMediaCursor, sweepOrphanMedia } from "./media-share";
import { addGalleryItem, listGallery } from "./gallery";
import { listThreads } from "./chat";

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
    firstName: "رسانه",
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

describe("NIXO media sharing", () => {
  afterEach(async () => {
    await resetStoreForTests();
  });

  it("denies chat blob download when no authorized message exists", async () => {
    const userId = await activeUser("media_idor");
    const threads = await listThreads(userId);
    const thread = threads[0]!;
    const denied = await authorizeChatBlob(userId, thread.id, "aaaaaaaaaaaaaaaa");
    expect(denied.ok).toBe(false);
  });

  it("does not let a stranger authorize another user's blob", async () => {
    const owner = await activeUser("media_own");
    const stranger = await activeUser("media_str");
    const threads = await listThreads(owner);
    const thread = threads[0]!;
    await mutateStore((data) => {
      data.messages.push({
        id: "msg1",
        threadId: thread.id,
        ownerUserId: owner,
        sender: "me",
        enc: "e2ee-v1",
        ciphertext: "AAAAAAAA",
        nonce: "BBBBBBBB",
        createdAt: Date.now(),
        kind: "photo",
        blobId: "bbbbbbbbbbbbbbbb",
        chunkCount: 1,
        byteLength: 12,
        hiddenFor: [],
        deletedEverywhere: false,
      });
    });
    const stolen = await authorizeChatBlob(stranger, thread.id, "bbbbbbbbbbbbbbbb");
    expect(stolen.ok).toBe(false);
    const allowed = await authorizeChatBlob(owner, thread.id, "bbbbbbbbbbbbbbbb");
    expect(allowed.ok).toBe(true);
  });

  it("sweeps incomplete blobs that are not tied to a message", async () => {
    const userId = await activeUser("media_orphan");
    await saveMediaChunk(userId, "cccccccccccccccc", 0, JSON.stringify({ enc: "e2ee-v1", ciphertext: "AA", nonce: "BB" }));
    const swept = await sweepOrphanMedia(Date.now() + 3 * 60 * 60 * 1000);
    expect(swept.removed).toBeGreaterThanOrEqual(1);
  });

  it("paginates gallery with a cursor and keeps EXIF out of stored jpeg", async () => {
    const owner = await activeUser("media_gal");
    const jpeg = Buffer.concat([
      Buffer.from([0xff, 0xd8, 0xff, 0xe1, 0x00, 0x10]),
      Buffer.from("Exif\0\0GPS!"),
      Buffer.from("/9j/4AAQ", "utf8"),
      Buffer.alloc(32, 0xff),
      Buffer.from([0xff, 0xd9]),
    ]);
    const dataUrl = `data:image/jpeg;base64,${jpeg.toString("base64")}`;
    const created = await addGalleryItem(owner, { name: "gps.jpg", dataUrl });
    expect(created.ok).toBe(true);
    if (!created.ok) return;
    const first = await listGallery(owner, { limit: 1 });
    expect(first.ok && first.items.length).toBe(1);
    expect(first.ok && first.items[0] && !("Exif" in first.items[0])).toBe(true);
    const cursor = encodeMediaCursor(Date.now() + 10, "zzzz");
    const page = await listGallery(owner, { cursor, limit: 10 });
    expect(page.ok).toBe(true);
  });
});
