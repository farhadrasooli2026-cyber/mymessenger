import { json, jsonError } from "@/lib/http";
import { requireActiveUser } from "@/lib/auth";
import { addMembers, moderateMember, setNotifyMute } from "@/lib/groups";

type Ctx = { params: Promise<{ id: string }> };

export async function POST(request: Request, ctx: Ctx) {
  const user = await requireActiveUser();
  if (!user) return jsonError("نشست فعال نیست.", 401);
  const { id } = await ctx.params;
  const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
  if (!body) return jsonError("درخواست نامعتبر است.");
  if (body.action === "notify") {
    const result = await setNotifyMute(
      user.id,
      id,
      body.ms === undefined ? undefined : body.ms === null ? null : Number(body.ms),
      typeof body.mentions === "boolean" ? body.mentions : undefined,
    );
    if (!result.ok) return jsonError(result.error, result.status);
    return json({ ok: true, notifyMutedUntil: result.notifyMutedUntil });
  }
  if (body.action === "add") {
    const keys = Array.isArray(body.keys) ? body.keys.map(String) : [];
    const result = await addMembers(user.id, id, keys);
    if (!result.ok) return jsonError(result.error, result.status);
    return json({ ok: true, group: result.group });
  }
  const action = body.action as "remove" | "ban" | "unban" | "mute" | "restrict" | "role" | "transfer";
  const result = await moderateMember(user.id, id, String(body.targetKey ?? ""), action, {
    ms: typeof body.ms === "number" ? body.ms : undefined,
    confirm: typeof body.confirm === "string" ? body.confirm : undefined,
  });
  if (!result.ok) return jsonError(result.error, result.status);
  return json({ ok: true, group: result.group });
}
