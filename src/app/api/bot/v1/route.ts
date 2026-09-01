import { json, jsonError } from "@/lib/http";
import {
  botApiMe,
  botDeleteOwnMessage,
  botEditOwnMessage,
  botKvGet,
  botKvSet,
  botPollUpdates,
  botPostChannel,
  botSendToUser,
  nixoPayStub,
  runDueBotJobs,
  scheduleBotJob,
  tryReadPrivateChat,
} from "@/lib/bots";
import type { BotButton, BotMessage } from "@/lib/bot-types";

function tokenOf(request: Request) {
  const auth = request.headers.get("authorization") ?? "";
  if (auth.toLowerCase().startsWith("bearer ")) return auth.slice(7).trim();
  return request.headers.get("x-nixo-bot-token")?.trim() ?? "";
}

export async function GET(request: Request) {
  const token = tokenOf(request);
  const method = new URL(request.url).searchParams.get("method") ?? "getMe";
  if (method === "getMe") {
    const result = await botApiMe(token);
    if (!result.ok) return jsonError(result.error, result.status);
    return json(result);
  }
  if (method === "getUpdates") {
    const result = await botPollUpdates(token);
    if (!result.ok) return jsonError(result.error, result.status);
    return json(result);
  }
  if (method === "health") {
    const result = await botApiMe(token);
    if (!result.ok) return jsonError(result.error, result.status);
    return json({ ok: true, apiVersion: "v1", health: result.ok ? result.bot.health : "down" });
  }
  return jsonError("method نامعتبر است. API v1.");
}

export async function POST(request: Request) {
  const token = tokenOf(request);
  const idem = request.headers.get("idempotency-key") ?? "";
  const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
  const method = String(body?.method ?? new URL(request.url).searchParams.get("method") ?? "");
  await runDueBotJobs();

  if (method === "sendMessage" || method === "sendPhoto" || method === "sendVideo" || method === "sendFile" || method === "sendNotification" || method === "sendButton" || method === "replyMessage") {
    const kindMap: Record<string, BotMessage["kind"]> = {
      sendPhoto: "photo",
      sendVideo: "video",
      sendFile: "file",
      sendNotification: "notification",
      sendButton: "text",
      sendMessage: "text",
      replyMessage: "text",
    };
    const buttons = Array.isArray(body?.buttons) ? (body.buttons as BotButton[]) : method === "sendButton" ? [{ id: "ok", label: "OK", payload: "ok" }] : [];
    const result = await botSendToUser(token, {
      userId: String(body?.userId ?? ""),
      text: String(body?.text ?? ""),
      kind: kindMap[method] ?? "text",
      buttons,
      replyToId: typeof body?.replyToId === "string" ? body.replyToId : undefined,
      idempotencyKey: idem || (typeof body?.idempotencyKey === "string" ? body.idempotencyKey : undefined),
    });
    if (!result.ok) return jsonError(result.error, result.status);
    return json(result);
  }
  if (method === "editMessage") {
    const result = await botEditOwnMessage(token, String(body?.messageId ?? ""), String(body?.text ?? ""));
    if (!result.ok) return jsonError(result.error, result.status);
    return json(result);
  }
  if (method === "deleteMessage") {
    const result = await botDeleteOwnMessage(token, String(body?.messageId ?? ""));
    if (!result.ok) return jsonError(result.error, result.status);
    return json(result);
  }
  if (method === "setStorage") {
    const result = await botKvSet(token, String(body?.key ?? ""), String(body?.value ?? ""));
    if (!result.ok) return jsonError(result.error, result.status);
    return json(result);
  }
  if (method === "getStorage") {
    const result = await botKvGet(token, String(body?.key ?? ""));
    if (!result.ok) return jsonError(result.error, result.status);
    return json(result);
  }
  if (method === "schedule") {
    const result = await scheduleBotJob(token, {
      userId: String(body?.userId ?? ""),
      text: String(body?.text ?? ""),
      runAt: Number(body?.runAt ?? Date.now()),
      kind: body?.kind === "notify" ? "notify" : "send",
      idempotencyKey: idem || undefined,
    });
    if (!result.ok) return jsonError(result.error, result.status);
    return json(result);
  }
  if (method === "getUpdates") {
    const result = await botPollUpdates(token);
    if (!result.ok) return jsonError(result.error, result.status);
    return json(result);
  }
  if (method === "getMe") {
    const result = await botApiMe(token);
    if (!result.ok) return jsonError(result.error, result.status);
    return json(result);
  }
  if (method === "postChannel") {
    const result = await botPostChannel(token, String(body?.channelId ?? ""), String(body?.text ?? ""));
    if (!result.ok) return jsonError(result.error, result.status);
    return json(result);
  }
  if (method === "readPrivateChats" || method === "readContacts" || method === "gallery" || method === "microphone" || method === "camera" || method === "location") {
    const denied = await tryReadPrivateChat();
    return jsonError(denied.error, denied.status);
  }
  if (method === "pay") {
    const pay = await nixoPayStub();
    return jsonError(pay.error, pay.status);
  }
  return jsonError("method نامعتبر است. API v1.");
}
