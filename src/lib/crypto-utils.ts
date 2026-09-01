import "server-only";
import { createCipheriv, createDecipheriv, createHmac, randomBytes, scryptSync, timingSafeEqual } from "node:crypto";
import { config } from "@/lib/config";

const SCRYPT_KEYLEN = 32;

export function randomId(): string {
  return randomBytes(16).toString("hex");
}

export function randomOtp(length: number): string {
  const digits: string[] = [];
  for (let i = 0; i < length; i += 1) {
    digits.push(String(randomBytes(1)[0]! % 10));
  }
  return digits.join("");
}

export function hmacIdentifier(normalized: string): string {
  return createHmac("sha256", config.pepper).update(normalized).digest("hex");
}

export function hashIp(ip: string): string {
  return createHmac("sha256", config.pepper).update(`ip:${ip}`).digest("hex");
}

export function newSalt(): string {
  return randomBytes(16).toString("hex");
}

export function hashOtp(code: string, salt: string): string {
  return scryptSync(`${config.pepper}:${code}`, salt, SCRYPT_KEYLEN).toString("hex");
}

export function otpHashesEqual(a: string, b: string): boolean {
  const left = Buffer.from(a, "hex");
  const right = Buffer.from(b, "hex");
  if (left.length !== right.length || left.length === 0) {
    return false;
  }
  return timingSafeEqual(left, right);
}

export function dummyOtpCompare(code: string): boolean {
  const salt = "0".repeat(32);
  const hashed = hashOtp(code, salt);
  return otpHashesEqual(hashed, hashed) && false;
}

function dataKey(): Buffer {
  const key = Buffer.from(config.dataKeyHex, "hex");
  if (key.length !== 32) {
    return Buffer.concat([key, Buffer.alloc(32)]).subarray(0, 32);
  }
  return key;
}

export function encryptText(plain: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", dataKey(), iv);
  const encrypted = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `${iv.toString("hex")}:${tag.toString("hex")}:${encrypted.toString("hex")}`;
}

export function decryptText(payload: string): string {
  const [ivHex, tagHex, dataHex] = payload.split(":");
  if (!ivHex || !tagHex || !dataHex) {
    throw new Error("invalid cipher payload");
  }
  const decipher = createDecipheriv("aes-256-gcm", dataKey(), Buffer.from(ivHex, "hex"));
  decipher.setAuthTag(Buffer.from(tagHex, "hex"));
  return Buffer.concat([
    decipher.update(Buffer.from(dataHex, "hex")),
    decipher.final(),
  ]).toString("utf8");
}

function backupKey(): Buffer {
  const hex = config.backupKeyHex;
  if (hex && hex.length >= 64) {
    const key = Buffer.from(hex, "hex");
    if (key.length >= 32) return key.subarray(0, 32);
  }
  return createHmac("sha256", dataKey()).update("nixo-backup-wrapping-v1").digest();
}

export function encryptBackupBytes(plain: Buffer): Buffer {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", backupKey(), iv);
  const encrypted = Buffer.concat([cipher.update(plain), cipher.final()]);
  const tag = cipher.getAuthTag();
  return Buffer.concat([Buffer.from("B1"), iv, tag, encrypted]);
}

export function decryptBackupBytes(payload: Buffer): Buffer {
  if (payload.length >= 2 + 12 + 16 && payload.subarray(0, 2).toString() === "B1") {
    const iv = payload.subarray(2, 14);
    const tag = payload.subarray(14, 30);
    const data = payload.subarray(30);
    const decipher = createDecipheriv("aes-256-gcm", backupKey(), iv);
    decipher.setAuthTag(tag);
    return Buffer.concat([decipher.update(data), decipher.final()]);
  }
  return decryptBytes(payload);
}

export function signBackupBlob(id: string, sha256: string): string {
  return createHmac("sha256", backupKey()).update(`nixo-dr:${id}:${sha256}`).digest("hex");
}

export function backupSignatureOk(id: string, sha256: string, signature: string): boolean {
  const expected = signBackupBlob(id, sha256);
  const a = Buffer.from(signature);
  const b = Buffer.from(expected);
  if (a.length !== b.length || a.length === 0) return false;
  return timingSafeEqual(a, b);
}

export function encryptBytes(plain: Buffer): Buffer {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", dataKey(), iv);
  const encrypted = Buffer.concat([cipher.update(plain), cipher.final()]);
  const tag = cipher.getAuthTag();
  return Buffer.concat([Buffer.from("N1"), iv, tag, encrypted]);
}

export function decryptBytes(payload: Buffer): Buffer {
  if (payload.length < 2 + 12 + 16 || payload.subarray(0, 2).toString() !== "N1") {
    throw new Error("invalid cipher payload");
  }
  const iv = payload.subarray(2, 14);
  const tag = payload.subarray(14, 30);
  const data = payload.subarray(30);
  const decipher = createDecipheriv("aes-256-gcm", dataKey(), iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(data), decipher.final()]);
}

export type SignedPayload = Record<string, unknown>;

export function signPayload(payload: SignedPayload): string {
  const body = Buffer.from(JSON.stringify(payload), "utf8").toString("base64url");
  const sig = createHmac("sha256", config.sessionSecret).update(body).digest("base64url");
  return `${body}.${sig}`;
}

export function verifyPayload<T extends SignedPayload>(token: string): T | null {
  const dot = token.lastIndexOf(".");
  if (dot <= 0) return null;
  const body = token.slice(0, dot);
  const sig = token.slice(dot + 1);
  const expected = createHmac("sha256", config.sessionSecret).update(body).digest("base64url");
  const a = Buffer.from(sig);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
  try {
    return JSON.parse(Buffer.from(body, "base64url").toString("utf8")) as T;
  } catch {
    return null;
  }
}

export function maskPhone(phone: string): string {
  if (phone.length < 8) return "***";
  return `${phone.slice(0, 4)}***${phone.slice(-2)}`;
}

export function maskEmail(email: string): string {
  const [local, domain] = email.split("@");
  if (!local || !domain) return "***";
  const keep = local.slice(0, Math.min(2, local.length));
  return `${keep}***@${domain}`;
}
