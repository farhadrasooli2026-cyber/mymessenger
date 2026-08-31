import { cookies, headers } from "next/headers";
import { config } from "@/lib/config";
import { hashIp, signPayload, verifyPayload } from "@/lib/crypto-utils";

export type RegisterStep = "verify" | "profile" | "complete" | "twostep";

export type RegisterSession = {
  v: 1 | 2;
  step: RegisterStep;
  challengeId: string;
  userId?: string;
  sid?: string;
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

export async function clientUserAgent(): Promise<string> {
  const h = await headers();
  return h.get("user-agent")?.slice(0, 180) || "unknown";
}

export async function readSession(): Promise<RegisterSession | null> {
  const jar = await cookies();
  const token = jar.get(config.cookieName)?.value;
  if (!token) return null;
  const payload = verifyPayload<RegisterSession>(token);
  if (!payload || (payload.v !== 1 && payload.v !== 2)) return null;
  if (payload.exp < Date.now()) return null;
  if (payload.sid && payload.userId) {
    const { isDeviceActive } = await import("@/lib/security");
    if (!(await isDeviceActive(payload.sid, payload.userId))) return null;
  }
  return payload;
}

export async function writeSession(session: Omit<RegisterSession, "v" | "exp">): Promise<void> {
  const jar = await cookies();
  const payload: RegisterSession = {
    v: 2,
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

export async function establishCompleteSession(input: {
  userId: string;
  challengeId: string;
}): Promise<void> {
  const ip = await clientIp();
  const userAgent = await clientUserAgent();
  const hdrs = await headers();
  const { approxFromRequest, createDeviceSessionForUser } = await import("@/lib/security");
  const { device } = await createDeviceSessionForUser({
    userId: input.userId,
    ip,
    userAgent,
    approx: approxFromRequest(hdrs, ip),
  });
  await writeSession({
    step: "complete",
    challengeId: input.challengeId,
    userId: input.userId,
    sid: device.id,
  });
}

export async function clearSession(): Promise<void> {
  const jar = await cookies();
  jar.delete(config.cookieName);
}
