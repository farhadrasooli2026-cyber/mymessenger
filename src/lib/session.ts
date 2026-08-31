import { cookies, headers } from "next/headers";
import { config } from "@/lib/config";
import { hashIp, signPayload, verifyPayload } from "@/lib/crypto-utils";

export type RegisterStep = "verify" | "profile" | "complete";

export type RegisterSession = {
  v: 1;
  step: RegisterStep;
  challengeId: string;
  userId?: string;
  exp: number;
};

export async function clientIp(): Promise<string> {
  const h = await headers();
  const forwarded = h.get("x-forwarded-for");
  if (forwarded) {
    return forwarded.split(",")[0]?.trim() || "0.0.0.0";
  }
  return h.get("x-real-ip")?.trim() || "0.0.0.0";
}

export async function clientIpHash(): Promise<string> {
  return hashIp(await clientIp());
}

export async function readSession(): Promise<RegisterSession | null> {
  const jar = await cookies();
  const token = jar.get(config.cookieName)?.value;
  if (!token) return null;
  const payload = verifyPayload<RegisterSession>(token);
  if (!payload || payload.v !== 1) return null;
  if (payload.exp < Date.now()) return null;
  return payload;
}

export async function writeSession(session: Omit<RegisterSession, "v" | "exp">): Promise<void> {
  const jar = await cookies();
  const payload: RegisterSession = {
    v: 1,
    ...session,
    exp: Date.now() + config.cookieMaxAgeSec * 1000,
  };
  jar.set(config.cookieName, signPayload(payload), {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: config.cookieMaxAgeSec,
  });
}

export async function clearSession(): Promise<void> {
  const jar = await cookies();
  jar.delete(config.cookieName);
}
