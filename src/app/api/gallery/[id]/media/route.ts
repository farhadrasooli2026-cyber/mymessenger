import { NextResponse } from "next/server";
import { requireActiveUser } from "@/lib/auth";
import { jsonError } from "@/lib/http";
import { getGalleryMedia } from "@/lib/gallery";

type Ctx = { params: Promise<{ id: string }> };

export async function GET(request: Request, ctx: Ctx) {
  const user = await requireActiveUser();
  if (!user) return jsonError("نشست فعال نیست.", 401);
  const { id } = await ctx.params;
  const token = new URL(request.url).searchParams.get("t") ?? "";
  const result = await getGalleryMedia(user.id, id, token);
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
