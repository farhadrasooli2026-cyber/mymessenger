/** Edge/CDN policy. No secrets, signed tokens, or private file bytes. */

export const EDGE_POPS = ["fra", "lhr", "iad", "sin", "gru"] as const;
export type EdgePopId = (typeof EDGE_POPS)[number];

export const PATH_CLASSES = ["static", "public-short", "api-private", "media-private", "signed", "auth", "search", "ai", "pay"] as const;
export type PathClass = (typeof PATH_CLASSES)[number];

export const PERF_BUDGET = {
  pageJsKb: 450,
  apiP95Ms: 450,
  lcpMs: 2800,
  assetKb: 250,
} as const;

export const SIGNED_URL_TTL_SEC = 120;

export type EdgePop = {
  id: EdgePopId;
  region: string;
  residency: "eu" | "us" | "apac" | "sa";
  healthy: boolean;
  rttMs: number;
  capacityPct: number;
  wsGateways: number;
  turn: boolean;
};

export function defaultPops(): EdgePop[] {
  return [
    { id: "fra", region: "eu-central", residency: "eu", healthy: true, rttMs: 18, capacityPct: 42, wsGateways: 2, turn: true },
    { id: "lhr", region: "eu-west", residency: "eu", healthy: true, rttMs: 24, capacityPct: 38, wsGateways: 2, turn: true },
    { id: "iad", region: "us-east", residency: "us", healthy: true, rttMs: 72, capacityPct: 35, wsGateways: 2, turn: true },
    { id: "sin", region: "ap-south", residency: "apac", healthy: true, rttMs: 140, capacityPct: 28, wsGateways: 1, turn: true },
    { id: "gru", region: "sa-east", residency: "sa", healthy: true, rttMs: 180, capacityPct: 22, wsGateways: 1, turn: false },
  ];
}

export function classifyPath(pathname: string): PathClass {
  const p = pathname.toLowerCase();
  if (p.startsWith("/_next/static") || p.startsWith("/icons/") || p.startsWith("/favicon") || p.endsWith(".woff2")) return "static";
  if (p.startsWith("/api/media/catalog") || p.startsWith("/api/media/bg-catalog") || p === "/api/status" || p === "/api/health") return "public-short";
  if (p.startsWith("/api/register") || p.startsWith("/api/security") || p.includes("/login")) return "auth";
  if (p.startsWith("/api/search")) return "search";
  if (p.startsWith("/api/ai")) return "ai";
  if (p.startsWith("/api/billing") || p.startsWith("/api/shop")) return "pay";
  if (p.includes("/media") || p.startsWith("/api/storage") || p.startsWith("/api/gallery") || p.startsWith("/api/stories")) return "media-private";
  if (p.startsWith("/api/")) return "api-private";
  return "public-short";
}

export function cacheControlFor(kind: PathClass, generation = 1): string {
  if (kind === "static") return "public, max-age=31536000, immutable";
  if (kind === "public-short") return `public, max-age=60, s-maxage=60, stale-while-revalidate=30, x-nixo-gen=${generation}`;
  return "private, no-store";
}

export function sharedCacheAllowed(input: { path: string; cookie?: string | null; authorization?: string | null; search?: string }): boolean {
  const kind = classifyPath(input.path);
  if (kind !== "static" && kind !== "public-short") return false;
  if (input.cookie && /nixo_|session|sid=/i.test(input.cookie) && kind !== "static") return false;
  if (input.authorization) return false;
  const q = input.search ?? "";
  if (/[?&](t|k|token|sig)=/i.test(q)) return false;
  return true;
}

export function publicCacheKey(host: string, path: string, search = ""): string | null {
  if (!sharedCacheAllowed({ path, search })) return null;
  const q = search.replace(/[?&](t|k|token|sig)=[^&]*/gi, "").replace(/^&/, "?");
  return `${host}${path}${q.startsWith("?") || !q ? q : ""}`;
}

export function hostAllowed(host: string, allow: string[]): boolean {
  const h = host.split(":")[0]?.toLowerCase() ?? "";
  if (!h || h === "localhost" || h === "127.0.0.1") return true;
  return allow.some((a) => a.toLowerCase() === h);
}

export function isOpenRedirect(target: string) {
  if (!target) return false;
  if (target.startsWith("/") && !target.startsWith("//")) return false;
  return /^https?:/i.test(target) || target.startsWith("//") || target.includes("\\");
}

export function signedExpired(expiresAt: number, now = Date.now()) {
  return expiresAt < now;
}

export function pickImageFormat(accept: string): "avif" | "webp" | "jpeg" {
  const a = accept.toLowerCase();
  if (a.includes("image/avif")) return "avif";
  if (a.includes("image/webp")) return "webp";
  return "jpeg";
}

export function percentile(values: number[], p: number) {
  if (!values.length) return 0;
  const s = [...values].sort((a, b) => a - b);
  const i = Math.min(s.length - 1, Math.max(0, Math.ceil((p / 100) * s.length) - 1));
  return s[i] ?? 0;
}

export function routeToPop(
  pops: EdgePop[],
  opts: { country?: string; residency?: EdgePop["residency"]; latency?: boolean },
): EdgePop | null {
  const healthy = pops.filter((p) => p.healthy && p.capacityPct < 92);
  const pool = healthy.length ? healthy : pops.filter((p) => p.healthy);
  if (!pool.length) return null;
  const geo =
    opts.country === "DE" || opts.country === "IR" || opts.residency === "eu"
      ? pool.filter((p) => p.residency === "eu")
      : opts.residency
        ? pool.filter((p) => p.residency === opts.residency)
        : pool;
  const candidates = geo.length ? geo : pool;
  if (opts.latency !== false) {
    candidates.sort((a, b) => a.rttMs - b.rttMs || a.capacityPct - b.capacityPct);
  }
  return candidates[0] ?? null;
}

export function wsGatewayFor(pop: EdgePop | null, stickyKey: string) {
  if (!pop || pop.wsGateways < 1) return null;
  let h = 0;
  for (let i = 0; i < stickyKey.length; i += 1) h = (h * 31 + stickyKey.charCodeAt(i)) | 0;
  const idx = Math.abs(h) % pop.wsGateways;
  return `${pop.id}-gw-${idx}`;
}
