/** Versioned documentation catalog. Never includes secret values or real user data. */

import { APP_VERSION, publicReleaseInfo } from "@/lib/release";
import { API_CODES, API_VERSION, NIXO_SERVICES } from "@/lib/api-types";
import { SCHEMA_VERSION } from "@/lib/db/catalog";
import { STAFF_ROLES, ADMIN_PERMS } from "@/lib/admin-types";

export const DOCS_VERSION = APP_VERSION;
export const DOCS_OWNERS = {
  platform: "platform",
  safety: "safety",
  docs: "platform",
} as const;

export type DocGroup =
  | "شروع"
  | "معماری"
  | "API"
  | "امنیت"
  | "داده"
  | "عملیات"
  | "راهنما"
  | "توسعه";

export type DocPage = {
  slug: string;
  title: string;
  group: DocGroup;
  owner: string;
  summary: string;
  tags: string[];
  headings: string[];
  body: string;
};

export const DOC_ENV_VARS = [
  "NIXO_PEPPER",
  "NIXO_DATA_KEY",
  "NIXO_BACKUP_KEY",
  "NIXO_SESSION_SECRET",
  "NIXO_ENV",
  "NIXO_DEMO_INBOX",
  "NIXO_STUN_URL",
  "NIXO_TURN_URL",
  "NIXO_TURN_USERNAME",
  "NIXO_TURN_CREDENTIAL",
  "NIXO_TURN_SECRET",
  "NIXO_CALL_REGION",
  "NIXO_VAULT_KEY_ID",
    "NIXO_ADMIN_KEY",
  "NIXO_EMAIL_PROVIDER",
  "NIXO_EMAIL_FROM",
  "NIXO_EMAIL_API_KEY",
  "NIXO_SMTP_HOST",
  "NIXO_SMTP_PORT",
  "NIXO_SMTP_USER",
  "NIXO_SMTP_PASS",
  "NIXO_SMTP_SECURE",
  "NIXO_MAILGUN_DOMAIN",
  "NIXO_SMS_PROVIDER",
  "NIXO_SMS_FROM",
  "NIXO_SMS_API_KEY",
  "NIXO_SMS_API_SECRET",
  "NIXO_PUBLIC_HOST",
  "DATABASE_URL",
  "NIXO_DATABASE_URL",
  "NIXO_EMAIL",
  "RESEND_API_KEY",
  "RESEND_FROM",
  "TWILIO_ACCOUNT_SID",
  "TWILIO_AUTH_TOKEN",
  "TWILIO_FROM",
] as const;

export const DOC_SCRIPTS = ["dev", "build", "start", "lint", "test", "ci", "security:scan", "docs:check", "icons", "db:migrate"] as const;

export const DOC_API_PATHS = [
  "/api/health",
  "/api/status",
  "/api/version",
  "/api/register/session",
  "/api/chats",
  "/api/groups",
  "/api/channels",
  "/api/stories",
  "/api/calls",
  "/api/notify",
  "/api/search",
  "/api/storage",
  "/api/admin/moderation",
  "/api/monitor",
  "/api/dr",
  "/api/perf",
  "/api/deploy",
  "/api/docs",
  "/api/i18n",
  "/api/a11y",
  "/api/bi",
  "/api/billing",
  "/api/prod",
  "/api/ai",
  "/api/ai/ops",
  "/api/cloud",
  "/api/edge",
  "/api/graph",
] as const;

function page(p: Omit<DocPage, "headings">): DocPage {
  const headings = [...p.body.matchAll(/^## (.+)$/gm)].map((m) => m[1] ?? "");
  return { ...p, headings };
}

export const DOC_PAGES: DocPage[] = [
  page({
    slug: "overview",
    title: "نمای کلی نیکسو",
    group: "شروع",
    owner: DOCS_OWNERS.platform,
    summary: "هدف محصول، نسخهٔ فعلی و آنچه این برش واقعاً اجرا می‌کند.",
    tags: ["overview", "product", "version"],
    body: `نسخهٔ مستندات با اپ ${DOCS_VERSION} و API v${API_VERSION} هم‌خوان است.

## هدف
NIXO (نیکسو) پیام‌رسان و پلتفرم ارتباطی با تأکید بر حریم خصوصی، امنیت سمت سرور، و قابلیت گسترش است — نه کپی واتساپ یا تلگرام.

## این برش
ثبت‌نام OTP، پروفایل، چت E2EE، گروه، کانال، استوری، تماس صوتی/تصویری محلی، اعلان، جستجو، گراف اجتماعی، Vault، ادمین، پایش، پشتیبان، عملکرد، انتشار، Localization، دسترسی‌پذیری، تحلیل محصول.

## آنچه این برش نیست
کلید خصوصی روی سرور ذخیره نمی‌شود. تماس Relayed P2P کامل بین دو دستگاه جدا در این برش ادعا نمی‌شود. پرداخت کارت واقعی فعال نیست.

## ناوبری
- نصب: /docs/install
- معماری: /docs/architecture
- API: /docs/api
- مشارکت: /docs/contributing`,
  }),
  page({
    slug: "install",
    title: "نصب و اجرای محلی",
    group: "شروع",
    owner: DOCS_OWNERS.docs,
    summary: "پیش‌نیاز، Setup مرحله‌به‌مرحله، Development و اجرای تست.",
    tags: ["install", "setup", "local", "prerequisites", "scripts"],
    body: `## پیش‌نیاز
- Node.js 20 LTS
- npm (همراه Node)
- Git
- پایگاه دادهٔ جدا لازم نیست؛ Store فایل JSON اتمی در \`.data/\` است.

## Setup
\`\`\`bash
git clone <repo>
cd <repo>
cp .env.example .env.local
# مقدارهای .env.local را عوض کن؛ هرگز آن فایل را commit نکن
npm ci
npm run dev
\`\`\`
برنامه روی \`http://127.0.0.1:43151\` گوش می‌دهد.

## اسکریپت‌ها
- \`npm run dev\` — Next.js development
- \`npm run build\` / \`npm start\` — production bind همان پورت
- \`npm test\` — Vitest
- \`npm run lint\` — ESLint (eslint-config-next)
- \`npx tsc --noEmit\` — TypeScript strict
- \`npm run ci\` — lint + tsc + test + secret-scan
- \`npm run docs:check\` — هم‌ترازی مستند با اسکریپت/env/مسیر API
- \`npm run security:scan\` — اسکن الگوی کلید خصوصی
- \`npm run icons\` — تولید آیکون PWA

## Staging / Production
\`NIXO_ENV=staging|production\` و \`NIXO_DEMO_INBOX=false\`. Pepper و Session Secret پیش‌فرض توسعه در Production رد می‌شوند. Email و SMS Provider اجباری است. جزئیات: /docs/deploy و \`docs/DEPLOY.md\` و \`docs/OTP.md\`.`,
  }),
  page({
    slug: "onboarding",
    title: "شروع کار Developer",
    group: "شروع",
    owner: DOCS_OWNERS.docs,
    summary: "چک‌لیست ورود فرد جدید بدون وابستگی به توضیح شفاهی.",
    tags: ["onboarding", "checklist"],
    body: `## چک‌لیست
1. Node 20 و \`npm ci\`
2. \`.env.local\` از \`.env.example\` بدون Secret واقعی در Git
3. \`npm run dev\` و باز کردن \`/\` سپس \`/docs\`
4. \`npm test\` سبز
5. خواندن /docs/architecture ، /docs/auth ، /docs/standards
6. یک Issue با قالب Bug/Feature
7. Branch از \`main\` با پیشوند \`cursor/\` یا \`feature/\`

## هویت سرور
کلاینت شناسهٔ کاربر را تعیین نمی‌کند. \`mutateStore\` تو در تو deadlock می‌شود. در Vitest برای Staff از \`cookies()\` استفاده نکن.`,
  }),
  page({
    slug: "architecture",
    title: "معماری و سرویس‌ها",
    group: "معماری",
    owner: DOCS_OWNERS.platform,
    summary: "App Router، Store تک‌نویسنده، سرویس‌های lib، Frontend و Backend.",
    tags: ["architecture", "frontend", "backend", "services", "adr"],
    body: `## تصمیم
Next.js App Router (React 19) + Route Handlers. منطق دامنه در \`src/lib/*\` با \`server-only\`. UI در \`src/components/*\` با Tailwind و shadcn/ui.

## Backend
هر درخواست API از Route Handler به توابع lib می‌رود. هویت از کوکی HttpOnly خوانده می‌شود نه از body.

## Frontend
صفحات \`src/app\`؛ RTL فارسی (Vazirmatn). وضعیت حساس روی سرور است.

## سرویس‌ها
${NIXO_SERVICES.map((s) => `- ${s.title}: \`${s.module}\``).join("\n")}
به‌علاوه: admin-moderation، monitor، dr، perf، deploy، search، graph، storage، calls، stories.

## ADR
JSON Store تک‌نویسنده (tmp+rename) به‌جای Postgres در این برش تا Backup/DR و تست‌ها ساده بمانند. جایگزین: SQL بعدی با همان قرارداد bind و Scope.

## بدهی فنی
Store فایل برای افق چندمیلیون کاربر کافی نیست؛ Sharding readiness در perf-types ثبت شده است.`,
  }),
  page({
    slug: "structure",
    title: "ساختار کد و استانداردها",
    group: "توسعه",
    owner: DOCS_OWNERS.docs,
    summary: "پوشه‌ها، نام‌گذاری، Lint، TypeScript، خطا و لاگ.",
    tags: ["structure", "naming", "lint", "typescript", "errors", "logging"],
    body: `## پوشه‌ها
- \`src/app/api\` — Endpointها
- \`src/lib\` — دامنه و Store
- \`src/components\` — UI
- \`src/lib/db\` — کاتالوگ، migrate، integrity
- \`docs/\` — Markdown هم‌تراز
- \`.data/\` — Store و بلاب؛ در Git نیست

## نام‌گذاری
فایل kebab یا دامنه (\`chat.ts\`). توابع camelCase. کامپوننت PascalCase. انواع در \`*-types.ts\`. مسیر API جمع (\`/api/chats\`).

## TypeScript
\`strict: true\`. \`noEmit\`. Alias \`@/\`.

## Lint / Format
ESLint \`eslint-config-next\` (core-web-vitals + typescript). Formatter رسمی جدا (Prettier) در این برش نصب نیست؛ همان قوانین ESLint.

## خطا
\`json\` / \`jsonError\` در \`src/lib/http.ts\`. شکل: \`{ ok: false, error, code }\`. Codeها: ${Object.keys(API_CODES).join(", ")}.

## لاگ
\`nixoLog\` با سطح و سرویس. Secret و کوکی redact می‌شوند. Trace از \`x-request-id\`.`,
  }),
  page({
    slug: "api",
    title: "API و نسخه‌بندی",
    group: "API",
    owner: DOCS_OWNERS.platform,
    summary: "قرارداد JSON، احراز، نمونهٔ Endpoint و Changelog API.",
    tags: ["api", "endpoints", "versioning", "examples", "changelog"],
    body: `## نسخه
هدر \`X-API-Version: ${API_VERSION}\` و \`X-NIXO-App-Version: ${DOCS_VERSION}\`. Bot API جدا: \`/api/bot/v1\`.

## احراز
اکثر مسیرها کوکی \`nixo_reg\`. Staff: \`nixo_staff\`. بدون Authorization در query. CSRF برای mutation: Origin همان‌مبدأ.

## نمونهٔ سلامت
\`\`\`
GET /api/health?probe=ready
→ { "ok": true, "ready": { "ok": true, "schema": ${SCHEMA_VERSION} } }
\`\`\`

## نمونهٔ نشست
\`\`\`
GET /api/register/session
بدون کوکی → { "ok": true, "step": "start" }
\`\`\`

## نمونهٔ پیام (مالکیت سرور)
\`\`\`
GET /api/chats/:id  (نشست لازم)
POST /api/chats/:id  body: { ciphertext, nonce, enc, clientNonce }
کلاینت متن خام نمی‌فرستد.
\`\`\`

## خطا
401 unauthorized، 403 forbidden، 404 not_found، 429 rate_limited، 503 service_unavailable (از جمله shed).

## اشتراک و پرداخت پلتفرم
\`GET /api/billing?view=plans|me|finance\` · \`POST /api/billing\` · Webhook \`POST /api/billing/webhook\` با \`x-nixo-billing-signature\` = HMAC(pepper, \`"billing:" + raw\`). موفق بودن پرداخت فقط با تأیید سرور/Webhook است نه پاسخ کلاینت. PAN در body رد می‌شود.

## آمادگی Production
\`GET/POST /api/prod\` با \`prod.view\` / \`prod.manage\`. امتیاز، Smoke داخلی، یخ‌زدگی انتشار، تأیید Release. Secret در پاسخ نیست.

## هوش مصنوعی
\`GET/POST /api/ai\` نشست کاربر. \`GET/POST /api/ai/ops\` با \`ai.view\` / \`ai.manage\`. کلید Provider در پاسخ نیست. شکست AI روی \`503\` است و هستهٔ پیام را قطع نمی‌کند.

## ابر
\`GET/POST /api/cloud\` با \`cloud.view\` / \`cloud.manage\`. Auto Scaling با min/max و cooldown. Secret و connection string در پاسخ نیست.

## لبه و CDN
\`GET/POST /api/edge\` با \`edge.view\` / \`edge.manage\`. RUM نمونه‌ای بدون URL خصوصی. Purge فقط Asset عمومی.

## جستجو
\`GET /api/search\` با نشست. Query، فیلتر، Cursor. \`health=1\` متریک تجمعی. \`eval=1\` فقط ایمنی نیکسو. Cache و تاریخچه per-user. شکست جستجو هسته را قطع نمی‌کند.

## Deprecation
فعلاً Breaking Change عمومی اعلام‌شده نیست. حذف فیلد فقط با bump API_VERSION و یادداشت در CHANGELOG.md.

## Changelog API (0.1.0)
- افزودن \`/api/version\`، \`/api/deploy\`، \`/api/docs\`، \`/api/i18n\`
- \`X-NIXO-App-Version\`
- \`/api/ai\` و \`/api/ai/ops\`
- \`/api/cloud\`
- \`/api/edge\``,
  }),
  page({
    slug: "realtime",
    title: "رویداد زنده (SSE)",
    group: "API",
    owner: DOCS_OWNERS.platform,
    summary: "این برش به‌جای WebSocket خام از SSE احرازشده استفاده می‌کند.",
    tags: ["websocket", "sse", "events"],
    body: `## واقعیت پیاده‌سازی
چت و کانال با SSE است نه WebSocket مرورگر. سقف ۸ اتصال زنده per user برای چت.

## چت
\`GET /api/chats/:id/live\` — نشست + مالکیت thread.
رویدادها (JSON داخل \`data:\`):
- hello — اتصال
- message | edit | delete | read | typing | ack
- error: connection-limit
Heartbeat: کامنت SSE \`: ping\` هر ۱۵ث.

نمونه:
\`\`\`
data: {"type":"message","threadId":"thr_example","at":1710000000000}
\`\`\`

## کانال
\`GET /api/channels/:id/live\` — مشترک/استاف احرازشده.

## عیب‌یابی
قطع بعد از deploy: ready probe در SIGTERM رد می‌شود تا LB درین کند. Reconnect از کلاینت با backoff؛ Connection Storm با سقف اتصال محدود است.`,
  }),
  page({
    slug: "auth",
    title: "احراز هویت و مجوز",
    group: "امنیت",
    owner: DOCS_OWNERS.safety,
    summary: "Register، Session، نقش Staff و این‌که Frontend مرجع نیست.",
    tags: ["auth", "session", "rbac", "authorization"],
    body: `## ثبت‌نام
1. Human challenge
2. \`POST /api/register/start\` کانال email/phone (شناسه یکپارچه در UI با تشخیص @ → email)
3. OTP هش‌شده؛ متن کد ذخیره نمی‌شود. ارسال فقط از Backend به مقصد واقعی (Resend/SendGrid/Postmark/Mailgun/SMTP و Twilio/Kavenegar/sms.ir). Demo Inbox در Production خاموش است.
4. \`POST /api/register/verify\`
5. ورود با رمز (اختیاری، حساب فعال با passwordHash): \`POST /api/register/password\`
6. پروفایل \`/setup\` تا حساب Active شود

## نشست
کوکی HttpOnly \`nixo_reg\`. Logout / Logout All دستگاه‌ها را باطل می‌کند. Refresh rotate در لایهٔ امنیت حساب.

## بازیابی
\`/recover\` با OTP (+ رمز دومرحله‌ای). Verification دور زده نمی‌شود.

## Staff
ورود جدا در \`/app/admin\`، کوکی \`nixo_staff\` هشت ساعت.
نقش‌ها: ${STAFF_ROLES.join(", ")}.
مجوزها: ${ADMIN_PERMS.join(", ")}.

## قانون
حتی با Feature Flag خاموش/روشن، Authorization سمت سرور است.`,
  }),
  page({
    slug: "otp",
    title: "ارسال OTP",
    group: "امنیت",
    owner: DOCS_OWNERS.safety,
    summary: "ایمیل و پیامک واقعی از Backend؛ Demo Inbox فقط توسعه.",
    tags: ["otp", "email", "sms", "resend", "twilio"],
    body: `فایل: \`docs/OTP.md\`.

## ارسال
کد روی سرور ساخته و هش می‌شود. متن کد به Provider می‌رود نه به Frontend. شکست Provider وضعیت \`failed\` می‌گیرد.

## Production
\`NIXO_DEMO_INBOX\` در Production همیشه خاموش است. Render باید Email و SMS Provider داشته باشد.`,
  }),
  page({
    slug: "security",
    title: "امنیت، حریم و E2EE",
    group: "امنیت",
    owner: DOCS_OWNERS.safety,
    summary: "سیاست امنیتی، کلیدها، حریم، و گزارش آسیب‌پذیری.",
    tags: ["security", "privacy", "e2ee", "encryption", "incident"],
    body: `## معماری امنیت
هویت و مجوز سرور. IDOR با تطبیق ownerUserId. Rate limit IP+User. CSP، CSRF، Headers. آپلود با magic bytes.

## E2EE
AES-GCM روی دستگاه. سرور \`ciphertext\`+\`nonce\`. کلید نخ در مرورگر. کلید خصوصی روی سرور نیست. دستگاه جدید به تاریخچهٔ E2EE قبلی بدون تأیید دسترسی ندارد.

## کلیدهای سرور (فقط نام)
- NIXO_PEPPER — HMAC شناسه و OTP
- NIXO_DATA_KEY — AES در Rest برای شناسهٔ تأییدشده و Vault
- NIXO_SESSION_SECRET — امضای کوکی
- NIXO_BACKUP_KEY — پوشش پشتیبان DR (جدا از data key)
مقدار واقعی در Documentation نیست.

## حریم
Settings → Privacy روی سرور اعمال می‌شود. جستجوی سراسری متن E2EE را ایندکس نمی‌کند.

## حادثهٔ امنیتی
1. Acknowledge در پایش
2. Rotate Secret از env (نه Git)
3. Revoke نشست‌ها
4. Audit زنجیره‌ای
گزارش خارجی: SECURITY.md — بدون PoC مخرب در Issue عمومی.`,
  }),
  page({
    slug: "data",
    title: "داده، Storage و Migration",
    group: "داده",
    owner: DOCS_OWNERS.platform,
    summary: "JSON Store، روابط کاتالوگ، فایل‌ها، Schema v1.",
    tags: ["database", "storage", "migration", "schema"],
    body: `## Store
\`.data/nixo-store.json\` با صف تک‌نویسنده و rename اتمی. تست: \`nixo-store.test.<worker>.json\`.

## Schema
نسخهٔ فعلی ${SCHEMA_VERSION}. Migration افزایشی در \`src/lib/db/migrate.ts\`: \`schema-meta-and-jobs\`. هرگز collection کاربر drop نمی‌شود.

## روابط (نمونهٔ غیرحساس)
messages.threadId → threads.id (cascade-owner).
channelPosts.channelId → pubChannels.id.
username یکتا روی users.

## Query
\`clampLimit\` سقف ۸۰. Cursor pagination. الحاق رشته به Query رد می‌شود.

## Storage
بلاب در \`.data/gallery\`، \`.data/vault\`، تکه‌های چت خصوصی. File ID به‌تنهایی کافی نیست. Cache-Control خصوصی برای رسانهٔ خصوصی.

## عیب‌یابی DB
قفل نویسنده: یک mutateStore در هر زمان. تو در تو ممنوع.
Schema جلوتر از باینری: \`assertSchemaCompatible\` ready را رد می‌کند.`,
  }),
  page({
    slug: "environments",
    title: "محیط و متغیرها",
    group: "عملیات",
    owner: DOCS_OWNERS.platform,
    summary: "چهار محیط جدا و فهرست نام Secretها بدون مقدار.",
    tags: ["env", "secrets", "config"],
    body: `## محیط‌ها
development، testing، staging، production (\`NIXO_ENV\`). Store، کوکی و Secret مشترک نیستند.

## متغیرها (نام و کاربرد)
${DOC_ENV_VARS.map((n) => `- \`${n}\``).join("\n")}

مثال امن: فایل \`.env.example\`. فایل \`.env.local\` در Gitignore است.

## Validation
در Production: Pepper/Session پیش‌فرض توسعه، Demo Inbox=true، و Email/SMS Provider خالی رد می‌شوند.`,
  }),
  page({
    slug: "observability",
    title: "پایش، هشدار و عملکرد",
    group: "عملیات",
    owner: DOCS_OWNERS.platform,
    summary: "Health، متریک تجمعی، آلرت، صف و Load Shed.",
    tags: ["monitoring", "alerting", "performance"],
    body: `## Health
\`/api/health?probe=live|ready\`. Ready در Shutdown و Config نامعتبر Production شکست می‌خورد.

## پایش
\`/app/admin\` زبانهٔ پایش — perm \`monitor\`. بدون متن پیام و بایت فایل.

## هشدار
آستانه، Dedup، Ack/Resolve. High/Critical به صف ادمین.

## عملکرد
زبانهٔ عملکرد \`/api/perf\`. کش بدون ciphertext. Shed، Login/Chat را قطع نمی‌کند.

## Bottleneck
Index گرم در perf، N+1 با prefetchById، صف Job در Store.`,
  }),
  page({
    slug: "deploy",
    title: "انتشار، CI و Runbook",
    group: "عملیات",
    owner: DOCS_OWNERS.platform,
    summary: "CI، Staging→Production، Rollback، Supervisors.",
    tags: ["deploy", "cicd", "release", "runbook", "rollback"],
    body: `## CI
\`.github/workflows/ci.yml\` — contents:read. lint، tsc، test، secret-scan، docs:check.

## Release
Semver در \`package.json\` / \`APP_VERSION\`. کاتالوگ: Staging سپس Production با \`DEPLOY_PRODUCTION\`. اضطراری \`EMERGENCY_DEPLOY\` + اسکن Secret.

## Rollback
\`ROLLBACK\` در پنل انتشار. نشست و Job پاک نمی‌شوند.

## Runbook استقرار
1. CI سبز
2. Backup DR برای تغییر حساس
3. Staging smoke: login + پیام
4. Approval Production (زبانهٔ آمادگی + \`DEPLOY_PRODUCTION\`)
5. Health ready روی instance جدید
6. اگر error rate بالا: Rollback یا Kill Switch پرچم
7. یخ‌زدگی \`PROD_FREEZE\` انتشار را تا رفع حادثه قفل می‌کند.

## بازیابی داده
زبانهٔ بازیابی \`/api/dr\`. Restore Production: رمز + \`RESTORE_PRODUCTION\`.

جزئیات کانتینر: \`docs/DEPLOY.md\`.`,
  }),
  page({
    slug: "troubleshooting",
    title: "عیب‌یابی",
    group: "عملیات",
    owner: DOCS_OWNERS.docs,
    summary: "خطاهای رایج توسعه، استقرار، سوکت، اعلان، جستجو، فایل و پشتیبان.",
    tags: ["troubleshooting", "debug", "errors"],
    body: `## کدهای مهم
- unauthorized — کوکی نیست یا منقضی
- csrf — Origin نامعتبر
- rate_limited — Retry-After
- shed — بار؛ مسیرهای هسته باید باز بمانند
- maintenance — حالت DR

## Debug Frontend
Network تب، کوکی HttpOnly دیده نمی‌شود در JS. پاسخ \`ok:false\`.

## Debug Backend
\`x-request-id\`. لاگ redactشده. Vitest با \`resetStoreForTests\`.

## استقرار
پورت 43151 اشغال. Demo Inbox در prod. Health 503 یعنی LB نباید traffic بدهد.

## Storage
URL بدون نشست 401. Path traversal در نام فایل رد می‌شود.

## اعلان
صف \`pushJobs\` در Store؛ DLQ جدا. توکن کامل در API عمومی نیست.

## جستجو
ایندکس عمومی بدون E2EE. Query کوتاه‌تر از ۲ نویسه رد.

## Backup
کلید جدا؛ dump از API دانلود نمی‌شود.

## Known issues
به \`docs/KNOWN_ISSUES.md\` نگاه کن.`,
  }),
  page({
    slug: "guides",
    title: "راهنمای محصول و ادمین",
    group: "راهنما",
    owner: DOCS_OWNERS.docs,
    summary: "حساب، پیام، گروه، کانال، استوری، تماس، فایل، اعلان، جستجو، ادمین.",
    tags: ["user", "admin", "moderator", "guides"],
    body: `## حساب
ثبت‌نام OTP، پروفایل، دستگاه‌ها در Settings → Devices، بازیابی /recover.

## پیام
چت خصوصی E2EE. ویرایش مهلت‌دار، حذف برای من/همه، View Once جدا از ناپدیدشونده.

## گروه / کانال
نقش‌ها سمت سرور. لینک دعوت Token+انقضا. فهرست اعضا صفحه‌بندی.

## استوری
انقضای ۲۴س، حریم Viewer، لینک توکن‌دار حریم را دور نمی‌زند.

## تماس
از چت؛ Signaling با نشست. ضبط API رد می‌شود.

## فایل
گالری و Vault؛ پیش‌نمایش مجاز؛ اجرایی رد.

## اعلان / جستجو
مرکز اعلان با Cursor. Search سراسری پس از Authz.

## ادمین / ناظر
\`/app/admin\`: کاربران، گزارش، پرونده، اعتراض، پایش، بازیابی، عملکرد، انتشار.
اعتراض کاربر: \`/app/settings/appeals\`.
Ban نیاز به عبارت BAN و رمز.

## Analytics
پایش عملیاتی: زبانهٔ پایش. هوش تجاری محصول: زبانهٔ **تحلیل** و \`/api/bi\` با مجوز \`analytics.view\`. متن پیام نیست.

## دسترسی‌پذیری
Settings → دسترسی‌پذیری. Skip link، میانبر Alt+Shift+/، Live Region پیام/تماس، Contrast، کاهش حرکت. API \`/api/a11y\`. جزئیات \`docs/A11Y.md\` و /docs/a11y.`,
  }),
  page({
    slug: "i18n",
    title: "زبان و بومی‌سازی",
    group: "توسعه",
    owner: DOCS_OWNERS.platform,
    summary: "کاتالوگ زبان، t()، قالب Intl، BiDi، کوکی، ادمین و گردش کار زبان جدید.",
    tags: ["i18n", "l10n", "rtl", "locale", "translation"],
    body: `## پیش‌فرض
fa، RTL، Asia/Tehran. بسته‌ها: fa/en/tr/ar/ru.

## افزودن زبان
1. ردیف BCP-47 در \`src/lib/i18n/languages.ts\`
2. \`messages/<code>.ts\` با کلیدهای fa
3. فعال‌سازی از ادمین بدون بازنویسی هسته
4. UGC ترجمه نمی‌شود مگر اجازه و Provider

## API
\`GET /api/i18n\` عمومی (بدون Secret). \`POST\` با CSRF همان‌مبدأ: detect/set و اکشن ادمین.

## کوکی
\`nixo_lang\` / \`nixo_tz\` راز نیستند.

جزئیات: \`docs/I18N.md\`.`,
  }),
  page({
    slug: "contributing",
    title: "مشارکت، Review و Issue",
    group: "توسعه",
    owner: DOCS_OWNERS.docs,
    summary: "Branch، Commit، PR، Review، قالب Bug و Feature.",
    tags: ["contributing", "pr", "review", "commit", "branch", "issues"],
    body: `## Branch
\`main\` مسیر انتشار. ویژگی: \`cursor/*\` یا \`feature/*\`. برش: \`release/x.y.z\`. حروف کوچک.

## Commit
فعل امری، چه چیزی و چرا. Secret در پیام commit نیست.

## PR
قالب \`.github/pull_request_template.md\`. CI باید سبز باشد. تغییر API/امنیت/DB باید docs را به‌روز کند.

## Review
IDOR، عدم اعتماد به کلاینت، عدم نشت Secret، تست برای مسیر اصلی، عدم deadlock در mutateStore.

## Issue
Bug: \`.github/ISSUE_TEMPLATE/bug.yml\`
Feature: \`feature.yml\`
امنیت: SECURITY.md نه Issue عمومی با اکسپلویت.

## Documentation Review
هر PR معماری/API باید صفحهٔ /docs مربوط را لمس کند.`,
  }),
  page({
    slug: "a11y",
    title: "دسترسی‌پذیری",
    group: "راهنما",
    owner: DOCS_OWNERS.platform,
    summary: "Keyboard، Screen Reader، Contrast، Reduced Motion، میانبرها و Preference همگام.",
    tags: ["a11y", "accessibility", "keyboard", "screen-reader", "rtl", "wcag"],
    body: `مرکز: Settings → دسترسی‌پذیری. فایل: \`docs/A11Y.md\`.

## Preference
حرکت کمتر، کنتراست، شفافیت، اندازه متن، اهداف لمسی، Live Region، میانبر، هشدار Timeout. همگام حساب + کوکی دستگاه. سیستم‌عامل با followSystem.

## Keyboard
ترتیب Tab منطقی. Focus-visible حلقه کهربایی. Escape مودال. Alt+Shift+/ فهرست میانبر. Ctrl+Enter ارسال. میانبر مرورگر ثبت نمی‌شود.

## Screen Reader
Skip to content. Landmark ناوبری/اصلی/جستجو. نام دکمه و Input. پیام با فرستنده/زمان/وضعیت. ایموجی‌تنها. Typing و پیام جدید Live. تماس Label و وضعیت. نتیجه جستجو اعلام می‌شود.

## Visual
Contrast جفت‌های کروم در تست WCAG AA. وضعیت Error/Success با متن نه فقط رنگ. Zoom و font-size محتوا را حذف نمی‌کند.

## تست
\`src/lib/a11y.test.ts\` در CI. Markup audit، Shortcut reserved، Persistence Preference.

Accessibility Authentication را دور نمی‌زند.`,
  }),
  page({
    slug: "analytics",
    title: "تحلیل و هوش تجاری",
    group: "عملیات",
    owner: DOCS_OWNERS.platform,
    summary: "رویداد نسخه‌دار، رضایت، تجمع بدون PII، داشبورد RBAC و لولهٔ ناهمگام.",
    tags: ["analytics", "bi", "privacy", "dau", "funnel", "experiment"],
    body: `مرکز: \`/app/admin\` زبانهٔ تحلیل. فایل: \`docs/ANALYTICS.md\`. API \`/api/bi\`.

## حریم
پیش‌فرض تحلیل محصول خاموش. شناسهٔ سوژه HMAC است. رمز، توکن، Secret، ciphertext و متن پیام وارد لوله نمی‌شوند. شکست لوله ورود یا پیام را قطع نمی‌کند.

## رضایت
Settings → مرکز حریم خصوصی. Opt-out رویداد محصول را حذف می‌کند. رویداد ضروری امنیت/پایداری جداست.

## متریک
DAU/WAU/MAU، Retention، Cohort، Churn، قیف ثبت‌نام، پیام (فقط پاکت)، تماس، جستجو، هزینهٔ برآوردی. تعریف هر عدد در پاسخ Dashboard است.

## دسترسی
\`analytics.view\` / \`analytics.manage\`. قابلیت اطمینان و امنیت تجمیعی نیازمند \`monitor\`. ادمین تحلیل به محتوای خصوصی نمی‌رسد.`,
  }),
  page({
    slug: "billing",
    title: "اشتراک و درآمدزایی",
    group: "عملیات",
    owner: DOCS_OWNERS.platform,
    summary: "پلن، Entitlement سمت سرور، درگاه انتزاعی، فاکتور، استرداد و حسابرسی مالی.",
    tags: ["billing", "subscription", "invoice", "refund", "entitlement"],
    body: `مرکز کاربر: Settings → اشتراک. داشبورد مالی: \`/app/admin\` زبانهٔ مالی. فایل: \`docs/BILLING.md\`. API \`/api/billing\`.

## Entitlement
پلن رایگان بدون ردیف اشتراک است. سقف استوری، Vault و AI روی سرور اعمال می‌شود. UI قفل به‌تنهایی کافی نیست.

## پرداخت
سندباکس و NIXO Pay. توکن \`tok_\`؛ PAN/CVV ذخیره نمی‌شود. Intent با Idempotency. Webhook با HMAC \`billing:\` + بدنه. رویداد تکراری دوباره شارژ نمی‌کند.

## حریم و نقش
پروفایل صورتحساب جدا از پروفایل کاربر است. نقش \`finance\` با \`billing.view|manage|refund|export\`. حسابرسی زنجیره‌ای فقط‌خواندنی. انقضای اشتراک پیام و فایل را حذف نمی‌کند.

## تحلیل
متریک درآمد اشتراک در \`/api/bi\` فقط تجمیعی است.`,
  }),
  page({
    slug: "production",
    title: "آمادگی Production",
    group: "عملیات",
    owner: DOCS_OWNERS.platform,
    summary: "امتیاز یکپارچگی، Smoke، یخ‌زدگی انتشار، مسدودکننده‌های امنیتی و تأیید Release.",
    tags: ["production", "readiness", "smoke", "freeze", "security"],
    body: `مرکز: \`/app/admin\` زبانهٔ آمادگی. فایل: \`docs/PRODUCTION.md\`. API \`/api/prod\`.

## امتیاز
از Health، پیکربندی Secret، Smoke داخلی و یکپارچگی Store محاسبه می‌شود. امتیاز بالا به‌معنای «روی localhost اجرا شد» نیست.

## مسدودکننده
امنیت بحرانی، از دست رفتن داده، یکپارچگی پرداخت، Bypass احراز/مجوز، Crash حیاتی، فساد پایگاه. هر کدام انتشار Production را متوقف می‌کند.

## یخ‌زدگی
\`PROD_FREEZE\` انتشار را قفل می‌کند تا حادثه بسته شود.

## Smoke
ثبت‌نام تا استرداد روی Store و ماژول‌های موجود بررسی می‌شود؛ جایگزین E2E مرورگر کامل نیست.`,
  }),
  page({
    slug: "ai",
    title: "هوش مصنوعی",
    group: "عملیات",
    owner: DOCS_OWNERS.safety,
    summary: "لایهٔ AI مستقل با Provider Abstraction، حریم، رضایت، سقف مصرف و Kill بدون قطع پیام‌رسانی.",
    tags: ["ai", "privacy", "provider", "consent", "moderation", "credits"],
    body: `مرکز کاربر: \`/app/ai\` و Settings → هوش مصنوعی. ادمین: زبانهٔ هوش مصنوعی. فایل: \`docs/AI.md\`. API \`/api/ai\` و \`/api/ai/ops\`.

## جداسازی
موتور داخلی پیش‌فرض است. کلید Provider به کلاینت نمی‌رود. شکست Provider هسته را Down نمی‌کند.

## حریم
Secret و کارت از Prompt حذف می‌شوند. جستجو فقط نتایج مجاز. تماس و ضبط بدون Policy وارد مدل نمی‌شود. Embedding و Cache با userId جدا می‌مانند.

## ایمنی
Injection، Safety Layer، خروجی Validateشده. Moderation کمکی است و Ban دائم نمی‌کند. محتوای AI برچسب دارد. Kill، Eval، Rollback پرامپت.`,
  }),
  page({
    slug: "cloud",
    title: "ابر و مقیاس",
    group: "عملیات",
    owner: DOCS_OWNERS.platform,
    summary: "Cloud-Ready، Auto Scaling با Min/Max، Load Balancer سالم، Multi-Region و Data plane خصوصی.",
    tags: ["cloud", "autoscaling", "kubernetes", "ha", "cdn", "object-storage"],
    body: `مرکز: \`/app/admin\` زبانهٔ ابر. فایل: \`docs/CLOUD.md\`. API \`/api/cloud\`.

## Scale
سرویس‌ها Stateless. Cooldown جلوی loop را می‌گیرد. Scale-in با Drain. HPA در \`deploy/k8s-scale.yaml\`.

## حریم شبکه
Database و Storage خصوصی. WAF/DDoS در لبه. Secret از env.

## بازیابی
Failover منطقه نشست را باطل نمی‌کند. RTO/RPO در پنل. Chaos فقط خارج از Production.`,
  }),
  page({
    slug: "edge",
    title: "CDN و لبه",
    group: "عملیات",
    owner: DOCS_OWNERS.platform,
    summary: "Edge جهانی، کش نسخه‌دار عمومی، Signed URL، Failover و Latency بدون نشت Cache خصوصی.",
    tags: ["cdn", "edge", "cache", "latency", "http3", "signed-url"],
    body: `مرکز: \`/app/admin\` زبانهٔ لبه. فایل: \`docs/EDGE.md\`. API \`/api/edge\`.

## کش
فقط \`/_next/static\` و Asset عمومی. API و رسانهٔ خصوصی \`private, no-store\`. Purge با مجوز.

## مسیریابی
PoP بر اساس سلامت و Latency. Host نامعتبر رد می‌شود. Origin داخلی است.

## حریم
RUM بدون query و توکن. Authorization در Core می‌ماند.`,
  }),
  page({
    slug: "search",
    title: "جستجو و کشف",
    group: "معماری",
    owner: DOCS_OWNERS.platform,
    summary: "جستجوی Permission-aware، ایندکس عمومی قابل Rebuild، Boolean، Hybrid و Discovery بدون نشت خصوصی.",
    tags: ["search", "discovery", "index", "ranking", "privacy"],
    body: `مرکز UI: پنل جستجوی پیام‌رسان. فایل: \`docs/SEARCH.md\`. API \`/api/search\`.

## ایندکس
اسناد عمومی جدا از Database اصلی برای Queryهای پرتکرار. صف Incremental، Tombstone، نسخهٔ اسکیما و Reindex اتمی. پیام E2EE ایندکس نمی‌شود.

## مجوز
نتیجه و Snippet فقط پس از Authentication، Membership، Block و Ban. Cache per-user. AI همان موتور مجاز را می‌خواند.

## Query
Full-Text، Exact، Prefix، Fuzzy، AND/OR/NOT، فیلتر تاریخ/فرستنده/گروه/کانال/فایل/رسانه/لینک/منشن/هشتگ. سقف پیچیدگی و Rate Limit.

## کشف
Discovery و Trending فقط Public. محبوبیت هشتگ با ضد سیلاب. شخصی‌سازی اختیاری و قابل خاموش شدن.`,
  }),
  page({
    slug: "graph",
    title: "گراف اجتماعی و پیشنهاد",
    group: "معماری",
    owner: DOCS_OWNERS.platform,
    summary: "Friend/Follow/Block روی Graph نسخه‌دار؛ پیشنهاد با فیلتر مجوز، بدون نشت شماره و ایمیل.",
    tags: ["graph", "recommendation", "friends", "follow", "privacy"],
    body: `مرکز UI: مخاطبین. فایل: \`docs/GRAPH.md\`. API \`/api/graph\`.

## گراف
روابط Friend، Follow، عضویت گروه مجاز و اشتراک کانال عمومی. Block بالاتر از بقیه است. حذف رابطه کش پیشنهاد را باطل می‌کند.

## پیشنهاد
Candidate سپس فیلتر Block/Hide/Spam. شخصی‌سازی قابل خاموش شدن. دلیل سطح‌بالا. AI همان feed مجاز را می‌خواند.

## حریم
خروجی Graph بدون تلفن و ایمیل. Mutual فقط با اجازه. Contact Sync همچنان Opt-In جدا در مخاطبین.`,
  }),
  page({
    slug: "changelog",
    title: "نسخه، تغییرات و آینده",
    group: "توسعه",
    owner: DOCS_OWNERS.docs,
    summary: "Versioning، CHANGELOG، Breaking، Roadmap و ADR.",
    tags: ["changelog", "versioning", "roadmap", "debt", "adr"],
    body: `## Versioning
Semver اپ ${DOCS_VERSION}. API v${API_VERSION} جدا. موبایل compat در /api/version.

## تغییرات این نسخه
CHANGELOG.md در ریشه. Dependency مهم: Next 16، React 19، Zod 4، Vitest 4.

## Breaking
هنوز bump عمدهٔ API نبوده. حذف E2EE ciphertext از Store بدون migration اعلام می‌شود.

## Roadmap
\`docs/ROADMAP.md\` — SQL اختیاری، Relayed Call، پرداخت واقعی.

## ADR
\`docs/adr/\` با Context / Decision / Alternatives / Consequences.`,
  }),
];

export function docsIndex() {
  return {
    version: DOCS_VERSION,
    release: publicReleaseInfo(),
    groups: Array.from(new Set(DOC_PAGES.map((p) => p.group))),
    pages: DOC_PAGES.map((p) => ({
      slug: p.slug,
      title: p.title,
      group: p.group,
      owner: p.owner,
      summary: p.summary,
      tags: p.tags,
    })),
  };
}

export function getDoc(slug: string) {
  return DOC_PAGES.find((p) => p.slug === slug) ?? null;
}

export function searchDocs(q: string) {
  const needle = q.trim().toLowerCase();
  if (needle.length < 2) return docsIndex().pages;
  return DOC_PAGES.filter((p) => {
    const hay = `${p.title} ${p.summary} ${p.tags.join(" ")} ${p.body} ${p.slug}`.toLowerCase();
    return hay.includes(needle);
  }).map((p) => ({ slug: p.slug, title: p.title, group: p.group, owner: p.owner, summary: p.summary, tags: p.tags }));
}
