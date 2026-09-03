import "server-only";
import { cookies } from "next/headers";
import { config } from "@/lib/config";
import { randomId, signPayload, verifyPayload } from "@/lib/crypto-utils";
import { SESSION_COOKIE_POLICY } from "@/lib/session";

/** HttpOnly human-check cookie so Ack works across Render workers without a shared store. */
export const HUMAN_COOKIE = "nixo_human";

export type HumanCookiePayload = {
  v: 1;
  t: string;
  iat: number;
  ack: number | null;
};

async function writeHumanCookie(payload: HumanCookiePayload) {
  const jar = await cookies();
  jar.set(HUMAN_COOKIE, signPayload(payload), {
    ...SESSION_COOKIE_POLICY,
    maxAge: Math.ceil(config.human.tokenTtlMs / 1000),
  });
}

export async function readHumanCookie(): Promise<HumanCookiePayload | null> {
  const jar = await cookies();
  const raw = jar.get(HUMAN_COOKIE)?.value;
  if (!raw) return null;
  const p = verifyPayload<HumanCookiePayload>(raw);
  if (!p || p.v !== 1 || typeof p.t !== "string" || typeof p.iat !== "number") return null;
  return p;
}

export async function clearHumanCookie() {
  const jar = await cookies();
  jar.delete(HUMAN_COOKIE);
}

export async function bindHumanCookie(token: string, issuedAt: number) {
  await writeHumanCookie({ v: 1, t: token, iat: issuedAt, ack: null });
}

export async function issueHumanCookieToken(): Promise<{ token: string; issuedAt: number }> {
  const token = randomId();
  const issuedAt = Date.now();
  await bindHumanCookie(token, issuedAt);
  return { token, issuedAt };
}

export async function ackHumanCookie(token: string): Promise<{ ok: boolean; error?: string }> {
  const row = await readHumanCookie();
  const now = Date.now();
  if (!row || row.t !== token) {
    return { ok: false, error: "نشست امنیتی نامعتبر است. صفحه را تازه‌سازی کنید." };
  }
  if (now - row.iat > config.human.tokenTtlMs) {
    return { ok: false, error: "نشست امنیتی منقضی شده است." };
  }
  await writeHumanCookie({ ...row, ack: now });
  return { ok: true };
}

export async function consumeHumanCookie(token: string): Promise<boolean> {
  const row = await readHumanCookie();
  const now = Date.now();
  if (!row || row.t !== token || row.ack == null) return false;
  if (now - row.iat > config.human.tokenTtlMs) return false;
  if (row.ack - row.iat < config.human.minElapsedMs) return false;
  await clearHumanCookie();
  return true;
}
