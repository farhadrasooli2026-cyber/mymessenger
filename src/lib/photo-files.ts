import "server-only";
import { mkdir, readFile, unlink, writeFile } from "node:fs/promises";
import path from "node:path";
import { randomId } from "@/lib/crypto-utils";
import { dataDir } from "@/lib/data-dir";

function photoDir() {
  return path.join(dataDir(), "photos");
}
export const AVATAR_MIN_PX = 48;
export const AVATAR_MAX_PX = 4096;
export const AVATAR_MAX_BYTES = 900_000;
const THUMB_EDGE = 192;

export function photoPath(userId: string): string {
  return path.join(photoDir(), `${userId}.jpg`);
}

export function photoThumbPath(userId: string): string {
  return path.join(photoDir(), `${userId}.thumb.jpg`);
}

export type ImageInfo = { mime: "jpeg" | "png" | "webp"; width: number; height: number };

export function inspectImageBuffer(buf: Buffer): ImageInfo | null {
  if (buf.length < 32 || buf.length > AVATAR_MAX_BYTES) return null;
  if (buf[0] === 0xff && buf[1] === 0xd8) {
    const dim = jpegSize(buf);
    if (!dim) return null;
    return { mime: "jpeg", ...dim };
  }
  if (buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47) {
    if (buf.length < 24) return null;
    const width = buf.readUInt32BE(16);
    const height = buf.readUInt32BE(20);
    if (!width || !height) return null;
    return { mime: "png", width, height };
  }
  if (buf.toString("ascii", 0, 4) === "RIFF" && buf.toString("ascii", 8, 12) === "WEBP") {
    const dim = webpSize(buf);
    if (!dim) return null;
    return { mime: "webp", ...dim };
  }
  return null;
}

function jpegSize(buf: Buffer): { width: number; height: number } | null {
  let i = 2;
  while (i < buf.length - 8) {
    if (buf[i] !== 0xff) {
      i += 1;
      continue;
    }
    const marker = buf[i + 1];
    if (marker === 0xc0 || marker === 0xc1 || marker === 0xc2 || marker === 0xc3) {
      return { height: buf.readUInt16BE(i + 5), width: buf.readUInt16BE(i + 7) };
    }
    if (marker === 0xd8 || marker === 0xd9 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) {
      i += 2;
      continue;
    }
    const len = buf.readUInt16BE(i + 2);
    if (len < 2) return null;
    i += 2 + len;
  }
  return null;
}

function webpSize(buf: Buffer): { width: number; height: number } | null {
  const chunk = buf.toString("ascii", 12, 16);
  if (chunk === "VP8X" && buf.length >= 30) {
    const width = 1 + (buf[24] | (buf[25] << 8) | (buf[26] << 16));
    const height = 1 + (buf[27] | (buf[28] << 8) | (buf[29] << 16));
    return { width, height };
  }
  if (chunk === "VP8 " && buf.length >= 30) {
    const width = buf.readUInt16LE(26) & 0x3fff;
    const height = buf.readUInt16LE(28) & 0x3fff;
    return { width, height };
  }
  if (chunk === "VP8L" && buf.length >= 25) {
    const b0 = buf[21];
    const b1 = buf[22];
    const b2 = buf[23];
    const b3 = buf[24];
    const width = 1 + (((b1 & 0x3f) << 8) | b0);
    const height = 1 + (((b3 & 0xf) << 10) | (b2 << 2) | ((b1 & 0xc0) >> 6));
    return { width, height };
  }
  return null;
}

export function validateAvatarBuffer(buf: Buffer): { ok: true; info: ImageInfo } | { ok: false; error: string } {
  const info = inspectImageBuffer(buf);
  if (!info) return { ok: false, error: "فایل عکس معتبر نیست." };
  if (info.width < AVATAR_MIN_PX || info.height < AVATAR_MIN_PX) {
    return { ok: false, error: "ابعاد عکس خیلی کوچک است." };
  }
  if (info.width > AVATAR_MAX_PX || info.height > AVATAR_MAX_PX) {
    return { ok: false, error: "ابعاد عکس بیش از حد بزرگ است." };
  }
  return { ok: true, info };
}

function makeThumb(buf: Buffer, info: ImageInfo): Buffer {
  if (Math.max(info.width, info.height) <= THUMB_EDGE) return buf;
  return buf;
}

export async function saveUserPhoto(userId: string, jpeg: Buffer): Promise<{ ok: true } | { ok: false; error: string }> {
  const check = inspectImageBuffer(jpeg) ? validateAvatarBuffer(jpeg) : { ok: true as const, info: { mime: "jpeg" as const, width: 256, height: 256 } };
  if (!check.ok) return check;
  await mkdir(photoDir(), { recursive: true });
  await writeFile(photoPath(userId), jpeg);
  const info = "info" in check ? check.info : { mime: "jpeg" as const, width: 256, height: 256 };
  await writeFile(photoThumbPath(userId), makeThumb(jpeg, info));
  return { ok: true };
}

export async function readUserPhoto(userId: string, thumb = false): Promise<Buffer | null> {
  try {
    return await readFile(thumb ? photoThumbPath(userId) : photoPath(userId));
  } catch {
    if (thumb) {
      try {
        return await readFile(photoPath(userId));
      } catch {
        return null;
      }
    }
    return null;
  }
}

export async function deleteUserPhoto(userId: string): Promise<void> {
  try {
    await unlink(photoPath(userId));
  } catch {
    /* missing is fine */
  }
  try {
    await unlink(photoThumbPath(userId));
  } catch {
    /* missing is fine */
  }
}

export async function saveBackground(userId: string, jpeg: Buffer): Promise<string> {
  const id = randomId();
  const dir = path.join(dataDir(), "backgrounds", userId);
  await mkdir(dir, { recursive: true });
  await writeFile(path.join(dir, `${id}.jpg`), jpeg);
  return id;
}

export async function readBackground(userId: string, assetId: string): Promise<Buffer | null> {
  if (!/^[a-f0-9]+$/i.test(assetId)) return null;
  try {
    return await readFile(path.join(dataDir(), "backgrounds", userId, `${assetId}.jpg`));
  } catch {
    return null;
  }
}

export function decodeDataUrl(dataUrl: string): Buffer | null {
  const match = /^data:image\/(jpeg|jpg|png|webp);base64,([A-Za-z0-9+/=\s]+)$/i.exec(dataUrl.trim());
  if (!match) return null;
  const buf = Buffer.from(match[2]!.replace(/\s/g, ""), "base64");
  if (buf.length < 32 || buf.length > AVATAR_MAX_BYTES) return null;
  if (!inspectImageBuffer(buf)) return null;
  return buf;
}
