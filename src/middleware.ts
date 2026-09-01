import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

function originAllowed(request: NextRequest, origin: string) {
  const host = request.headers.get("host");
  if (!host) return false;
  try {
    return new URL(origin).host === host;
  } catch {
    return false;
  }
}

export function middleware(request: NextRequest) {
  const origin = request.headers.get("origin");
  const cors: Record<string, string> = {
    Vary: "Origin",
    "Access-Control-Allow-Methods": "GET,POST,PUT,PATCH,DELETE,OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
  };
  if (origin && originAllowed(request, origin)) {
    cors["Access-Control-Allow-Origin"] = origin;
    cors["Access-Control-Allow-Credentials"] = "true";
  }
  if (request.method === "OPTIONS") {
    return new NextResponse(null, { status: 204, headers: cors });
  }
  const res = NextResponse.next();
  for (const [k, v] of Object.entries(cors)) res.headers.set(k, v);
  return res;
}

export const config = {
  matcher: "/api/:path*",
};
