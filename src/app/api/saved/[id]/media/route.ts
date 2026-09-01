import { requireActiveUser } from "@/lib/auth";
import { jsonError } from "@/lib/http";
import { readSavedMedia, verifySavedMedia } from "@/lib/saved";

type Ctx = { params: Promise<{ id: string }> };

export async function GET(request: Request, ctx: Ctx) {
  const user = await requireActiveUser();
  if (!user) return jsonError("نشست فعال نیست.", 401);
  const { id } = await ctx.params;
  const token = new URL(request.url).searchParams.get("t") ?? "";
  if (!verifySavedMedia(id, user.id, token)) return jsonError("لینک منقضی یا نامعتبر است.", 403);
  const media = await readSavedMedia(user.id, id);
  if (!media) return jsonError("یافت نشد.", 404);
  if (media.startsWith("data:")) {
    const comma = media.indexOf(",");
    const meta = media.slice(5, comma);
    const body = media.slice(comma + 1);
    const mime = meta.split(";")[0] || "application/octet-stream";
    const buf = Buffer.from(body, meta.includes("base64") ? "base64" : "utf8");
    return new Response(buf, {
      headers: { "Content-Type": mime, "Cache-Control": "private, no-store" },
    });
  }
  return new Response(media, {
    headers: { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "private, no-store" },
  });
}
