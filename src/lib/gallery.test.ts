import { afterEach, describe, expect, it } from "vitest";
import { hashIp } from "./crypto-utils";
import { completeProfile } from "./profile";
import { ackHumanChallenge, issueHumanChallenge, startRegistration, verifyOtp } from "./registration";
import { getOutbox } from "./outbox";
import { resetStoreForTests } from "./store";
import { addGalleryItem, getGalleryMedia, listGallery, saveAlbum, signGalleryMedia, trashItems } from "./gallery";
import { sniffMagic } from "./media";

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
    firstName: "گالری",
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

const JPEG = "data:image/jpeg;base64,/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRofHh0aHBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/2wBDAQkJCQwLDBgNDRgyIRwhMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjL/wAARCAABAAEDASIAAhEBAxEB/8QAFQABAQAAAAAAAAAAAAAAAAAAAAb/xAAUEAEAAAAAAAAAAAAAAAAAAAAA/8QAFQEBAQAAAAAAAAAAAAAAAAAAAAX/xAAUEQEAAAAAAAAAAAAAAAAAAAAA/9oADAMBAAIQAxAAAAGfAD/2Q==";

describe("NIXO gallery", () => {
  afterEach(async () => {
    await resetStoreForTests();
  });

  it("rejects html payloads by magic bytes", () => {
    const html = Buffer.from("<html><script>x</script>");
    expect(sniffMagic(html).ok).toBe(false);
  });

  it("stores a photo only for the owner and signs access", async () => {
    const owner = await activeUser("gal_own");
    const other = await activeUser("gal_oth");
    const created = await addGalleryItem(owner, { name: "pic.jpg", dataUrl: JPEG });
    expect(created.ok).toBe(true);
    if (!created.ok) return;
    expect(created.item.kind).toBe("photo");
    const listed = await listGallery(owner);
    expect(listed.ok && !listed.locked && listed.items.some((i) => i.id === created.item.id)).toBe(true);
    const otherList = await listGallery(other);
    expect(otherList.ok && otherList.items.every((i) => i.id !== created.item.id)).toBe(true);
    const stolen = signGalleryMedia(created.item.id, other);
    const denied = await getGalleryMedia(other, created.item.id, stolen);
    expect(denied.ok).toBe(false);
    const album = await saveAlbum(owner, { name: "Trip", itemIds: [created.item.id] });
    expect(album.ok).toBe(true);
    const gone = await trashItems(owner, [created.item.id], false);
    expect(gone.count).toBe(1);
    const trash = await listGallery(owner, { trash: true });
    expect(trash.ok && trash.items.some((i) => i.id === created.item.id)).toBe(true);
  });
});
