import { cookies, headers } from "next/headers";
import { config } from "@/lib/config";
import { hashIp, signPayload, verifyPayload } from "@/lib/crypto-utils";

export type RegisterStep = "verify" | "profile" | "complete" | "twostep" | "device" | "recover";

export type RegisterSession = {
  v: 1 | 2;
  step: RegisterStep;
  challengeId: string;
  userId?: string;
  sid?: string;
  purpose?: "login" | "recovery";
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
    const { sessionDeviceStatus } = await import("@/lib/security");
    const status = await sessionDeviceStatus(payload.sid, payload.userId);
    if (!status.ok) return null;
    if (payload.step === "complete" && (status.pending || !status.trusted)) return null;
  }
  return payload;
}

export const SESSION_COOKIE_POLICY = {
  httpOnly: true as const,
  sameSite: "lax" as const,
  secure: process.env.NODE_ENV === "production",
  path: "/",
};

export async function writeSession(session: Omit<RegisterSession, "v" | "exp">): Promise<void> {
  const jar = await cookies();
  const payload: RegisterSession = {
    v: 2,
    ...session,
    exp: Date.now() + config.cookieMaxAgeSec * 1000,
  };
  jar.set(config.cookieName, signPayload(payload), {
    ...SESSION_COOKIE_POLICY,
    maxAge: config.cookieMaxAgeSec,
  });
}

export async function establishCompleteSession(input: {
  userId: string;
  challengeId: string;
  recovery?: boolean;
}): Promise<{ pending: boolean; deviceId: string }> {
  const ip = await clientIp();
  const userAgent = await clientUserAgent();
  const hdrs = await headers();
  const { approxFromRequest, createDeviceSessionForUser, revokeAllOtherDevices } = await import("@/lib/security");
  const { device, pending } = await createDeviceSessionForUser({
    userId: input.userId,
    ip,
    userAgent,
    approx: approxFromRequest(hdrs, ip),
    recovery: input.recovery,
  });
  if (input.recovery) {
    await revokeAllOtherDevices(input.userId, device.id, ip);
  }
  await writeSession({
    step: pending ? "device" : "complete",
    challengeId: input.challengeId,
    userId: input.userId,
    sid: device.id,
    purpose: input.recovery ? "recovery" : "login",
  });
  return { pending, deviceId: device.id };
}

export async function clearSession(): Promise<void> {
  const jar = await cookies();
  jar.delete(config.cookieName);
}
