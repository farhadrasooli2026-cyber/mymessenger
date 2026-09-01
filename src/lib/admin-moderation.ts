import "server-only";
import { cookies } from "next/headers";
import { z } from "zod";
import { expireStaleRestriction, loginBlocked, postingBlocked } from "@/lib/account-gate";
import {
  ADMIN_BULK_MAX,
  ADMIN_CONFIRM,
  ADMIN_PAGE,
  ADMIN_SESSION_MS,
  emptyAdminMetrics,
  permsForRole,
  roleHasPerm,
  roleRank,
  type AdminPerm,
  type AppealStatus,
  type CaseStatus,
  type ContentAction,
  type ModerationAppeal,
  type ReportPriority,
  type ReportStatus,
  type StaffRole,
} from "@/lib/admin-types";
import { config } from "@/lib/config";
import { decryptText, hmacIdentifier, randomId, signPayload, verifyPayload } from "@/lib/crypto-utils";
import { totpValid } from "@/lib/totp";
import { emitNotification } from "@/lib/notify";
import { hitRateLimit } from "@/lib/rate-limit";
import { passwordMatches, revokeAllOtherDevices, revokeDevice } from "@/lib/security";
import { isNixoOpsHandle, sanitizeUserHtml } from "@/lib/security-core";
import { mutateStore, readStoreSnapshot, type SafetyReport, type StoreData, type UserRecord } from "@/lib/store";

type StaffCookie = { v: 1; userId: string; sid: string; exp: number };

const testStaffCookie: { current: StaffCookie | null } = { current: null };

export function lookupStaff(data: StoreData, userId: string) {
  data.staffMembers ??= [];
  const user = data.users.find((u) => u.id === userId);
  const builtin = isNixoOpsHandle(user?.username);
  const row = data.staffMembers.find((s) => s.userId === userId);
  if (row) return builtin ? { ...row, role: "super_admin" as const } : row;
  if (builtin && user) {
    return {
      userId,
      role: "super_admin" as const,
      extraPerms: [] as AdminPerm[],
      denyPerms: [] as AdminPerm[],
      ipAllow: [] as string[],
      createdAt: 0,
      updatedAt: 0,
      disabled: false,
    };
  }
  return null;
}

export function staffHasPerm(data: StoreData, userId: string, perm: AdminPerm) {
  const staff = lookupStaff(data, userId);
  if (!staff || staff.disabled) return false;
  if (staff.denyPerms.includes(perm)) return false;
  if (staff.extraPerms.includes(perm)) return true;
  return roleHasPerm(staff.role, perm);
}

export function ensureStaff(data: StoreData, userId: string) {
  const user = data.users.find((u) => u.id === userId);
  const builtin = isNixoOpsHandle(user?.username);
  data.staffMembers ??= [];
  let row = data.staffMembers.find((s) => s.userId === userId);
  if (!row && builtin && user) {
    row = {
      userId,
      role: "super_admin",
      extraPerms: [],
      denyPerms: [],
      ipAllow: [],
      createdAt: Date.now(),
      updatedAt: Date.now(),
      disabled: false,
    };
    data.staffMembers.push(row);
  } else if (row && builtin) {
    row.role = "super_admin";
  }
  return lookupStaff(data, userId);
}

function hashStaffToken(token: string) {
  return hmacIdentifier(`staff-session:${token}`);
}

function appendAdminAudit(
  data: StoreData,
  actor: UserRecord,
  role: StaffRole,
  action: string,
  targetType: string,
  targetId: string,
  result: "ok" | "deny" | "error",
  detail: string,
) {
  data.adminAudit ??= [];
  const prev = data.adminAudit[0]?.chainHash ?? "genesis";
  const id = randomId();
  const createdAt = Date.now();
  const safe = sanitizeUserHtml(detail).slice(0, 240);
  const chainHash = hmacIdentifier(`admin:${prev}:${id}:${action}:${createdAt}:${actor.id}:${safe}`);
  data.adminAudit.unshift({
    id,
    actorUserId: actor.id,
    actorRole: role,
    action,
    targetType,
    targetId,
    result,
    detail: safe,
    createdAt,
    chainHash,
  });
  data.adminAudit = data.adminAudit.slice(0, 2000);
  data.adminMetrics ??= emptyAdminMetrics();
  data.adminMetrics.actions += 1;
}

function pushAlert(data: StoreData, severity: "info" | "warning" | "high" | "critical", title: string, detail: string) {
  data.adminAlerts ??= [];
  data.adminAlerts.unshift({
    id: randomId(),
    severity,
    title,
    detail: sanitizeUserHtml(detail).slice(0, 280),
    createdAt: Date.now(),
    ackAt: null,
    ackBy: null,
  });
  data.adminAlerts = data.adminAlerts.slice(0, 400);
  data.adminMetrics ??= emptyAdminMetrics();
  data.adminMetrics.lastAlertAt = Date.now();
  for (const s of data.staffMembers ?? []) {
    if (s.disabled) continue;
    if (!roleHasPerm(s.role, "alerts") && s.role !== "super_admin") continue;
    emitNotification(data, {
      userId: s.userId,
      category: "security",
      kind: "security_alert",
      title,
      body: detail.slice(0, 140),
      sourceId: "admin",
      target: { type: "security", id: "admin", href: "/app/admin" },
      allowDuringDnd: true,
    });
  }
}

export function publicReporter(id: string) {
  return hmacIdentifier(`reporter:${id}`).slice(0, 12);
}

function publicUserCard(user: UserRecord, permPii: boolean) {
  expireStaleRestriction(user);
  return {
    id: user.id,
    username: user.username ?? null,
    displayName: user.displayName ?? user.firstName ?? null,
    status: user.status,
    accountStatus: user.accountStatus ?? "active",
    restrictionKind: user.restrictionKind ?? "none",
    restrictionUntil: user.restrictionUntil ?? null,
    restrictionReason: permPii ? (user.restrictionReason ?? "") : "",
    officialVerified: Boolean(user.officialVerified),
    createdAt: user.createdAt,
    lastSeenAt: permPii ? user.lastSeenAt : null,
    identifierMasked: permPii ? user.identifierMasked : undefined,
    channel: permPii ? user.channel : undefined,
    twoStepEnabled: Boolean(user.twoStepEnabled),
    hasPassword: Boolean(user.passwordHash),
    deviceCount: undefined as number | undefined,
  };
}

export async function readStaffCookie() {
  if (process.env.VITEST) {
    if (!testStaffCookie.current || testStaffCookie.current.exp < Date.now()) return null;
    return testStaffCookie.current;
  }
  const jar = await cookies();
  const token = jar.get(config.staffCookie)?.value;
  if (!token) return null;
  const payload = verifyPayload<StaffCookie>(token);
  if (!payload || payload.v !== 1 || payload.exp < Date.now()) return null;
  return payload;
}

export async function writeStaffCookie(userId: string, sid: string) {
  const payload: StaffCookie = { v: 1, userId, sid, exp: Date.now() + ADMIN_SESSION_MS };
  if (process.env.VITEST) {
    testStaffCookie.current = payload;
    return;
  }
  const jar = await cookies();
  jar.set(config.staffCookie, signPayload(payload), {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: Math.floor(ADMIN_SESSION_MS / 1000),
  });
}

export async function clearStaffCookie() {
  testStaffCookie.current = null;
  if (process.env.VITEST) return;
  const jar = await cookies();
  jar.delete(config.staffCookie);
}

export async function requireStaff(perm?: AdminPerm) {
  const cookie = await readStaffCookie();
  if (!cookie) return { ok: false as const, status: 401 as const, error: "ورود ادمین لازم است." };
  const data = await readStoreSnapshot();
  const session = (data.adminSessions ?? []).find((s) => s.id === cookie.sid && s.userId === cookie.userId);
  if (!session || session.revokedAt || session.expiresAt < Date.now()) {
    return { ok: false as const, status: 401 as const, error: "نشست ادمین منقضی یا باطل است." };
  }
  const user = data.users.find((u) => u.id === cookie.userId);
  if (!user) return { ok: false as const, status: 401 as const, error: "حساب یافت نشد." };
  const staff = lookupStaff(data, user.id);
  if (!staff || staff.disabled) return { ok: false as const, status: 403 as const, error: "دسترسی مدیریتی نداری." };
  if (staff.ipAllow.length) {
    const { clientIp } = await import("@/lib/session");
    const ip = await clientIp();
    if (!staff.ipAllow.includes(ip) && !staff.ipAllow.includes("127.0.0.1")) {
      return { ok: false as const, status: 403 as const, error: "این شبکه برای ادمین مجاز نیست." };
    }
  }
  if (perm && !staffHasPerm(data, user.id, perm)) {
    return { ok: false as const, status: 403 as const, error: "مجوز این عملیات را نداری." };
  }
  return {
    ok: true as const,
    user,
    staff,
    session,
    impersonateUserId: session.impersonateUserId,
    perms: permsForRole(staff.role).filter((p) => !staff.denyPerms.includes(p)).concat(staff.extraPerms),
  };
}

export async function staffLogin(userId: string, password: string, totp: string | undefined, ip: string, userAgent: string) {
  return mutateStore((data) => {
    const limit = hitRateLimit(data, `admin-login:${userId}`, 15 * 60_000, 8);
    const ipLimit = hitRateLimit(data, `admin-login-ip:${ip}`, 15 * 60_000, 20);
    if (!limit.allowed || !ipLimit.allowed) {
      data.adminMetrics ??= emptyAdminMetrics();
      data.adminMetrics.failedAdminLogins += 1;
      return { ok: false as const, error: "تلاش ورود ادمین محدود شد.", status: 429 };
    }
    const user = data.users.find((u) => u.id === userId);
    const staff = user ? ensureStaff(data, user.id) : null;
    if (!user || !staff || staff.disabled) {
      data.adminMetrics ??= emptyAdminMetrics();
      data.adminMetrics.failedAdminLogins += 1;
      return { ok: false as const, error: "ورود ادمین نامعتبر است.", status: 401 };
    }
    if (!passwordMatches(user, password)) {
      data.adminMetrics ??= emptyAdminMetrics();
      data.adminMetrics.failedAdminLogins += 1;
      pushAlert(data, "high", "ورود ناموفق ادمین", `@${user.username ?? "staff"}`);
      appendAdminAudit(data, user, staff.role, "login.fail", "staff", user.id, "deny", "رمز نادرست");
      return { ok: false as const, error: "ورود ادمین نامعتبر است.", status: 401 };
    }
    if (user.totpSecretCipher) {
      let secret = "";
      try {
        secret = decryptText(user.totpSecretCipher);
      } catch {
        secret = "";
      }
      if (!secret || !totpValid(secret, totp ?? "")) {
        data.adminMetrics ??= emptyAdminMetrics();
        data.adminMetrics.failedAdminLogins += 1;
        return { ok: false as const, error: "تأیید دومرحله‌ای ادمین لازم است.", status: 401 };
      }
    }
    const raw = randomId() + randomId();
    const row = {
      id: randomId(),
      userId: user.id,
      tokenHash: hashStaffToken(raw),
      createdAt: Date.now(),
      expiresAt: Date.now() + ADMIN_SESSION_MS,
      lastSeenAt: Date.now(),
      revokedAt: null,
      ipHint: hmacIdentifier(`ip:${ip}`).slice(0, 10),
      userAgent: userAgent.slice(0, 120),
      impersonateUserId: null as string | null,
    };
    data.adminSessions ??= [];
    data.adminSessions.unshift(row);
    appendAdminAudit(data, user, staff.role, "login", "staff", user.id, "ok", "ورود پنل");
    return { ok: true as const, sid: row.id, token: raw, role: staff.role };
  });
}

export async function staffLogout(sid: string, userId: string, allOther = false) {
  return mutateStore((data) => {
    const now = Date.now();
    for (const s of data.adminSessions ?? []) {
      if (s.userId !== userId || s.revokedAt) continue;
      if (allOther ? s.id !== sid : s.id === sid) s.revokedAt = now;
    }
    return { ok: true as const };
  });
}

function confirmOk(action: keyof typeof ADMIN_CONFIRM, typed: string | undefined) {
  return (typed ?? "").trim() === ADMIN_CONFIRM[action];
}

function actorCanTouchRole(actor: StaffRole, target: StaffRole) {
  if (actor === "super_admin") return true;
  if (!roleHasPerm(actor, "roles.manage")) return false;
  return roleRank(target) < roleRank(actor);
}

export function afterReportFiled(data: StoreData, report: SafetyReport) {
  data.adminMetrics ??= emptyAdminMetrics();
  data.adminMetrics.reports += 1;
  report.status = report.status ?? "open";
  report.priority = report.priority ?? (report.category === "abuse" ? "high" : "normal");
  report.assignedTo = report.assignedTo ?? null;
  report.notes = report.notes ?? [];
  report.duplicateOf = report.duplicateOf ?? null;
  const twins = data.reports.filter(
    (r) => r.id !== report.id && r.targetKind === report.targetKind && r.targetKey === report.targetKey && (r.status === "open" || r.status === "reviewing"),
  );
  if (twins[0]) {
    report.duplicateOf = twins[0].id;
    report.status = "open";
  }
  const count = 1 + twins.length;
  if (count >= 3 || report.category === "spam") {
    report.autoFlagged = true;
    if (count >= 3) report.priority = "high";
    data.autoModFlags ??= [];
    data.autoModFlags.unshift({
      id: randomId(),
      targetKind: report.targetKind,
      targetKey: report.targetKey,
      reason: count >= 3 ? "گزارش‌های تکراری — نیاز به بررسی انسانی" : "الگوی هرزنامه",
      status: "pending",
      createdAt: Date.now(),
      reviewedAt: null,
      reviewerId: null,
    });
    data.moderationCases ??= [];
    let cas = data.moderationCases.find((c) => c.targetKind === report.targetKind && c.targetKey === report.targetKey && c.status !== "closed");
    if (!cas) {
      cas = {
        id: randomId(),
        title: `${report.targetKind}:${report.targetKey.slice(0, 8)}`,
        status: "open",
        assigneeId: null,
        reportIds: [],
        targetKind: report.targetKind,
        targetKey: report.targetKey,
        notes: [],
        history: [{ at: Date.now(), actorUserId: "system", action: "open", detail: "پرونده خودکار" }],
        createdAt: Date.now(),
        updatedAt: Date.now(),
      };
      data.moderationCases.unshift(cas);
    }
    if (!cas.reportIds.includes(report.id)) cas.reportIds.push(report.id);
    report.caseId = cas.id;
  }
  data.adminMetrics.openReports = data.reports.filter((r) => r.status === "open" || !r.status).length;
  data.adminMetrics.openCases = (data.moderationCases ?? []).filter((c) => c.status === "open" || c.status === "investigating").length;
}

export async function adminDashboard() {
  const ctx = await requireStaff("dashboard");
  if (!ctx.ok) return ctx;
  const data = await readStoreSnapshot();
  const now = Date.now();
  const metrics = data.adminMetrics ?? emptyAdminMetrics();
  return {
    ok: true as const,
    role: ctx.staff.role,
    perms: ctx.perms,
    impersonateUserId: ctx.impersonateUserId,
    metrics: {
      ...metrics,
      reports: data.reports.length,
      openReports: data.reports.filter((r) => (r.status ?? "open") === "open" || r.status === "reviewing").length,
      openCases: (data.moderationCases ?? []).filter((c) => c.status === "open" || c.status === "investigating").length,
      bans: data.users.filter((u) => expireStaleRestriction(u, now).accountStatus === "banned").length,
      suspensions: data.users.filter((u) => u.accountStatus === "suspended").length,
      appeals: (data.moderationAppeals ?? []).filter((a) => a.status === "open" || a.status === "reviewing").length,
      users: data.users.length,
      flags: (data.autoModFlags ?? []).filter((f) => f.status === "pending").length,
    },
    alerts: (data.adminAlerts ?? []).slice(0, 8).map((a) => ({
      id: a.id,
      severity: a.severity,
      title: a.title,
      createdAt: a.createdAt,
      ack: Boolean(a.ackAt),
    })),
    sessions: (data.adminSessions ?? [])
      .filter((s) => s.userId === ctx.user.id && !s.revokedAt && s.expiresAt > now)
      .map((s) => ({
        id: s.id,
        current: s.id === ctx.session.id,
        createdAt: s.createdAt,
        lastSeenAt: s.lastSeenAt,
        ipHint: s.ipHint,
        userAgent: s.userAgent,
      })),
  };
}

export async function searchUsers(query: string, page = 0) {
  const ctx = await requireStaff("users.search");
  if (!ctx.ok) return ctx;
  const data = await mutateStore((d) => {
    appendAdminAudit(d, ctx.user, ctx.staff.role, "users.search", "user", "list", "ok", query.slice(0, 40));
    return d;
  });
  const q = query.trim().replace(/^@/, "").toLowerCase();
  if (q.length === 1) return { ok: false as const, error: "جستجو کوتاه است.", status: 400 };
  const hits = data.users.filter((u) => {
    if (!q) return true;
    if (u.id === q) return true;
    if ((u.username ?? "").toLowerCase().includes(q)) return true;
    if ((u.displayName ?? "").toLowerCase().includes(q)) return true;
    return false;
  });
  const start = Math.max(0, page) * ADMIN_PAGE;
  const slice = hits.slice(start, start + ADMIN_PAGE);
  return {
    ok: true as const,
    total: hits.length,
    page,
    users: slice.map((u) => publicUserCard(u, staffHasPerm(data, ctx.user.id, "users.view"))),
  };
}

export async function viewUser(targetId: string) {
  const ctx = await requireStaff("users.view");
  if (!ctx.ok) return ctx;
  return mutateStore((data) => {
    const user = data.users.find((u) => u.id === targetId);
    if (!user) return { ok: false as const, error: "کاربر یافت نشد.", status: 404 };
    appendAdminAudit(data, ctx.user, ctx.staff.role, "users.view", "user", targetId, "ok", "پروفایل مدیریتی");
    const warnings = (data.accountWarnings ?? []).filter((w) => w.userId === targetId).slice(0, 20);
    const devices = (data.devices ?? [])
      .filter((d) => d.userId === targetId && !d.revokedAt)
      .map((d) => ({
        id: d.id,
        name: d.name,
        deviceType: d.deviceType,
        os: d.os,
        lastSeenAt: d.lastSeenAt,
        pending: d.pending,
        trusted: d.trusted,
      }));
    const events = data.audit
      .filter((e) => e.userId === targetId)
      .slice(0, 20)
      .map((e) => ({ id: e.id, kind: e.kind, createdAt: e.createdAt, title: e.detail?.slice(0, 80) }));
    return {
      ok: true as const,
      user: { ...publicUserCard(user, true), deviceCount: devices.length },
      warnings: warnings.map((w) => ({ id: w.id, reason: w.reason, createdAt: w.createdAt })),
      devices,
      events,
    };
  });
}

function sensitiveOk(
  ctx: Extract<Awaited<ReturnType<typeof requireStaff>>, { ok: true }>,
  password: string | undefined,
  confirmKey: keyof typeof ADMIN_CONFIRM,
  typed: string | undefined,
) {
  if (!confirmOk(confirmKey, typed)) return { ok: false as const, error: "تأیید عبارت لازم است.", status: 400 };
  if (!password || !passwordMatches(ctx.user, password)) return { ok: false as const, error: "رمز ادمین لازم است.", status: 401 };
  if (ctx.session.impersonateUserId) return { ok: false as const, error: "در حالت مشاهدهٔ کاربر عملیات حساس مجاز نیست.", status: 403 };
  return { ok: true as const };
}

export async function applyRestriction(input: {
  targetId: string;
  kind: "restrict" | "suspend" | "ban";
  until?: number | null;
  reason: string;
  password: string;
  confirm: string;
  permanent?: boolean;
}) {
  const perm: AdminPerm = input.kind === "ban" ? "users.ban" : input.kind === "suspend" ? "users.suspend" : "users.restrict";
  const ctx = await requireStaff(perm);
  if (!ctx.ok) return ctx;
  const confirmKey: keyof typeof ADMIN_CONFIRM = input.kind === "ban" ? "ban" : "suspend";
  return mutateStore((data) => {
    const g = sensitiveOk(ctx, input.password, confirmKey, input.confirm);
    if (!g.ok) return g;
    const target = data.users.find((u) => u.id === input.targetId);
    if (!target) return { ok: false as const, error: "کاربر یافت نشد.", status: 404 };
    if (lookupStaff(data, target.id)?.role === "super_admin" && ctx.staff.role !== "super_admin") {
      return { ok: false as const, error: "این حساب محافظت شده است.", status: 403 };
    }
    const now = Date.now();
    target.restrictionKind = input.kind;
    target.restrictionReason = sanitizeUserHtml(input.reason).slice(0, 400);
    target.restrictionPermanent = Boolean(input.permanent) && input.kind === "ban";
    target.restrictionUntil = target.restrictionPermanent
      ? null
      : input.until && input.until > now
        ? input.until
        : input.kind === "restrict"
          ? now + 24 * 60 * 60_000
          : input.until ?? now + 7 * 24 * 60 * 60_000;
    target.accountStatus = input.kind === "ban" ? "banned" : input.kind === "suspend" ? "suspended" : "restricted";
    for (const d of data.devices) {
      if (d.userId === target.id && !d.revokedAt) d.revokedAt = now;
    }
    for (const s of data.adminSessions ?? []) {
      if (s.userId === target.id && !s.revokedAt) s.revokedAt = now;
    }
    data.adminMetrics ??= emptyAdminMetrics();
    if (input.kind === "ban") data.adminMetrics.bans += 1;
    if (input.kind === "suspend") data.adminMetrics.suspensions += 1;
    appendAdminAudit(data, ctx.user, ctx.staff.role, `users.${input.kind}`, "user", target.id, "ok", target.restrictionReason ?? "");
    pushAlert(data, "critical", input.kind === "ban" ? "مسدودسازی حساب" : "محدودیت حساب", `@${target.username ?? target.id.slice(0, 6)}`);
    return { ok: true as const, accountStatus: target.accountStatus };
  });
}

export async function unbanUser(targetId: string, password: string, confirm: string) {
  const ctx = await requireStaff("users.unban");
  if (!ctx.ok) return ctx;
  return mutateStore((data) => {
    const g = sensitiveOk(ctx, password, "ban", confirm);
    if (!g.ok) return g;
    const target = data.users.find((u) => u.id === targetId);
    if (!target) return { ok: false as const, error: "کاربر یافت نشد.", status: 404 };
    target.accountStatus = "active";
    target.restrictionKind = "none";
    target.restrictionUntil = null;
    target.restrictionPermanent = false;
    appendAdminAudit(data, ctx.user, ctx.staff.role, "users.unban", "user", targetId, "ok", "رفع مسدود");
    return { ok: true as const };
  });
}

export async function warnUser(targetId: string, reason: string) {
  const ctx = await requireStaff("users.warn");
  if (!ctx.ok) return ctx;
  return mutateStore((data) => {
    const target = data.users.find((u) => u.id === targetId);
    if (!target) return { ok: false as const, error: "کاربر یافت نشد.", status: 404 };
    data.accountWarnings ??= [];
    data.accountWarnings.unshift({
      id: randomId(),
      userId: targetId,
      reason: sanitizeUserHtml(reason).slice(0, 400),
      actorUserId: ctx.user.id,
      createdAt: Date.now(),
    });
    appendAdminAudit(data, ctx.user, ctx.staff.role, "users.warn", "user", targetId, "ok", reason.slice(0, 80));
    emitNotification(data, {
      userId: targetId,
      category: "security",
      kind: "security",
      title: "هشدار ایمنی نیکسو",
      body: "یک هشدار سیاست برای حسابت ثبت شد.",
      sourceId: "moderation",
      target: { type: "security", id: "warn", href: "/app/settings/appeals" },
      allowDuringDnd: true,
    });
    return { ok: true as const };
  });
}

export async function adminRevokeUserSessions(targetId: string, deviceId?: string) {
  const ctx = await requireStaff("sessions.revoke");
  if (!ctx.ok) return ctx;
  if (deviceId) {
    const r = await revokeDevice(targetId, deviceId);
    await mutateStore((data) => {
      appendAdminAudit(data, ctx.user, ctx.staff.role, "sessions.revoke", "device", deviceId, r ? "ok" : "error", "");
    });
    return r ? { ok: true as const } : { ok: false as const, error: "ابطال نشد.", status: 400 };
  }
  await revokeAllOtherDevices(targetId, undefined);
  await mutateStore((data) => {
    for (const s of data.miniSessions ?? []) {
      if (s.userId === targetId && !s.revokedAt) s.revokedAt = Date.now();
    }
    appendAdminAudit(data, ctx.user, ctx.staff.role, "tokens.revoke", "user", targetId, "ok", "نشست و توکن");
  });
  return { ok: true as const };
}

function serializeReport(data: StoreData, r: SafetyReport, evidence: boolean) {
  return {
    id: r.id,
    targetKind: r.targetKind,
    targetKey: r.targetKey,
    category: r.category,
    details: evidence ? sanitizeUserHtml(r.details) : "",
    createdAt: r.createdAt,
    status: r.status ?? "open",
    priority: r.priority ?? "normal",
    assignedTo: r.assignedTo ?? null,
    duplicateOf: r.duplicateOf ?? null,
    autoFlagged: Boolean(r.autoFlagged),
    caseId: r.caseId ?? null,
    reporter: evidence ? publicReporter(r.reporterId) : undefined,
    messageIds: evidence ? r.messageIds : [],
    notes: evidence ? (r.notes ?? []).map((n) => ({ id: n.id, body: n.body, createdAt: n.createdAt })) : [],
    targetHint: evidence ? evidenceHint(data, r) : null,
  };
}

function evidenceHint(data: StoreData, r: SafetyReport) {
  if (r.targetKind === "user" || r.targetKind === "profile") {
    const u = data.users.find((x) => x.id === r.targetKey);
    return u ? { username: u.username, displayName: u.displayName } : { id: r.targetKey };
  }
  if (r.targetKind === "story") {
    const s = data.userStories.find((x) => x.id === r.targetKey);
    return s ? { owner: s.ownerUserId, kind: s.kind, deleted: Boolean(s.deletedAt) } : { missing: true };
  }
  if (r.targetKind === "group") {
    const gid = r.targetKey.split(":")[0] ?? r.targetKey;
    const g = data.groups.find((x) => x.id === gid);
    return g ? { name: g.name, hold: g.platformHold ?? "ok" } : { missing: true };
  }
  if (r.targetKind === "channel") {
    const cid = r.targetKey.split(":")[0] ?? r.targetKey;
    const c = data.pubChannels.find((x) => x.id === cid);
    return c ? { name: c.name, status: c.status } : { missing: true };
  }
  if (r.targetKind === "file") {
    const f = (data.vaultObjects ?? []).find((x) => x.id === r.targetKey);
    return f ? { ownerUserId: f.ownerUserId, name: f.originalName, mime: f.mime } : { missing: true };
  }
  if (r.targetKind === "chat" || r.targetKind === "message") {
    return { encrypted: true, note: "متن گفتگوی خصوصی E2EE برای ناظر قابل مشاهده نیست." };
  }
  return { targetKey: r.targetKey };
}

export async function listReports(filter: {
  status?: ReportStatus;
  type?: string;
  priority?: ReportPriority;
  q?: string;
  page?: number;
}) {
  const ctx = await requireStaff("reports.view");
  if (!ctx.ok) return ctx;
  const data = await readStoreSnapshot();
  const evidence = staffHasPerm(data, ctx.user.id, "reports.evidence");
  let rows = [...data.reports];
  if (filter.status) rows = rows.filter((r) => (r.status ?? "open") === filter.status);
  if (filter.type) rows = rows.filter((r) => r.targetKind === filter.type);
  if (filter.priority) rows = rows.filter((r) => (r.priority ?? "normal") === filter.priority);
  if (filter.q) {
    const q = filter.q.toLowerCase();
    rows = rows.filter((r) => r.id.includes(q) || r.targetKey.toLowerCase().includes(q) || r.category.includes(q));
  }
  const page = filter.page ?? 0;
  const start = page * ADMIN_PAGE;
  return {
    ok: true as const,
    total: rows.length,
    page,
    reports: rows.slice(start, start + ADMIN_PAGE).map((r) => serializeReport(data, r, evidence)),
  };
}

export async function getReport(id: string) {
  const ctx = await requireStaff("reports.view");
  if (!ctx.ok) return ctx;
  return mutateStore((data) => {
    const r = data.reports.find((x) => x.id === id);
    if (!r) return { ok: false as const, error: "گزارش یافت نشد.", status: 404 };
    const evidence = staffHasPerm(data, ctx.user.id, "reports.evidence");
    if (evidence) {
      appendAdminAudit(data, ctx.user, ctx.staff.role, "reports.evidence", "report", id, "ok", r.targetKind);
    }
    return { ok: true as const, report: serializeReport(data, r, evidence) };
  });
}

export async function mutateReport(input: {
  id: string;
  status?: ReportStatus;
  priority?: ReportPriority;
  assignedTo?: string | null;
  note?: string;
}) {
  const ctx = await requireStaff("reports.assign");
  if (!ctx.ok) return ctx;
  return mutateStore((data) => {
    const r = data.reports.find((x) => x.id === input.id);
    if (!r) return { ok: false as const, error: "گزارش یافت نشد.", status: 404 };
    if (input.status) r.status = input.status;
    if (input.priority) r.priority = input.priority;
    if (input.assignedTo !== undefined) r.assignedTo = input.assignedTo;
    if (input.note && staffHasPerm(data, ctx.user.id, "notes.write")) {
      r.notes = r.notes ?? [];
      r.notes.unshift({
        id: randomId(),
        authorUserId: ctx.user.id,
        body: sanitizeUserHtml(input.note).slice(0, 500),
        createdAt: Date.now(),
        internal: true,
      });
    }
    appendAdminAudit(data, ctx.user, ctx.staff.role, "reports.update", "report", r.id, "ok", r.status ?? "");
    return { ok: true as const };
  });
}

export async function takeContentAction(input: {
  reportId?: string;
  kind: "message" | "story" | "file" | "group" | "channel" | "profile" | "post";
  targetId: string;
  action: ContentAction;
  reason: string;
  password?: string;
  confirm?: string;
}) {
  const ctx = await requireStaff(input.action === "ban" ? "users.ban" : input.action === "restore" as string ? "content.restore" : "content.remove");
  if (!ctx.ok) return ctx;
  if (input.action === "none") {
    return mutateStore((data) => {
      appendAdminAudit(data, ctx.user, ctx.staff.role, "content.none", input.kind, input.targetId, "ok", "");
      return { ok: true as const };
    });
  }
  if (input.action === "escalate") {
    return mutateStore((data) => {
      const r = input.reportId ? data.reports.find((x) => x.id === input.reportId) : null;
      if (r) {
        r.status = "escalated";
        r.priority = "critical";
      }
      pushAlert(data, "high", "ارجاع محتوا", input.targetId.slice(0, 12));
      appendAdminAudit(data, ctx.user, ctx.staff.role, "content.escalate", input.kind, input.targetId, "ok", "");
      return { ok: true as const };
    });
  }
  if (input.action === "warning") {
    return warnUser(input.targetId, input.reason);
  }
  if (input.action === "restrict" || input.action === "suspend" || input.action === "ban") {
    if (!input.password) return { ok: false as const, error: "رمز لازم است.", status: 401 };
    return applyRestriction({
      targetId: input.targetId,
      kind: input.action,
      reason: input.reason,
      password: input.password,
      confirm: input.confirm ?? (input.action === "ban" ? "BAN" : "SUSPEND"),
    });
  }
  return mutateStore((data) => {
    const reason = sanitizeUserHtml(input.reason).slice(0, 400);
    if (!reason) return { ok: false as const, error: "دلیل حذف لازم است.", status: 400 };
    data.contentTombstones ??= [];
    const snap: Record<string, unknown> = { kind: input.kind, targetId: input.targetId };
    if (input.kind === "story") {
      const story = data.userStories.find((s) => s.id === input.targetId);
      if (!story) return { ok: false as const, error: "استوری یافت نشد.", status: 404 };
      snap.deletedAt = story.deletedAt;
      snap.media = Boolean(story.media);
      story.deletedAt = Date.now();
      story.shareToken = "";
    } else if (input.kind === "group") {
      if (!staffHasPerm(data, ctx.user.id, "groups.moderate")) return { ok: false as const, error: "مجوز گروه نداری.", status: 403 };
      const group = data.groups.find((g) => g.id === input.targetId);
      if (!group) return { ok: false as const, error: "گروه یافت نشد.", status: 404 };
      snap.hold = group.platformHold;
      group.platformHold = "removed";
      group.platformHoldReason = reason;
    } else if (input.kind === "channel") {
      if (!staffHasPerm(data, ctx.user.id, "channels.moderate")) return { ok: false as const, error: "مجوز کانال نداری.", status: 403 };
      const ch = data.pubChannels.find((c) => c.id === input.targetId);
      if (!ch) return { ok: false as const, error: "کانال یافت نشد.", status: 404 };
      snap.status = ch.status;
      ch.status = "suspended";
    } else if (input.kind === "file") {
      const file = (data.vaultObjects ?? []).find((o) => o.id === input.targetId);
      if (!file) return { ok: false as const, error: "فایل یافت نشد.", status: 404 };
      appendAdminAudit(data, ctx.user, ctx.staff.role, "private.file", "file", file.id, "ok", "مشاهدهٔ محدود گزارش");
      snap.deletedAt = file.deletedAt;
      file.deletedAt = Date.now();
    } else if (input.kind === "message") {
      const msg = data.messages.find((m) => m.id === input.targetId) ?? data.groupMessages.find((m) => m.id === input.targetId);
      if (!msg) return { ok: false as const, error: "پیام در صف بررسی است؛ متن E2EE افشا نمی‌شود.", status: 404 };
      if ("deletedEverywhere" in msg) msg.deletedEverywhere = true;
    } else if (input.kind === "profile") {
      const user = data.users.find((u) => u.id === input.targetId);
      if (!user) return { ok: false as const, error: "کاربر یافت نشد.", status: 404 };
      snap.bio = user.bio;
      user.bio = "";
    } else if (input.kind === "post") {
      const post = data.channelPosts.find((p) => p.id === input.targetId);
      if (!post) return { ok: false as const, error: "پست یافت نشد.", status: 404 };
      post.deleted = true;
    }
    data.contentTombstones.unshift({
      id: randomId(),
      kind: input.kind,
      targetId: input.targetId,
      reason,
      actorUserId: ctx.user.id,
      createdAt: Date.now(),
      restoredAt: null,
      snapshot: JSON.stringify(snap).slice(0, 2000),
    });
    if (input.reportId) {
      const r = data.reports.find((x) => x.id === input.reportId);
      if (r) r.status = "resolved";
    }
    appendAdminAudit(data, ctx.user, ctx.staff.role, "content.remove", input.kind, input.targetId, "ok", reason);
    return { ok: true as const };
  });
}

export async function restoreContent(tombstoneId: string, password: string, confirm: string) {
  const ctx = await requireStaff("content.restore");
  if (!ctx.ok) return ctx;
  return mutateStore((data) => {
    const g = sensitiveOk(ctx, password, "restore", confirm);
    if (!g.ok) return g;
    const row = (data.contentTombstones ?? []).find((t) => t.id === tombstoneId);
    if (!row || row.restoredAt) return { ok: false as const, error: "قابل بازیابی نیست.", status: 404 };
    let snap: Record<string, unknown> = {};
    try {
      snap = JSON.parse(row.snapshot) as Record<string, unknown>;
    } catch {
      snap = {};
    }
    if (row.kind === "story") {
      const story = data.userStories.find((s) => s.id === row.targetId);
      if (story) story.deletedAt = null;
    } else if (row.kind === "group") {
      const group = data.groups.find((g) => g.id === row.targetId);
      if (group) {
        group.platformHold = "ok";
        group.platformHoldReason = "";
      }
    } else if (row.kind === "channel") {
      const ch = data.pubChannels.find((c) => c.id === row.targetId);
      if (ch) {
        ch.status = "active";
        ch.deletedAt = null;
      }
    } else if (row.kind === "file") {
      const file = (data.vaultObjects ?? []).find((o) => o.id === row.targetId);
      if (file) file.deletedAt = null;
    } else if (row.kind === "post") {
      const post = data.channelPosts.find((p) => p.id === row.targetId);
      if (post) post.deleted = false;
    } else if (row.kind === "profile") {
      const user = data.users.find((u) => u.id === row.targetId);
      if (user && typeof snap.bio === "string") user.bio = snap.bio;
    }
    row.restoredAt = Date.now();
    appendAdminAudit(data, ctx.user, ctx.staff.role, "content.restore", row.kind, row.targetId, "ok", "");
    return { ok: true as const };
  });
}

export async function setGroupHold(groupId: string, hold: "ok" | "restricted" | "removed", reason: string, ownerUserId?: string) {
  const ctx = await requireStaff("groups.moderate");
  if (!ctx.ok) return ctx;
  return mutateStore((data) => {
    const group = data.groups.find((g) => g.id === groupId && !g.deletedAt);
    if (!group) return { ok: false as const, error: "گروه یافت نشد.", status: 404 };
    if (ownerUserId) {
      if (!staffHasPerm(data, ctx.user.id, "groups.owner")) {
        return { ok: false as const, error: "تغییر مالک گروه مجاز نیست.", status: 403 };
      }
      if (!group.members.some((m) => m.key === ownerUserId && !m.leftAt)) {
        return { ok: false as const, error: "مالک جدید باید عضو باشد.", status: 400 };
      }
      group.ownerUserId = ownerUserId;
      appendAdminAudit(data, ctx.user, ctx.staff.role, "groups.owner", "group", groupId, "ok", "");
    }
    group.platformHold = hold;
    group.platformHoldReason = sanitizeUserHtml(reason).slice(0, 200);
    appendAdminAudit(data, ctx.user, ctx.staff.role, "groups.hold", "group", groupId, "ok", hold);
    return { ok: true as const };
  });
}

export async function setChannelHold(channelId: string, status: "active" | "restricted" | "suspended", ownerUserId?: string) {
  const ctx = await requireStaff("channels.moderate");
  if (!ctx.ok) return ctx;
  return mutateStore((data) => {
    const ch = data.pubChannels.find((c) => c.id === channelId);
    if (!ch) return { ok: false as const, error: "کانال یافت نشد.", status: 404 };
    if (ownerUserId) {
      if (!staffHasPerm(data, ctx.user.id, "channels.owner")) {
        return { ok: false as const, error: "تغییر مالک کانال مجاز نیست.", status: 403 };
      }
      const staff = ch.staff.find((s) => s.userId === ownerUserId);
      if (!staff) return { ok: false as const, error: "مالک جدید باید در کارکنان کانال باشد.", status: 400 };
      for (const s of ch.staff) if (s.role === "owner") s.role = "admin";
      staff.role = "owner";
      appendAdminAudit(data, ctx.user, ctx.staff.role, "channels.owner", "channel", channelId, "ok", "");
    }
    ch.status = status;
    if (status === "active") ch.deletedAt = null;
    appendAdminAudit(data, ctx.user, ctx.staff.role, "channels.hold", "channel", channelId, "ok", status);
    return { ok: true as const };
  });
}

export async function listCases(status?: CaseStatus, page = 0) {
  const ctx = await requireStaff("cases.manage");
  if (!ctx.ok) return ctx;
  const data = await readStoreSnapshot();
  let rows = data.moderationCases ?? [];
  if (status) rows = rows.filter((c) => c.status === status);
  const start = page * ADMIN_PAGE;
  return {
    ok: true as const,
    total: rows.length,
    page,
    cases: rows.slice(start, start + ADMIN_PAGE).map((c) => ({
      id: c.id,
      title: c.title,
      status: c.status,
      assigneeId: c.assigneeId,
      reports: c.reportIds.length,
      updatedAt: c.updatedAt,
    })),
  };
}

export async function mutateCase(input: { id?: string; title?: string; status?: CaseStatus; assigneeId?: string | null; reportId?: string; note?: string }) {
  const ctx = await requireStaff("cases.manage");
  if (!ctx.ok) return ctx;
  return mutateStore((data) => {
    data.moderationCases ??= [];
    let cas = input.id ? data.moderationCases.find((c) => c.id === input.id) : undefined;
    if (!cas) {
      cas = {
        id: randomId(),
        title: sanitizeUserHtml(input.title || "پرونده").slice(0, 80),
        status: "open",
        assigneeId: input.assigneeId ?? ctx.user.id,
        reportIds: input.reportId ? [input.reportId] : [],
        targetKind: "mixed",
        targetKey: "",
        notes: [],
        history: [{ at: Date.now(), actorUserId: ctx.user.id, action: "create", detail: "" }],
        createdAt: Date.now(),
        updatedAt: Date.now(),
      };
      data.moderationCases.unshift(cas);
    }
    if (input.status) cas.status = input.status;
    if (input.assigneeId !== undefined) cas.assigneeId = input.assigneeId;
    if (input.title) cas.title = sanitizeUserHtml(input.title).slice(0, 80);
    if (input.reportId && !cas.reportIds.includes(input.reportId)) cas.reportIds.push(input.reportId);
    if (input.note) {
      cas.notes.unshift({
        id: randomId(),
        authorUserId: ctx.user.id,
        body: sanitizeUserHtml(input.note).slice(0, 500),
        createdAt: Date.now(),
        internal: true,
      });
    }
    cas.history.unshift({ at: Date.now(), actorUserId: ctx.user.id, action: "update", detail: cas.status });
    cas.updatedAt = Date.now();
    appendAdminAudit(data, ctx.user, ctx.staff.role, "cases.update", "case", cas.id, "ok", cas.status);
    return { ok: true as const, id: cas.id, history: cas.history.slice(0, 20) };
  });
}

export async function listAppeals(page = 0) {
  const ctx = await requireStaff("appeals.review");
  if (!ctx.ok) return ctx;
  const data = await readStoreSnapshot();
  const rows = data.moderationAppeals ?? [];
  const start = page * ADMIN_PAGE;
  return {
    ok: true as const,
    total: rows.length,
    page,
    appeals: rows.slice(start, start + ADMIN_PAGE).map((a) => ({
      id: a.id,
      kind: a.kind,
      status: a.status,
      createdAt: a.createdAt,
      userHint: publicReporter(a.userId),
    })),
  };
}

export async function decideAppeal(id: string, status: AppealStatus, decision: string) {
  const ctx = await requireStaff("appeals.review");
  if (!ctx.ok) return ctx;
  return mutateStore((data) => {
    const row = (data.moderationAppeals ?? []).find((a) => a.id === id);
    if (!row) return { ok: false as const, error: "اعتراض یافت نشد.", status: 404 };
    row.status = status;
    row.decision = sanitizeUserHtml(decision).slice(0, 400);
    row.reviewerId = ctx.user.id;
    row.decidedAt = Date.now();
    if (status === "accepted" && (row.kind === "ban" || row.kind === "suspend")) {
      const user = data.users.find((u) => u.id === row.userId);
      if (user) {
        user.accountStatus = "active";
        user.restrictionKind = "none";
        user.restrictionUntil = null;
      }
    }
    appendAdminAudit(data, ctx.user, ctx.staff.role, "appeals.decide", "appeal", id, "ok", status);
    return { ok: true as const };
  });
}

export async function fileAppeal(userId: string, kind: ModerationAppeal["kind"], body: string, targetId = "") {
  return mutateStore((data) => {
    const limit = hitRateLimit(data, `appeal:${userId}`, 24 * 60 * 60_000, 3);
    if (!limit.allowed) return { ok: false as const, error: "سقف اعتراض امروز پر است.", status: 429 };
    data.moderationAppeals ??= [];
    const row = {
      id: randomId(),
      userId,
      kind,
      targetId,
      body: sanitizeUserHtml(body).slice(0, 800),
      status: "open" as const,
      decision: "",
      reviewerId: null,
      createdAt: Date.now(),
      decidedAt: null,
    };
    data.moderationAppeals.unshift(row);
    data.adminMetrics ??= emptyAdminMetrics();
    data.adminMetrics.appeals += 1;
    return { ok: true as const, id: row.id };
  });
}

export async function listMyAppeals(userId: string) {
  const data = await readStoreSnapshot();
  return (data.moderationAppeals ?? [])
    .filter((a) => a.userId === userId)
    .slice(0, 20)
    .map((a) => ({ id: a.id, kind: a.kind, status: a.status, createdAt: a.createdAt, decision: a.decision }));
}

export async function setStaffRole(targetUserId: string, role: StaffRole, password: string, confirm: string) {
  const ctx = await requireStaff("roles.manage");
  if (!ctx.ok) return ctx;
  return mutateStore((data) => {
    const g = sensitiveOk(ctx, password, "role", confirm);
    if (!g.ok) return g;
    if (!actorCanTouchRole(ctx.staff.role, role)) return { ok: false as const, error: "ارتقای نقش مجاز نیست.", status: 403 };
    const target = data.users.find((u) => u.id === targetUserId);
    if (!target) return { ok: false as const, error: "کاربر یافت نشد.", status: 404 };
    const existing = ensureStaff(data, targetUserId);
    if (existing && !actorCanTouchRole(ctx.staff.role, existing.role)) {
      return { ok: false as const, error: "تغییر این نقش مجاز نیست.", status: 403 };
    }
    if (existing?.role === "super_admin" && ctx.staff.role !== "super_admin") {
      return { ok: false as const, error: "ابرادمین محافظت شده است.", status: 403 };
    }
    if (targetUserId === ctx.user.id && roleRank(role) > roleRank(ctx.staff.role)) {
      return { ok: false as const, error: "نمی‌توانی نقش خود را ارتقا دهی.", status: 403 };
    }
    const supers = (data.staffMembers ?? []).filter((s) => s.role === "super_admin" && !s.disabled);
    if (existing?.role === "super_admin" && role !== "super_admin" && supers.length < 2) {
      return { ok: false as const, error: "آخرین ابرادمین را نمی‌توان تنزل داد.", status: 403 };
    }
    if (!existing) {
      data.staffMembers.push({
        userId: targetUserId,
        role,
        extraPerms: [],
        denyPerms: [],
        ipAllow: [],
        createdAt: Date.now(),
        updatedAt: Date.now(),
        disabled: false,
      });
    } else {
      existing.role = role;
      existing.updatedAt = Date.now();
    }
    appendAdminAudit(data, ctx.user, ctx.staff.role, "roles.change", "staff", targetUserId, "ok", role);
    return { ok: true as const };
  });
}

export async function startImpersonation(targetId: string, password: string, confirm: string) {
  const ctx = await requireStaff("impersonate");
  if (!ctx.ok) return ctx;
  return mutateStore((data) => {
    const g = sensitiveOk(ctx, password, "impersonate", confirm);
    if (!g.ok) return g;
    const target = data.users.find((u) => u.id === targetId);
    if (!target) return { ok: false as const, error: "کاربر یافت نشد.", status: 404 };
    const session = data.adminSessions.find((s) => s.id === ctx.session.id);
    if (session) session.impersonateUserId = targetId;
    appendAdminAudit(data, ctx.user, ctx.staff.role, "impersonate.start", "user", targetId, "ok", "مشاهده محدود");
    pushAlert(data, "critical", "مشاهدهٔ حساب کاربر", "impersonation");
    return { ok: true as const };
  });
}

export async function stopImpersonation() {
  const ctx = await requireStaff();
  if (!ctx.ok) return ctx;
  return mutateStore((data) => {
    const session = data.adminSessions.find((s) => s.id === ctx.session.id);
    if (session) session.impersonateUserId = null;
    appendAdminAudit(data, ctx.user, ctx.staff.role, "impersonate.stop", "staff", ctx.user.id, "ok", "");
    return { ok: true as const };
  });
}

export async function exportReports(password: string, confirm: string) {
  const ctx = await requireStaff("export");
  if (!ctx.ok) return ctx;
  return mutateStore((data) => {
    const g = sensitiveOk(ctx, password, "export", confirm);
    if (!g.ok) return g;
    const limit = hitRateLimit(data, `admin-export:${ctx.user.id}`, 60 * 60_000, 2);
    if (!limit.allowed) return { ok: false as const, error: "سقف خروجی.", status: 429 };
    const rows = data.reports.slice(0, 200).map((r) => ({
      id: r.id,
      kind: r.targetKind,
      category: r.category,
      status: r.status ?? "open",
      createdAt: r.createdAt,
    }));
    appendAdminAudit(data, ctx.user, ctx.staff.role, "export", "reports", "batch", "ok", String(rows.length));
    return { ok: true as const, rows };
  });
}

export async function bulkAction(ids: string[], action: "assign" | "reject", password: string, confirm: string) {
  const ctx = await requireStaff("bulk");
  if (!ctx.ok) return ctx;
  if (ids.length > ADMIN_BULK_MAX) return { ok: false as const, error: `حداکثر ${ADMIN_BULK_MAX} مورد.`, status: 400 };
  return mutateStore((data) => {
    const g = sensitiveOk(ctx, password, "bulk", confirm);
    if (!g.ok) return g;
    let n = 0;
    for (const id of ids) {
      const r = data.reports.find((x) => x.id === id);
      if (!r) continue;
      if (action === "assign") r.assignedTo = ctx.user.id;
      if (action === "reject") r.status = "rejected";
      n += 1;
    }
    appendAdminAudit(data, ctx.user, ctx.staff.role, "bulk", "reports", action, "ok", String(n));
    return { ok: true as const, count: n };
  });
}

export async function listAudit(page = 0) {
  const ctx = await requireStaff("audit.view");
  if (!ctx.ok) return ctx;
  const data = await readStoreSnapshot();
  const rows = data.adminAudit ?? [];
  const start = page * ADMIN_PAGE;
  return {
    ok: true as const,
    total: rows.length,
    page,
    immutable: true,
    integrity: verifyAdminAudit(rows),
    audit: rows.slice(start, start + ADMIN_PAGE).map((a) => ({
      id: a.id,
      actorRole: a.actorRole,
      action: a.action,
      targetType: a.targetType,
      targetId: a.targetId,
      result: a.result,
      createdAt: a.createdAt,
      detail: a.detail,
    })),
  };
}

export function verifyAdminAudit(rows: StoreData["adminAudit"]) {
  const chrono = [...rows].reverse();
  let prev = "genesis";
  for (const e of chrono) {
    const expect = hmacIdentifier(`admin:${prev}:${e.id}:${e.action}:${e.createdAt}:${e.actorUserId}:${e.detail}`);
    if (e.chainHash !== expect) return false;
    prev = e.chainHash;
  }
  return true;
}

export async function recoverModeration() {
  const ctx = await requireStaff();
  if (!ctx.ok) return ctx;
  if (ctx.staff.role !== "super_admin") return { ok: false as const, error: "فقط ابرادمین.", status: 403 };
  return mutateStore((data) => {
    data.reports ??= [];
    data.moderationCases ??= [];
    data.moderationAppeals ??= [];
    data.adminAudit ??= [];
    data.contentTombstones ??= [];
    data.adminMetrics ??= emptyAdminMetrics();
    appendAdminAudit(data, ctx.user, ctx.staff.role, "recovery", "moderation", "core", "ok", "rehydrate");
    return {
      ok: true as const,
      reports: data.reports.length,
      cases: data.moderationCases.length,
      appeals: data.moderationAppeals.length,
    };
  });
}

export async function reviewAutoFlag(id: string, status: "confirmed" | "false_positive") {
  const ctx = await requireStaff("reports.assign");
  if (!ctx.ok) return ctx;
  return mutateStore((data) => {
    const row = (data.autoModFlags ?? []).find((f) => f.id === id);
    if (!row) return { ok: false as const, error: "پرچم یافت نشد.", status: 404 };
    row.status = status;
    row.reviewedAt = Date.now();
    row.reviewerId = ctx.user.id;
    appendAdminAudit(data, ctx.user, ctx.staff.role, "flags.review", "flag", id, "ok", status);
    return { ok: true as const };
  });
}

export async function listFlags() {
  const ctx = await requireStaff("reports.view");
  if (!ctx.ok) return ctx;
  const data = await readStoreSnapshot();
  return {
    ok: true as const,
    flags: (data.autoModFlags ?? []).slice(0, 50).map((f) => ({
      id: f.id,
      reason: f.reason,
      status: f.status,
      targetKind: f.targetKind,
      createdAt: f.createdAt,
    })),
  };
}

export async function ackAlert(id: string) {
  const ctx = await requireStaff("alerts");
  if (!ctx.ok) return ctx;
  return mutateStore((data) => {
    const row = (data.adminAlerts ?? []).find((a) => a.id === id);
    if (!row) return { ok: false as const, error: "هشدار یافت نشد.", status: 404 };
    row.ackAt = Date.now();
    row.ackBy = ctx.user.id;
    return { ok: true as const };
  });
}

export async function listStaff() {
  const ctx = await requireStaff("roles.manage");
  if (!ctx.ok) return ctx;
  const data = await readStoreSnapshot();
  return {
    ok: true as const,
    staff: (data.staffMembers ?? []).map((s) => {
      const u = data.users.find((x) => x.id === s.userId);
      return { userId: s.userId, username: u?.username ?? null, role: s.role, disabled: s.disabled };
    }),
  };
}

export const adminActionSchema = z.object({
  action: z.string().min(2).max(40),
  password: z.string().max(200).optional(),
  confirm: z.string().max(40).optional(),
  totp: z.string().max(16).optional(),
  id: z.string().max(80).optional(),
  targetId: z.string().max(80).optional(),
  q: z.string().max(80).optional(),
  page: z.number().int().min(0).max(200).optional(),
  status: z.string().max(24).optional(),
  type: z.string().max(24).optional(),
  priority: z.string().max(16).optional(),
  reason: z.string().max(400).optional(),
  note: z.string().max(500).optional(),
  kind: z.string().max(24).optional(),
  until: z.number().optional().nullable(),
  permanent: z.boolean().optional(),
  role: z.string().max(24).optional(),
  assignedTo: z.string().max(80).nullable().optional(),
  contentAction: z.string().max(24).optional(),
  hold: z.string().max(24).optional(),
  ids: z.array(z.string().max(80)).max(ADMIN_BULK_MAX).optional(),
  title: z.string().max(80).optional(),
  body: z.string().max(800).optional(),
  decision: z.string().max(400).optional(),
  ownerUserId: z.string().max(80).optional(),
});

export { loginBlocked, postingBlocked };
