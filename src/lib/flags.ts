import type { FeatureFlagRow, FlagSegment } from "@/lib/deploy-types";

function bucket(userId: string, key: string) {
  let h = 2166136261;
  const s = `${userId}:${key}`;
  for (let i = 0; i < s.length; i += 1) h ^= s.charCodeAt(i), (h = Math.imul(h, 16777619));
  return Math.abs(h) % 100;
}

/** Missing flag = leave existing product behavior on. Kill never grants access. */
export function flagAllows(
  flags: FeatureFlagRow[] | undefined,
  key: string,
  ctx: { userId?: string | null; staff?: boolean },
): boolean {
  const flag = (flags ?? []).find((f) => f.key === key);
  if (!flag) return true;
  if (flag.kill) return false;
  if (!flag.enabled) return false;
  if (flag.segment === "staff") return Boolean(ctx.staff);
  if (flag.segment === "all" || flag.percent >= 100) return true;
  if (flag.percent <= 0) return false;
  if (!ctx.userId) return false;
  return bucket(ctx.userId, key) < flag.percent;
}

export function publicFlagView(flag: FeatureFlagRow) {
  return {
    key: flag.key,
    enabled: flag.enabled && !flag.kill,
    percent: flag.percent,
    segment: flag.segment as FlagSegment,
    kill: flag.kill,
  };
}
