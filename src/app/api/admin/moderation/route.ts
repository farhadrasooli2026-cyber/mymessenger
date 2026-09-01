import { json, jsonError } from "@/lib/http";
import { requireActiveSession } from "@/lib/auth";
import { hitRateLimit } from "@/lib/rate-limit";
import { mutateStore } from "@/lib/store";
import {
  ackAlert,
  adminActionSchema,
  adminDashboard,
  adminRevokeUserSessions,
  applyRestriction,
  bulkAction,
  clearStaffCookie,
  decideAppeal,
  exportReports,
  getReport,
  listAppeals,
  listAudit,
  listCases,
  listFlags,
  listReports,
  listStaff,
  mutateCase,
  mutateReport,
  recoverModeration,
  requireStaff,
  restoreContent,
  reviewAutoFlag,
  searchUsers,
  setChannelHold,
  setGroupHold,
  setStaffRole,
  staffLogin,
  staffLogout,
  startImpersonation,
  stopImpersonation,
  takeContentAction,
  unbanUser,
  viewUser,
  warnUser,
  writeStaffCookie,
} from "@/lib/admin-moderation";
import { lookupStaff } from "@/lib/admin-moderation";
import { readStoreSnapshot } from "@/lib/store";
import type { AppealStatus, CaseStatus, ContentAction, ReportPriority, ReportStatus, StaffRole } from "@/lib/admin-types";
import { clientIp, clientUserAgent } from "@/lib/session";

export async function GET(request: Request) {
  const url = new URL(request.url);
  const view = url.searchParams.get("view") ?? "me";
  if (view === "me") {
    const session = await requireActiveSession();
    if (!session) return jsonError("نشست فعال نیست.", 401);
    const data = await readStoreSnapshot();
    const staff = lookupStaff(data, session.user.id);
    const ctx = await requireStaff();
    return json({
      ok: true,
      staff: Boolean(staff && !staff.disabled),
      role: staff?.role ?? null,
      authed: ctx.ok,
      impersonateUserId: ctx.ok ? ctx.impersonateUserId : null,
    });
  }
  const ctx = await requireStaff();
  if (!ctx.ok) return jsonError(ctx.error, ctx.status);
  if (view === "dashboard") {
    const r = await adminDashboard();
    if (!r.ok) return jsonError(r.error, r.status);
    return json(r);
  }
  if (view === "users") {
    const r = await searchUsers(url.searchParams.get("q") ?? "", Number(url.searchParams.get("page") ?? 0));
    if (!r.ok) return jsonError(r.error, r.status);
    return json(r);
  }
  if (view === "user") {
    const r = await viewUser(url.searchParams.get("id") ?? "");
    if (!r.ok) return jsonError(r.error, "status" in r ? r.status : 400);
    return json(r);
  }
  if (view === "reports") {
    const r = await listReports({
      status: (url.searchParams.get("status") as ReportStatus) || undefined,
      type: url.searchParams.get("type") || undefined,
      priority: (url.searchParams.get("priority") as ReportPriority) || undefined,
      q: url.searchParams.get("q") || undefined,
      page: Number(url.searchParams.get("page") ?? 0),
    });
    if (!r.ok) return jsonError(r.error, r.status);
    return json(r);
  }
  if (view === "report") {
    const r = await getReport(url.searchParams.get("id") ?? "");
    if (!r.ok) return jsonError(r.error, "status" in r ? r.status : 400);
    return json(r);
  }
  if (view === "cases") {
    const r = await listCases((url.searchParams.get("status") as CaseStatus) || undefined, Number(url.searchParams.get("page") ?? 0));
    if (!r.ok) return jsonError(r.error, r.status);
    return json(r);
  }
  if (view === "appeals") {
    const r = await listAppeals(Number(url.searchParams.get("page") ?? 0));
    if (!r.ok) return jsonError(r.error, r.status);
    return json(r);
  }
  if (view === "audit") {
    const r = await listAudit(Number(url.searchParams.get("page") ?? 0));
    if (!r.ok) return jsonError(r.error, r.status);
    return json(r);
  }
  if (view === "flags") {
    const r = await listFlags();
    if (!r.ok) return jsonError(r.error, r.status);
    return json(r);
  }
  if (view === "staff") {
    const r = await listStaff();
    if (!r.ok) return jsonError(r.error, r.status);
    return json(r);
  }
  return jsonError("نمای نامعتبر.", 400);
}

export async function POST(request: Request) {
  const parsed = adminActionSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return jsonError("درخواست نامعتبر است.");
  const body = parsed.data;
  const ip = await clientIp();
  const flood = await mutateStore((data) => hitRateLimit(data, `admin-api:${ip}`, 60_000, 80));
  if (!flood.allowed) return jsonError("محدودیت نرخ پنل ادمین.", 429);

  if (body.action === "login") {
    const session = await requireActiveSession();
    if (!session) return jsonError("ابتدا با حساب نیکسو وارد شو.", 401);
    const result = await staffLogin(session.user.id, body.password ?? "", body.totp, ip, await clientUserAgent());
    if (!result.ok) return jsonError(result.error, result.status);
    await writeStaffCookie(session.user.id, result.sid);
    return json({ ok: true, role: result.role });
  }

  if (body.action === "logout") {
    const ctx = await requireStaff();
    if (ctx.ok) await staffLogout(ctx.session.id, ctx.user.id, false);
    await clearStaffCookie();
    return json({ ok: true });
  }
  if (body.action === "logout-others") {
    const ctx = await requireStaff();
    if (!ctx.ok) return jsonError(ctx.error, ctx.status);
    await staffLogout(ctx.session.id, ctx.user.id, true);
    return json({ ok: true });
  }

  const map: Record<string, () => Promise<{ ok: boolean; error?: string; status?: number } & Record<string, unknown>>> = {
    restrict: () =>
      applyRestriction({
        targetId: body.targetId ?? "",
        kind: "restrict",
        until: body.until,
        reason: body.reason ?? "",
        password: body.password ?? "",
        confirm: body.confirm ?? "",
      }),
    suspend: () =>
      applyRestriction({
        targetId: body.targetId ?? "",
        kind: "suspend",
        until: body.until,
        reason: body.reason ?? "",
        password: body.password ?? "",
        confirm: body.confirm ?? "SUSPEND",
      }),
    ban: () =>
      applyRestriction({
        targetId: body.targetId ?? "",
        kind: "ban",
        until: body.until,
        reason: body.reason ?? "",
        password: body.password ?? "",
        confirm: body.confirm ?? "",
        permanent: body.permanent,
      }),
    unban: () => unbanUser(body.targetId ?? "", body.password ?? "", body.confirm ?? ""),
    warn: () => warnUser(body.targetId ?? "", body.reason ?? ""),
    revoke: () => adminRevokeUserSessions(body.targetId ?? "", body.id),
    "report-update": () =>
      mutateReport({
        id: body.id ?? "",
        status: body.status as ReportStatus | undefined,
        priority: body.priority as ReportPriority | undefined,
        assignedTo: body.assignedTo,
        note: body.note,
      }),
    "content-action": () =>
      takeContentAction({
        reportId: body.id,
        kind: (body.kind as "story") ?? "story",
        targetId: body.targetId ?? "",
        action: (body.contentAction as ContentAction) ?? "none",
        reason: body.reason ?? "",
        password: body.password,
        confirm: body.confirm,
      }),
    restore: () => restoreContent(body.id ?? "", body.password ?? "", body.confirm ?? ""),
    "group-hold": () => setGroupHold(body.targetId ?? "", (body.hold as "ok") ?? "restricted", body.reason ?? "", body.ownerUserId),
    "channel-hold": () =>
      setChannelHold(body.targetId ?? "", (body.hold as "active") ?? "restricted", body.ownerUserId),
    "case-update": () =>
      mutateCase({
        id: body.id,
        title: body.title,
        status: body.status as CaseStatus | undefined,
        assigneeId: body.assignedTo,
        reportId: body.targetId,
        note: body.note,
      }),
    "appeal-decide": () => decideAppeal(body.id ?? "", (body.status as AppealStatus) ?? "rejected", body.decision ?? ""),
    "set-role": () => setStaffRole(body.targetId ?? "", (body.role as StaffRole) ?? "moderator", body.password ?? "", body.confirm ?? ""),
    impersonate: () => startImpersonation(body.targetId ?? "", body.password ?? "", body.confirm ?? ""),
    "impersonate-stop": () => stopImpersonation(),
    export: () => exportReports(body.password ?? "", body.confirm ?? ""),
    bulk: () => bulkAction(body.ids ?? [], body.kind === "reject" ? "reject" : "assign", body.password ?? "", body.confirm ?? ""),
    recover: () => recoverModeration(),
    "flag-review": () => reviewAutoFlag(body.id ?? "", body.status === "confirmed" ? "confirmed" : "false_positive"),
    "alert-ack": () => ackAlert(body.id ?? ""),
  };

  const run = map[body.action];
  if (!run) return jsonError("عملیات ناشناخته است.");
  const result = await run();
  if (!result.ok) return jsonError(String(result.error ?? "خطا"), Number(result.status ?? 400));
  return json(result);
}
