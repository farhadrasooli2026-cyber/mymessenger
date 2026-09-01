import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import {
  clientIpFromHeaders,
  contentLengthOk,
  IP_MAX_HITS,
  IP_WINDOW_MS,
  methodAllowed,
  mutatingContentTypeOk,
  originOkForMutation,
  sameOrigin,
} from "@/lib/safe-web";

const hits = new Map<string, number[]>();

function ipFlooded(ip: string, now = Date.now()): boolean {
  const prev = (hits.get(ip) ?? []).filter((t) => now - t < IP_WINDOW_MS);
  if (prev.length >= IP_MAX_HITS) {
    hits.set(ip, prev);
    return true;
  }
  prev.push(now);
  hits.set(ip, prev);
  if (hits.size > 20_000) {
    const first = hits.keys().next().value;
    if (first) hits.delete(first);
  }
  return false;
}

function securityExtras(request: NextRequest): Record<string, string> {
  const extra: Record<string, string> = {
    "X-Content-Type-Options": "nosniff",
    "X-Frame-Options": "DENY",
    "Referrer-Policy": "strict-origin-when-cross-origin",
    "Cross-Origin-Resource-Policy": "same-origin",
    "X-DNS-Prefetch-Control": "off",
  };
  const proto = request.headers.get("x-forwarded-proto");
  if (proto === "https") extra["Strict-Transport-Security"] = "max-age=15552000; includeSubDomains";
  extra["X-Request-Id"] = request.headers.get("x-request-id") || `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
  return extra;
}

export function middleware(request: NextRequest) {
  const extra = securityExtras(request);
  const origin = request.headers.get("origin");
  const cors: Record<string, string> = {
    Vary: "Origin",
    "Access-Control-Allow-Methods": "GET,POST,PUT,PATCH,DELETE,OPTIONS,HEAD",
    "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Request-Id, Idempotency-Key",
    ...extra,
  };
  if (origin && sameOrigin(request, origin)) {
    cors["Access-Control-Allow-Origin"] = origin;
    cors["Access-Control-Allow-Credentials"] = "true";
  }

  if (!methodAllowed(request.method)) {
    return new NextResponse(JSON.stringify({ ok: false, error: "روش HTTP مجاز نیست.", code: "method" }), {
      status: 405,
      headers: { ...cors, Allow: "GET,POST,PUT,PATCH,DELETE,OPTIONS,HEAD", "Content-Type": "application/json" },
    });
  }

  if (request.method === "OPTIONS") {
    return new NextResponse(null, { status: 204, headers: cors });
  }

  if (!mutatingContentTypeOk(request.headers, request.method)) {
    return new NextResponse(JSON.stringify({ ok: false, error: "نوع محتوا مجاز نیست.", code: "content_type" }), {
      status: 415,
      headers: { ...cors, "Content-Type": "application/json" },
    });
  }

  if (!contentLengthOk(request.headers)) {
    return new NextResponse(JSON.stringify({ ok: false, error: "حجم درخواست بیش از حد است.", code: "payload" }), {
      status: 413,
      headers: { ...cors, "Content-Type": "application/json" },
    });
  }

  if (!originOkForMutation(request, request.nextUrl.pathname)) {
    return new NextResponse(JSON.stringify({ ok: false, error: "Origin مجاز نیست.", code: "csrf" }), {
      status: 403,
      headers: { ...cors, "Content-Type": "application/json" },
    });
  }

  const ip = clientIpFromHeaders(request.headers);
  if (ipFlooded(ip)) {
    return new NextResponse(JSON.stringify({ ok: false, error: "تعداد درخواست بیش از حد است.", code: "rate" }), {
      status: 429,
      headers: { ...cors, "Content-Type": "application/json", "Retry-After": "60" },
    });
  }

  const res = NextResponse.next();
  for (const [k, v] of Object.entries(cors)) res.headers.set(k, v);
  return res;
}

export const config = {
  matcher: "/api/:path*",
};
