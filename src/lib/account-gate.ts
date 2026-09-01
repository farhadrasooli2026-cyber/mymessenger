/** Account enforcement for bans/suspensions. Safe to import from messaging services. */

export type EnforcementStatus = "active" | "pending_deletion" | "closed" | "deactivated" | "restricted" | "suspended" | "banned";

export type AccountGateUser = {
  accountStatus?: string | null;
  restrictionUntil?: number | null;
  restrictionKind?: string | null;
  restrictionReason?: string | null;
};

export function effectiveEnforcement(user: AccountGateUser | null | undefined, now = Date.now()): EnforcementStatus {
  if (!user) return "active";
  const kind = user.restrictionKind;
  const until = user.restrictionUntil ?? null;
  if ((kind === "ban" || user.accountStatus === "banned") && (until == null || until > now)) return "banned";
  if ((kind === "suspend" || user.accountStatus === "suspended") && (until == null || until > now)) return "suspended";
  if ((kind === "restrict" || user.accountStatus === "restricted") && (until == null || until > now)) return "restricted";
  const st = user.accountStatus;
  if (st === "pending_deletion" || st === "closed" || st === "deactivated") return st;
  return "active";
}

export function loginBlocked(user: AccountGateUser | null | undefined, now = Date.now()) {
  const st = effectiveEnforcement(user, now);
  if (st === "banned") return { blocked: true as const, error: "این حساب مسدود است. می‌توانی از صفحهٔ اعتراض پیگیری کنی.", code: "banned" };
  if (st === "suspended") return { blocked: true as const, error: "این حساب موقتاً معلق است.", code: "suspended" };
  if (st === "closed") return { blocked: true as const, error: "این حساب بسته شده است.", code: "closed" };
  return { blocked: false as const };
}

export function postingBlocked(user: AccountGateUser | null | undefined, now = Date.now()) {
  const login = loginBlocked(user, now);
  if (login.blocked) return login;
  const st = effectiveEnforcement(user, now);
  if (st === "restricted") {
    return { blocked: true as const, error: "ارسال محتوا برای این حساب محدود شده است.", code: "restricted" };
  }
  return { blocked: false as const };
}

export function expireStaleRestriction<T extends AccountGateUser>(user: T, now = Date.now()): T {
  const until = user.restrictionUntil;
  if (until && until <= now && user.restrictionKind && user.restrictionKind !== "none") {
    user.restrictionKind = "none";
    user.restrictionUntil = null;
    if (user.accountStatus === "banned" || user.accountStatus === "suspended" || user.accountStatus === "restricted") {
      user.accountStatus = "active";
    }
  }
  return user;
}
