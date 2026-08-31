import { NextResponse } from "next/server";
import { requireActiveUser } from "@/lib/auth";
import { jsonError } from "@/lib/http";
import { getCatalogFile, getMusicFile } from "@/lib/music";

export async function GET(request: Request) {
  const user = await requireActiveUser();
  if (!user) return jsonError("نشست فعال نیست.", 401);
  const url = new URL(request.url);
  const catalog = url.searchParams.get("catalog");
  if (catalog) {
    const result = await getCatalogFile(user.id, catalog);
    if (!result.ok) return jsonError(result.error, result.status);
    return new NextResponse(new Uint8Array(result.bytes), {
      status: 200,
      headers: {
        "Content-Type": result.mime,
        "Cache-Control": "private, max-age=120",
        "X-Content-Type-Options": "nosniff",
      },
    });
  }
  const id = url.searchParams.get("id") ?? "";
  const token = url.searchParams.get("t") ?? "";
  const result = await getMusicFile(user.id, id, token);
  if (!result.ok) return jsonError(result.error, result.status);
  return new NextResponse(new Uint8Array(result.bytes), {
    status: 200,
    headers: {
      "Content-Type": result.mime,
      "Cache-Control": "private, no-store",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
