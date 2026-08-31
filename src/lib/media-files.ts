import "server-only";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { MEDIA_MAX_CHUNKS } from "@/lib/media";

const ROOT = path.join(process.cwd(), ".data", "media");

function blobDir(userId: string, blobId: string) {
  if (!/^[a-f0-9]{8,64}$/i.test(blobId)) return null;
  if (!/^[a-f0-9]+$/i.test(userId.replace(/-/g, ""))) {
    /* user ids are hex from randomId */
  }
  if (!/^[a-zA-Z0-9_-]+$/.test(userId)) return null;
  return path.join(ROOT, userId, blobId);
}

export async function saveMediaChunk(
  userId: string,
  blobId: string,
  index: number,
  payload: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  if (index < 0 || index >= MEDIA_MAX_CHUNKS) return { ok: false, error: "شماره تکه نامعتبر است." };
  if (payload.length > 500_000) return { ok: false, error: "تکه بزرگ‌تر از حد مجاز است." };
  const dir = blobDir(userId, blobId);
  if (!dir) return { ok: false, error: "شناسه نامعتبر است." };
  await mkdir(dir, { recursive: true });
  await writeFile(path.join(dir, `${index}.enc`), payload, "utf8");
  return { ok: true };
}

export async function readMediaChunk(userId: string, blobId: string, index: number): Promise<string | null> {
  const dir = blobDir(userId, blobId);
  if (!dir || index < 0 || index >= MEDIA_MAX_CHUNKS) return null;
  try {
    return await readFile(path.join(dir, `${index}.enc`), "utf8");
  } catch {
    return null;
  }
}

export async function deleteMediaBlob(userId: string, blobId: string): Promise<void> {
  const dir = blobDir(userId, blobId);
  if (!dir) return;
  await rm(dir, { recursive: true, force: true });
}

export async function listUploadedChunks(userId: string, blobId: string): Promise<number[]> {
  const dir = blobDir(userId, blobId);
  if (!dir) return [];
  try {
    const { readdir } = await import("node:fs/promises");
    const files = await readdir(dir);
    return files
      .map((f) => Number(f.replace(".enc", "")))
      .filter((n) => Number.isInteger(n))
      .sort((a, b) => a - b);
  } catch {
    return [];
  }
}
