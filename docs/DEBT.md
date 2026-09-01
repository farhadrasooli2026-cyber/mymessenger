# Technical debt

- JSON Store تک‌فایل؛ شاردینگ فقط به‌صورت کلید `ownerUserId` آماده است.
- SSE به‌جای WebSocket خام؛ fan-out چند instance نیاز به Pub/Sub خارجی دارد.
- Demo Inbox در development برای OTP؛ باید در Production خاموش بماند.
