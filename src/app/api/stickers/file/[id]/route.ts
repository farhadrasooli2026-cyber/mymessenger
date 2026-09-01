import { NextResponse } from "next/server";
import { jsonError } from "@/lib/http";
import { requireActiveUser } from "@/lib/auth";
import { getStickerFile } from "@/lib/stickers";

type Ctx = { params: Promise<{ id: string }> };

export async function GET(request: Request, ctx: Ctx) {
  const user = await requireActiveUser();
  if (!user) return jsonError("نشست فعال نیست.", 401);
  const { id } = await ctx.params;
  const token = new URL(request.url).searchParams.get("t") ?? "";
  const item = await getStickerFile(user.id, id, token);
  if (!item) return jsonError("فایل در دسترس نیست.", 404);
  if (item.payload.startsWith("data:")) {
    const m = /^data:([^;]+);base64,(.+)$/.exec(item.payload);
    if (m) {
        const buf = Buffer.from(m[2]!, "base64");
        return new NextResponse(new Uint8Array(buf), {
        headers: {
          "Content-Type": m[1]!,
          "Cache-Control": "private, max-age=60",
          "X-Content-Type-Options": "nosniff",
        },
      });
    }
    const utf = item.payload.replace(/^data:[^,]+,/, "");
    return new NextResponse(decodeURIComponent(utf), {
      headers: {
        "Content-Type": item.mime || "image/svg+xml",
        "Cache-Control": "private, max-age=60",
        "Content-Security-Policy": "default-src 'none'; img-src 'self' data:",
        "X-Content-Type-Options": "nosniff",
      },
    });
  }
  return jsonError("بارگذاری نامعتبر است.", 400);
}
