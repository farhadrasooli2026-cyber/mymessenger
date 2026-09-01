import { afterEach, describe, expect, it } from "vitest";
import { hashIp } from "./crypto-utils";
import { completeProfile } from "./profile";
import { getOutbox } from "./outbox";
import { ackHumanChallenge, issueHumanChallenge, startRegistration, verifyOtp } from "./registration";
import { resetStoreForTests } from "./store";
import { stripJpegExif } from "./files";
import {
  beginVaultUpload,
  completeVaultUpload,
  getVaultMedia,
  parseByteRange,
  putVaultChunk,
  trashVault,
} from "./storage";

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
    firstName: "فایل",
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

function pdfBytes() {
  return Buffer.from("%PDF-1.4 extra bytes here for sniffing");
}

async function upload(userId: string, name: string, buf: Buffer) {
  const begin = await beginVaultUpload(userId, { name, size: buf.length, mime: "application/pdf", chunks: 1 });
  expect(begin.ok).toBe(true);
  if (!begin.ok) throw new Error("begin");
  const chunk = await putVaultChunk(userId, begin.sessionId, 0, buf.toString("base64"));
  expect(chunk.ok).toBe(true);
  const done = await completeVaultUpload(userId, begin.sessionId);
  return { begin, done };
}

describe("NIXO media vault", () => {
  afterEach(async () => {
    await resetStoreForTests();
  });

  it("parses HTTP ranges for resume/stream", () => {
    expect(parseByteRange("bytes=0-9", 100)).toEqual({ start: 0, end: 9 });
    expect(parseByteRange("bytes=90-", 100)).toEqual({ start: 90, end: 99 });
    expect(parseByteRange("bytes=-10", 100)).toEqual({ start: 90, end: 99 });
    expect(parseByteRange("bytes=50-10", 100)).toBeNull();
  });

  it("stores a pdf privately and rejects another account even with a stolen id", async () => {
    const a = await activeUser("st_own");
    const b = await activeUser("st_oth");
    const { done } = await upload(a, "report.pdf", pdfBytes());
    expect(done.ok).toBe(true);
    if (!done.ok) return;
    expect(done.item.status).toBe("ready");
    expect(done.item.mediaUrl).toContain(done.item.id);
    const token = new URL(done.item.mediaUrl, "http://nixo.local").searchParams.get("t") ?? "";
    const own = await getVaultMedia(a, done.item.id, token);
    expect(own.ok).toBe(true);
    const steal = await getVaultMedia(b, done.item.id, token);
    expect(steal.ok).toBe(false);
    if (!steal.ok) expect(steal.status).toBe(403);
  });

  it("quarantines html and never serves it", async () => {
    const id = await activeUser("st_html");
    const html = Buffer.from("<!doctype html><script>x</script> more text");
    const begin = await beginVaultUpload(id, { name: "note.txt", size: html.length, mime: "text/plain", chunks: 1 });
    expect(begin.ok).toBe(true);
    if (!begin.ok) return;
    await putVaultChunk(id, begin.sessionId, 0, html.toString("base64"));
    const done = await completeVaultUpload(id, begin.sessionId);
    expect(done.ok).toBe(false);
  });

  it("strips jpeg exif on ingest and revokes signed urls after delete", async () => {
    const id = await activeUser("st_jpg");
    const payload = Buffer.alloc(16);
    Buffer.from("Exif\0\0GPS").copy(payload);
    const len = 2 + payload.length;
    const jpeg = Buffer.concat([
      Buffer.from([0xff, 0xd8, 0xff, 0xe1, (len >> 8) & 0xff, len & 0xff]),
      payload,
      Buffer.from([0xff, 0xd9]),
    ]);
    expect(jpeg.includes("Exif")).toBe(true);
    expect(stripJpegExif(jpeg).includes("Exif")).toBe(false);
    const begin = await beginVaultUpload(id, { name: "pic.jpg", size: jpeg.length, mime: "image/jpeg", chunks: 1 });
    expect(begin.ok).toBe(true);
    if (!begin.ok) return;
    await putVaultChunk(id, begin.sessionId, 0, jpeg.toString("base64"));
    const done = await completeVaultUpload(id, begin.sessionId);
    expect(done.ok).toBe(true);
    if (!done.ok) return;
    const token = new URL(done.item.mediaUrl, "http://nixo.local").searchParams.get("t") ?? "";
    const media = await getVaultMedia(id, done.item.id, token);
    expect(media.ok).toBe(true);
    if (media.ok) expect(Buffer.from(media.bytes).includes("Exif")).toBe(false);
    await trashVault(id, [done.item.id], false);
    const after = await getVaultMedia(id, done.item.id, token);
    expect(after.ok).toBe(false);
  });

  it("supports chunked resume by client nonce", async () => {
    const id = await activeUser("st_res");
    const buf = pdfBytes();
    const nonce = "resume-1";
    const first = await beginVaultUpload(id, { name: "a.pdf", size: buf.length, mime: "application/pdf", chunks: 1, clientNonce: nonce });
    const again = await beginVaultUpload(id, { name: "a.pdf", size: buf.length, mime: "application/pdf", chunks: 1, clientNonce: nonce });
    expect(first.ok && again.ok).toBe(true);
    if (!first.ok || !again.ok) return;
    expect(again.sessionId).toBe(first.sessionId);
    expect(again.resume).toBe(true);
  });

  it("encrypts at rest, shares only to allowed users, and blocks stolen share links", async () => {
    const { wrapVaultBytes, unwrapVaultBytes, isWrappedVaultBlob } = await import("./storage-crypto");
    const { cancelVaultUpload, createVaultLink, shareVaultFile, forwardVaultFile, restoreVault, listVault, beginVaultUpload } = await import("./storage");
    const { globalSearch } = await import("./search");
    const plain = Buffer.from("hello-nixo-vault");
    const wrapped = wrapVaultBytes(plain);
    expect(isWrappedVaultBlob(wrapped)).toBe(true);
    expect(unwrapVaultBytes(wrapped).equals(plain)).toBe(true);

    const a = await activeUser("st_share_a");
    const b = await activeUser("st_share_b");
    const c = await activeUser("st_share_c");
    const { done } = await upload(a, "secret.pdf", pdfBytes());
    expect(done.ok).toBe(true);
    if (!done.ok) return;
    const searchC = await globalSearch(c, { q: "secret.pdf", kind: "files" });
    expect(searchC.ok && searchC.hits.every((h) => h.target.id !== done.item.id)).toBe(true);
    const searchA = await globalSearch(a, { q: "secret.pdf", kind: "files" });
    expect(searchA.ok && searchA.hits.some((h) => h.target.id === done.item.id)).toBe(true);

    const fwd = await forwardVaultFile(b, done.item.id, c);
    expect(fwd.ok).toBe(false);
    const shared = await shareVaultFile(a, done.item.id, b);
    expect(shared.ok).toBe(true);
    const listed = await listVault(b, {});
    const hit = listed.items.find((i) => i.id === done.item.id);
    expect(hit).toBeTruthy();
    const tokenB = hit ? new URL(hit.mediaUrl, "http://nixo.local").searchParams.get("t") ?? "" : "";
    const asB = await getVaultMedia(b, done.item.id, tokenB);
    expect(asB.ok).toBe(true);
    const link = await createVaultLink(a, done.item.id, "download");
    expect(link.ok).toBe(true);
    if (link.ok) {
      const k = new URL(link.href, "http://nixo.local").searchParams.get("k") ?? "";
      const steal = await getVaultMedia(c, done.item.id, "", { link: k });
      expect(steal.ok).toBe(false);
    }
    await trashVault(a, [done.item.id], false);
    const restored = await restoreVault(a, [done.item.id]);
    expect(restored.ok && restored.count).toBe(1);

    const rec = await beginVaultUpload(a, { name: "nixo-call-recording.webm", size: 12, mime: "video/webm", chunks: 1 });
    expect(rec.ok).toBe(false);

    const begin = await beginVaultUpload(a, { name: "draft.pdf", size: pdfBytes().length, mime: "application/pdf", chunks: 1 });
    expect(begin.ok).toBe(true);
    if (begin.ok) {
      const cancelled = await cancelVaultUpload(a, begin.sessionId);
      expect(cancelled.ok).toBe(true);
    }
  });
});
