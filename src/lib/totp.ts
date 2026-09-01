import { createHmac, randomBytes } from "node:crypto";

const ALPH = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";

export function randomTotpSecret(): string {
  const buf = randomBytes(20);
  return toBase32(buf);
}

export function toBase32(buf: Buffer) {
  let bits = 0;
  let value = 0;
  let out = "";
  for (const b of buf) {
    value = (value << 8) | b;
    bits += 8;
    while (bits >= 5) {
      out += ALPH[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) out += ALPH[(value << (5 - bits)) & 31];
  return out;
}

export function fromBase32(secret: string): Buffer {
  const clean = secret.toUpperCase().replace(/=+$/g, "").replace(/[^A-Z2-7]/g, "");
  let bits = 0;
  let value = 0;
  const out: number[] = [];
  for (const ch of clean) {
    const idx = ALPH.indexOf(ch);
    if (idx < 0) continue;
    value = (value << 5) | idx;
    bits += 5;
    if (bits >= 8) {
      out.push((value >>> (bits - 8)) & 255);
      bits -= 8;
    }
  }
  return Buffer.from(out);
}

export function totpCode(secret: string, at = Date.now(), stepSec = 30): string {
  const counter = Math.floor(at / 1000 / stepSec);
  const buf = Buffer.alloc(8);
  buf.writeUInt32BE(Math.floor(counter / 0x100000000), 0);
  buf.writeUInt32BE(counter >>> 0, 4);
  const hmac = createHmac("sha1", fromBase32(secret)).update(buf).digest();
  const offset = hmac[hmac.length - 1]! & 0xf;
  const bin =
    ((hmac[offset]! & 0x7f) << 24) |
    ((hmac[offset + 1]! & 0xff) << 16) |
    ((hmac[offset + 2]! & 0xff) << 8) |
    (hmac[offset + 3]! & 0xff);
  return String(bin % 1_000_000).padStart(6, "0");
}

export function totpValid(secret: string, code: string, at = Date.now()) {
  const c = String(code).replace(/\s/g, "");
  if (!/^\d{6}$/.test(c)) return false;
  return totpCode(secret, at) === c || totpCode(secret, at - 30_000) === c || totpCode(secret, at + 30_000) === c;
}

export function otpauthUrl(secret: string, account: string) {
  const label = encodeURIComponent(`NIXO:${account}`);
  return `otpauth://totp/${label}?secret=${secret}&issuer=NIXO&digits=6&period=30`;
}
