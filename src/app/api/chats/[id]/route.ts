import { z } from "zod";
import { json, jsonError } from "@/lib/http";
import { requireActiveUser } from "@/lib/auth";
import { listMessages, sendMessage } from "@/lib/chat";

const schema = z.object({ text: z.string().min(1).max(2000) });

type Ctx = { params: Promise<{ id: string }> };

export async function GET(_request: Request, ctx: Ctx) {
  const user = await requireActiveUser();
  if (!user) return jsonError("نشست فعال نیست.", 401);
  const { id } = await ctx.params;
  const result = await listMessages(user.id, id);
  if (!result) return jsonError("گفتگو یافت نشد.", 404);
  return json({ ok: true, thread: result.thread, messages: result.messages });
}

export async function POST(request: Request, ctx: Ctx) {
  const user = await requireActiveUser();
  if (!user) return jsonError("نشست فعال نیست.", 401);
  const { id } = await ctx.params;
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return jsonError("درخواست نامعتبر است.");
  }
  const parsed = schema.safeParse(body);
  if (!parsed.success) return jsonError("متن پیام معتبر نیست.");
  const result = await sendMessage(user.id, id, parsed.data.text);
  if (!result.ok) return jsonError(result.error, result.status);
  return json({ ok: true, thread: result.thread, messages: result.messages });
}
