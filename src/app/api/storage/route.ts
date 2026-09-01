import { json, jsonError } from "@/lib/http";
import { requireActiveUser } from "@/lib/auth";
import { requestOriginAllowed } from "@/lib/security";
import {
  beginVaultUpload,
  cancelVaultUpload,
  completeVaultUpload,
  createVaultLink,
  forwardVaultFile,
  listVault,
  processVaultJobs,
  putVaultChunk,
  restoreVault,
  revokeVaultLink,
  setVaultPrivacy,
  shareVaultFile,
  storageDashboard,
  sweepVault,
  trashVault,
} from "@/lib/storage";
import type { FileSort } from "@/lib/files";
import type { VaultPrivacy, VaultScope } from "@/lib/storage-types";

export async function GET(request: Request) {
  const user = await requireActiveUser();
  if (!user) return jsonError("نشست فعال نیست.", 401);
  const url = new URL(request.url);
  if (url.searchParams.get("view") === "dash") {
    return json(await storageDashboard(user.id));
  }
  const result = await listVault(user.id, {
    q: url.searchParams.get("q") ?? undefined,
    kind: url.searchParams.get("kind") ?? undefined,
    sort: (url.searchParams.get("sort") as FileSort) || "newest",
    trash: url.searchParams.get("trash") === "1",
    status: url.searchParams.get("status") ?? undefined,
  });
  return json(result);
}

export async function POST(request: Request) {
  const user = await requireActiveUser();
  if (!user) return jsonError("نشست فعال نیست.", 401);
  if (!requestOriginAllowed(request)) return jsonError("Origin مجاز نیست.", 403, { code: "csrf" });
  const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
  if (!body || typeof body.action !== "string") return jsonError("درخواست نامعتبر است.");
  const action = body.action;
  if (action === "begin") {
    const result = await beginVaultUpload(user.id, {
      name: String(body.name ?? "file"),
      size: Number(body.size ?? 0),
      mime: typeof body.mime === "string" ? body.mime : undefined,
      chunks: Number(body.chunks ?? 1),
      clientNonce: typeof body.clientNonce === "string" ? body.clientNonce : undefined,
      scope: body.scope === "group" || body.scope === "channel" ? (body.scope as VaultScope) : "user",
      scopeId: typeof body.scopeId === "string" ? body.scopeId : undefined,
      privacy: body.privacy === "public" ? "public" : "private",
    });
    if (!result.ok) return jsonError(result.error, result.status);
    return json(result);
  }
  if (action === "chunk") {
    const result = await putVaultChunk(user.id, String(body.sessionId ?? ""), Number(body.index ?? -1), String(body.payload ?? ""));
    if (!result.ok) return jsonError(result.error, result.status);
    return json(result);
  }
  if (action === "complete") {
    const result = await completeVaultUpload(user.id, String(body.sessionId ?? ""));
    if (!result.ok) return jsonError(result.error, result.status);
    return json(result);
  }
  if (action === "trash") {
    const ids = Array.isArray(body.ids) ? body.ids.map(String) : [];
    const result = await trashVault(user.id, ids, Boolean(body.permanent));
    return json(result);
  }
  if (action === "restore") {
    const ids = Array.isArray(body.ids) ? body.ids.map(String) : [];
    return json(await restoreVault(user.id, ids));
  }
  if (action === "privacy") {
    const ids = Array.isArray(body.ids) ? body.ids.map(String) : [];
    const privacy: VaultPrivacy = body.privacy === "public" ? "public" : "private";
    return json(await setVaultPrivacy(user.id, ids, privacy));
  }
  if (action === "cancel") {
    const result = await cancelVaultUpload(user.id, String(body.sessionId ?? ""));
    if (!result.ok) return jsonError(result.error, result.status);
    return json(result);
  }
  if (action === "share") {
    const result = await shareVaultFile(user.id, String(body.id ?? ""), String(body.toUserId ?? ""));
    if (!result.ok) return jsonError(result.error, result.status);
    return json(result);
  }
  if (action === "forward") {
    const result = await forwardVaultFile(user.id, String(body.id ?? ""), String(body.toUserId ?? ""));
    if (!result.ok) return jsonError(result.error, result.status);
    return json(result);
  }
  if (action === "link") {
    const result = await createVaultLink(user.id, String(body.id ?? ""), body.preview ? "preview" : "download");
    if (!result.ok) return jsonError(result.error, result.status);
    return json(result);
  }
  if (action === "revoke") {
    const result = await revokeVaultLink(user.id, String(body.linkId ?? ""));
    if (!result.ok) return jsonError(result.error, result.status);
    return json(result);
  }
  if (action === "process") {
    return json(await processVaultJobs(user.id));
  }
  if (action === "sweep") {
    return json(await sweepVault());
  }
  return jsonError("عملیات ناشناخته است.");
}
