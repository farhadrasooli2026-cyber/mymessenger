# جستجو و کشف نیکسو

موتور مرکزی Search جدا از Messaging است. شکست جستجو Login، چت، تماس یا فایل را متوقف نمی‌کند. **جستجو هرگز Access Control را دور نمی‌زند.**

## ایندکس

- ایندکس عمومی (`searchDocs`) فقط محتوای Public و قابل Discovery است.
- پیام خصوصی E2EE، گروه دعوت‌محور، کانال خصوصی و فایل غیرعمومی وارد ایندکس عمومی نمی‌شوند.
- همگام‌سازی افزایشی از صف `searchIndexJobs`. Rebuild کامل از Store منبع.
- Tombstone مانع بازگشت سند حذف‌شده پس از Reindex می‌شود.
- Embedding عمومی فقط از عنوان/پیش‌نمایش اسناد Public (`tokens` روی `searchDocs`). Vector/Hybrid بعد از ACL.
- ارزیابی Suggestion جدا از Query خصوصی.

## Query

حداقل ۲ نویسه، سقف ۲۰۰، سقف عملگر و Boolean. الگوهای regex/injection رد می‌شوند.

| عملگر | معنی |
| --- | --- |
| `from:@user` | فرستنده |
| `in:id` | گروه/کانال/چت مجاز |
| `after:` / `before:` | تاریخ |
| `has:link\|file\|media\|image\|video\|audio\|mention\|hashtag\|document` | نوع محتوا |
| `minsize:` / `maxsize:` | حجم فایل |
| `type:` | پسوند |
| `AND` / `OR` / `NOT` | حداکثر ۴ عملگر |
| `"عبارت"` | Exact Phrase |
| `#tag` / `@user` | هشتگ و منشن |

Prefix، Partial، Fuzzy و Typo روی متن مجاز. Stemming و مترادف نسخه‌دار فقط از واژه‌نامهٔ عمومی.

## رتبه و کشف

Relevance + تازگی + محبوبیت عمومی + زمینهٔ کاربر در صورت روشن بودن شخصی‌سازی. Hybrid/Semantic فقط روی Hitهایی که ACL قبلاً تأیید کرده. Discovery و Trending فقط Public. ضد دستکاری هشتگ با Rate Limit.

## حریم

تاریخچه فقط صاحب حساب. Cache با `userId`. Snippet پس از Permission Recheck. Analytics تجمعی بدون متن Query حساس. Voice Search روی دستگاه به متن تبدیل می‌شود و صوت آپلود نمی‌شود. AI Search همان `collectSearchHits` مجاز را می‌خواند.

## API

`GET /api/search` · `suggest=1` · `history=1` · `health=1` · `eval=1` (ایمنی نیکسو)

`POST` `rebuild` / `reindex_scope` / `tombstone` / `personalize` / `hide`

`DELETE` تاریخچه

متریک: Latency، P50/P95/P99، Zero-result، Error، Throughput.

پیشنهاد اجتماعی (Friend/Follow/گروه و کانال عمومی) جدا در `/api/graph` است و از همین ACL عمومی پیروی می‌کند.
