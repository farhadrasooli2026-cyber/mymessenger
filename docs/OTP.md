# ارسال OTP نیکسو

کد تأیید روی **Backend** ساخته می‌شود، با نمک هش می‌شود، و فقط به **مقصد واقعی** کاربر (ایمیل یا شماره) از طریق Provider ارسال می‌شود. Frontend هرگز کد را از API عمومی نمی‌گیرد مگر Demo Inbox در development/testing.

تولید ۶ رقمی، TTL سه دقیقه، cooldown ارسال مجدد ۴۵ث، سقف تلاش و Rate Limit بدون تغییر مانده‌اند. Login و Register و بازیابی و تغییر شناسه و حذف حساب همه از همین مسیر ارسال استفاده می‌کنند.

ورود با رمز عبور (`POST /api/register/password`) OTP را جایگزین نمی‌کند؛ فقط برای حساب فعال با رمز تنظیم‌شده است. Rate Limit جدا (`password-login:`) دارد و خطای عمومی از وجود حساب خبر نمی‌دهد.

## Demo Inbox

- Vitest و `NIXO_ENV=development` (پیش‌فرض): صندوق آزمایشی نشست‌دار فعال است.
- `NIXO_ENV=production` یا `NODE_ENV=production`: صندوق **همیشه خاموش** است؛ حتی اگر `NIXO_DEMO_INBOX` ست نشده باشد.
- مقدار `NIXO_DEMO_INBOX=true` در Production توسط `validateRuntimeConfig` رد می‌شود و probe `ready` شکست می‌خورد.

## وضعیت ارسال

روی چالش: `pending` → `sent` | `failed` | `dev-outbox`. اگر Demo Inbox روشن باشد (development/testing) ارسال زنده Provider صدا زده نمی‌شود مگر `NIXO_OTP_FORCE_PROVIDER=1`. در Production همیشه Provider واقعی استفاده می‌شود. خطای Provider در لاگ ساخت‌یافته (`otp_send_failed` / `otp_provider_http`) بدون متن کد و بدون API Key ثبت می‌شود؛ کلاینت خطای عمومی ۵۰۲ می‌گیرد و نشست Verify فقط بعد از ارسال موفق ساخته می‌شود. `GET /api/health?probe=ready` فیلد `otp.email` / `otp.sms` را بدون Secret برمی‌گرداند.

## متغیرهای Render (Environment)

Secret را فقط در داشبورد Render بگذار؛ در Git commit نکن.

| Variable | Required in Production | Notes |
| --- | --- | --- |
| `NIXO_ENV` | yes | `production` |
| `NIXO_DEMO_INBOX` | yes | must be `false` |
| `NIXO_PEPPER` | yes | `openssl rand -hex 32` — not the dev fallback |
| `NIXO_SESSION_SECRET` | yes | long random |
| `NIXO_DATA_KEY` | yes | 64 hex chars |
| `NIXO_BACKUP_KEY` | recommended | 64 hex chars, different from data key |
| `NIXO_EMAIL_PROVIDER` | yes | `resend` \| `sendgrid` \| `postmark` \| `mailgun` \| `smtp` |
| `NIXO_EMAIL_FROM` | yes | e.g. `NIXO <noreply@yourdomain>` |
| `NIXO_EMAIL_API_KEY` | yes unless SMTP | Resend/SendGrid/Postmark/Mailgun API key |
| `NIXO_MAILGUN_DOMAIN` | if mailgun | sending domain |
| `NIXO_SMTP_HOST` | if smtp | |
| `NIXO_SMTP_PORT` | if smtp | `465` or `587` |
| `NIXO_SMTP_USER` | if smtp | |
| `NIXO_SMTP_PASS` | if smtp | |
| `NIXO_SMTP_SECURE` | if smtp | `true` for 465 |
| `NIXO_SMS_PROVIDER` | yes | `twilio` \| `kavenegar` \| `smsir` |
| `NIXO_SMS_API_KEY` | yes | Twilio Account SID or Kavenegar/sms.ir key |
| `NIXO_SMS_API_SECRET` | Twilio | Twilio Auth Token |
| `NIXO_SMS_FROM` | Twilio / sms.ir | E.164 or line number |
| `NIXO_PUBLIC_HOST` | optional | extra CORS/CSRF host if custom domain ≠ `Host` |

## تست End-to-End روی Render

1. متغیرها را در Render ست کن؛ سرویس را Redeploy کن.
2. `GET /api/health?probe=ready` باید ۲۰۰ باشد (Demo Inbox و Providerها معتبر).
3. ثبت‌نام با **ایمیل واقعی** که به دامنهٔ From اجازهٔ ارسال می‌دهد. کد فقط در Inbox آن ایمیل است؛ `/api/register/inbox` باید ۴۰۴ باشد.
4. ثبت‌نام با **شماره واقعی** روی همان Provider (Twilio trial باید شماره را Verify کرده باشد؛ کاوه‌نگار طبق پنل).
5. اگر ارسال شکست بخورد، در لاگ سرویس `otp_send_failed` با `challengeId` و `provider` می‌آید نه کد.

تست خودکار در CI با Mock HTTP است (`NIXO_OTP_FORCE_PROVIDER=1`) تا Secret واقعی وارد Git نشود.
