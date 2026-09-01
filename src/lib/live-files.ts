import "server-only";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import { config } from "@/lib/config";
import { LIVE_RECORD_MAX_BYTES } from "@/lib/live-types";

const ROOT = path.join(process.cwd(), ".data", "live");

function dataKey(): Buffer {
  const key = Buffer.from(config.dataKeyHex, "hex");
  if (key.length !== 32) return Buffer.concat([key, Buffer.alloc(32)]).subarray(0, 32);
  return key;
}

function recPath(hostUserId: string, recordingId: string) {
  if (!/^[a-zA-Z0-9_-]+$/.test(hostUserId) || !/^[a-zA-Z0-9_-]+$/.test(recordingId)) return null;
  return path.join(ROOT, hostUserId, recordingId);
}

function encryptBytes(plain: Buffer): Buffer {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", dataKey(), iv);
  const enc = Buffer.concat([cipher.update(plain), cipher.final()]);
  const tag = cipher.getAuthTag();
  return Buffer.concat([iv, tag, enc]);
}

function decryptBytes(blob: Buffer): Buffer | null {
  if (blob.length < 29) return null;
  const iv = blob.subarray(0, 12);
  const tag = blob.subarray(12, 28);
  const data = blob.subarray(28);
  try {
    const decipher = createDecipheriv("aes-256-gcm", dataKey(), iv);
    decipher.setAuthTag(tag);
    return Buffer.concat([decipher.update(data), decipher.final()]);
  } catch {
    return null;
  }
}

export async function writeLiveRecording(hostUserId: string, recordingId: string, bytes: Buffer) {
  if (bytes.length > LIVE_RECORD_MAX_BYTES) return { ok: false as const, error: "حجم Recording از سقف نیکسو بیشتر است." };
  const p = recPath(hostUserId, recordingId);
  if (!p) return { ok: false as const, error: "شناسه نامعتبر است." };
  await mkdir(path.dirname(p), { recursive: true });
  await writeFile(p, encryptBytes(bytes));
  return { ok: true as const };
}

export async function readLiveRecording(hostUserId: string, recordingId: string): Promise<Buffer | null> {
  const p = recPath(hostUserId, recordingId);
  if (!p) return null;
  try {
    const raw = await readFile(p);
    return decryptBytes(raw);
  } catch {
    return null;
  }
}

export async function deleteLiveRecordingFile(hostUserId: string, recordingId: string) {
  const p = recPath(hostUserId, recordingId);
  if (!p) return;
  await rm(p, { force: true });
}
