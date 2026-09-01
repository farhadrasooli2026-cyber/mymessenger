export type CallKindUi = "voice" | "video";
export type CallStatusUi = "ringing" | "active" | "ended" | "declined" | "missed" | "queued";
export type CallDirectionUi = "out" | "in";

export function callStatusFa(status: CallStatusUi, direction: CallDirectionUi, kind: CallKindUi): string {
  if (status === "queued") return "تماس منتظر (خط مشغول)";
  if (status === "ringing" && direction === "in") return "تماس ورودی";
  if (status === "ringing") return "در حال زنگ…";
  if (status === "active") return "متصل";
  if (status === "missed") return kind === "video" ? "تماس تصویری بی‌پاسخ" : "تماس صوتی بی‌پاسخ";
  if (status === "declined") return "رد شد";
  return "پایان‌یافته";
  if (status === "ringing" && direction === "in") return "تماس ورودی";
  if (status === "ringing") return "در حال زنگ…";
  if (status === "active") return "متصل";
  if (status === "missed") return kind === "video" ? "تماس تصویری بی‌پاسخ" : "تماس صوتی بی‌پاسخ";
  if (status === "declined") return "رد شد";
  return "پایان‌یافته";
}

export function callKindFa(kind: CallKindUi): string {
  return kind === "video" ? "تصویری" : "صوتی";
}

export function formatCallClock(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}

export function formatCallWhen(ts: number): string {
  return new Intl.DateTimeFormat("fa-IR", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(ts);
}
