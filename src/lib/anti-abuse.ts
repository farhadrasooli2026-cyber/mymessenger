import "server-only";
import { hmacIdentifier } from "@/lib/crypto-utils";
import type { AuditEvent } from "@/lib/store";
import { sniffFileBytes } from "@/lib/files";

export { progressiveBackoffMs, safeRedirectPath, stripSensitive, redactLogText, impossibleTravel, countryFromApprox } from "@/lib/safe-web";

export const INCIDENT_PLAYBOOK = [
  {
    phase: "Detection",
    title: "شناسایی",
    steps: [
      "هشدار امنیت در Settings → Security و اعلان Critical را باز کن.",
      "Login History، دستگاه‌های Unknown و متریک suspicious24h را ببین.",
      "اگر دستگاه را نمی‌شناسی همان‌جا Logout / Remove کن.",
    ],
  },
  {
    phase: "Containment",
    title: "مهار",
    steps: [
      "Log Out All Other Devices از حساب یا امنیت.",
      "رمز دومرحله‌ای و Passkey را در صورت تردید Rotate کن.",
      "نشست مشکوک سمت سرور باطل می‌شود؛ توکن کلاینت به‌تنهایی کافی نیست.",
    ],
  },
  {
    phase: "Recovery",
    title: "بازیابی",
    steps: [
      "از /recover با OTP وارد شو؛ نشست‌های دیگر باطل می‌شوند.",
      "شناسهٔ ورود را در صورت نشت با تأیید عوض کن.",
      "Backup E2EE را فقط با رمز خودت Restore کن.",
    ],
  },
  {
    phase: "Audit",
    title: "حسابرسی",
    steps: [
      "رویدادها chainHash دارند و از داشبورد قابل مشاهده‌اند.",
      "گزارش آسیب‌پذیری از همین صفحه بدون قرار دادن Secret در متن.",
      "نیکسو ادعا نمی‌کند غیرقابل نفوذ است؛ پاسخ سریع مهم‌تر از شعار است.",
    ],
  },
] as const;

export function auditChainPayload(prev: string, e: Pick<AuditEvent, "id" | "kind" | "createdAt" | "userId" | "detail">) {
  return `audit:${prev}:${e.id}:${e.kind}:${e.createdAt}:${e.userId}:${e.detail ?? ""}`;
}

export function nextAuditChainHash(prev: string, e: Pick<AuditEvent, "id" | "kind" | "createdAt" | "userId" | "detail">) {
  return hmacIdentifier(auditChainPayload(prev, e));
}

export function verifyAuditChain(events: AuditEvent[]): boolean {
  const chrono = [...events].reverse();
  let prev = "genesis";
  for (const e of chrono) {
    if (!e.chainHash) {
      prev = nextAuditChainHash(prev, e);
      continue;
    }
    const expect = nextAuditChainHash(prev, e);
    if (e.chainHash !== expect) return false;
    prev = e.chainHash;
  }
  return true;
}

export function scanUploadBytes(bytes: Uint8Array) {
  return sniffFileBytes(bytes);
}
