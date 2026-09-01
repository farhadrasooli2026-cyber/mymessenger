import { NextResponse } from "next/server";
import { requireActiveUser } from "@/lib/auth";
import { jsonError } from "@/lib/http";
import { getStoryMedia } from "@/lib/stories";

type Ctx = { params: Promise<{ id: string }> };

export async function GET(request: Request, ctx: Ctx) {
  const user = await requireActiveUser();
  if (!user) return jsonError("نشست فعال نیست.", 401);
  const { id } = await ctx.params;
  const token = new URL(request.url).searchParams.get("t") ?? "";
  const thumb = new URL(request.url).searchParams.get("thumb") === "1";
  const result = await getStoryMedia(user.id, id, token, thumb);
  if (!result.ok) return jsonError(result.error, result.status);
  const match = result.media.match(/^data:([^;]+);base64,(.+)$/);
  if (!match) return jsonError("رسانه نامعتبر است.", 400);
  const bytes = Buffer.from(match[2]!, "base64");
  return new NextResponse(bytes, {
    status: 200,
    headers: {
      "Content-Type": match[1] || "application/octet-stream",
      "Cache-Control": "private, no-store",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
