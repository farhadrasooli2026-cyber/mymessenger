import "server-only";
import { mkdir, readFile, readdir, rm, stat, writeFile, copyFile } from "node:fs/promises";
import path from "node:path";
import { unwrapVaultBytes, wrapVaultBytes } from "@/lib/storage-crypto";

function root() {
  const name = process.env.VITEST ? `vault.test.${process.env.VITEST_WORKER_ID ?? "0"}` : "vault";
  return path.join(process.cwd(), ".data", name);
}

function tmpRoot() {
  const name = process.env.VITEST ? `vault-tmp.test.${process.env.VITEST_WORKER_ID ?? "0"}` : "vault-tmp";
  return path.join(process.cwd(), ".data", name);
}

function safeSeg(id: string) {
  return /^[a-zA-Z0-9_-]+$/.test(id) ? id : null;
}

export function vaultObjectPath(ownerUserId: string, storageKey: string) {
  const a = safeSeg(ownerUserId);
  const b = safeSeg(storageKey);
  if (!a || !b) return null;
  return path.join(root(), a, b);
}

export async function writeVaultBlob(ownerUserId: string, storageKey: string, bytes: Buffer) {
  const p = vaultObjectPath(ownerUserId, storageKey);
  if (!p) return { ok: false as const, error: "شناسه ذخیره‌سازی نامعتبر است." };
  await mkdir(path.dirname(p), { recursive: true });
  await writeFile(p, wrapVaultBytes(bytes));
  return { ok: true as const };
}

export async function readVaultBlob(ownerUserId: string, storageKey: string): Promise<Buffer | null> {
  const p = vaultObjectPath(ownerUserId, storageKey);
  if (!p) return null;
  try {
    const raw = await readFile(p);
    return unwrapVaultBytes(raw);
  } catch {
    return null;
  }
}

function backupRoot() {
  const name = process.env.VITEST ? `vault-backup.test.${process.env.VITEST_WORKER_ID ?? "0"}` : "vault-backup";
  return path.join(process.cwd(), ".data", name);
}

/** Isolated encrypted replica. Never served by public media APIs. */
export async function copyVaultBackup(ownerUserId: string, storageKey: string) {
  const src = vaultObjectPath(ownerUserId, storageKey);
  const a = safeSeg(ownerUserId);
  const b = safeSeg(storageKey);
  if (!src || !a || !b) return { ok: false as const };
  const dest = path.join(backupRoot(), a, b);
  await mkdir(path.dirname(dest), { recursive: true });
  try {
    await copyFile(src, dest);
    return { ok: true as const };
  } catch {
    return { ok: false as const };
  }
}

export async function readVaultRange(ownerUserId: string, storageKey: string, start: number, end: number): Promise<Buffer | null> {
  const full = await readVaultBlob(ownerUserId, storageKey);
  if (!full) return null;
  const s = Math.max(0, start);
  const e = Math.min(full.length - 1, end);
  if (s > e) return Buffer.alloc(0);
  return full.subarray(s, e + 1);
}

export async function vaultBlobSize(ownerUserId: string, storageKey: string): Promise<number | null> {
  const p = vaultObjectPath(ownerUserId, storageKey);
  if (!p) return null;
  try {
    return (await stat(p)).size;
  } catch {
    return null;
  }
}

export async function deleteVaultBlob(ownerUserId: string, storageKey: string) {
  const p = vaultObjectPath(ownerUserId, storageKey);
  if (!p) return;
  await rm(p, { force: true });
}

export async function writeSessionChunk(sessionId: string, index: number, bytes: Buffer) {
  const sid = safeSeg(sessionId);
  if (!sid || index < 0 || index > 10_000) return { ok: false as const, error: "نشست نامعتبر است." };
  const dir = path.join(tmpRoot(), sid);
  await mkdir(dir, { recursive: true });
  await writeFile(path.join(dir, `${index}.part`), bytes);
  return { ok: true as const };
}

export async function readSessionChunks(sessionId: string, count: number): Promise<Buffer | null> {
  const sid = safeSeg(sessionId);
  if (!sid) return null;
  const parts: Buffer[] = [];
  for (let i = 0; i < count; i += 1) {
    try {
      parts.push(await readFile(path.join(tmpRoot(), sid, `${i}.part`)));
    } catch {
      return null;
    }
  }
  return Buffer.concat(parts);
}

export async function listSessionIndexes(sessionId: string): Promise<number[]> {
  const sid = safeSeg(sessionId);
  if (!sid) return [];
  try {
    const files = await readdir(path.join(tmpRoot(), sid));
    return files
      .filter((f) => f.endsWith(".part"))
      .map((f) => Number(f.replace(".part", "")))
      .filter((n) => Number.isInteger(n))
      .sort((a, b) => a - b);
  } catch {
    return [];
  }
}

export async function deleteSessionDir(sessionId: string) {
  const sid = safeSeg(sessionId);
  if (!sid) return;
  await rm(path.join(tmpRoot(), sid), { recursive: true, force: true });
}

export async function listVaultKeys(): Promise<{ ownerUserId: string; storageKey: string; mtime: number }[]> {
  const out: { ownerUserId: string; storageKey: string; mtime: number }[] = [];
  try {
    const users = await readdir(root());
    for (const ownerUserId of users) {
      if (!safeSeg(ownerUserId)) continue;
      const keys = await readdir(path.join(root(), ownerUserId)).catch(() => []);
      for (const storageKey of keys) {
        if (!safeSeg(storageKey)) continue;
        const st = await stat(path.join(root(), ownerUserId, storageKey)).catch(() => null);
        out.push({ ownerUserId, storageKey, mtime: st?.mtimeMs ?? 0 });
      }
    }
  } catch {
    return out;
  }
  return out;
}
