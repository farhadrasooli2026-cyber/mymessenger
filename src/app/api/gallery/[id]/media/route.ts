import { NextResponse } from "next/server";
import { requireActiveUser } from "@/lib/auth";
import { jsonError, mergeHeaders } from "@/lib/http";
import { getGalleryMedia } from "@/lib/gallery";
import { parseByteRange } from "@/lib/storage";

type Ctx = { params: Promise<{ id: string }> };

export async function GET(request: Request, ctx: Ctx) {
  const user = await requireActiveUser();
  if (!user) return jsonError("نشست فعال نیست.", 401);
  const { id } = await ctx.params;
  const token = new URL(request.url).searchParams.get("t") ?? "";
  const result = await getGalleryMedia(user.id, id, token);
  if (!result.ok) return jsonError(result.error, result.status);
  const size = result.bytes.length;
  const range = parseByteRange(request.headers.get("range"), size);
  const slice = range ? result.bytes.subarray(range.start, range.end + 1) : result.bytes;
  const headers = mergeHeaders({
    "Content-Type": result.mime,
    "Cache-Control": "private, no-store",
    "X-Content-Type-Options": "nosniff",
    "Accept-Ranges": "bytes",
    "Content-Length": String(slice.length),
  });
  if (range) {
    headers.set("Content-Range", `bytes ${range.start}-${range.end}/${size}`);
    return new NextResponse(new Uint8Array(slice), { status: 206, headers });
  }
  return new NextResponse(new Uint8Array(slice), { status: 200, headers });
}
