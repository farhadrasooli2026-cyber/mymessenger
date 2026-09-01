/** Edge-safe web security helpers. No Node APIs, no secrets. */

export const MAX_API_BODY_BYTES = 32 * 1024 * 1024;
export const IP_WINDOW_MS = 60_000;
export const IP_MAX_HITS = 300;

const CSRF_EXEMPT = ["/api/health", "/api/status", "/api/version", "/api/docs", "/api/shop/webhook", "/api/billing/webhook", "/api/bot/v1"];

export function clientIpFromHeaders(headers: Headers): string {
  const forwarded = headers.get("x-forwarded-for");
  if (forwarded) return forwarded.split(",")[0]?.trim() || "0.0.0.0";
  return headers.get("x-real-ip")?.trim() || "0.0.0.0";
}

export function sameOrigin(request: { headers: Headers; nextUrl?: { host: string } }, origin: string): boolean {
  const host = request.headers.get("host") || request.nextUrl?.host;
  if (!host) return false;
  try {
    const originHost = new URL(origin).host;
    if (originHost === host) return true;
    const extra = (process.env.NIXO_PUBLIC_HOST || "").trim();
    return Boolean(extra) && originHost === extra;
  } catch {
    return false;
  }
}

export function isCsrfExemptPath(pathname: string): boolean {
  return CSRF_EXEMPT.some((p) => pathname === p || pathname.startsWith(`${p}/`));
}

export function isMutatingMethod(method: string): boolean {
  return method === "POST" || method === "PUT" || method === "PATCH" || method === "DELETE";
}

export function methodAllowed(method: string): boolean {
  return ["GET", "HEAD", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"].includes(method);
}

export function originOkForMutation(request: { headers: Headers; nextUrl?: { host: string }; method: string; nextUrlPath?: string }, pathname: string): boolean {
  if (!isMutatingMethod(request.method) || isCsrfExemptPath(pathname)) return true;
  const origin = request.headers.get("origin");
  if (!origin) return true;
  return sameOrigin(request, origin);
}

export function contentLengthOk(headers: Headers, max = MAX_API_BODY_BYTES): boolean {
  const raw = headers.get("content-length");
  if (!raw) return true;
  const n = Number(raw);
  if (!Number.isFinite(n) || n < 0) return false;
  return n <= max;
}

export function mutatingContentTypeOk(headers: Headers, method: string): boolean {
  if (!isMutatingMethod(method)) return true;
  const ct = (headers.get("content-type") || "").toLowerCase();
  if (!ct) return true;
  return (
    ct.includes("application/json") ||
    ct.includes("multipart/form-data") ||
    ct.includes("application/octet-stream") ||
    ct.includes("application/x-www-form-urlencoded") ||
    ct.includes("text/plain")
  );
}

export function timestampFresh(ts: unknown, skewMs = 5 * 60_000, now = Date.now()): boolean {
  if (typeof ts !== "number" || !Number.isFinite(ts)) return false;
  return Math.abs(now - ts) <= skewMs;
}

export function safeRedirectPath(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const s = raw.trim();
  if (!s.startsWith("/") || s.startsWith("//") || s.includes("\\") || s.includes("://")) return null;
  if (/[\u0000-\u001f]/.test(s)) return null;
  if (/javascript:/i.test(s) || /data:/i.test(s) || /vbscript:/i.test(s)) return null;
  return s.slice(0, 240);
}

const SENSITIVE_KEY =
  /^(password|passwordhash|passwordsalt|currentpassword|newpassword|totpsecretcipher|totppendingcipher|identifiercipher|codehash|pepper|sessionsecret|refreshhash|refreshsalt|privatekey|apikey|authorization|cookie|nixopepper|datakeyhex|mediasecret|mediatokenhash)$/i;

export function stripSensitive(value: unknown, depth = 0): unknown {
  if (depth > 8 || value == null) return value;
  if (Array.isArray(value)) return value.map((v) => stripSensitive(v, depth + 1));
  if (typeof value !== "object") return value;
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
    if (SENSITIVE_KEY.test(k)) continue;
    out[k] = stripSensitive(v, depth + 1);
  }
  return out;
}

export function redactLogText(text: string): string {
  return text
    .replace(/(password|token|secret|authorization|cookie)\s*[:=]\s*["']?[^"'&\s]+/gi, "$1=[redacted]")
    .replace(/nixo_reg=[^;\s]+/gi, "nixo_reg=[redacted]")
    .slice(0, 2000);
}

export function progressiveBackoffMs(failCount: number): number {
  const n = Math.max(0, Math.min(12, failCount));
  return Math.min(30_000, 400 * 2 ** n);
}

export function isPrivateHost(host: string): boolean {
  const h = host.toLowerCase().replace(/\.+$/, "");
  if (h === "localhost" || h === "metadata.google.internal" || h.endsWith(".local")) return true;
  if (h === "::1" || h.startsWith("127.") || h.startsWith("0.")) return true;
  if (h.startsWith("10.") || h.startsWith("192.168.") || h.startsWith("169.254.")) return true;
  const m = /^172\.(\d{1,3})\./.exec(h);
  if (m) {
    const n = Number(m[1]);
    if (n >= 16 && n <= 31) return true;
  }
  return false;
}

export function countryFromApprox(approx: string): string | null {
  const m = /کشور تقریبی:\s*([A-Z]{2})\b/.exec(approx);
  return m?.[1] ?? null;
}

export function impossibleTravel(prev: { country: string | null; at: number }, next: { country: string | null; at: number }): boolean {
  if (!prev.country || !next.country || prev.country === next.country) return false;
  return Math.abs(next.at - prev.at) < 2 * 60 * 60_000;
}
