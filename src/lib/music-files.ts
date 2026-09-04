import "server-only";
import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { config } from "@/lib/config";
import { NIXO_TONES, type LicensedTone } from "@/lib/music-types";
import { dataDir } from "@/lib/data-dir";

function musicRoot() {
  return path.join(dataDir(), "music");
}

function key() {
  return createHash("sha256").update(`nixo.music.${config.pepper}`).digest();
}

function itemPath(userId: string, itemId: string) {
  if (!/^[a-zA-Z0-9_-]+$/.test(userId) || !/^[a-zA-Z0-9_-]+$/.test(itemId)) return null;
  return path.join(musicRoot(), userId, itemId);
}

export async function writeMusicBlob(userId: string, itemId: string, bytes: Buffer) {
  const p = itemPath(userId, itemId);
  if (!p) return { ok: false as const, error: "شناسه نامعتبر است." };
  await mkdir(path.dirname(p), { recursive: true });
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key(), iv);
  const enc = Buffer.concat([cipher.update(bytes), cipher.final()]);
  const tag = cipher.getAuthTag();
  await writeFile(p, Buffer.concat([Buffer.from("NMA1"), iv, tag, enc]));
  return { ok: true as const };
}

export async function readMusicBlob(userId: string, itemId: string): Promise<Buffer | null> {
  const p = itemPath(userId, itemId);
  if (!p) return null;
  try {
    const raw = await readFile(p);
    if (raw.length < 32 || raw.subarray(0, 4).toString() !== "NMA1") return null;
    const iv = raw.subarray(4, 16);
    const tag = raw.subarray(16, 32);
    const enc = raw.subarray(32);
    const decipher = createDecipheriv("aes-256-gcm", key(), iv);
    decipher.setAuthTag(tag);
    return Buffer.concat([decipher.update(enc), decipher.final()]);
  } catch {
    return null;
  }
}

export async function deleteMusicBlob(userId: string, itemId: string) {
  const p = itemPath(userId, itemId);
  if (!p) return;
  await rm(p, { force: true });
}

export function toneWav(tone: LicensedTone): Buffer {
  const sampleRate = 8000;
  const n = Math.floor((tone.durationMs / 1000) * sampleRate);
  const data = Buffer.alloc(n * 2);
  for (let i = 0; i < n; i++) {
    const t = i / sampleRate;
    const env = Math.min(1, t * 8) * Math.min(1, (n - i) / (sampleRate * 0.12));
    const sample = Math.round(Math.sin(2 * Math.PI * tone.freq * t) * 0.28 * env * 32767);
    data.writeInt16LE(sample, i * 2);
  }
  const header = Buffer.alloc(44);
  header.write("RIFF", 0);
  header.writeUInt32LE(36 + data.length, 4);
  header.write("WAVE", 8);
  header.write("fmt ", 12);
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20);
  header.writeUInt16LE(1, 22);
  header.writeUInt32LE(sampleRate, 24);
  header.writeUInt32LE(sampleRate * 2, 28);
  header.writeUInt16LE(2, 32);
  header.writeUInt16LE(16, 34);
  header.write("data", 36);
  header.writeUInt32LE(data.length, 40);
  return Buffer.concat([header, data]);
}

export function licensedTone(id: string): LicensedTone | undefined {
  return NIXO_TONES.find((t) => t.id === id);
}
