# نصب نیکسو (v0.1.0)

## پیش‌نیاز

- Node.js 20
- npm
- Git

پایگاه دادهٔ جدا لازم نیست.

## مراحل

```bash
cp .env.example .env.local
npm ci
npm run dev
```

آدرس: http://127.0.0.1:43151

سپس `/docs` را برای مرجع باز کن.

مقدارهای `.env.local` را commit نکن. نام متغیرها در `.env.example` است.

ارسال OTP واقعی: [`docs/OTP.md`](./OTP.md). در development صندوق آزمایشی فعال است؛ در Production باید Provider ایمیل و پیامک در env باشد.
