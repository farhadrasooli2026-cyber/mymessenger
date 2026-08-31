import { NextResponse } from "next/server";

export function json(data: unknown, status = 200, extraHeaders?: HeadersInit) {
  return NextResponse.json(data, { status, headers: extraHeaders });
}

export function jsonError(error: string, status = 400, extra?: Record<string, unknown>) {
  return NextResponse.json({ ok: false, error, ...extra }, { status });
}
