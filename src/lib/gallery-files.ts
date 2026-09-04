import "server-only";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { dataDir } from "@/lib/data-dir";

function galleryRoot() {
  return path.join(dataDir(), "gallery");
}

function itemPath(userId: string, itemId: string) {
  if (!/^[a-zA-Z0-9_-]+$/.test(userId) || !/^[a-zA-Z0-9_-]+$/.test(itemId)) return null;
  return path.join(galleryRoot(), userId, itemId);
}

export async function writeGalleryBlob(userId: string, itemId: string, bytes: Buffer) {
  const p = itemPath(userId, itemId);
  if (!p) return { ok: false as const, error: "شناسه نامعتبر است." };
  await mkdir(path.dirname(p), { recursive: true });
  await writeFile(p, bytes);
  return { ok: true as const };
}

export async function readGalleryBlob(userId: string, itemId: string): Promise<Buffer | null> {
  const p = itemPath(userId, itemId);
  if (!p) return null;
  try {
    return await readFile(p);
  } catch {
    return null;
  }
}

export async function deleteGalleryBlob(userId: string, itemId: string) {
  const p = itemPath(userId, itemId);
  if (!p) return;
  await rm(p, { force: true });
}
