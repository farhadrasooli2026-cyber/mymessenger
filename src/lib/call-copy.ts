export type CallKindUi = "voice" | "video";
export type CallStatusUi =
  | "ringing"
  | "active"
  | "ended"
  | "declined"
  | "missed"
  | "queued"
  | "connecting"
  | "failed"
  | "reconnecting";
export type CallDirectionUi = "out" | "in";

export function callStatusFa(status: CallStatusUi, direction: CallDirectionUi, kind: CallKindUi): string {
  if (status === "queued") return "خط مشغول";
  if (status === "connecting") return "در حال اتصال · Connecting";
  if (status === "reconnecting") return "اتصال مجدد · Reconnecting";
  if (status === "failed") return "ناموفق · Failed";
  if (status === "ringing" && direction === "in") return "تماس ورودی · Ringing";
  if (status === "ringing") return "در حال زنگ · Calling";
  if (status === "active") return "متصل · Connected";
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

export function missedCallChatText(kind: CallKindUi): string {
  return kind === "video" ? "تماس تصویری بی‌پاسخ" : "تماس صوتی بی‌پاسخ";
}

export function formatCallWhen(ts: number): string {
  return new Intl.DateTimeFormat("fa-IR", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(ts);
}
