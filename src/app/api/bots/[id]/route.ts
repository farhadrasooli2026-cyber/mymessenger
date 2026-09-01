import { json, jsonError } from "@/lib/http";
import { requireActiveUser } from "@/lib/auth";
import {
  addBotToChannel,
  addBotToGroup,
  adminBotStatus,
  developerDashboard,
  publishBotVersion,
  registerMiniApp,
  removeBotPlacement,
  retryWebhooks,
  revokeToken,
  rollbackBotVersion,
  rotateToken,
  setBotPerms,
  setBotStatus,
  setCommands,
  setWebhook,
  updateBotProfile,
} from "@/lib/bots";
import type { BotApiPerms, BotCategory, BotCommand, BotStatus, MiniCategory, MiniScope } from "@/lib/bot-types";

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
    const commands = Array.isArray(body.commands) ? (body.commands as BotCommand[]) : [];
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
    const status =
      body.status === "disabled" || body.status === "deleted" || body.status === "active" || body.status === "suspended" ? body.status : null;
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
      requestedScopes: Array.isArray(body.requestedScopes) ? (body.requestedScopes as MiniScope[]) : undefined,
      webUrl: typeof body.webUrl === "string" ? body.webUrl : undefined,
      privacyUrl: typeof body.privacyUrl === "string" ? body.privacyUrl : undefined,
      termsUrl: typeof body.termsUrl === "string" ? body.termsUrl : undefined,
      version: typeof body.version === "string" ? body.version : undefined,
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
  if (body.action === "remove-group") {
    const result = await removeBotPlacement(user.id, id, String(body.groupId ?? ""), undefined);
    if (!result.ok) return jsonError(result.error, result.status);
    return json(result);
  }
  if (body.action === "profile") {
    const result = await updateBotProfile(user.id, id, {
      name: typeof body.name === "string" ? body.name : undefined,
      description: typeof body.description === "string" ? body.description : undefined,
      startMessage: typeof body.startMessage === "string" ? body.startMessage : undefined,
      privacyUrl: typeof body.privacyUrl === "string" ? body.privacyUrl : undefined,
      termsUrl: typeof body.termsUrl === "string" ? body.termsUrl : undefined,
      category: body.category as BotCategory | undefined,
    });
    if (!result.ok) return jsonError(result.error, result.status);
    return json(result);
  }
  if (body.action === "publish") {
    const result = await publishBotVersion(user.id, id, String(body.version ?? ""));
    if (!result.ok) return jsonError(result.error, result.status);
    return json(result);
  }
  if (body.action === "rollback") {
    const result = await rollbackBotVersion(user.id, id, String(body.version ?? ""));
    if (!result.ok) return jsonError(result.error, result.status);
    return json(result);
  }
  if (body.action === "webhook-retry") {
    const result = await retryWebhooks(user.id, id);
    if (!result.ok) return jsonError(result.error, result.status);
    return json(result);
  }
  if (body.action === "admin") {
    const result = await adminBotStatus(user.id, id, body.status as BotStatus);
    if (!result.ok) return jsonError(result.error, result.status);
    return json(result);
  }
  return jsonError("عملیات ناشناخته است.");
}
