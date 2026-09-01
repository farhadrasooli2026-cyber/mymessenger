# مشارکت در نیکسو

مرجع کامل: `/docs/contributing` (نسخهٔ اپ باید با `package.json` یکی باشد).

## Branch

- `main` مسیر انتشار است.
- ویژگی: `cursor/*` یا `feature/*` (حروف کوچک).
- برش نسخه: `release/x.y.z`.

## Commit

پیام روشن: چه چیزی و چرا. Secret، توکن و dump در commit نیست.

## Pull Request

از `.github/pull_request_template.md`. قبل از merge: `npm run ci`.

تغییر Architecture / API / Database / Security / Deployment باید Documentation (`/docs` یا `docs/`) را به‌روز کند.

## Code Review

- هویت سمت سرور؛ IDOR
- عدم نشت Secret در پاسخ/لاگ
- `mutateStore` تو در تو نباشد
- تست مسیر اصلی
- مستند هم‌نسخه

## Secret

فقط نام متغیر در docs. مقدار در secret store یا `.env.local` (gitignore).
