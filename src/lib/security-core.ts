/** Shared NIXO security policy. No secrets. Safe to import from tests and UI copy. */

export const NIXO_SECURITY = {
  passwordMin: 10,
  recoveryCodeCount: 8,
  sessionCookieHttpOnly: true,
  sessionSameSite: "lax",
  exportTtlMs: 15 * 60_000,
  loginHistoryMax: 20,
  auditMax: 400,
} as const;

/** IDOR: resource owner must match the authenticated actor. */
export function assertOwned(ownerId: string | undefined | null, actorId: string | undefined | null) {
  return Boolean(ownerId && actorId && ownerId === actorId);
}

export function denyIfCrossAccount(ownerId: string | undefined | null, actorId: string | undefined | null) {
  if (assertOwned(ownerId, actorId)) return { ok: true as const };
  return { ok: false as const, status: 403 as const, error: "اجازه نداری." };
}

export function isNixoOpsHandle(username: string | undefined | null) {
  const h = (username ?? "").toLowerCase();
  return h === "nixo" || h === "nixo_ops";
}

/** Strip tags and handlers before any HTML context. Not a substitute for React text nodes. */
export function sanitizeUserHtml(raw: string) {
  return raw
    .replace(/<script[\s\S]*?>[\s\S]*?<\/script>/gi, "")
    .replace(/<style[\s\S]*?>[\s\S]*?<\/style>/gi, "")
    .replace(/<[^>]+>/g, "")
    .replace(/javascript:/gi, "")
    .replace(/data:/gi, "")
    .replace(/vbscript:/gi, "")
    .replace(/on\w+\s*=/gi, "")
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, "")
    .trim()
    .slice(0, 2000);
}

export type SecurityMetrics = {
  permissionDenies: number;
  loginFails: number;
  incidents: number;
  tokenRevokes: number;
  lastAlertAt: number | null;
};

export function emptySecurityMetrics(): SecurityMetrics {
  return { permissionDenies: 0, loginFails: 0, incidents: 0, tokenRevokes: 0, lastAlertAt: null };
}
