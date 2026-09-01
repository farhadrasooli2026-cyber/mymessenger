# Migration (Schema v1)

منبع: `src/lib/db/migrate.ts`.

1. `schema-meta-and-jobs` — فیلد `schemaMeta`، `dbJobs`، `dbAudit`.
2. Migration افزایشی است و collection کاربر را drop نمی‌کند.
3. اگر فایل Store نسخهٔ بالاتر از باینری داشته باشد، readiness شکست می‌خورد.

ترتیب اجرا: هنگام `mutateStore` / hydrate، `applyMigrations`.

Breaking آینده باید در CHANGELOG و `/docs/api` ثبت شود.
