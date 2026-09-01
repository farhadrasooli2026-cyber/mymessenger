import "server-only";
import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import { config } from "@/lib/config";

const MAGIC = Buffer.from("NXV1");

function dataKey() {
  const hex = config.dataKeyHex;
  const raw = Buffer.from(hex, "hex");
  if (raw.length >= 32) return raw.subarray(0, 32);
  return Buffer.concat([raw, Buffer.alloc(32)]).subarray(0, 32);
}

export const VAULT_KEY_ID = (process.env.NIXO_VAULT_KEY_ID || "v1").slice(0, 4).padEnd(4, "0");

/** AES-256-GCM envelope. Key lives in env, never in the client or public object metadata. */
export function wrapVaultBytes(plain: Buffer, keyId = VAULT_KEY_ID): Buffer {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", dataKey(), iv);
  const enc = Buffer.concat([cipher.update(plain), cipher.final()]);
  const tag = cipher.getAuthTag();
  const kid = Buffer.from(keyId.slice(0, 4).padEnd(4, "0"));
  return Buffer.concat([MAGIC, kid, iv, tag, enc]);
}

export function unwrapVaultBytes(buf: Buffer): Buffer {
  if (buf.length < 4 + 4 + 12 + 16) return buf;
  if (!buf.subarray(0, 4).equals(MAGIC)) return buf;
  const iv = buf.subarray(8, 20);
  const tag = buf.subarray(20, 36);
  const enc = buf.subarray(36);
  try {
    const decipher = createDecipheriv("aes-256-gcm", dataKey(), iv);
    decipher.setAuthTag(tag);
    return Buffer.concat([decipher.update(enc), decipher.final()]);
  } catch {
    return buf;
  }
}

export function isWrappedVaultBlob(buf: Buffer) {
  return buf.length >= 8 && buf.subarray(0, 4).equals(MAGIC);
}
