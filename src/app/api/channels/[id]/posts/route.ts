import { json, jsonError } from "@/lib/http";
import { requireActiveUser } from "@/lib/auth";
import { commentPost, createPost, deleteComment, deletePost, editPost, pinPost, reactPost, recordForward, recordPostView, votePoll, cancelScheduledPost, repostPost } from "@/lib/channels";

type Ctx = { params: Promise<{ id: string }> };

export async function POST(request: Request, ctx: Ctx) {
  const user = await requireActiveUser();
  if (!user) return jsonError("نشست فعال نیست.", 401);
  const { id } = await ctx.params;
  const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
  if (!body) return jsonError("درخواست نامعتبر است.");
  if (body.action === "edit") {
    const result = await editPost(user.id, id, String(body.postId ?? ""), {
      body: typeof body.body === "string" ? body.body : undefined,
      caption: typeof body.caption === "string" ? body.caption : undefined,
    });
    if (!result.ok) return jsonError(result.error, result.status);
    return json({ ok: true, post: result.post });
  }
  if (body.action === "delete") {
    const result = await deletePost(user.id, id, String(body.postId ?? ""));
    if (!result.ok) return jsonError(result.error, result.status);
    return json({ ok: true });
  }
  if (body.action === "pin" || body.action === "unpin") {
    const result = await pinPost(user.id, id, String(body.postId ?? ""), body.action === "pin");
    if (!result.ok) return jsonError(result.error, result.status);
    return json({ ok: true, pinIds: result.pinIds });
  }
  if (body.action === "react") {
    const result = await reactPost(user.id, id, String(body.postId ?? ""), String(body.emoji ?? "❤️"));
    if (!result.ok) return jsonError(result.error, result.status);
    return json({ ok: true, reactions: result.reactions });
  }
  if (body.action === "comment") {
    const result = await commentPost(user.id, id, String(body.postId ?? ""), String(body.body ?? ""), typeof body.parentId === "string" ? body.parentId : null);
    if (!result.ok) return jsonError(result.error, result.status);
    return json({ ok: true, comments: result.comments });
  }
  if (body.action === "cancel-schedule") {
    const result = await cancelScheduledPost(user.id, id, String(body.postId ?? ""));
    if (!result.ok) return jsonError(result.error, result.status);
    return json({ ok: true, post: result.post });
  }
  if (body.action === "repost") {
    const result = await repostPost(user.id, id, String(body.sourcePostId ?? body.postId ?? ""));
    if (!result.ok) return jsonError(result.error, result.status);
    return json({ ok: true, post: result.post, channel: result.channel });
  }
  if (body.action === "deleteComment") {
    const result = await deleteComment(user.id, id, String(body.postId ?? ""), String(body.commentId ?? ""));
    if (!result.ok) return jsonError(result.error, result.status);
    return json({ ok: true });
  }
  if (body.action === "vote") {
    const indexes = Array.isArray(body.indexes) ? body.indexes.map(Number) : [];
    const result = await votePoll(user.id, id, String(body.postId ?? ""), indexes);
    if (!result.ok) return jsonError(result.error, result.status);
    return json({ ok: true, poll: result.poll });
  }
  if (body.action === "view") {
    const result = await recordPostView(user.id, id, String(body.postId ?? ""));
    if (!result.ok) return jsonError(result.error, result.status);
    return json({ ok: true, views: result.views });
  }
  if (body.action === "forward") {
    const result = await recordForward(user.id, id, String(body.postId ?? ""));
    if (!result.ok) return jsonError(result.error, result.status);
    return json({ ok: true, forwards: result.forwards });
  }
  const result = await createPost(user.id, id, {
    kind: typeof body.kind === "string" ? (body.kind as never) : "text",
    body: typeof body.body === "string" ? body.body : "",
    caption: typeof body.caption === "string" ? body.caption : "",
    status: body.status === "draft" || body.status === "scheduled" ? body.status : "published",
    scheduledAt: typeof body.scheduledAt === "number" ? body.scheduledAt : null,
    poll: body.poll && typeof body.poll === "object" ? (body.poll as never) : undefined,
    album: Array.isArray(body.album) ? body.album.map(String) : undefined,
    durationMs: typeof body.durationMs === "number" ? body.durationMs : undefined,
    voiceDataUrl: typeof body.voiceDataUrl === "string" ? body.voiceDataUrl : undefined,
    fileDataUrl: typeof body.fileDataUrl === "string" ? body.fileDataUrl : undefined,
    fileName: typeof body.fileName === "string" ? body.fileName : undefined,
  });
  if (!result.ok) return jsonError(result.error, result.status);
  return json({ ok: true, post: result.post, channel: result.channel });
}
