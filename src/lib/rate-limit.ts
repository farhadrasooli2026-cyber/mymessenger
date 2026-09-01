import "server-only";
import { config } from "@/lib/config";
import type { RateBucket, StoreData } from "@/lib/store";
import { adaptiveRateFactor } from "@/lib/perf-mode";

export function hitRateLimit(
  data: StoreData,
  key: string,
  windowMs: number,
  maxHits: number,
  now = Date.now(),
): { allowed: boolean; retryAfterSec: number; remaining: number } {
  const protect = key.startsWith("send:") || key.startsWith("verify:") || key.startsWith("admin-login") || key.startsWith("human:");
  const cap = protect ? maxHits : Math.max(2, Math.floor(maxHits * adaptiveRateFactor()));
  let bucket = data.rateBuckets.find((b) => b.key === key);
  if (!bucket) {
    bucket = { key, hits: [], blockedUntil: null };
    data.rateBuckets.push(bucket);
  }

  if (bucket.blockedUntil && bucket.blockedUntil > now) {
    return {
      allowed: false,
      retryAfterSec: Math.ceil((bucket.blockedUntil - now) / 1000),
      remaining: 0,
    };
  }

  bucket.hits = bucket.hits.filter((t) => now - t < windowMs);
  if (bucket.hits.length >= cap) {
    bucket.blockedUntil = now + windowMs;
    return {
      allowed: false,
      retryAfterSec: Math.ceil(windowMs / 1000),
      remaining: 0,
    };
  }

  bucket.hits.push(now);
  return {
    allowed: true,
    retryAfterSec: 0,
    remaining: Math.max(0, cap - bucket.hits.length),
  };
}

export function sendLimits(data: StoreData, identifierHash: string, ipHash: string, now = Date.now()) {
  const idLimit = hitRateLimit(
    data,
    `send:id:${identifierHash}`,
    15 * 60 * 1000,
    config.otp.maxSendsPerIdentifier15m,
    now,
  );
  if (!idLimit.allowed) return { ok: false as const, retryAfterSec: idLimit.retryAfterSec, scope: "identifier" };

  const ipLimit = hitRateLimit(
    data,
    `send:ip:${ipHash}`,
    60 * 60 * 1000,
    config.otp.maxSendsPerIpHour,
    now,
  );
  if (!ipLimit.allowed) return { ok: false as const, retryAfterSec: ipLimit.retryAfterSec, scope: "ip" };

  return { ok: true as const, retryAfterSec: 0 };
}

export function verifyIpLimit(data: StoreData, ipHash: string, now = Date.now()) {
  return hitRateLimit(
    data,
    `verify:ip:${ipHash}`,
    15 * 60 * 1000,
    config.otp.maxVerifyPerIp15m,
    now,
  );
}

export function isIdentifierLocked(data: StoreData, identifierHash: string, now = Date.now()): boolean {
  const row = data.failedCycles.find((f) => f.identifierHash === identifierHash);
  if (!row) return false;
  if (row.count < config.otp.exhaustedCyclesBeforeLock) return false;
  return now - row.lastAt < config.otp.identifierLockMs;
}

export function recordExhaustedCycle(data: StoreData, identifierHash: string, now = Date.now()): void {
  const row = data.failedCycles.find((f) => f.identifierHash === identifierHash);
  if (row) {
    row.count += 1;
    row.lastAt = now;
    return;
  }
  data.failedCycles.push({ identifierHash, count: 1, lastAt: now });
}

export function clearFailedCycles(data: StoreData, identifierHash: string): void {
  data.failedCycles = data.failedCycles.filter((f) => f.identifierHash !== identifierHash);
}

export function bucketSummary(bucket: RateBucket | undefined, now = Date.now()): number {
  if (!bucket) return 0;
  return bucket.hits.filter((t) => now - t < 60 * 60 * 1000).length;
}
