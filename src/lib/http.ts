import { NextResponse } from "next/server";
import { API_VERSION, statusToCode } from "@/lib/api-types";
import { APP_VERSION, deployedGitSha } from "@/lib/release";
import { stripSensitive } from "@/lib/safe-web";

export const SECURITY_HEADERS: Record<string, string> = {
  "X-Content-Type-Options": "nosniff",
  "X-Frame-Options": "DENY",
  "Referrer-Policy": "strict-origin-when-cross-origin",
  "X-API-Version": API_VERSION,
  "X-NIXO-App-Version": APP_VERSION,
  "Cache-Control": "private, no-store",
  "Permissions-Policy": "camera=(self), microphone=(self), geolocation=(), payment=()",
  "Cross-Origin-Resource-Policy": "same-origin",
  "X-DNS-Prefetch-Control": "off",
  "Content-Security-Policy":
    "default-src 'self'; script-src 'self' 'unsafe-inline' 'unsafe-eval'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; font-src 'self' data:; connect-src 'self'; frame-ancestors 'none'; base-uri 'self'; form-action 'self'",
};

export function mergeHeaders(extra?: HeadersInit, correlationId?: string): Headers {
  const h = new Headers(SECURITY_HEADERS);
  const sha = deployedGitSha();
  if (sha) h.set("X-NIXO-Git-Sha", sha);
  if (correlationId) h.set("x-request-id", correlationId);
  if (extra) {
    const more = new Headers(extra);
    more.forEach((v, k) => h.set(k, v));
  }
  return h;
}

const MAX_JSON_RESPONSE_CHARS = 4_000_000;

function observeStatus(status: number) {
  if (process.env.VITEST) return;
  void import("@/lib/monitor")
    .then((m) => m.observeHttp(status))
    .catch(() => undefined);
}

export function json(data: unknown, status = 200, extraHeaders?: HeadersInit) {
  const body = stripSensitive(data);
  try {
    const encoded = JSON.stringify(body);
    if (encoded.length > MAX_JSON_RESPONSE_CHARS) {
      return jsonError("پاسخ بیش از حد بزرگ است.", 413, { code: "response_too_large" });
    }
  } catch {
    return jsonError("پاسخ قابل ارسال نیست.", 500);
  }
  observeStatus(status);
  return NextResponse.json(body, { status, headers: mergeHeaders(extraHeaders) });
}

export function jsonError(error: string, status = 400, extra?: Record<string, unknown>) {
  const rest = { ...(extra ?? {}) };
  const code = typeof rest.code === "string" ? rest.code : statusToCode(status);
  delete rest.code;
  delete rest.stack;
  delete rest.password;
  const message = error.replace(/\n[\s\S]*$/g, "").slice(0, 280);
  observeStatus(status);
  return NextResponse.json(stripSensitive({ ok: false, error: message, code, ...rest }), { status, headers: mergeHeaders() });
}
