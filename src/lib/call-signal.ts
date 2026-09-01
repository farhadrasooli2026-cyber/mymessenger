import "server-only";
import { randomId } from "@/lib/crypto-utils";
import { hitRateLimit } from "@/lib/rate-limit";
import { mutateStore } from "@/lib/store";
import type { CallSignal, StoreData } from "@/lib/store";

const SIGNAL_MAX = 16_000;
const SIGNAL_KEEP = 40;

function canAccessCall(data: StoreData, userId: string, callId: string): boolean {
  if (data.calls.some((c) => c.id === callId && c.ownerUserId === userId)) return true;
  const room = (data.groupCalls ?? []).find((c) => c.id === callId);
  if (!room || room.status === "ended") return false;
  return room.participants.some((p) => p.userId === userId && !p.leftAt && !p.kicked);
}

function parseQuality(body: string): { rttMs: number; loss: number; jitterMs: number } | null {
  const rtt = /rtt=(\d{1,6})/.exec(body);
  const loss = /loss=(\d{1,3})/.exec(body);
  const jitter = /jitter=(\d{1,6})/.exec(body);
  if (!rtt || !loss || !jitter) return null;
  return {
    rttMs: Number(rtt[1]),
    loss: Math.min(100, Number(loss[1])),
    jitterMs: Number(jitter[1]),
  };
}

export async function postCallSignal(
  userId: string,
  callId: string,
  input: { type: CallSignal["type"]; body?: string; nonce?: string },
) {
  return mutateStore((data) => {
    if (!canAccessCall(data, userId, callId)) {
      return { ok: false as const, error: "به این تماس دسترسی نداری.", status: 403 };
    }
    const flood = hitRateLimit(data, `csig:${userId}`, 60_000, 80);
    if (!flood.allowed) return { ok: false as const, error: "سیگنالینگ محدود شد.", status: 429 };
    const type = input.type;
    if (!["offer", "answer", "ice", "hangup", "reconnect", "quality"].includes(type)) {
      return { ok: false as const, error: "نوع سیگنال نامعتبر است.", status: 400 };
    }
    const nonce = typeof input.nonce === "string" ? input.nonce.trim().slice(0, 80) : "";
    if (nonce) {
      const replay = (data.callSignals ?? []).some(
        (s) => s.callId === callId && s.fromUserId === userId && s.nonce === nonce,
      );
      if (replay) return { ok: false as const, error: "این سیگنال قبلاً ثبت شده.", status: 409 };
    }
    const body = String(input.body ?? "").slice(0, SIGNAL_MAX);
    if ((type === "offer" || type === "answer" || type === "ice") && body.length < 8) {
      return { ok: false as const, error: "بدنهٔ سیگنال ناقص است.", status: 400 };
    }
    if (type === "quality" && /v=0|a=candidate|\bsdp\b/i.test(body)) {
      return { ok: false as const, error: "نمونهٔ کیفیت نامعتبر است.", status: 400 };
    }
    data.callSignals ??= [];
    const row: CallSignal = {
      id: randomId(),
      callId,
      fromUserId: userId,
      type,
      body: type === "quality" ? body.replace(/[^\d.,:\-a-z]/gi, "").slice(0, 80) : body,
      nonce: nonce || undefined,
      createdAt: Date.now(),
    };
    data.callSignals.push(row);
    const sample = type === "quality" ? parseQuality(row.body) : null;
    if (sample) {
      data.callQuality ??= [];
      data.callQuality.push({ callId, ...sample, at: Date.now() });
      data.callQuality = data.callQuality.filter((q) => Date.now() - q.at < 10 * 60_000).slice(-400);
    }
    data.callSignals = data.callSignals
      .filter((s) => s.callId === callId || Date.now() - s.createdAt < 10 * 60_000)
      .slice(-800);
    const mine = data.callSignals.filter((s) => s.callId === callId);
    if (mine.length > SIGNAL_KEEP) {
      const drop = new Set(mine.slice(0, mine.length - SIGNAL_KEEP).map((s) => s.id));
      data.callSignals = data.callSignals.filter((s) => !drop.has(s.id));
    }
    return { ok: true as const, id: row.id };
  });
}

export async function listCallSignals(userId: string, callId: string, after?: number) {
  return mutateStore((data) => {
    if (!canAccessCall(data, userId, callId)) {
      return { ok: false as const, error: "به این تماس دسترسی نداری.", status: 403 };
    }
    const since = typeof after === "number" ? after : 0;
    const items = (data.callSignals ?? [])
      .filter((s) => s.callId === callId && s.createdAt > since)
      .map((s) => ({
        id: s.id,
        type: s.type,
        fromMe: s.fromUserId === userId,
        body: s.fromUserId === userId ? undefined : s.body,
        createdAt: s.createdAt,
      }));
    return { ok: true as const, items, note: "رسانه روی دستگاه حلقه می‌شود؛ سرور فقط سیگنال احرازشده را نگه می‌دارد نه صدا." };
  });
}
