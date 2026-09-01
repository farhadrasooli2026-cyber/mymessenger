import "server-only";

function requiredFallback(name: string, fallback: string): string {
  const value = process.env[name];
  if (value && value.length >= 16) return value;
  return fallback;
}

export const config = {
  pepper: requiredFallback(
    "NIXO_PEPPER",
    "nixo-dev-pepper-not-for-production-use",
  ),
  dataKeyHex: requiredFallback(
    "NIXO_DATA_KEY",
    "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef",
  ),
  sessionSecret: requiredFallback(
    "NIXO_SESSION_SECRET",
    "nixo-dev-session-secret-not-for-production",
  ),
  demoInbox: process.env.NIXO_DEMO_INBOX !== "false",
  stunUrl: process.env.NIXO_STUN_URL || "stun:stun.cloudflare.com:3478",
  turnUrl: process.env.NIXO_TURN_URL || "",
  turnUser: process.env.NIXO_TURN_USERNAME || "",
  turnCredential: process.env.NIXO_TURN_CREDENTIAL || "",
  turnSecret: process.env.NIXO_TURN_SECRET || "",
  callRegion: process.env.NIXO_CALL_REGION || "default",
  otp: {
    length: 6,
    ttlMs: 3 * 60 * 1000,
    resendCooldownMs: 45 * 1000,
    maxVerifyAttempts: 5,
    maxSendsPerIdentifier15m: 3,
    maxSendsPerIpHour: 8,
    maxVerifyPerIp15m: 25,
    identifierLockMs: 30 * 60 * 1000,
    exhaustedCyclesBeforeLock: 3,
  },
  human: {
    minElapsedMs: process.env.VITEST ? 0 : 1600,
    tokenTtlMs: 15 * 60 * 1000,
  },
  cookieName: "nixo_reg",
  adminCookie: "nixo_admin",
  staffCookie: "nixo_staff",
  adminKey: process.env.NIXO_ADMIN_KEY || "nixo-admin-dev",
  cookieMaxAgeSec: 7 * 24 * 60 * 60,
  deletionGraceMs: 14 * 24 * 60 * 60 * 1000,
  maxBackupBytes: 2_500_000,
  username: {
    minLen: 3,
    maxLen: 20,
    changeCooldownMs: process.env.VITEST ? 0 : 24 * 60 * 60 * 1000,
    maxChangesPer30d: 3,
    releaseHoldMs: process.env.VITEST ? 0 : 14 * 24 * 60 * 60 * 1000,
  },
} as const;
