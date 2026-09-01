import { json, jsonError } from "@/lib/http";
import { requireActiveUser } from "@/lib/auth";
import {
  acceptInvite,
  blockPerson,
  cancelRequest,
  clearMyContacts,
  contactCard,
  createInvite,
  deleteContact,
  discover,
  exportMine,
  findUsername,
  followUser,
  ingestPhoneBook,
  importMine,
  listContacts,
  listSocialGraph,
  mergeContacts,
  muteUser,
  removeFriend,
  saveContact,
  sendRequest,
  setPermission,
  startChatFromContact,
  suggestions,
  unfollowUser,
  viewPerson,
  resolveRequest,
} from "@/lib/contacts";
import { fileReport, listBlocked } from "@/lib/safety";

export async function GET(request: Request) {
  const user = await requireActiveUser();
  if (!user) return jsonError("نشست فعال نیست.", 401);
  const url = new URL(request.url);
  const action = url.searchParams.get("action") ?? "list";
  if (action === "person") {
    const result = await viewPerson(user.id, url.searchParams.get("username") ?? "");
    if (!result.ok) return jsonError(result.error, result.status);
    return json(result);
  }
  if (action === "username") {
    const result = await findUsername(user.id, url.searchParams.get("q") ?? "");
    if (!result.ok) return jsonError(result.error, result.status);
    return json(result);
  }
  if (action === "discover") {
    const result = await discover(user.id, url.searchParams.get("q") ?? "");
    if (!result.ok) return jsonError(result.error, result.status);
    return json(result);
  }
  if (action === "suggestions") {
    const result = await suggestions(user.id);
    if (!result.ok) return jsonError(result.error, result.status);
    return json(result);
  }
  if (action === "export") {
    const result = await exportMine(user.id);
    if (!result.ok) return jsonError(result.error, result.status);
    return json(result);
  }
  if (action === "blocked") {
    const blocked = await listBlocked(user.id);
    return json({ ok: true, blocked });
  }
  if (action === "graph") {
    const which = url.searchParams.get("which") === "followers" || url.searchParams.get("which") === "following" ? url.searchParams.get("which") : "friends";
    const target = url.searchParams.get("userId") || user.id;
    const result = await listSocialGraph(user.id, target, which as "followers" | "following" | "friends");
    if (!result.ok) return jsonError(result.error, result.status);
    return json(result);
  }
  const result = await listContacts(user.id, {
    q: url.searchParams.get("q") ?? undefined,
    sort: url.searchParams.get("sort") ?? undefined,
    group: url.searchParams.get("group") ?? undefined,
    favorites: url.searchParams.get("favorites") === "1",
    recently: url.searchParams.get("recently") === "1",
    offset: url.searchParams.get("offset") ? Number(url.searchParams.get("offset")) : undefined,
    limit: url.searchParams.get("limit") ? Number(url.searchParams.get("limit")) : undefined,
    cursor: url.searchParams.get("cursor") ?? undefined,
  });
  if (!result.ok) return jsonError(result.error, result.status);
  return json(result);
}

export async function POST(request: Request) {
  const user = await requireActiveUser();
  if (!user) return jsonError("نشست فعال نیست.", 401);
  const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
  if (!body) return jsonError("درخواست نامعتبر است.");
  const action = String(body.action ?? "save");

  if (action === "save") {
    const result = await saveContact(user.id, body);
    if (!result.ok) return jsonError(result.error, result.status, result.contact ? { contact: result.contact } : undefined);
    return json(result);
  }
  if (action === "delete") {
    const result = await deleteContact(user.id, String(body.id ?? ""));
    if (!result.ok) return jsonError(result.error, result.status);
    return json(result);
  }
  if (action === "merge") {
    const result = await mergeContacts(user.id, String(body.keepId ?? ""), String(body.dropId ?? ""), Boolean(body.confirm));
    if (!result.ok) return jsonError(result.error, result.status);
    return json(result);
  }
  if (action === "sync-phone") {
    const rows = Array.isArray(body.rows) ? (body.rows as { name?: string; phone?: string; email?: string }[]) : [];
    const perm = body.permission === "allow" || body.permission === "limited" || body.permission === "deny" ? body.permission : "deny";
    const result = await ingestPhoneBook(user.id, rows, perm);
    if (!result.ok) return jsonError(result.error, result.status);
    return json(result);
  }
  if (action === "permission") {
    const perm =
      body.permission === "allow" || body.permission === "deny" || body.permission === "limited" || body.permission === "unknown"
        ? body.permission
        : "unknown";
    const result = await setPermission(user.id, perm);
    if (!result.ok) return jsonError(result.error, result.status);
    return json(result);
  }
  if (action === "invite") {
    const result = await createInvite(user.id, typeof body.maxUses === "number" ? body.maxUses : null, typeof body.ttlMs === "number" ? body.ttlMs : null);
    if (!result.ok) return jsonError(result.error, result.status);
    return json(result);
  }
  if (action === "accept-invite") {
    const result = await acceptInvite(user.id, String(body.token ?? ""));
    if (!result.ok) return jsonError(result.error, result.status);
    return json(result);
  }
  if (action === "request") {
    const result = await sendRequest(user.id, String(body.userId ?? ""));
    if (!result.ok) return jsonError(result.error, result.status);
    return json(result);
  }
  if (action === "resolve-request") {
    const act = body.resolve === "accept" || body.resolve === "decline" || body.resolve === "block" || body.resolve === "report" ? body.resolve : "decline";
    const result = await resolveRequest(user.id, String(body.id ?? ""), act);
    if (!result.ok) return jsonError(result.error, result.status);
    return json(result);
  }
  if (action === "cancel-request") {
    const result = await cancelRequest(user.id, String(body.id ?? ""));
    if (!result.ok) return jsonError(result.error, result.status);
    return json(result);
  }
  if (action === "unfriend") {
    const result = await removeFriend(user.id, String(body.userId ?? ""));
    if (!result.ok) return jsonError(result.error, result.status);
    return json(result);
  }
  if (action === "follow") {
    const result = await followUser(user.id, String(body.userId ?? ""));
    if (!result.ok) return jsonError(result.error, result.status);
    return json(result);
  }
  if (action === "unfollow") {
    const result = await unfollowUser(user.id, String(body.userId ?? ""));
    if (!result.ok) return jsonError(result.error, result.status);
    return json(result);
  }
  if (action === "mute") {
    const result = await muteUser(user.id, String(body.peerKey ?? body.userId ?? ""), body.muted !== false);
    if (!result.ok) return jsonError(result.error, result.status);
    return json(result);
  }
  if (action === "unmute") {
    const result = await muteUser(user.id, String(body.peerKey ?? body.userId ?? ""), false);
    if (!result.ok) return jsonError(result.error, result.status);
    return json(result);
  }
  if (action === "clear") {
    const result = await clearMyContacts(user.id);
    if (!result.ok) return jsonError(result.error, result.status);
    return json(result);
  }
  if (action === "open-chat") {
    const result = await startChatFromContact(user.id, typeof body.contactId === "string" ? body.contactId : undefined, typeof body.userId === "string" ? body.userId : undefined);
    if (!result.ok) return jsonError(result.error, "status" in result ? result.status : 400);
    return json(result);
  }
  if (action === "block") {
    const result = await blockPerson(user.id, String(body.peerKey ?? ""), Boolean(body.blocked));
    if (!result.ok) return jsonError(result.error, result.status);
    return json(result);
  }
  if (action === "report") {
    const result = await fileReport(user.id, {
      targetKind: "user",
      targetKey: String(body.peerKey ?? ""),
      category: body.category === "abuse" || body.category === "fake" || body.category === "harassment" || body.category === "other" ? body.category : "spam",
      details: String(body.details ?? "").slice(0, 500),
    });
    if (!result.ok) return jsonError(result.error, result.status);
    return json(result);
  }
  if (action === "import") {
    const rows = Array.isArray(body.rows) ? body.rows : [];
    const result = await importMine(user.id, rows);
    return json(result);
  }
  if (action === "card") {
    const fields = Array.isArray(body.fields) ? body.fields.map(String) : ["name"];
    const result = await contactCard(user.id, String(body.id ?? ""), fields);
    if (!result.ok) return jsonError(result.error, result.status);
    return json(result);
  }
  return jsonError("عملیات نامعتبر است.");
}
