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
  cookieMaxAgeSec: 7 * 24 * 60 * 60,
} as const;
