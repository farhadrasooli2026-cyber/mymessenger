import { json, jsonError } from "@/lib/http";
import { requireActiveUser } from "@/lib/auth";
import { activeCall, listCalls, startOutgoing } from "@/lib/calls";

export async function GET(request: Request) {
  const user = await requireActiveUser();
  if (!user) return jsonError("نشست فعال نیست.", 401);
  const url = new URL(request.url);
  const filter = url.searchParams.get("filter") ?? undefined;
  if (url.searchParams.get("live") === "1") {
    const live = await activeCall(user.id);
    return json({ ok: true, ...live });
  }
  const calls = await listCalls(user.id, filter);
  return json({ ok: true, calls });
}

export async function POST(request: Request) {
  const user = await requireActiveUser();
  if (!user) return jsonError("نشست فعال نیست.", 401);
  const body = (await request.json().catch(() => null)) as { threadId?: string; kind?: string } | null;
  if (!body?.threadId || (body.kind !== "voice" && body.kind !== "video")) {
    return jsonError("درخواست تماس نامعتبر است.");
  }
  const result = await startOutgoing(user.id, body.threadId, body.kind);
  if (!result.ok) return jsonError(result.error, result.status);
  return json({ ok: true, call: result.call });
}
