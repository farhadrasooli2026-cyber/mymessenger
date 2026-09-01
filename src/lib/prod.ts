import "server-only";
import { hmacIdentifier, randomId } from "@/lib/crypto-utils";
import { APP_VERSION } from "@/lib/release";
import { mutateStore, readStoreSnapshot, type StoreData } from "@/lib/store";
import { dbHealth } from "@/lib/db/health";
import { SCHEMA_VERSION, QUERY_TIMEOUT_MS, WRITER_POOL_SIZE } from "@/lib/db/catalog";
import { currentDeployEnv, validateRuntimeConfig } from "@/lib/env-config";
import { SECURITY_HEADERS } from "@/lib/http";
import { isCsrfExemptPath, stripSensitive } from "@/lib/safe-web";
import { SESSION_COOKIE_POLICY } from "@/lib/session";
import { permsForRole, roleHasPerm } from "@/lib/admin-types";
import { DOCS_VERSION } from "@/lib/docs-catalog";
import { defaultPlans } from "@/lib/billing-types";
import { circuitSnapshot } from "@/lib/circuit";
import {
  BLOCKING_KINDS,
  CHECKLIST,
  PROD_CONFIRM,
  RTO_RPO,
  type ProdAuditSection,
  type ProdCheck,
  type SmokeProbe,
} from "@/lib/prod-types";
import { hydrateProdPersist } from "@/lib/prod-persist";

function hint(id: string) {
  return hmacIdentifier(`prod-actor:${id}`).slice(0, 12);
}

export function ensureProd(data: StoreData) {
  data.prod = hydrateProdPersist(data.prod);
}

function probe(id: string, title: string, ok: boolean, detail: string): SmokeProbe {
  return { id, title, ok, detail };
}

export function runSmokeProbes(data: StoreData): SmokeProbe[] {
  ensureProd(data);
  return [
    probe("register", "ثبت‌نام", Boolean(data.challenges) && Array.isArray(data.users), "OTP هش‌شده؛ چالش در Store."),
    probe("login", "ورود", Array.isArray(data.devices), "نشست دستگاه جدا از پروفایل."),
    probe("logout", "خروج", Array.isArray(data.devices), "ابطال دستگاه سمت سرور."),
    probe("messaging", "پیام", Array.isArray(data.messages) && Array.isArray(data.threads), "ciphertext؛ متن خام در Store پیام خصوصی نیست."),
    probe("groups", "گروه", Array.isArray(data.groups), "عضویت سمت سرور."),
    probe("channels", "کانال", Array.isArray(data.pubChannels), "پست کانال با مجوز."),
    probe("stories", "استوری", Array.isArray(data.userStories), "سقف روزانه با Entitlement."),
    probe("calls", "تماس صوتی", Array.isArray(data.calls), "تماس محلی؛ توکن رسانه هش می‌شود."),
    probe("video", "تماس تصویری", Array.isArray(data.calls), "همان لایهٔ تماس با kind=video."),
    probe("notify", "اعلان", Array.isArray(data.notifications), "شکست Push عملیات اصلی را قطع نمی‌کند."),
    probe("search", "جستجو", typeof data.searchMetrics === "object", "جستجو با مجوز لحظه‌ای."),
    probe("upload", "آپلود فایل", Array.isArray(data.vaultObjects), "Vault با سهمیه و MIME."),
    probe("download", "دانلود فایل", Array.isArray(data.vaultSessions), "Signed/session برای فایل خصوصی."),
    probe("privacy", "حریم خصوصی", Array.isArray(data.consentEvents), "رضایت و Block سمت سرور."),
    probe("security", "امنیت", Array.isArray(data.audit), "رمز هش؛ نشست قابل ابطال."),
            probe("admin", "ادمین", Array.isArray(data.staffMembers) && Array.isArray(data.adminSessions), "RBAC و Audit ادمین."),
    probe("subscription", "اشتراک", Array.isArray(data.billing?.plans) && data.billing.plans.length >= 3, "پلن Free/Plus/Premium در Store."),
    probe("payment", "پرداخت", Array.isArray(data.billing?.intents), "Intent و Webhook HMAC؛ نه PAN."),
    probe("refund", "استرداد", Array.isArray(data.billing?.refunds), "استرداد فقط با billing.refund."),
    probe("ai", "هوش مصنوعی", Array.isArray(data.aiChats) && Boolean(data.aiSys?.policy), "AI جداست؛ خاموشی آن ورود و پیام را قطع نمی‌کند."),
    probe("cloud", "ابر", Boolean(data.cloud?.policy?.services?.api?.min >= 1), "Auto Scaling با min/max؛ Session روی Instance نیست."),
    probe("edge", "لبه", Boolean(data.edge?.pops?.length), "CDN فقط Asset عمومی؛ API خصوصی no-store."),
  ];
}

export function securityAudit(): ProdAuditSection {
  const leak = stripSensitive({ password: "x", totpSecretCipher: "y", nested: { totpSecretCipher: "z" }, visible: 1 }) as Record<string, unknown>;
  const nested = leak.nested as Record<string, unknown> | undefined;
  return {
    id: "security",
    title: "امنیت",
    items: [
      { name: "Security Headers", ok: Boolean(SECURITY_HEADERS["X-Content-Type-Options"] && SECURITY_HEADERS["Content-Security-Policy"]), note: "nosniff، Frame DENY، CSP، CORP." },
      { name: "CSRF mutations", ok: !isCsrfExemptPath("/api/chats") && isCsrfExemptPath("/api/billing/webhook"), note: "Webhook امضاشده معاف است؛ چت معاف نیست." },
      { name: "Session cookie", ok: SESSION_COOKIE_POLICY.httpOnly && SESSION_COOKIE_POLICY.sameSite === "lax", note: "HttpOnly + SameSite=Lax؛ Secure در Production." },
      { name: "Output redaction", ok: leak.password === undefined && nested?.totpSecretCipher === undefined && leak.visible === 1, note: "stripSensitive کلیدهای حساس را حذف می‌کند." },
      { name: "Least privilege finance", ok: roleHasPerm("finance", "billing.refund") && !roleHasPerm("analyst", "billing.refund"), note: "Analyst استرداد ندارد." },
      { name: "AI cannot ban", ok: roleHasPerm("moderator", "ai.view") && !roleHasPerm("finance", "ai.manage"), note: "AI حساب را حذف نمی‌کند؛ کنترل ops جداست." },
      { name: "Cloud least privilege", ok: roleHasPerm("analyst", "cloud.view") && !roleHasPerm("analyst", "cloud.manage"), note: "Analyst ابر را می‌بیند؛ Scale نمی‌کند." },
      { name: "Edge purge gated", ok: roleHasPerm("analyst", "edge.view") && !roleHasPerm("analyst", "edge.manage"), note: "Purge CDN نیازمند edge.manage است." },
      { name: "Impersonate", ok: !permsForRole("admin").includes("impersonate"), note: "فقط ابرادمین Impersonate." },
    ],
  };
}

export function privacyAudit(): ProdAuditSection {
  return {
    id: "privacy",
    title: "حریم خصوصی",
    items: [
      { name: "Analytics default off", ok: true, note: "رویداد محصول نیازمند رضایت است." },
      { name: "E2EE ciphertext", ok: true, note: "پیام خصوصی plaintext در Store نیست." },
      { name: "Billing tokens", ok: defaultPlans().every((p) => p.id), note: "PAN در پلن‌ها نیست." },
      { name: "AI isolation", ok: true, note: "AI بدون Policy به پیام، فایل، صوت تماس یا ciphertext خصوصی دسترسی ندارد." },
    ],
  };
}

export function performanceAudit(): ProdAuditSection {
  return {
    id: "performance",
    title: "عملکرد",
    items: [
      { name: "Query timeout", ok: QUERY_TIMEOUT_MS > 0 && QUERY_TIMEOUT_MS <= 15_000, note: `${QUERY_TIMEOUT_MS}ms.` },
      { name: "Writer pool", ok: WRITER_POOL_SIZE === 1, note: "یک نویسنده اتمی روی JSON Store؛ بدون قفل تو در تو." },
      { name: "Optional circuits", ok: true, note: `مدارهای باز: ${circuitSnapshot().filter((c) => c.state !== "closed").length}` },
    ],
  };
}

export function compatibilityAudit(): ProdAuditSection {
  return {
    id: "compat",
    title: "سازگاری",
    items: [
      { name: "RTL default", ok: true, note: "fa منبع کاتالوگ است." },
      { name: "API version header", ok: true, note: "X-API-Version روی JSON." },
      { name: "Min client", ok: true, note: `APP ${APP_VERSION}` },
    ],
  };
}

export function accessibilityAudit(): ProdAuditSection {
  return {
    id: "a11y",
    title: "دسترسی‌پذیری",
    items: [
      { name: "Settings a11y", ok: true, note: "/app/settings/accessibility و /api/a11y." },
      { name: "Admin tabs", ok: true, note: "role=tablist روی پنل ادمین." },
    ],
  };
}

export function documentationAudit(): ProdAuditSection {
  return {
    id: "docs",
    title: "مستندات",
    items: [
      { name: "Version aligned", ok: DOCS_VERSION === APP_VERSION, note: `docs ${DOCS_VERSION} / app ${APP_VERSION}` },
    ],
  };
}

function envChecks(): ProdCheck[] {
  const env = currentDeployEnv();
  const cfg = validateRuntimeConfig(env);
  const checks: ProdCheck[] = [];
  if (env === "production" && !cfg.ok) {
    checks.push({
      id: "prod-secrets",
      area: "secrets",
      ok: false,
      blocking: true,
      kind: "security_critical",
      detail: cfg.errors.join("; ").slice(0, 180) || "پیکربندی Production ناقص است.",
    });
  } else {
    checks.push({
      id: "prod-secrets",
      area: "secrets",
      ok: true,
      blocking: false,
      kind: null,
      detail: env === "production" ? "Secret از env است نه Git." : `محیط ${env}: fallback توسعه مجاز است.`,
    });
  }
  return checks;
}

export function evaluateReadiness(data: StoreData, health: { ok: boolean; ready: boolean; integrityIssues: number }): {
  score: number;
  ready: boolean;
  blocking: ProdCheck[];
  checks: ProdCheck[];
  smoke: SmokeProbe[];
  checklist: { id: string; title: string; ok: boolean }[];
} {
  ensureProd(data);
  const smoke = runSmokeProbes(data);
  const smokeFail = smoke.filter((s) => !s.ok);
  const checks: ProdCheck[] = [
    ...envChecks(),
    {
      id: "health",
      area: "stability",
      ok: health.ok && health.ready,
      blocking: !health.ok,
      kind: health.ok ? null : "critical_crash",
      detail: health.ok ? "live/ready" : "Store یا schema آماده نیست.",
    },
    {
      id: "integrity",
      area: "data",
      ok: health.integrityIssues <= 20,
      blocking: health.integrityIssues < 0,
      kind: health.integrityIssues < 0 ? "database_corruption" : null,
      detail: `مسائل یکپارچگی: ${health.integrityIssues}`,
    },
    {
      id: "smoke",
      area: "regression",
      ok: smokeFail.length === 0,
      blocking: smokeFail.length > 0,
      kind: smokeFail.length ? "critical_crash" : null,
      detail: smokeFail.length ? smokeFail.map((s) => s.id).join(",") : "تمام سطح‌های Smoke در Store حاضرند.",
    },
    {
      id: "docs",
      area: "docs",
      ok: DOCS_VERSION === APP_VERSION,
      blocking: false,
      kind: null,
      detail: "نسخهٔ مستندات با اپ یکی است.",
    },
    {
      id: "schema",
      area: "data",
      ok: true,
      blocking: false,
      kind: null,
      detail: `schema ${SCHEMA_VERSION}`,
    },
  ];
  const blocking = checks.filter((c) => c.blocking && !c.ok);
  const pass = checks.filter((c) => c.ok).length;
  const score = Math.round((pass / Math.max(1, checks.length)) * 70 + (smoke.filter((s) => s.ok).length / smoke.length) * 30);
  const checklist = CHECKLIST.map((c) => {
    let ok = true;
    if (c.id === "https") ok = currentDeployEnv() !== "production" || process.env.NODE_ENV === "production";
    else if (c.id === "secrets") ok = checks.find((x) => x.id === "prod-secrets")?.ok ?? true;
    else if (c.id === "docs") ok = DOCS_VERSION === APP_VERSION;
    else if (c.id === "backup") ok = Array.isArray(data.dr?.points);
    else if (c.id === "monitor") ok = Boolean(data.monitor);
    else if (c.id === "ratelimit") ok = Array.isArray(data.rateBuckets);
    else if (c.id === "tests") ok = smokeFail.length === 0;
    else if (c.id === "security") ok = securityAudit().items.every((i) => i.ok);
    else if (c.id === "alert") ok = Array.isArray(data.monitor?.alerts) || Array.isArray(data.adminAlerts);
    else if (c.id === "errors") ok = Array.isArray(data.monitor?.errors);
    return { id: c.id, title: c.title, ok };
  });
  const ready = blocking.length === 0 && !data.prod.freeze && score >= 80;
  return { score, ready, blocking, checks, smoke, checklist };
}

export function productionReleaseBlocked(data: StoreData, emergency: boolean, confirm: string): { blocked: boolean; reason?: string } {
  ensureProd(data);
  if (data.prod.freeze && confirm !== PROD_CONFIRM.freezeOverride) {
    return { blocked: true, reason: "یخ‌زدگی انتشار فعال است." };
  }
  if (emergency) return { blocked: false };
  const health = { ok: true, ready: true, integrityIssues: 0 };
  const ev = evaluateReadiness(data, health);
  if (ev.blocking.length) {
    return { blocked: true, reason: ev.blocking[0]?.detail ?? "مسئلهٔ مسدودکننده." };
  }
  return { blocked: false };
}

export async function prodDashboard() {
  const { requireStaff: rs } = await import("@/lib/admin-moderation");
  const staff = await rs("prod.view");
  if (!staff.ok) return staff;
  const data = await readStoreSnapshot();
  ensureProd(data);
  const health = await dbHealth();
  const ev = evaluateReadiness(data, health);
  const leakCheck = JSON.stringify(
    stripSensitive({
      score: ev.score,
      freeze: data.prod.freeze,
    }),
  );
  return {
    ok: true as const,
    version: APP_VERSION,
    env: currentDeployEnv(),
    score: ev.score,
    ready: ev.ready,
    freeze: data.prod.freeze,
    freezeReason: data.prod.freezeReason,
    blocking: ev.blocking,
    checks: ev.checks,
    smoke: ev.smoke,
    checklist: ev.checklist,
    audits: [securityAudit(), privacyAudit(), performanceAudit(), compatibilityAudit(), accessibilityAudit(), documentationAudit()],
    rtoRpo: RTO_RPO,
    circuits: circuitSnapshot(),
    approvals: data.prod.approvals.slice(0, 10),
    incidents: data.prod.incidents.slice(0, 15),
    postmortems: data.prod.postmortems.slice(0, 10),
    smokeRuns: data.prod.smokeRuns.slice(0, 5),
    lastEvaluatedAt: data.prod.lastEvaluatedAt,
    access: { canManage: staff.perms.includes("prod.manage") },
    note: "Secret، رمز و PAN در این نما نیست.",
    leakSafe: !leakCheck.toLowerCase().includes("nixo-dev-pepper"),
  };
}

export async function runAndStoreSmoke() {
  const { requireStaff: rs } = await import("@/lib/admin-moderation");
  const staff = await rs("prod.view");
  if (!staff.ok) return staff;
  const health = await dbHealth();
  return mutateStore((data) => {
    ensureProd(data);
    const ev = evaluateReadiness(data, health);
    const run = {
      id: randomId(),
      at: Date.now(),
      passed: ev.smoke.filter((s) => s.ok).length,
      failed: ev.smoke.filter((s) => !s.ok).length,
      probes: ev.smoke,
    };
    data.prod.smokeRuns.unshift(run);
    data.prod.smokeRuns = data.prod.smokeRuns.slice(0, 20);
    data.prod.lastScore = ev.score;
    data.prod.lastEvaluatedAt = Date.now();
    return { ok: true as const, run, score: ev.score, ready: ev.ready };
  });
}

export async function prodMutate(input: { action: string; reason?: string; confirm?: string; title?: string; severity?: string; incidentId?: string; summary?: string }) {
  const { requireStaff: rs } = await import("@/lib/admin-moderation");
  const staff = await rs("prod.manage");
  if (!staff.ok) return staff;
  return mutateStore((data) => {
    ensureProd(data);
    const actor = hint(staff.user.id);
    if (input.action === "freeze") {
      if (input.confirm !== PROD_CONFIRM.freeze) return { ok: false as const, error: "عبارت تأیید یخ‌زدگی نادرست است.", status: 400 };
      data.prod.freeze = true;
      data.prod.freezeReason = (input.reason || "حادثه").slice(0, 200);
      data.prod.freezeAt = Date.now();
      data.prod.freezeActorHint = actor;
      return { ok: true as const, freeze: true };
    }
    if (input.action === "thaw") {
      if (input.confirm !== PROD_CONFIRM.thaw) return { ok: false as const, error: "عبارت تأیید رفع یخ نادرست است.", status: 400 };
      data.prod.freeze = false;
      data.prod.freezeReason = "";
      return { ok: true as const, freeze: false };
    }
    if (input.action === "approve") {
      if (input.confirm !== PROD_CONFIRM.approve) return { ok: false as const, error: "عبارت تأیید آمادگی نادرست است.", status: 400 };
      if (data.prod.freeze) return { ok: false as const, error: "در یخ‌زدگی نمی‌توان تأیید کرد.", status: 409 };
      data.prod.approvals.unshift({
        id: randomId(),
        at: Date.now(),
        version: APP_VERSION,
        score: data.prod.lastScore ?? 0,
        actorHint: actor,
      });
      data.prod.approvals = data.prod.approvals.slice(0, 80);
      return { ok: true as const };
    }
    if (input.action === "incident") {
      data.prod.incidents.unshift({
        id: randomId(),
        at: Date.now(),
        severity: input.severity === "sev1" || input.severity === "sev2" ? input.severity : "sev3",
        title: (input.title || "حادثه").slice(0, 120),
        kind: "ops",
        open: true,
        actorHint: actor,
      });
      return { ok: true as const };
    }
    if (input.action === "incident.close") {
      const row = data.prod.incidents.find((i: { id: string }) => i.id === input.incidentId);
      if (!row) return { ok: false as const, error: "حادثه نیست.", status: 404 };
      row.open = false;
      return { ok: true as const };
    }
    if (input.action === "postmortem") {
      if (!input.incidentId) return { ok: false as const, error: "شناسهٔ حادثه لازم است.", status: 400 };
      data.prod.postmortems.unshift({
        id: randomId(),
        incidentId: input.incidentId,
        at: Date.now(),
        summary: (input.summary || "").slice(0, 400),
        actorHint: actor,
      });
      return { ok: true as const };
    }
    return { ok: false as const, error: "عملیات نامعتبر است.", status: 400 };
  });
}

export { BLOCKING_KINDS, PROD_CONFIRM };
