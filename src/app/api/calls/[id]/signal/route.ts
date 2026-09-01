import { json, jsonError } from "@/lib/http";
import { requireActiveUser } from "@/lib/auth";
import { listCallSignals, postCallSignal } from "@/lib/call-signal";
import type { CallSignal } from "@/lib/store";

type Ctx = { params: Promise<{ id: string }> };

export async function GET(request: Request, ctx: Ctx) {
  const user = await requireActiveUser();
  if (!user) return jsonError("نشست فعال نیست.", 401);
  const { id } = await ctx.params;
  const after = Number(new URL(request.url).searchParams.get("after") ?? "0");
  const result = await listCallSignals(user.id, id, Number.isFinite(after) ? after : 0);
  if (!result.ok) return jsonError(result.error, result.status);
  return json(result);
}

export async function POST(request: Request, ctx: Ctx) {
  const user = await requireActiveUser();
  if (!user) return jsonError("نشست فعال نیست.", 401);
  const { id } = await ctx.params;
  const body = (await request.json().catch(() => null)) as {
    type?: string;
    body?: string;
    nonce?: string;
    token?: string;
  } | null;
  const type = body?.type as CallSignal["type"] | undefined;
  if (!type) return jsonError("سیگنال نامعتبر است.");
  const result = await postCallSignal(user.id, id, { type, body: body?.body, nonce: body?.nonce, token: body?.token });
  if (!result.ok) return jsonError(result.error, result.status);
  return json({ ok: true, id: result.id });
}
