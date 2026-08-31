export const DISAPPEAR_MAX_MS = 7 * 24 * 60 * 60 * 1000;

export const DISAPPEAR_PRESETS = [
  { id: "off", ms: 0, label: "خاموش" },
  { id: "10s", ms: 10_000, label: "۱۰ ثانیه" },
  { id: "30s", ms: 30_000, label: "۳۰ ثانیه" },
  { id: "1m", ms: 60_000, label: "۱ دقیقه" },
  { id: "1h", ms: 60 * 60 * 1000, label: "۱ ساعت" },
  { id: "1d", ms: 24 * 60 * 60 * 1000, label: "۱ روز" },
  { id: "1w", ms: 7 * 24 * 60 * 60 * 1000, label: "۱ هفته" },
  { id: "custom", ms: -1, label: "سفارشی" },
] as const;

export type DisappearId = (typeof DISAPPEAR_PRESETS)[number]["id"];

export function clampDisappearMs(ms: number): number {
  if (!Number.isFinite(ms) || ms <= 0) return 0;
  return Math.min(DISAPPEAR_MAX_MS, Math.floor(ms));
}

export function labelDisappear(ms: number | null | undefined): string {
  if (!ms) return "خاموش";
  const hit = DISAPPEAR_PRESETS.find((p) => p.ms === ms);
  if (hit && hit.id !== "custom" && hit.id !== "off") return hit.label;
  if (ms < 60_000) return `${Math.round(ms / 1000)} ثانیه`;
  if (ms < 60 * 60 * 1000) return `${Math.round(ms / 60_000)} دقیقه`;
  if (ms < 24 * 60 * 60 * 1000) return `${Math.round(ms / 3_600_000)} ساعت`;
  return `${Math.round(ms / 86_400_000)} روز`;
}

export function systemDisappearText(ms: number | null): string {
  if (!ms) return "پیام‌های ناپدیدشونده خاموش شد.";
  return `پیام‌های ناپدیدشونده روشن شد: ${labelDisappear(ms)}.`;
}

export function systemCaptureText(): string {
  return "احتمال ثبت صفحه روی محتوای یک‌بارمصرف شناسایی شد. نیکسو نمی‌تواند عکس از دستگاه دیگر را ۱۰۰٪ متوقف کند.";
}

export type ExpireClock = {
  createdAt: number;
  expireFrom?: "send" | "view" | null;
  disappearAfterMs?: number | null;
  expiresAt?: number | null;
  viewedAt?: number | null;
  viewOnce?: boolean;
  enc?: string;
  kind?: string;
};

export function expireFromForKind(
  kind: string,
  viewOnce: boolean,
  disappearAfterMs: number | null | undefined,
): "send" | "view" | undefined {
  if (viewOnce) return "view";
  if (!disappearAfterMs) return undefined;
  if (kind === "photo" || kind === "video" || kind === "voice") return "view";
  return "send";
}

/** Server clock only. Client-supplied expiresAt is ignored when computing from fields. */
export function isMessageExpired(message: ExpireClock, now: number): boolean {
  if (message.kind === "system") return false;
  if (message.enc && message.enc !== "e2ee-v1") return true;
  if (typeof message.expiresAt === "number" && message.expiresAt <= now) return true;
  const ms = message.disappearAfterMs;
  if (!ms || ms <= 0) return false;
  if (message.viewOnce && !message.viewedAt) return false;
  if (message.expireFrom === "view") {
    return typeof message.viewedAt === "number" && message.viewedAt + ms <= now;
  }
  return message.createdAt + ms <= now;
}

export function remainingMs(message: ExpireClock, now: number): number | null {
  if (isMessageExpired(message, now)) return 0;
  if (typeof message.expiresAt === "number") return Math.max(0, message.expiresAt - now);
  const ms = message.disappearAfterMs;
  if (!ms) return null;
  if (message.expireFrom === "view") {
    if (!message.viewedAt) return null;
    return Math.max(0, message.viewedAt + ms - now);
  }
  if (message.expireFrom === "send") return Math.max(0, message.createdAt + ms - now);
  return null;
}

export function backupEligible(message: ExpireClock, now: number): boolean {
  if (message.viewOnce) return false;
  if (isMessageExpired(message, now)) return false;
  if (message.enc && message.enc !== "e2ee-v1") return false;
  return true;
}
