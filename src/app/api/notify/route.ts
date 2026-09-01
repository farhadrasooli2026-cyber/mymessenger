import { json, jsonError } from "@/lib/http";
import { requireActiveUser } from "@/lib/auth";
import {
  deleteNotify,
  dismissNotify,
  getNotifySnapshot,
  listNotifications,
  markNotify,
  muteTarget,
  setOverride,
  updateNotifyPrefs,
} from "@/lib/notify";
import { NOTIFY_CATEGORIES, type NotifyCategory } from "@/lib/notify-types";

export async function GET(request: Request) {
  const user = await requireActiveUser();
  if (!user) return jsonError("نشست فعال نیست.", 401);
  const url = new URL(request.url);
  if (url.searchParams.get("snapshot") === "1") {
    return json(await getNotifySnapshot(user.id));
  }
  const catRaw = url.searchParams.get("category") ?? "all";
  const category = (NOTIFY_CATEGORIES as readonly string[]).includes(catRaw) ? (catRaw as NotifyCategory) : "all";
  const result = await listNotifications(
    user.id,
    category,
    url.searchParams.get("offset") ? Number(url.searchParams.get("offset")) : 0,
    url.searchParams.get("limit") ? Number(url.searchParams.get("limit")) : 40,
    {
      cursor: url.searchParams.get("cursor") ?? undefined,
      q: url.searchParams.get("q") ?? undefined,
      kind: url.searchParams.get("kind") ?? undefined,
      unread: url.searchParams.get("unread") === "1",
      mentions: url.searchParams.get("mentions") === "1",
      security: url.searchParams.get("security") === "1",
      from: url.searchParams.get("from") ? Number(url.searchParams.get("from")) : undefined,
      to: url.searchParams.get("to") ? Number(url.searchParams.get("to")) : undefined,
    },
  );
  return json(result);
}

export async function PATCH(request: Request) {
  const user = await requireActiveUser();
  if (!user) return jsonError("نشست فعال نیست.", 401);
  const body = await request.json().catch(() => ({}));
  const result = await updateNotifyPrefs(user.id, body);
  return json(result);
}

export async function POST(request: Request) {
  const user = await requireActiveUser();
  if (!user) return jsonError("نشست فعال نیست.", 401);
  const body = await request.json().catch(() => ({}));
  const action = body.action as string;
  if (action === "read") {
    const ids = body.all ? "all" : Array.isArray(body.ids) ? body.ids.map(String) : [String(body.id ?? "")];
    return json(await markNotify(user.id, ids === "all" ? "all" : ids.filter(Boolean), true));
  }
  if (action === "unread") {
    return json(await markNotify(user.id, [String(body.id)], false));
  }
  if (action === "dismiss") {
    const ids = body.all ? "all" : Array.isArray(body.ids) ? body.ids.map(String) : [String(body.id ?? "")];
    return json(await dismissNotify(user.id, ids === "all" ? "all" : ids.filter(Boolean)));
  }
  if (action === "mute") {
    const forever = body.forever === true || body.ms === null;
    const ms = forever ? null : Number(body.ms);
    return json(await muteTarget(user.id, body.targetType, String(body.targetId), forever ? null : ms));
  }
  if (action === "unmute") {
    return json(await muteTarget(user.id, body.targetType, String(body.targetId), 0));
  }
  if (action === "override") {
    return json(
      await setOverride(user.id, {
        targetType: body.targetType,
        targetId: String(body.targetId),
        enabled: body.enabled,
        preview: body.preview,
        sound: body.sound,
      }),
    );
  }
  return jsonError("اقدام نامعتبر است.", 400);
}

export async function DELETE(request: Request) {
  const user = await requireActiveUser();
  if (!user) return jsonError("نشست فعال نیست.", 401);
  const url = new URL(request.url);
  const all = url.searchParams.get("all") === "1";
  const id = url.searchParams.get("id");
  const result = await deleteNotify(user.id, all ? "all" : id ? [id] : []);
  return json(result);
}
