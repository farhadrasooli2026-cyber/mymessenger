import { json, jsonError } from "@/lib/http";
import { requireActiveUser } from "@/lib/auth";
import { blockBot, reportBot, setBotNotify, startBot, stopBot, userBotChat, userSendToBot } from "@/lib/bots";
import type { BotReportCategory } from "@/lib/bot-types";

export async function GET(request: Request) {
  const user = await requireActiveUser();
  if (!user) return jsonError("نشست فعال نیست.", 401);
  const botId = new URL(request.url).searchParams.get("botId") ?? "";
  const chat = await userBotChat(user.id, botId);
  if (!chat) return jsonError("ربات یافت نشد.", 404);
  return json({ ok: true, ...chat });
}

export async function POST(request: Request) {
  const user = await requireActiveUser();
  if (!user) return jsonError("نشست فعال نیست.", 401);
  const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
  if (!body || typeof body.action !== "string") return jsonError("درخواست نامعتبر است.");
  const botId = String(body.botId ?? "");
  if (!botId) return jsonError("ربات مشخص نیست.");

  if (body.action === "start") {
    const result = await startBot(user.id, botId);
    if (!result.ok) return jsonError(result.error, result.status);
    return json(result);
  }
  if (body.action === "send") {
    const result = await userSendToBot(user.id, botId, String(body.text ?? ""));
    if (!result.ok) return jsonError(result.error, result.status);
    return json(result);
  }
  if (body.action === "stop") {
    const result = await stopBot(user.id, botId);
    if (!result.ok) return jsonError(result.error, result.status);
    return json(result);
  }
  if (body.action === "notify") {
    const notify = body.notify === "off" || body.notify === "mute" ? body.notify : "on";
    const result = await setBotNotify(user.id, botId, notify);
    if (!result.ok) return jsonError(result.error, result.status);
    return json(result);
  }
  if (body.action === "block") {
    const result = await blockBot(user.id, botId, body.blocked !== false);
    if (!result.ok) return jsonError(result.error, result.status);
    return json(result);
  }
  if (body.action === "report") {
    const result = await reportBot(user.id, botId, String(body.category ?? "other") as BotReportCategory, String(body.details ?? ""));
    if (!result.ok) return jsonError(result.error, result.status);
    return json(result);
  }
  return jsonError("عملیات ناشناخته است.");
}
