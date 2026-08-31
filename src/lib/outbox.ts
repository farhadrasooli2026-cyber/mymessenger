import "server-only";

type OutboxItem = {
  challengeId: string;
  channel: "phone" | "email";
  maskedTo: string;
  body: string;
  createdAt: number;
};

const outbox = new Map<string, OutboxItem>();

export function putOutbox(item: OutboxItem): void {
  outbox.set(item.challengeId, item);
  for (const [id, existing] of outbox) {
    if (Date.now() - existing.createdAt > 10 * 60 * 1000) {
      outbox.delete(id);
    }
  }
}

export function getOutbox(challengeId: string): OutboxItem | null {
  const item = outbox.get(challengeId);
  if (!item) return null;
  if (Date.now() - item.createdAt > 10 * 60 * 1000) {
    outbox.delete(challengeId);
    return null;
  }
  return item;
}

export function buildOtpMessage(channel: "phone" | "email", code: string, ttlMin: number): string {
  if (channel === "phone") {
    return `کد تأیید NIXO: ${code}\nاین کد تا ${ttlMin} دقیقه معتبر است و فقط یک‌بار قابل استفاده است.`;
  }
  return `کد تأیید ثبت‌نام NIXO شما ${code} است. اعتبار: ${ttlMin} دقیقه. این کد یک‌بارمصرف است. اگر این درخواست از سمت شما نبوده، این پیام را نادیده بگیرید.`;
}
