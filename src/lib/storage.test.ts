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
});
