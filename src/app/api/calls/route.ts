import { json, jsonError } from "@/lib/http";
import { requireActiveUser } from "@/lib/auth";
import { activeCall, deleteCallHistory, listCalls, startOutgoing } from "@/lib/calls";
import { listGroupCalls } from "@/lib/group-calls";

export async function GET(request: Request) {
  const user = await requireActiveUser();
  if (!user) return jsonError("نشست فعال نیست.", 401);
  const url = new URL(request.url);
  const filter = url.searchParams.get("filter") ?? undefined;
  if (url.searchParams.get("live") === "1") {
    const live = await activeCall(user.id);
    return json({ ok: true, ...live });
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
  const body = (await request.json().catch(() => null)) as {
    threadId?: string;
    kind?: string;
    action?: string;
    ids?: string[];
  } | null;
  if (body?.action === "clear-history") {
    const result = await deleteCallHistory(user.id, Array.isArray(body.ids) && body.ids.length ? body.ids : "all");
    return json({ ok: true, cleared: result.cleared });
  }
  if (!body?.threadId || (body.kind !== "voice" && body.kind !== "video")) {
    return jsonError("درخواست تماس نامعتبر است.");
  }
  const result = await startOutgoing(user.id, body.threadId, body.kind);
  if (!result.ok) return jsonError(result.error, result.status);
  return json({ ok: true, call: result.call });
}

export async function DELETE() {
  const user = await requireActiveUser();
  if (!user) return jsonError("نشست فعال نیست.", 401);
  const result = await deleteCallHistory(user.id, "all");
  return json({ ok: true, cleared: result.cleared });
}
