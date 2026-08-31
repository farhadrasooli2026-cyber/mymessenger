import { json, jsonError } from "@/lib/http";
import { requireActiveUser } from "@/lib/auth";
import {
  clearSyncedContacts,
  findByIdentifier,
  getPrivacy,
  requestDeletion,
  setBlockedPeer,
  setPresence,
  syncContacts,
  updatePrivacy,
  viewPresence,
} from "@/lib/privacy";

export async function GET(request: Request) {
  const user = await requireActiveUser();
  if (!user) return jsonError("نشست فعال نیست.", 401);
  const url = new URL(request.url);
  const target = url.searchParams.get("userId");
  if (target) {
    const result = await viewPresence(user.id, target);
    if (!result.ok) return jsonError(result.error, result.status);
    return json(result);
  }
  const phone = url.searchParams.get("find");
  if (phone) {
    const result = await findByIdentifier(user.id, phone);
    if (!result.ok) return jsonError(result.error, result.status);
    return json(result);
  }
  const data = await getPrivacy(user.id);
  if (!data) return jsonError("نشست فعال نیست.", 401);
  return json({ ok: true, ...data });
}

export async function POST(request: Request) {
  const user = await requireActiveUser();
  if (!user) return jsonError("نشست فعال نیست.", 401);
  const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
  if (!body) return jsonError("درخواست نامعتبر است.");
  if (body.action === "presence") {
    const result = await setPresence(user.id, {
      typingThreadId: typeof body.threadId === "string" ? body.threadId : undefined,
      typing: typeof body.typing === "boolean" ? body.typing : undefined,
      recording: typeof body.recording === "boolean" ? body.recording : undefined,
    });
    if (!result.ok) return jsonError(result.error, result.status);
    return json({ ok: true });
  }
  if (body.action === "contacts") {
    const hashes = Array.isArray(body.hashes) ? body.hashes.map(String) : [];
    const identifiers = Array.isArray(body.identifiers) ? body.identifiers.map(String) : undefined;
    const result = await syncContacts(user.id, hashes, identifiers);
    if (!result.ok) return jsonError(result.error, result.status);
    return json(result);
  }
  if (body.action === "contacts-clear") {
    const result = await clearSyncedContacts(user.id);
    if (!result.ok) return jsonError(result.error, result.status);
    return json(result);
  }
  if (body.action === "delete-request") {
    const result = await requestDeletion(user.id);
    if (!result.ok) return jsonError(result.error, result.status);
    return json(result);
  }
  if (body.action === "block") {
    const result = await setBlockedPeer(user.id, String(body.peerKey ?? ""), Boolean(body.blocked));
    if (!result.ok) return jsonError(result.error, result.status);
    return json(result);
  }
  const result = await updatePrivacy(user.id, body);
  if (!result.ok) return jsonError(result.error, result.status);
  return json({ ok: true, settings: result.settings, checkup: result.checkup });
}
