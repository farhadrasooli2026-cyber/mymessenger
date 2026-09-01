import "server-only";
import { randomId } from "@/lib/crypto-utils";
import { hitRateLimit } from "@/lib/rate-limit";
import { mutateStore } from "@/lib/store";
import type { CallSignal, StoreData } from "@/lib/store";
import { CALL_RECONNECT_MAX, hashCallToken } from "@/lib/calls";

const SIGNAL_MAX = 16_000;
const SIGNAL_KEEP = 40;

function liveStatuses(status: string) {
  return status === "ringing" || status === "active" || status === "queued";
}

export function signalRoomForUser(data: StoreData, userId: string, callId: string): { room: string; tokenHash?: string; tokenExp?: number; live: boolean } | null {
  const mine = data.calls.find((c) => c.id === callId && c.ownerUserId === userId);
  if (mine) {
    return {
      room: mine.sessionId ?? mine.id,
      tokenHash: mine.mediaTokenHash,
      tokenExp: mine.mediaTokenExpiresAt,
      live: liveStatuses(mine.status),
    };
  }
  const room = (data.groupCalls ?? []).find((c) => c.id === callId);
  if (!room || room.status === "ended") return null;
  if (!room.participants.some((p) => p.userId === userId && !p.leftAt && !p.kicked)) return null;
  return { room: callId, live: true };
}

function looksLikeIce(body: string) {
  return /candidate/i.test(body) && body.length >= 8 && !/\bscript\b/i.test(body);
}

function looksLikeSdp(body: string) {
  return /v=0/.test(body) && body.length >= 8;
}

export async function postCallSignal(
  userId: string,
  callId: string,
  input: { type: CallSignal["type"]; body?: string; nonce?: string; token?: string },
) {
  return mutateStore((data) => {
    const access = signalRoomForUser(data, userId, callId);
    if (!access) {
      return { ok: false as const, error: "به این تماس دسترسی نداری.", status: 403 };
    }
    if (!access.live) {
      return { ok: false as const, error: "این نشست تماس پایان یافته است.", status: 410 };
    }
    if (access.tokenHash) {
      if (!input.token || hashCallToken(input.token) !== access.tokenHash) {
        return { ok: false as const, error: "توکن تماس نامعتبر است.", status: 403 };
      }
      if (access.tokenExp && access.tokenExp < Date.now()) {
        return { ok: false as const, error: "توکن تماس منقضی شده است.", status: 401 };
      }
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
        (s) => s.callId === access.room && s.fromUserId === userId && s.nonce === nonce,
      );
      if (replay) return { ok: false as const, error: "این سیگنال قبلاً ثبت شده.", status: 409 };
    }
    const body = String(input.body ?? "").slice(0, SIGNAL_MAX);
    if (type === "offer" || type === "answer") {
      if (!looksLikeSdp(body)) return { ok: false as const, error: "SDP نامعتبر است.", status: 400 };
    }
    if (type === "ice" && !looksLikeIce(body)) {
      return { ok: false as const, error: "ICE Candidate نامعتبر است.", status: 400 };
    }
    if (type === "quality" && /v=0|a=candidate|\bsdp\b/i.test(body)) {
      return { ok: false as const, error: "نمونهٔ کیفیت نامعتبر است.", status: 400 };
    }
    if (type === "reconnect") {
      const mine = data.calls.find((c) => c.id === callId && c.ownerUserId === userId);
      if (mine) {
        const n = (mine.reconnects ?? 0) + 1;
        if (n > CALL_RECONNECT_MAX) return { ok: false as const, error: "Reconnect به سقف رسید.", status: 429 };
        mine.reconnects = n;
        mine.reconnecting = true;
        mine.reconnectStartedAt = Date.now();
        mine.connectionState = "reconnecting";
      }
    }
    data.callSignals ??= [];
    const row: CallSignal = {
      id: randomId(),
      callId: access.room,
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
      data.callQuality.push({ callId: access.room, ...sample, at: Date.now() });
      data.callQuality = data.callQuality.filter((q) => Date.now() - q.at < 10 * 60_000).slice(-400);
    }
    data.callSignals = data.callSignals
      .filter((s) => Date.now() - s.createdAt < 10 * 60_000)
      .slice(-800);
    const mine = data.callSignals.filter((s) => s.callId === access.room);
    if (mine.length > SIGNAL_KEEP) {
      const drop = new Set(mine.slice(0, mine.length - SIGNAL_KEEP).map((s) => s.id));
      data.callSignals = data.callSignals.filter((s) => !drop.has(s.id));
    }
    return { ok: true as const, id: row.id };
  });
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

export async function listCallSignals(userId: string, callId: string, after?: number) {
  return mutateStore((data) => {
    const access = signalRoomForUser(data, userId, callId);
    if (!access) {
      return { ok: false as const, error: "به این تماس دسترسی نداری.", status: 403 };
    }
    const since = typeof after === "number" ? after : 0;
    const items = (data.callSignals ?? [])
      .filter((s) => s.callId === access.room && s.createdAt > since)
      .map((s) => ({
        id: s.id,
        type: s.type,
        fromMe: s.fromUserId === userId,
        body: s.fromUserId === userId ? undefined : s.body,
        createdAt: s.createdAt,
      }));
    return {
      ok: true as const,
      items,
      live: access.live,
      note: "رسانه با DTLS/SRTP مرورگر رمز می‌شود؛ سرور فقط سیگنال احرازشده را نگه می‌دارد نه صدا یا تصویر.",
    };
  });
}

export async function callQualitySummary(userId: string) {
  const { readStoreSnapshot } = await import("@/lib/store");
  const data = await readStoreSnapshot();
  const mine = new Set(
    data.calls.filter((c) => c.ownerUserId === userId).map((c) => c.sessionId ?? c.id),
  );
  const samples = (data.callQuality ?? []).filter((q) => mine.has(q.callId));
  const n = samples.length;
  const avg = (key: "rttMs" | "loss" | "jitterMs") => (n ? Math.round(samples.reduce((s, q) => s + q[key], 0) / n) : 0);
  const ended = data.calls.filter((c) => c.ownerUserId === userId && c.status === "ended");
  const failed = data.calls.filter((c) => c.ownerUserId === userId && c.endReason === "failed").length;
  const video = data.calls.filter((c) => c.ownerUserId === userId && c.kind === "video").length;
  return {
    ok: true as const,
    samples: n,
    avgRttMs: avg("rttMs"),
    avgLoss: avg("loss"),
    avgJitterMs: avg("jitterMs"),
    ended: ended.length,
    failed,
    video,
  };
}

