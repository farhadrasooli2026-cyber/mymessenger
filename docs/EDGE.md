# CDN و Edge نیکسو

لبه ترافیک عمومی را نزدیک User می‌آورد. **کش مشترک هرگز پیام، فایل خصوصی، نشست، AI یا پرداخت را نگه نمی‌دارد.** Authorization در Origin می‌ماند.

## پنل

`/app/admin` → لبه (`/api/edge`). `edge.view` / `edge.manage`. Purge فقط با `EDGE_PURGE` و پیشوند عمومی.

## مسیریابی

PoPها: fra / lhr / iad / sin / gru. انتخاب بر اساس سلامت، ظرفیت و Latency. Edge ناسالم از مسیر خارج می‌شود. WebSocket با چسبندگی روی Gateway همان PoP؛ Failover با Ready و reconnect کلاینت.

## کش

| منبع | Cache-Control |
| --- | --- |
| `/_next/static`, فونت hashed | public immutable |
| آیکون / کاتالوگ عمومی | public کوتاه + generation |
| API، چت، Vault، استوری، AI، billing | private, no-store |

Signed URL منقضی می‌شود. Queryهای `t`/`k`/`token` وارد کلید کش عمومی نمی‌شوند.

## امنیت لبه

WAF/DDoS/Bot در پیکربندی نمونه. Host نامعتبر `421`. Origin خصوصی (`origin.nixo.internal`). Rate limit جدا برای auth / search / AI / پرداخت / دانلود. Request smuggling: HTTP/1.1 keepalive به Origin با `Connection ""`.

## رسانه

Range و Resume در Vault موجود است. WebP/AVIF در صورت Accept. Adaptive/TURN منطقه‌ای از ICE موجود. Live پیکسل روی CDN عمومی نیست.

## مشاهده‌پذیری

RUM نمونه‌برداری‌شده (TTFB، بدون URL خصوصی). P50/P95/P99، Synthetic از PoPها، هزینه پهنای باند. بودجه عملکرد در پنل.

## IaC

`deploy/cdn/nixo-edge.conf` و Rolling در انتشار موجود. Canary و Rollback کانفیگ لبه نسخه‌دار است.
