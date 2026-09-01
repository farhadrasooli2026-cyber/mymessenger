/** Edge-safe shed/circuit flags. No secrets, no store. */

import type { ShedLevel } from "@/lib/perf-types";
import { CORE_API_PREFIXES, CRITICAL_API_PREFIXES, SOFT_SHED_PREFIXES } from "@/lib/perf-types";

let shed: ShedLevel = "off";
let rateFactor = 1;

export function currentShed(): ShedLevel {
  return shed;
}

export function setShedLevel(next: ShedLevel) {
  shed = next;
  rateFactor = next === "hard" ? 0.25 : next === "soft" ? 0.5 : 1;
}

export function adaptiveRateFactor() {
  return rateFactor;
}

export function adaptiveIpMax(base: number) {
  return Math.max(40, Math.floor(base * rateFactor));
}

function matches(path: string, prefixes: readonly string[]) {
  return prefixes.some((p) => path === p || path.startsWith(`${p}/`));
}

export function isCriticalApiPath(pathname: string) {
  return matches(pathname, CRITICAL_API_PREFIXES);
}

export function isCoreApiPath(pathname: string) {
  return matches(pathname, CORE_API_PREFIXES);
}

export function shouldShedRequest(pathname: string): ShedLevel | null {
  if (shed === "off") return null;
  if (isCriticalApiPath(pathname)) return null;
  if (pathname.includes("/discover") || pathname.includes("/trending")) return shed;
  if (shed === "hard" && !isCoreApiPath(pathname)) return "hard";
  if ((shed === "soft" || shed === "hard") && matches(pathname, SOFT_SHED_PREFIXES)) return shed;
  return null;
}
