import { NextResponse } from "next/server";
import { requireActiveUser } from "@/lib/auth";
import { jsonError, mergeHeaders } from "@/lib/http";
import { getVaultMedia } from "@/lib/storage";

type Ctx = { params: Promise<{ id: string }> };

export async function GET(request: Request, ctx: Ctx) {
  const user = await requireActiveUser();
  if (!user) return jsonError("نشست فعال نیست.", 401);
  const { id } = await ctx.params;
  const url = new URL(request.url);
  const token = url.searchParams.get("t") ?? "";
  const result = await getVaultMedia(user.id, id, token, {
    thumb: url.searchParams.get("thumb") === "1",
    range: request.headers.get("range"),
    link: url.searchParams.get("k") ?? undefined,
  });
  if (!result.ok) return jsonError(result.error, result.status);
  const headers = mergeHeaders({
    "Content-Type": result.mime,
    "X-Content-Type-Options": "nosniff",
    "Cache-Control": result.cacheControl,
    "Content-Disposition": result.disposition,
    ETag: result.etag,
    "Accept-Ranges": "bytes",
  });
  if (result.range) {
    headers.set("Content-Range", `bytes ${result.range.start}-${result.range.end}/${result.size}`);
    headers.set("Content-Length", String(result.bytes.length));
    return new NextResponse(new Uint8Array(result.bytes), { status: 206, headers });
  }
  headers.set("Content-Length", String(result.bytes.length));
  return new NextResponse(new Uint8Array(result.bytes), { status: 200, headers });
}
