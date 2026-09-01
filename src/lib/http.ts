import { NextResponse } from "next/server";
import { API_VERSION, statusToCode } from "@/lib/api-types";

export const SECURITY_HEADERS: Record<string, string> = {
  "X-Content-Type-Options": "nosniff",
  "X-Frame-Options": "DENY",
  "Referrer-Policy": "strict-origin-when-cross-origin",
  "X-API-Version": API_VERSION,
  "Cache-Control": "private, no-store",
  "Permissions-Policy": "camera=(self), microphone=(self), geolocation=(), payment=()",
  "Cross-Origin-Opener-Policy": "same-origin",
  "Content-Security-Policy":
    "default-src 'self'; script-src 'self' 'unsafe-inline' 'unsafe-eval'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; font-src 'self' data:; connect-src 'self'; frame-ancestors 'none'; base-uri 'self'; form-action 'self'",
};

export function mergeHeaders(extra?: HeadersInit, correlationId?: string): Headers {
  const h = new Headers(SECURITY_HEADERS);
  if (correlationId) h.set("x-request-id", correlationId);
  if (extra) {
    const more = new Headers(extra);
    more.forEach((v, k) => h.set(k, v));
  }
  return h;
}

export function json(data: unknown, status = 200, extraHeaders?: HeadersInit) {
  return NextResponse.json(data, { status, headers: mergeHeaders(extraHeaders) });
}

export function jsonError(error: string, status = 400, extra?: Record<string, unknown>) {
  const rest = { ...(extra ?? {}) };
  const code = typeof rest.code === "string" ? rest.code : statusToCode(status);
  delete rest.code;
  return NextResponse.json({ ok: false, error, code, ...rest }, { status, headers: mergeHeaders() });
}
