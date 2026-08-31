import { json, jsonError } from "@/lib/http";
import { requireActiveUser } from "@/lib/auth";
import { deletePost, publishPost } from "@/lib/communities";

type Ctx = { params: Promise<{ id: string }> };

export async function POST(request: Request, ctx: Ctx) {
  const user = await requireActiveUser();
  if (!user) return jsonError("نشست فعال نیست.", 401);
  const { id } = await ctx.params;
  const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
  if (!body) return jsonError("درخواست نامعتبر است.");
  if (body.action === "delete") {
    const result = await deletePost(user.id, id, String(body.postId ?? ""));
    if (!result.ok) return jsonError(result.error, result.status);
    return json({ ok: true, community: result.community });
  }
  const result = await publishPost(user.id, id, String(body.channelId ?? ""), {
    body: String(body.body ?? ""),
    kind:
      body.kind === "photo" || body.kind === "video" || body.kind === "file" || body.kind === "link"
        ? body.kind
        : "text",
  });
  if (!result.ok) return jsonError(result.error, result.status);
  return json({ ok: true, community: result.community });
}
