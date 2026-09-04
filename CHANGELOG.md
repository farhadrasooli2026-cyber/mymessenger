# Changelog

همهٔ نسخه‌ها Semver اپ هستند. API جدا با هدر `X-API-Version`.

## 0.1.1

- استارت Render با `scripts/start.mjs` روی `$PORT` و خروجی `.next` (نه `dist`)
- مسیر فایل محلی روی Render: `/tmp/.data` وقتی `/app` قابل نوشتن نیست
- Build ID از git SHA تا کش Cloudflare/مرورگر فایل‌های استاتیک قدیمی را قاطی نکند
- متا `nixo-build` و هدر `X-NIXO-Git-Sha` برای تشخیص نسخهٔ دیپلوی

## 0.1.0

- ثبت‌نام OTP، چت E2EE، گروه، کانال، استوری، تماس محلی، اعلان، جستجو، Vault
- ادمین، پایش، DR، عملکرد، کاتالوگ انتشار
- Localization (`/api/i18n`) و دسترسی‌پذیری (`/api/a11y`, Settings → دسترسی‌پذیری)
- تحلیل محصول (`/api/bi`, زبانهٔ تحلیل) جدا از پایش عملیاتی
- اشتراک و صورتحساب سندباکس (`/api/billing`, Settings → اشتراک، زبانهٔ مالی)
- آمادگی Production (`/api/prod`, زبانهٔ آمادگی): امتیاز، Smoke داخلی، یخ‌زدگی انتشار
- لایهٔ هوش مصنوعی (`/api/ai`, `/api/ai/ops`): Provider محلی، حریم، Kill بدون قطع پیام
- ابر و Auto Scaling (`/api/cloud`, زبانهٔ ابر): min/max، Drain، Failover منطقه
- CDN و Edge (`/api/edge`, زبانهٔ لبه): کش عمومی نسخه‌دار، Purge مجاز، RUM بدون نشت خصوصی
- جستجوی پیشرفته (`/api/search`): Boolean، Tombstone، Hybrid مجاز، P95/P99، Discovery عمومی
- گراف اجتماعی و پیشنهاد (`/api/graph`): Friend/Follow موجود، Block، Mute، پیشنهاد با فیلتر مجوز، کش per-user، Rollback مدل
- ارسال OTP واقعی از Backend (Resend/SendGrid/Postmark/Mailgun/SMTP و Twilio/Kavenegar/sms.ir)؛ Demo Inbox فقط غیر Production
- ماندگاری حساب در Postgres (`DATABASE_URL`) با قفل تراکنشی تا OTP بین چند process گم نشود؛ `/api/version` با `gitSha`
- `npm run db:migrate` هنگام استارت Render جدول‌های `nixo_store` و `nixo_schema_migrations` را می‌سازد
- تشخیص `resend_test_mode` / `twilio_trial` در لاگ OTP وقتی Provider فقط یک مقصد آزمایشی را قبول می‌کند
- صفحهٔ Login نئونی (کارت شیشه‌ای، تأیید با کد / ورود با رمز)؛ معرفی محصول در `/about`
- Dependency اصلی: Next 16.3، React 19، Zod 4، Vitest 4، Tailwind 4

### API

- `GET /api/health`, `/api/status`, `/api/version`, `/api/docs`, `/api/i18n`, `/api/bi`, `/api/billing`, `/api/prod`, `/api/ai`, `/api/ai/ops`, `/api/cloud`, `/api/edge`, `/api/graph`
- SSE `/api/chats/:id/live`

### Breaking

هیچ bump عمومی API قبل از این برش نبود.

### Deprecated

مسیری برای حذف اعلام نشده است.
