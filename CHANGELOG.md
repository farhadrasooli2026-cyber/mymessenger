# Changelog

همهٔ نسخه‌ها Semver اپ هستند. API جدا با هدر `X-API-Version`.

## 0.1.0

- ثبت‌نام OTP، چت E2EE، گروه، کانال، استوری، تماس محلی، اعلان، جستجو، Vault
- ادمین، پایش، DR، عملکرد، کاتالوگ انتشار
- مستندات `/docs` و CI `docs:check`
- Dependency اصلی: Next 16.3، React 19، Zod 4، Vitest 4، Tailwind 4

### API

- `GET /api/health`, `/api/status`, `/api/version`, `/api/docs`
- SSE `/api/chats/:id/live`

### Breaking

هیچ bump عمومی API قبل از این برش نبود.

### Deprecated

مسیری برای حذف اعلام نشده است.
