import { json, jsonError } from "@/lib/http";
import { requireActiveUser } from "@/lib/auth";
import {
  evaluateGraph,
  exportSocialGraph,
  graphHealth,
  graphMutuals,
  recFeedback,
  recommendFeed,
  rollbackGraphModel,
  setRecPrefs,
} from "@/lib/graph";
import type { RecKind } from "@/lib/graph-types";

const KINDS: RecKind[] = ["people", "follow", "group", "channel", "creator"];

export async function GET(request: Request) {
  const user = await requireActiveUser();
  if (!user) return jsonError("نشست فعال نیست.", 401);
  const url = new URL(request.url);
  const action = url.searchParams.get("action") ?? "feed";
  if (action === "health") return json(await graphHealth());
  if (action === "export") {
    const result = await exportSocialGraph(user.id);
    if (!result.ok) return jsonError(result.error, result.status);
    return json(result);
  }
  if (action === "eval") {
    const result = await evaluateGraph(user.id);
    if (!result.ok) return jsonError(result.error, result.status);
    return json(result);
  }
  if (action === "mutuals") {
    const result = await graphMutuals(user.id, url.searchParams.get("userId") ?? "");
    if (!result.ok) return jsonError(result.error, result.status);
    return json(result);
  }
  const result = await recommendFeed(user.id);
  if (!result.ok) return jsonError(result.error, result.status);
  return json(result);
}

export async function POST(request: Request) {
  const user = await requireActiveUser();
  if (!user) return jsonError("نشست فعال نیست.", 401);
  const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
  if (!body) return jsonError("درخواست نامعتبر است.");
  const action = String(body.action ?? "");
  if (action === "feedback") {
    const kind = KINDS.includes(body.kind as RecKind) ? (body.kind as RecKind) : "people";
    const act =
      body.feedback === "hide" || body.feedback === "not-interested" || body.feedback === "click" || body.feedback === "dismiss"
        ? body.feedback
        : "dismiss";
    const result = await recFeedback(user.id, kind, String(body.id ?? ""), act);
    if (!result.ok) return jsonError(result.error, result.status);
    return json(result);
  }
  if (action === "prefs") {
    const result = await setRecPrefs(user.id, {
      personalize: typeof body.personalize === "boolean" ? body.personalize : undefined,
      notify: typeof body.notify === "boolean" ? body.notify : undefined,
    });
    if (!result.ok) return jsonError(result.error, result.status);
    return json(result);
  }
  if (action === "rollback") {
    const result = await rollbackGraphModel(user.id, body.on !== false);
    if (!result.ok) return jsonError(result.error, result.status);
    return json(result);
  }
  return jsonError("عملیات ناشناخته است.", 400);
}
