import { json, jsonError } from "@/lib/http";
import { requireActiveUser } from "@/lib/auth";
import { getGroup, sendGroupMessage } from "@/lib/groups";

type Ctx = { params: Promise<{ id: string }> };

export async function GET(_req: Request, ctx: Ctx) {
  const user = await requireActiveUser();
  if (!user) return jsonError("نشست فعال نیست.", 401);
  const { id } = await ctx.params;
  const result = await getGroup(user.id, id);
  if (!result) return jsonError("گروه یافت نشد.", 404);
  return json({ ok: true, messages: result.messages });
}

export async function POST(request: Request, ctx: Ctx) {
  const user = await requireActiveUser();
  if (!user) return jsonError("نشست فعال نیست.", 401);
  const { id } = await ctx.params;
  const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
  if (!body) return jsonError("درخواست نامعتبر است.");
  const result = await sendGroupMessage(user.id, id, {
    enc: typeof body.enc === "string" ? body.enc : undefined,
    ciphertext: typeof body.ciphertext === "string" ? body.ciphertext : undefined,
    nonce: typeof body.nonce === "string" ? body.nonce : undefined,
    kind:
      body.kind === "voice" ||
      body.kind === "photo" ||
      body.kind === "video" ||
      body.kind === "file" ||
      body.kind === "poll" ||
      body.kind === "sticker"
        ? body.kind
        : "text",
    stickerId: typeof body.stickerId === "string" ? body.stickerId : undefined,
    replyToId: typeof body.replyToId === "string" ? body.replyToId : undefined,
    mentions: Array.isArray(body.mentions) ? body.mentions.map(String) : undefined,
    blobId: typeof body.blobId === "string" ? body.blobId : undefined,
    chunkCount: typeof body.chunkCount === "number" ? body.chunkCount : undefined,
    poll:
      body.poll && typeof body.poll === "object"
        ? (body.poll as {
            question: string;
            options: string[];
            anonymous?: boolean;
            multiple?: boolean;
            closesAt?: number | null;
          })
        : undefined,
  });
  if (!result.ok) return jsonError(result.error, result.status);
  return json({ ok: true, message: result.message });
}
