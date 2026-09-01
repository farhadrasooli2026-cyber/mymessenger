# آمادگی Production نیکسو

Production Ready یعنی Security، Privacy، Integrity، Recovery و Maintainability با هم کار کنند — نه فقط «سرور بالا است».

## پنل

`/app/admin` → آمادگی (`/api/prod`). مجوز `prod.view` / `prod.manage`.

## مسدودکننده‌ها

این موارد قبل از رفع وارد Production نمی‌شوند:

- امنیت بحرانی (از جمله Secret توسعه در env واقعی)
- ریسک از دست رفتن داده
- یکپارچگی پرداخت
- Bypass احراز هویت یا مجوز
- Crash حیاتی Store
- فساد داده

یخ‌زدگی (`PROD_FREEZE`) انتشار `/api/deploy` Production را با HTTP 423 متوقف می‌کند.

## Smoke داخلی

سطح‌های Login تا Refund روی Store موجود بررسی می‌شوند. جایگزین تست مرورگر روی Staging نیست.

## HTTPS و Cookie

در Production کوکی نشست `Secure` + `HttpOnly` + `SameSite=Lax` است. HSTS وقتی `x-forwarded-proto=https` باشد ست می‌شود.

Demo Inbox در Production خاموش است. ارسال OTP فقط از Backend با Providerهای env.

## RTO / RPO (هدف داخلی)

| حوزه | RTO | RPO |
| --- | --- | --- |
| هویت | ۱۵ دقیقه | ۵ دقیقه |
| پیام | ۳۰ دقیقه | ۵ دقیقه |
| ذخیره | ۶۰ دقیقه | ۱۵ دقیقه |
| صورتحساب | ۳۰ دقیقه | نزدیک به صفر (Intent+Webhook) |
| جستجو | ۱۲۰ دقیقه | قابل Rebuild |

## Circuit

وابستگی اختیاری (تحلیل، موسیقی) نباید هویت یا پیام را قطع کند. مدار `src/lib/circuit.ts` برای سرویس‌های غیر هسته است.

## تأیید Release

`PROD_APPROVE` فقط رکورد می‌سازد؛ جایگزین `DEPLOY_PRODUCTION` نیست.

## AI

لایهٔ هوش مصنوعی جدا از مدار هویت و پیام است. Kill دستیار ورود را نمی‌بندد. جزئیات: `docs/AI.md`.
