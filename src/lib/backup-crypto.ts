/** Client/server-safe backup wrapping. Uses Web Crypto AES-GCM + PBKDF2. */

export type WrappedBackup = {
  enc: "aes-gcm-v1";
  salt: string;
  nonce: string;
  ciphertext: string;
};

function bytesToB64(bytes: Uint8Array): string {
  if (typeof Buffer !== "undefined") return Buffer.from(bytes).toString("base64");
  let s = "";
  bytes.forEach((b) => {
    s += String.fromCharCode(b);
  });
  return btoa(s);
}

function b64ToBytes(b64: string): Uint8Array<ArrayBuffer> {
  const bytes =
    typeof Buffer !== "undefined" ? new Uint8Array(Buffer.from(b64, "base64")) : (() => {
      const bin = atob(b64);
      const out = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i += 1) out[i] = bin.charCodeAt(i);
      return out;
    })();
  return new Uint8Array(bytes);
}

function asBuf(bytes: Uint8Array): ArrayBuffer {
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
}

export async function deriveBackupKey(secret: string, saltB64: string): Promise<CryptoKey> {
  const enc = new TextEncoder().encode(secret);
  const base = await crypto.subtle.importKey("raw", asBuf(enc), "PBKDF2", false, ["deriveKey"]);
  return crypto.subtle.deriveKey(
    { name: "PBKDF2", salt: asBuf(b64ToBytes(saltB64)), iterations: 120_000, hash: "SHA-256" },
    base,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"],
  );
}

export async function wrapBackup(secret: string, plaintext: string): Promise<WrappedBackup> {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const nonce = crypto.getRandomValues(new Uint8Array(12));
  const key = await deriveBackupKey(secret, bytesToB64(salt));
  const ct = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv: asBuf(nonce) },
    key,
    asBuf(new TextEncoder().encode(plaintext)),
  );
  return {
    enc: "aes-gcm-v1",
    salt: bytesToB64(salt),
    nonce: bytesToB64(nonce),
    ciphertext: bytesToB64(new Uint8Array(ct)),
  };
}

export async function unwrapBackup(secret: string, wrapped: WrappedBackup): Promise<string> {
  const key = await deriveBackupKey(secret, wrapped.salt);
  const pt = await crypto.subtle.decrypt(
    { name: "AES-GCM", iv: asBuf(b64ToBytes(wrapped.nonce)) },
    key,
    asBuf(b64ToBytes(wrapped.ciphertext)),
  );
  return new TextDecoder().decode(pt);
}

export function generateRecoveryKey() {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  const bytes = crypto.getRandomValues(new Uint8Array(24));
  const chars = Array.from(bytes, (b) => alphabet[b % alphabet.length]).join("");
  return `${chars.slice(0, 6)}-${chars.slice(6, 12)}-${chars.slice(12, 18)}-${chars.slice(18, 24)}`;
}
