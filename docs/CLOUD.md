# Cloud و Auto-Scaling نیکسو

نیکسو Cloud-Ready است: سرویس‌ها Stateless (نشست روی کوکی HttpOnly، صف در Store)، Scale افقی/عمودی، Auto Scaling با Min/Max و Cooldown، Load Balancer آگاه از Health، و جداسازی Development / Staging / Production.

## پنل

`/app/admin` → ابر (`/api/cloud`). مجوز `cloud.view` / `cloud.manage`.

## قوانین سخت

- Scale باعث از دست رفتن پیام، نشست، یا دوباره‌کاری پرداخت/اعلان نمی‌شود (Idempotency موجود می‌ماند).
- Database و Storage خصوصی به اینترنت عمومی Bind نمی‌شوند.
- Secret در Git، Image یا کلاینت نیست (`NIXO_*` از env / SecretRef).
- Auto Scaling بدون سقف ممنوع است؛ `min` و `max` اجباری‌اند.
- خرابی یک Instance با replica حداقل API متوقف نمی‌کند.
- Deployment مرحله‌ای: Rolling در `deploy/k8s.yaml`، Canary/Blue-Green در کاتالوگ انتشار.

## سرویس‌ها

`api` · `worker` (پردازش تصویر/ویدیو/فایل، Push، ایمیل/SMS صف) · `search` · `notify` · `media` · `turn`

Scale-in ابتدا Drain می‌کند (Ready شکست می‌خورد تا LB ترافیک جدید ندهد) بعد Terminate.

## Data plane

- Object Storage برای فایل بزرگ؛ Application Server منبع فایل نیست.
- CDN برای `/_next/static`؛ API `private, no-store`.
- فایل خصوصی Signed URL + Authorization.
- Writer pool کنترل‌شده؛ Read replica در Policy؛ Sharding readiness در perf-types.
- Cache شکست داده را حذف نمی‌کند.
- Backup/DR موجود (`/api/dr`)؛ RTO/RPO در پنل ابر.

## IaC

- `Dockerfile` غیر root + HEALTHCHECK ready
- `docker-compose.yml` حد CPU/RAM و stop grace
- `deploy/k8s.yaml` Rolling + Probe
- `deploy/k8s-scale.yaml` HPA، PDB، Worker جدا، NetworkPolicy
- `deploy/iac/nixo.tf` اسکلت Terraform بدون Secret

## تست

Load/Stress/Chaos از پنل فقط خارج از Production. Failover منطقه نشست را باطل نمی‌کند.
