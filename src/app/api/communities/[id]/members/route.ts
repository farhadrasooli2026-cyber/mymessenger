import { json, jsonError } from "@/lib/http";
import { requireActiveUser } from "@/lib/auth";
import { addMembers, moderateMember, setNotifyMode } from "@/lib/communities";
import type { NotifyMode } from "@/lib/community-types";

type Ctx = { params: Promise<{ id: string }> };

export async function POST(request: Request, ctx: Ctx) {
  const user = await requireActiveUser();
  if (!user) return jsonError("نشست فعال نیست.", 401);
  const { id } = await ctx.params;
  const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
  if (!body) return jsonError("درخواست نامعتبر است.");
  if (body.action === "notify") {
    const mode = body.mode;
    if (mode !== "all" && mode !== "mentions" && mode !== "important" && mode !== "mute") {
      return jsonError("حالت اعلان نامعتبر است.");
    }
    const result = await setNotifyMode(user.id, id, mode as NotifyMode);
    if (!result.ok) return jsonError(result.error, result.status);
    return json({ ok: true, notifyMode: result.notifyMode });
  }
  if (body.action === "add") {
    const keys = Array.isArray(body.keys) ? body.keys.map(String) : [];
    const result = await addMembers(user.id, id, keys);
    if (!result.ok) return jsonError(result.error, result.status);
    return json({ ok: true, community: result.community });
  }
  const action = body.action as "remove" | "ban" | "unban" | "mute" | "restrict" | "role";
  const result = await moderateMember(user.id, id, String(body.targetKey ?? ""), action, {
    ms: typeof body.ms === "number" ? body.ms : undefined,
    role: body.role === "admin" || body.role === "moderator" || body.role === "member" ? body.role : undefined,
  });
  if (!result.ok) return jsonError(result.error, result.status);
  return json({ ok: true, community: result.community });
}
