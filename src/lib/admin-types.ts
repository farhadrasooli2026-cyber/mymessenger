/** Client-safe admin/moderation types. No secrets. */

export const STAFF_ROLES = ["super_admin", "admin", "moderator", "support", "analyst"] as const;
export type StaffRole = (typeof STAFF_ROLES)[number];

export const ADMIN_PERMS = [
  "dashboard",
  "users.view",
  "users.search",
  "users.restrict",
  "users.suspend",
  "users.ban",
  "users.unban",
  "users.warn",
  "users.recover",
  "sessions.revoke",
  "tokens.revoke",
  "reports.view",
  "reports.assign",
  "reports.evidence",
  "content.remove",
  "content.restore",
  "groups.moderate",
  "groups.owner",
  "channels.moderate",
  "channels.owner",
  "cases.manage",
  "appeals.review",
  "notes.write",
  "export",
  "roles.manage",
  "impersonate",
  "bulk",
  "audit.view",
  "alerts",
  "monitor",
  "backup.view",
  "backup.manage",
  "backup.restore",
  "deploy.view",
  "deploy.manage",
  "deploy.approve",
  "i18n.view",
  "i18n.manage",
] as const;
export type AdminPerm = (typeof ADMIN_PERMS)[number];

const ROLE_PERMS: Record<StaffRole, AdminPerm[]> = {
  super_admin: [...ADMIN_PERMS],
  admin: ADMIN_PERMS.filter((p) => p !== "impersonate"),
  moderator: [
    "dashboard",
    "users.view",
    "users.search",
    "users.restrict",
    "users.warn",
    "sessions.revoke",
    "reports.view",
    "reports.assign",
    "reports.evidence",
    "content.remove",
    "groups.moderate",
    "channels.moderate",
    "cases.manage",
    "appeals.review",
    "notes.write",
    "audit.view",
    "alerts",
    "monitor",
    "deploy.view",
    "i18n.view",
  ],
  support: [
    "dashboard",
    "users.view",
    "users.search",
    "users.recover",
    "sessions.revoke",
    "tokens.revoke",
    "appeals.review",
    "notes.write",
    "audit.view",
    "monitor",
  ],
  analyst: ["dashboard", "users.view", "users.search", "reports.view", "audit.view", "export", "monitor", "backup.view", "deploy.view", "i18n.view"],
};

export function permsForRole(role: StaffRole): AdminPerm[] {
  return ROLE_PERMS[role];
}

export function roleHasPerm(role: StaffRole, perm: AdminPerm) {
  return ROLE_PERMS[role].includes(perm);
}

export function roleRank(role: StaffRole) {
  return { analyst: 1, support: 2, moderator: 3, admin: 4, super_admin: 5 }[role];
}

export const REPORT_STATUSES = ["open", "reviewing", "resolved", "rejected", "escalated"] as const;
export type ReportStatus = (typeof REPORT_STATUSES)[number];

export const REPORT_PRIORITIES = ["low", "normal", "high", "critical"] as const;
export type ReportPriority = (typeof REPORT_PRIORITIES)[number];

export const CASE_STATUSES = ["open", "investigating", "resolved", "closed"] as const;
export type CaseStatus = (typeof CASE_STATUSES)[number];

export const APPEAL_STATUSES = ["open", "reviewing", "accepted", "rejected"] as const;
export type AppealStatus = (typeof APPEAL_STATUSES)[number];

export const CONTENT_ACTIONS = ["none", "warning", "remove", "restrict", "suspend", "ban", "escalate"] as const;
export type ContentAction = (typeof CONTENT_ACTIONS)[number];

export const ADMIN_CONFIRM = {
  ban: "BAN",
  suspend: "SUSPEND",
  delete: "DELETE",
  restore: "RESTORE",
  role: "ROLE",
  impersonate: "IMPERSONATE",
  export: "EXPORT",
  bulk: "BULK",
  restoreProduction: "RESTORE_PRODUCTION",
  failover: "FAILOVER",
  deployProduction: "DEPLOY_PRODUCTION",
  emergencyDeploy: "EMERGENCY_DEPLOY",
  rollback: "ROLLBACK",
} as const;

export const ADMIN_PAGE = 30;
export const ADMIN_BULK_MAX = 25;
export const ADMIN_AUDIT_KEEP = 2000;
export const ADMIN_SESSION_MS = 8 * 60 * 60 * 1000;

export const STAFF_ROLE_FA: Record<StaffRole, string> = {
  super_admin: "ابرادمین",
  admin: "ادمین",
  moderator: "ناظر",
  support: "پشتیبانی",
  analyst: "تحلیل‌گر",
};

export type StaffMember = {
  userId: string;
  role: StaffRole;
  extraPerms: AdminPerm[];
  denyPerms: AdminPerm[];
  ipAllow: string[];
  createdAt: number;
  updatedAt: number;
  disabled: boolean;
};

export type AdminSessionRow = {
  id: string;
  userId: string;
  tokenHash: string;
  createdAt: number;
  expiresAt: number;
  lastSeenAt: number;
  revokedAt: number | null;
  ipHint: string;
  userAgent: string;
  impersonateUserId: string | null;
};

export type AdminAuditRow = {
  id: string;
  actorUserId: string;
  actorRole: StaffRole;
  action: string;
  targetType: string;
  targetId: string;
  result: "ok" | "deny" | "error";
  detail: string;
  createdAt: number;
  chainHash: string;
};

export type ModerationNote = {
  id: string;
  authorUserId: string;
  body: string;
  createdAt: number;
  internal: true;
};

export type ModerationCase = {
  id: string;
  title: string;
  status: CaseStatus;
  assigneeId: string | null;
  reportIds: string[];
  targetKind: string;
  targetKey: string;
  notes: ModerationNote[];
  history: { at: number; actorUserId: string; action: string; detail: string }[];
  createdAt: number;
  updatedAt: number;
};

export type ModerationAppeal = {
  id: string;
  userId: string;
  kind: "ban" | "suspend" | "content" | "warning";
  targetId: string;
  body: string;
  status: AppealStatus;
  decision: string;
  reviewerId: string | null;
  createdAt: number;
  decidedAt: number | null;
};

export type AccountWarning = {
  id: string;
  userId: string;
  reason: string;
  actorUserId: string;
  createdAt: number;
};

export type AdminAlert = {
  id: string;
  severity: "info" | "warning" | "high" | "critical";
  title: string;
  detail: string;
  createdAt: number;
  ackAt: number | null;
  ackBy: string | null;
};

export type AutoModFlag = {
  id: string;
  targetKind: string;
  targetKey: string;
  reason: string;
  status: "pending" | "confirmed" | "false_positive";
  createdAt: number;
  reviewedAt: number | null;
  reviewerId: string | null;
};

export type ContentTombstone = {
  id: string;
  kind: "message" | "story" | "file" | "group" | "channel" | "profile" | "post";
  targetId: string;
  reason: string;
  actorUserId: string;
  createdAt: number;
  restoredAt: number | null;
  snapshot: string;
};

export type AdminMetrics = {
  reports: number;
  openReports: number;
  openCases: number;
  bans: number;
  suspensions: number;
  appeals: number;
  actions: number;
  failedAdminLogins: number;
  lastAlertAt: number | null;
};

export function emptyAdminMetrics(): AdminMetrics {
  return {
    reports: 0,
    openReports: 0,
    openCases: 0,
    bans: 0,
    suspensions: 0,
    appeals: 0,
    actions: 0,
    failedAdminLogins: 0,
    lastAlertAt: null,
  };
}
