import "server-only";
import { mkdir, readFile, unlink, writeFile } from "node:fs/promises";
import path from "node:path";

const PHOTO_DIR = path.join(process.cwd(), ".data", "photos");

export function photoPath(userId: string): string {
  return path.join(PHOTO_DIR, `${userId}.jpg`);
}

export async function saveUserPhoto(userId: string, jpeg: Buffer): Promise<void> {
  await mkdir(PHOTO_DIR, { recursive: true });
  await writeFile(photoPath(userId), jpeg);
}

export async function readUserPhoto(userId: string): Promise<Buffer | null> {
  try {
    return await readFile(photoPath(userId));
  } catch {
    return null;
  }
}

export async function deleteUserPhoto(userId: string): Promise<void> {
  try {
    await unlink(photoPath(userId));
  } catch {
    /* missing is fine */
  }
}

export function decodeDataUrl(dataUrl: string): Buffer | null {
  const match = /^data:image\/(jpeg|jpg|png|webp);base64,([A-Za-z0-9+/=\s]+)$/i.exec(dataUrl.trim());
  if (!match) return null;
  const buf = Buffer.from(match[2]!.replace(/\s/g, ""), "base64");
  if (buf.length < 32 || buf.length > 900_000) return null;
  return buf;
}
