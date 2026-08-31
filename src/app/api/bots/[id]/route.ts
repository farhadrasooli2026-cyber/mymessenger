import { json, jsonError } from "@/lib/http";
import { requireActiveUser } from "@/lib/auth";
import {
  addBotToChannel,
  addBotToGroup,
  developerDashboard,
  registerMiniApp,
  revokeToken,
  rotateToken,
  setBotPerms,
  setBotStatus,
  setCommands,
  setWebhook,
} from "@/lib/bots";
import type { BotApiPerms, MiniCategory } from "@/lib/bot-types";

type Ctx = { params: Promise<{ id: string }> };

export async function GET(_request: Request, ctx: Ctx) {
  const user = await requireActiveUser();
  if (!user) return jsonError("نشست فعال نیست.", 401);
  const { id } = await ctx.params;
  const dash = await developerDashboard(user.id, id);
  if (!dash) return jsonError("ربات یافت نشد یا مال شما نیست.", 404);
  return json({ ok: true, ...dash });
}

export async function POST(request: Request, ctx: Ctx) {
  const user = await requireActiveUser();
  if (!user) return jsonError("نشست فعال نیست.", 401);
  const { id } = await ctx.params;
  const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
  if (!body || typeof body.action !== "string") return jsonError("درخواست نامعتبر است.");

  if (body.action === "rotate-token") {
    const result = await rotateToken(user.id, id);
    if (!result.ok) return jsonError(result.error, result.status);
    return json(result);
  }
  if (body.action === "revoke-token") {
    const result = await revokeToken(user.id, id);
    if (!result.ok) return jsonError(result.error, result.status);
    return json(result);
  }
  if (body.action === "webhook") {
    const url = typeof body.url === "string" && body.url.trim() ? body.url.trim() : null;
    const result = await setWebhook(user.id, id, url);
    if (!result.ok) return jsonError(result.error, result.status);
    return json(result);
  }
  if (body.action === "commands") {
    const commands = Array.isArray(body.commands) ? (body.commands as { command: string; description: string }[]) : [];
    const result = await setCommands(user.id, id, commands);
    if (!result.ok) return jsonError(result.error, result.status);
    return json(result);
  }
  if (body.action === "perms") {
    const result = await setBotPerms(user.id, id, (body.perms ?? {}) as Partial<BotApiPerms>);
    if (!result.ok) return jsonError(result.error, result.status);
    return json(result);
  }
  if (body.action === "status") {
    const status = body.status === "disabled" || body.status === "deleted" || body.status === "active" ? body.status : null;
    if (!status) return jsonError("وضعیت نامعتبر است.");
    if (status !== "active" && body.confirm !== true) return jsonError("تأیید لازم است.");
    const result = await setBotStatus(user.id, id, status);
    if (!result.ok) return jsonError(result.error, result.status);
    return json(result);
  }
  if (body.action === "mini") {
    const result = await registerMiniApp(user.id, id, {
      title: String(body.title ?? ""),
      category: (body.category as MiniCategory) ?? "productivity",
      description: String(body.description ?? ""),
      html: typeof body.html === "string" ? body.html : undefined,
      paymentHint: Boolean(body.paymentHint),
    });
    if (!result.ok) return jsonError(result.error, result.status);
    return json(result);
  }
  if (body.action === "add-group") {
    const result = await addBotToGroup(user.id, String(body.groupId ?? ""), id, {
      canSend: Boolean(body.canSend),
      canModerate: Boolean(body.canModerate),
    });
    if (!result.ok) return jsonError(result.error, result.status);
    return json(result);
  }
  if (body.action === "add-channel") {
    const result = await addBotToChannel(user.id, String(body.channelId ?? ""), id, {
      canPost: Boolean(body.canPost),
      canModerate: Boolean(body.canModerate),
    });
    if (!result.ok) return jsonError(result.error, result.status);
    return json(result);
  }
  return jsonError("عملیات ناشناخته است.");
}
