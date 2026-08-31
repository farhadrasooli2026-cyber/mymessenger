import { json, jsonError } from "@/lib/http";
import { requireActiveUser } from "@/lib/auth";
import { setChatDisappear } from "@/lib/chat";
import { DISAPPEAR_MAX_MS } from "@/lib/disappear";

type Ctx = { params: Promise<{ id: string }> };

export async function PATCH(request: Request, ctx: Ctx) {
  const user = await requireActiveUser();
  if (!user) return jsonError("نشست فعال نیست.", 401);
  const { id } = await ctx.params;
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return jsonError("درخواست نامعتبر است.");
  }
  if (!body || typeof body !== "object") return jsonError("درخواست نامعتبر است.");
  const rec = body as Record<string, unknown>;
  const raw = rec.disappearAfterMs;
  let ms: number | null;
  if (raw === null || raw === 0) ms = null;
  else if (typeof raw === "number" && raw > 0 && raw <= DISAPPEAR_MAX_MS) ms = Math.floor(raw);
  else return jsonError("زمان نامعتبر است.", 400);
  const result = await setChatDisappear(user.id, id, ms);
  if (!result.ok) return jsonError(result.error, result.status);
  return json({ ok: true, thread: result.thread, disappearAfterMs: result.disappearAfterMs });
}
