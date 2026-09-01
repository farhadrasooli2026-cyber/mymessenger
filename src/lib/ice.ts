import "server-only";
import { createHmac } from "node:crypto";
import { config } from "@/lib/config";

export type IceServerPublic = {
  urls: string;
  username?: string;
  credential?: string;
};

const TURN_TTL_SEC = 10 * 60;

export function mintTurnCredential(userId: string) {
  const secret = config.turnSecret || config.turnCredential || config.sessionSecret;
  const expiry = Math.floor(Date.now() / 1000) + TURN_TTL_SEC;
  const username = `${expiry}:${userId.slice(0, 16)}`;
  const credential = createHmac("sha1", secret).update(username).digest("base64");
  return { username, credential, expiresAt: expiry * 1000 };
}

export function iceServersForSession(userId?: string) {
  const iceServers: IceServerPublic[] = [{ urls: config.stunUrl }];
  const turnUrl = config.turnUrl;
  const rest = Boolean(turnUrl && userId);
  const staticTurn = Boolean(turnUrl && config.turnUser && config.turnCredential);
  if (rest) {
    const cred = mintTurnCredential(userId!);
    iceServers.push({ urls: turnUrl, username: cred.username, credential: cred.credential });
  } else if (staticTurn) {
    iceServers.push({
      urls: turnUrl,
      username: config.turnUser,
      credential: config.turnCredential,
    });
  }
  return {
    iceServers,
    relay: rest || staticTurn,
    rest,
    region: config.callRegion,
    stunHost: (() => {
      try {
        return new URL(config.stunUrl.replace(/^stun:/, "http://")).host;
      } catch {
        return "stun";
      }
    })(),
    turnTtlSec: rest ? TURN_TTL_SEC : 0,
    note: rest
      ? "STUN + TURN با اعتبار زمان‌دار برای همین نشست. TURN استاتیک در کلاینت لو نمی‌رود."
      : staticTurn
        ? "STUN و TURN از تنظیم سرور؛ فقط برای نشست احرازشده."
        : "STUN عمومی. برای NAT سخت، NIXO_TURN_URL و NIXO_TURN_SECRET را روی سرور بگذار.",
  };
}

export function iceHealth() {
  return {
    stunConfigured: Boolean(config.stunUrl),
    turnConfigured: Boolean(config.turnUrl),
    turnRest: Boolean(config.turnUrl),
    region: config.callRegion,
    failover: "STUN عمومی اگر ICE اختصاصی در دسترس نباشد",
  };
}
