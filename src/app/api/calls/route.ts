import { json, jsonError } from "@/lib/http";
import { requireActiveUser } from "@/lib/auth";
import { requestOriginAllowed } from "@/lib/security";
import { activeCall, deleteCallHistory, listCalls, markCallsSeen, readAllMissedCalls, startOutgoing } from "@/lib/calls";
import { listGroupCalls } from "@/lib/group-calls";
import { callCenterDashboard, requestCallRecording, searchCallHistory, sweepCallInfra } from "@/lib/call-center";

export async function GET(request: Request) {
  const user = await requireActiveUser();
  if (!user) return jsonError("نشست فعال نیست.", 401);
  const url = new URL(request.url);
  const filter = url.searchParams.get("filter") ?? undefined;
  if (url.searchParams.get("live") === "1") {
    const live = await activeCall(user.id);
    return json({ ok: true, ...live });
  }
  if (url.searchParams.get("view") === "center") {
    const dash = await callCenterDashboard(user.id);
    return json(dash);
  }
  const q = url.searchParams.get("q") ?? undefined;
  const cursor = url.searchParams.get("cursor") ?? undefined;
  const limitRaw = url.searchParams.get("limit");
  if (q || cursor || limitRaw || url.searchParams.get("page") === "1") {
    const result = await searchCallHistory(user.id, {
      q,
      filter,
      cursor,
      limit: limitRaw ? Number(limitRaw) : undefined,
    });
    return json(result);
  }
  if (filter === "group") {
    const group = await listGroupCalls(user.id);
    return json({ ok: true, calls: group });
  }
  const calls = await listCalls(user.id, filter);
  const group = filter === "all" || !filter ? await listGroupCalls(user.id) : [];
  return json({ ok: true, calls: [...calls, ...group].sort((a, b) => b.createdAt - a.createdAt) });
}

export async function POST(request: Request) {
  const user = await requireActiveUser();
  if (!user) return jsonError("نشست فعال نیست.", 401);
  if (!requestOriginAllowed(request)) return jsonError("Origin مجاز نیست.", 403, { code: "csrf" });
  const body = (await request.json().catch(() => null)) as {
    threadId?: string;
    kind?: string;
    action?: string;
    ids?: string[];
    callId?: string;
  } | null;
  if (body?.action === "sweep") {
    await sweepCallInfra();
    return json({ ok: true });
  }
  if (body?.action === "record" || body?.action === "recording") {
    const result = await requestCallRecording(user.id, String(body.callId ?? ""));
    return jsonError(result.error, result.status);
  }
  if (body?.action === "clear-history") {
    const result = await deleteCallHistory(user.id, Array.isArray(body.ids) && body.ids.length ? body.ids : "all");
    return json({ ok: true, cleared: result.cleared });
  }
  if (body?.action === "read-all") {
    return json(await readAllMissedCalls(user.id));
  }
  if (body?.action === "seen") {
    const ids = Array.isArray(body.ids) ? body.ids.map(String) : [];
    return json(await markCallsSeen(user.id, ids));
  }
  if (!body?.threadId || (body.kind !== "voice" && body.kind !== "video")) {
    return jsonError("درخواست تماس نامعتبر است.");
  }
  const result = await startOutgoing(user.id, body.threadId, body.kind);
  if (!result.ok) return jsonError(result.error, result.status);
  return json({ ok: true, call: result.call, mediaToken: "mediaToken" in result ? result.mediaToken : null });
}

export async function DELETE() {
  const user = await requireActiveUser();
  if (!user) return jsonError("نشست فعال نیست.", 401);
  const result = await deleteCallHistory(user.id, "all");
  return json({ ok: true, cleared: result.cleared });
}
