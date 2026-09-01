import { json, jsonError } from "@/lib/http";
import { requireActiveUser } from "@/lib/auth";
import { directoryMiniApps, nixoPayStub, setMiniProfileGrant } from "@/lib/bots";
import {
  adminMiniStatus,
  connectedMiniApps,
  developerUpdateMini,
  disconnectMini,
  getMiniProfile,
  listMiniDirectory,
  miniAnalytics,
  miniBridge,
  openMiniSession,
  reportMiniApp,
  reviewMini,
  setMiniScopes,
  toggleMiniFlag,
} from "@/lib/mini";
import type { MiniAppStatus, MiniScope } from "@/lib/bot-types";

export async function GET(request: Request) {
  const user = await requireActiveUser();
  if (!user) return jsonError("نشست فعال نیست.", 401);
  const url = new URL(request.url);
  const miniId = url.searchParams.get("id");
  if (url.searchParams.get("connected") === "1" || url.searchParams.get("export") === "1") {
    return json(await connectedMiniApps(user.id));
  }
  if (url.searchParams.get("profile") === "1" && miniId) {
    const result = await getMiniProfile(user.id, miniId);
    if (!result.ok) return jsonError(result.error, result.status);
    return json(result);
  }
  if (miniId) {
    const result = await openMiniSession(user.id, miniId);
    if (!result.ok) return jsonError(result.error, result.status);
    return json(result);
  }
  const q = url.searchParams.get("q") ?? "";
  const category = url.searchParams.get("category") ?? "";
  if (q || url.searchParams.get("dir") === "1") {
    return json(await listMiniDirectory(user.id, q, category || undefined));
  }
  const miniApps = await directoryMiniApps(category || undefined);
  return json({ ok: true, miniApps });
}

export async function POST(request: Request) {
  const user = await requireActiveUser();
  if (!user) return jsonError("نشست فعال نیست.", 401);
  const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
  if (!body || typeof body.action !== "string") return jsonError("درخواست نامعتبر است.");
  const miniId = String(body.miniId ?? "");

  if (body.action === "grant") {
    const result = await setMiniProfileGrant(user.id, miniId, body.allow === true);
    if (!result.ok) return jsonError(result.error, result.status);
    return json(result);
  }
  if (body.action === "scopes") {
    const next = (body.scopes ?? {}) as Partial<Record<MiniScope, boolean>>;
    const result = await setMiniScopes(user.id, miniId, next);
    if (!result.ok) return jsonError(result.error, result.status);
    return json(result);
  }
  if (body.action === "disconnect") {
    const result = await disconnectMini(user.id, miniId, false);
    return json(result);
  }
  if (body.action === "clear-data") {
    const result = await disconnectMini(user.id, miniId, true);
    return json(result);
  }
  if (body.action === "favorite" || body.action === "install") {
    const result = await toggleMiniFlag(user.id, miniId, body.action === "favorite" ? "favorite" : "installed");
    if (!result.ok) return jsonError(result.error, result.status);
    return json(result);
  }
  if (body.action === "review") {
    const result = await reviewMini(user.id, miniId, Number(body.stars ?? 0), String(body.body ?? ""));
    if (!result.ok) return jsonError(result.error, result.status);
    return json(result);
  }
  if (body.action === "report") {
    const cat = body.category === "spam" || body.category === "abuse" || body.category === "fake" || body.category === "harassment" || body.category === "other" ? body.category : "other";
    const result = await reportMiniApp(user.id, miniId, cat, String(body.details ?? ""));
    if (!result.ok) return jsonError(result.error, result.status);
    return json(result);
  }
  if (body.action === "bridge") {
    const result = await miniBridge(user.id, miniId, String(body.op ?? ""), (body.extra as Record<string, unknown>) ?? {});
    if (!result.ok) return jsonError(result.error, result.status ?? 400);
    return json(result);
  }
  if (body.action === "update") {
    const result = await developerUpdateMini(user.id, miniId, {
      title: typeof body.title === "string" ? body.title : undefined,
      description: typeof body.description === "string" ? body.description : undefined,
      html: typeof body.html === "string" ? body.html : undefined,
      version: typeof body.version === "string" ? body.version : undefined,
      privacyUrl: typeof body.privacyUrl === "string" ? body.privacyUrl : undefined,
      termsUrl: typeof body.termsUrl === "string" ? body.termsUrl : undefined,
      webUrl: body.webUrl === null ? null : typeof body.webUrl === "string" ? body.webUrl : undefined,
      requestedScopes: Array.isArray(body.requestedScopes) ? (body.requestedScopes as MiniScope[]) : undefined,
      status: body.status === "active" || body.status === "maintenance" ? body.status : undefined,
    });
    if (!result.ok) return jsonError(result.error, result.status);
    return json(result);
  }
  if (body.action === "analytics") {
    const result = await miniAnalytics(user.id, miniId);
    if (!result.ok) return jsonError(result.error, result.status);
    return json(result);
  }
  if (body.action === "admin") {
    const status = body.status as MiniAppStatus;
    const result = await adminMiniStatus(user.id, miniId, status);
    if (!result.ok) return jsonError(result.error, result.status);
    return json(result);
  }
  if (body.action === "pay") {
    const pay = await nixoPayStub();
    return jsonError(pay.error, pay.status);
  }
  return jsonError("عملیات ناشناخته است.");
}
