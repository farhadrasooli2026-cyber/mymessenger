# ADR 0001 — JSON Store تک‌نویسنده

## Context

نیاز به ماندگاری حساب، پیام ciphertext، و تست سریع بدون سرویس خارجی.

## Decision

فایل `.data/nixo-store.json` با صف Promise تک‌نویسنده و نوشتن tmp+rename.

## Alternatives

SQLite یا Postgres از ابتدا. رد شد تا Backup/DR و Vitest روی یک فایل بماند.

## Consequences

مقیاس افقی محدود است. Migration افزایشی در `migrate.ts`. مسیر بعدی: درایور SQL با همان `bindSql` و `scopedRows`.
