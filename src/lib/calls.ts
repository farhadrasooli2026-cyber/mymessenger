import "server-only";
import { randomId } from "@/lib/crypto-utils";
import { SEED_PEERS } from "@/lib/chat-copy";
import { blockState } from "@/lib/safety";
import { audienceAllows } from "@/lib/privacy";
import { mutateStore, readStoreSnapshot } from "@/lib/store";
import type { CallDirection, CallKind, CallRecord, CallStatus, StoreData } from "@/lib/store";
import { hitRateLimit } from "@/lib/rate-limit";
import { emitNotification } from "@/lib/notify";

export const CALL_RING_MS = 30_000;
export const CALL_FLOOD_WINDOW_MS = 60_000;
export const CALL_FLOOD_MAX = 8;

export type PublicCall = {
  id: string;
  threadId: string;
  peerKey: string;
  peerName: string;
  peerColor: string;
  kind: CallKind;
  direction: CallDirection;
  status: CallStatus;
  createdAt: number;
  connectedAt: number | null;
  endedAt: number | null;
  durationMs: number;
  declineWithMessage: boolean;
  endReason?: CallRecord["endReason"];
};

function noteMissedInChat(data: StoreData, call: CallRecord, now: number) {
  if (call.chatNotedAt || call.direction !== "in") return;
  call.chatNotedAt = now;
  data.messages.push({
    id: randomId(),
    threadId: call.threadId,
    ownerUserId: call.ownerUserId,
    sender: "peer",
    enc: "purged",
    ciphertext: "",
    nonce: "",
    createdAt: now,
    kind: "system",
    hiddenFor: [],
    systemEvent: { type: "missed_call", callKind: call.kind },
  });
  const thread = data.threads.find((t) => t.id === call.threadId && t.ownerUserId === call.ownerUserId);
  if (thread) thread.updatedAt = now;
}

function expireRinging(call: CallRecord, now: number, data?: StoreData): CallRecord {
  if (call.status === "ringing" && now - call.createdAt >= CALL_RING_MS) {
    call.status = "missed";
    call.endedAt = call.createdAt + CALL_RING_MS;
    call.endReason = "timeout";
    if (data && call.direction === "in") {
      noteMissedInChat(data, call, now);
      emitNotification(data, {
        userId: call.ownerUserId,
        category: "calls",
        kind: "missed",
        title: "Missed Call",
        senderName: call.peerName,
        body: call.kind === "video" ? "Incoming Video Call از دست رفت" : "Incoming Voice Call از دست رفت",
        sourceId: `call:${call.peerKey}`,
        muteType: "chat",
        muteId: call.threadId,
        target: { type: "call", id: call.id },
      });
    }
  }
  return call;
}

export function publicCall(call: CallRecord, now = Date.now()): PublicCall {
  expireRinging(call, now);
  const durationMs =
    call.durationMs ??
    (call.connectedAt && (call.endedAt ?? (call.status === "active" ? now : null))
      ? (call.endedAt ?? now) - call.connectedAt
      : 0);
  return {
    id: call.id,
    threadId: call.threadId,
    peerKey: call.peerKey,
    peerName: call.peerName,
    peerColor: call.peerColor,
    kind: call.kind,
    direction: call.direction,
    status: call.status,
    createdAt: call.createdAt,
    connectedAt: call.connectedAt ?? null,
    endedAt: call.endedAt ?? null,
    durationMs,
    declineWithMessage: Boolean(call.declineWithMessage),
    endReason: call.endReason,
  };
}

function seedIsContact(peerKey: string) {
  return SEED_PEERS.some((p) => p.peerKey === peerKey);
}

export function canReceiveCall(data: StoreData, userId: string, fromPeerKey: string): boolean {
  const user = data.users.find((u) => u.id === userId);
  if (!user) return false;
  const safety = blockState(data, userId, fromPeerKey);
  if (!safety.callsAllowed) return false;
  return audienceAllows(user.callPrivacy ?? "everyone", user.contactIds, user.callAllowIds ?? [], fromPeerKey) ||
    ((user.callPrivacy ?? "everyone") === "contacts" && seedIsContact(fromPeerKey));
}

function busyCall(data: StoreData, userId: string) {
  const now = Date.now();
  return data.calls.find((c) => {
    if (c.ownerUserId !== userId) return false;
    expireRinging(c, now);
    return c.status === "ringing" || c.status === "active";
  });
}

export async function listCalls(userId: string, filter?: string) {
  return mutateStore((data) => {
    const now = Date.now();
    let rows = data.calls
      .filter((c) => c.ownerUserId === userId && !c.hiddenAt)
      .map((c) => publicCall(expireRinging(c, now, data), now));
    if (filter === "missed") rows = rows.filter((c) => c.status === "missed");
    else if (filter === "incoming") rows = rows.filter((c) => c.direction === "in");
    else if (filter === "outgoing") rows = rows.filter((c) => c.direction === "out");
    else if (filter === "declined") rows = rows.filter((c) => c.status === "declined");
    else if (filter === "voice") rows = rows.filter((c) => c.kind === "voice");
    else if (filter === "video") rows = rows.filter((c) => c.kind === "video");
    rows.sort((a, b) => b.createdAt - a.createdAt);
    return rows;
  });
}

export async function activeCall(userId: string) {
  const data = await readStoreSnapshot();
  const now = Date.now();
  const live = data.calls.find((c) => {
    if (c.ownerUserId !== userId) return false;
    expireRinging(c, now);
    return c.status === "ringing" || c.status === "active";
  });
  const waiting = data.calls.find((c) => {
    if (c.ownerUserId !== userId) return false;
    return c.status === "queued";
  });
  const user = data.users.find((u) => u.id === userId);
  return {
    call: live ? publicCall(live, now) : null,
    waiting: waiting ? publicCall(waiting, now) : null,
    lowDataCalls: Boolean(user?.lowDataCalls),
    hideCallOnLockScreen: Boolean(user?.hideCallOnLockScreen),
    callPrivacy: user?.callPrivacy ?? "everyone",
  };
}

export async function startOutgoing(userId: string, threadId: string, kind: CallKind) {
  return mutateStore((data) => {
    const thread = data.threads.find((t) => t.id === threadId && t.ownerUserId === userId);
    if (!thread) return { ok: false as const, error: "گفتگو یافت نشد.", status: 404 };
    const now = Date.now();
    const safety = blockState(data, userId, thread.peerKey);
    if (!safety.callsAllowed) {
      return { ok: false as const, error: "تماس با این شخص محدود شده است.", status: 403 };
    }
    const existing = data.calls.find(
      (c) => c.ownerUserId === userId && c.threadId === thread.id && c.status === "ringing" && now - c.createdAt < 8_000,
    );
    if (existing) return { ok: true as const, call: publicCall(existing, now) };
    if (busyCall(data, userId)) {
      return { ok: false as const, error: "یک تماس دیگر در جریان است.", status: 409, busy: true as const };
    }
    const flood = hitRateLimit(data, `callout:${userId}`, CALL_FLOOD_WINDOW_MS, CALL_FLOOD_MAX);
    if (!flood.allowed) return { ok: false as const, error: "تماس پیاپی محدود شد.", status: 429 };
    const call: CallRecord = {
      id: randomId(),
      ownerUserId: userId,
      threadId: thread.id,
      peerKey: thread.peerKey,
      peerName: thread.peerName,
      peerColor: thread.color,
      kind,
      direction: "out",
      status: "ringing",
      createdAt: now,
    };
    data.calls.push(call);
    return { ok: true as const, call: publicCall(call, now) };
  });
}

export async function startIncomingDemo(userId: string, kind: CallKind) {
  return mutateStore((data) => {
    const thread = data.threads.find((t) => t.ownerUserId === userId && t.peerKey === "nixo");
    if (!thread) return { ok: false as const, error: "گفتگوی نیکسو یافت نشد.", status: 404 };
    if (!canReceiveCall(data, userId, "nixo")) {
      return { ok: false as const, error: "تنظیم حریم خصوصی تماس این ورودی را مسدود کرد.", status: 403 };
    }
    const busy = busyCall(data, userId);
    const now = Date.now();
    const flood = hitRateLimit(data, `callin:${userId}`, CALL_FLOOD_WINDOW_MS, CALL_FLOOD_MAX);
    if (!flood.allowed) return { ok: false as const, error: "تماس ورودی پیاپی محدود شد.", status: 429 };
    const call: CallRecord = {
      id: randomId(),
      ownerUserId: userId,
      threadId: thread.id,
      peerKey: thread.peerKey,
      peerName: thread.peerName,
      peerColor: thread.color,
      kind,
      direction: "in",
      status: busy ? "queued" : "ringing",
      createdAt: now,
    };
    data.calls.push(call);
    const hide = Boolean(data.users.find((u) => u.id === userId)?.hideCallOnLockScreen);
    emitNotification(data, {
      userId,
      category: "calls",
      kind: kind === "video" ? "incoming_video" : "incoming_voice",
      title: kind === "video" ? "Incoming Video Call" : "Incoming Voice Call",
      senderName: hide ? "NIXO" : call.peerName,
      body: hide ? "تماس ورودی" : call.peerName,
      sourceId: `call:${call.peerKey}`,
      muteType: "chat",
      muteId: thread.id,
      target: { type: "call", id: call.id },
    });
    return { ok: true as const, call: publicCall(call, now) };
  });
}

export async function actOnCall(
  userId: string,
  callId: string,
  action: "accept" | "connect" | "decline" | "end" | "message-decline" | "end-current-accept" | "cancel" | "fail",
) {
  return mutateStore((data) => {
    const call = data.calls.find((c) => c.id === callId && c.ownerUserId === userId);
    if (!call) return { ok: false as const, error: "تماس یافت نشد.", status: 404 };
    const now = Date.now();
    expireRinging(call, now, data);
    if (action === "connect") {
      if (call.direction !== "out" || call.status !== "ringing") {
        return { ok: false as const, error: "این تماس قابل اتصال نیست.", status: 400 };
      }
      call.status = "active";
      call.connectedAt = now;
    } else if (action === "accept") {
      if (call.direction !== "in" || (call.status !== "ringing" && call.status !== "queued")) {
        return { ok: false as const, error: "تماس ورودی فعالی نیست.", status: 400 };
      }
      call.status = "active";
      call.connectedAt = now;
    } else if (action === "end-current-accept") {
      const current = busyCall(data, userId);
      if (current && current.id !== call.id) {
        current.status = "ended";
        current.endedAt = now;
        if (current.connectedAt) current.durationMs = now - current.connectedAt;
      }
      if (call.direction !== "in" || (call.status !== "queued" && call.status !== "ringing")) {
        return { ok: false as const, error: "تماس منتظری نیست.", status: 400 };
      }
      call.status = "active";
      call.connectedAt = now;
    } else if (action === "cancel") {
      if (call.direction !== "out" || call.status !== "ringing") {
        return { ok: false as const, error: "این تماس قابل لغو نیست.", status: 400 };
      }
      call.status = "ended";
      call.endedAt = now;
      call.endReason = "cancel";
    } else if (action === "fail") {
      call.status = "ended";
      call.endedAt = now;
      call.endReason = "failed";
      if (call.connectedAt) call.durationMs = now - call.connectedAt;
    } else if (action === "decline" || action === "message-decline") {
      if (call.status !== "ringing" && call.status !== "queued") {
        return { ok: false as const, error: "تماس در حال زنگ نیست.", status: 400 };
      }
      call.status = call.direction === "in" ? "declined" : "ended";
      call.endedAt = now;
      call.declineWithMessage = action === "message-decline";
      call.endReason = call.direction === "in" ? "declined" : "cancel";
    } else if (action === "end") {
      if (call.status === "active") {
        call.durationMs = call.connectedAt ? now - call.connectedAt : 0;
        call.endReason = "hangup";
      }
      if (call.status === "ringing" && call.direction === "in") {
        call.status = "missed";
        call.endReason = "timeout";
        noteMissedInChat(data, call, now);
      } else if (call.status === "ringing") {
        call.status = "ended";
        call.endReason = "cancel";
      } else call.status = "ended";
      call.endedAt = now;
    }
    return { ok: true as const, call: publicCall(call, now) };
  });
}

export async function updateCallSettings(
  userId: string,
  patch: {
    callPrivacy?: "everyone" | "contacts" | "nobody" | "selected";
    callAllowIds?: string[];
    hideCallOnLockScreen?: boolean;
    lowDataCalls?: boolean;
  },
) {
  return mutateStore((data) => {
    const user = data.users.find((u) => u.id === userId);
    if (!user) return { ok: false as const, error: "حساب فعال نیست.", status: 401 };
    if (patch.callPrivacy) user.callPrivacy = patch.callPrivacy;
    if (patch.callAllowIds) user.callAllowIds = patch.callAllowIds.slice(0, 200);
    if (typeof patch.hideCallOnLockScreen === "boolean") user.hideCallOnLockScreen = patch.hideCallOnLockScreen;
    if (typeof patch.lowDataCalls === "boolean") user.lowDataCalls = patch.lowDataCalls;
    return {
      ok: true as const,
      callPrivacy: user.callPrivacy,
      hideCallOnLockScreen: user.hideCallOnLockScreen,
      lowDataCalls: user.lowDataCalls,
    };
  });
}

export async function deleteCallHistory(userId: string, ids: string[] | "all") {
  return mutateStore((data) => {
    const now = Date.now();
    let n = 0;
    for (const c of data.calls ?? []) {
      if (c.ownerUserId !== userId) continue;
      if (ids !== "all" && !ids.includes(c.id)) continue;
      if (c.status === "ringing" || c.status === "active" || c.status === "queued") continue;
      c.hiddenAt = now;
      n += 1;
    }
    for (const g of data.groupCalls ?? []) {
      if (ids !== "all" && !ids.includes(g.id)) continue;
      if (!g.participants.some((p) => p.userId === userId)) continue;
      if (g.status !== "ended") continue;
      g.hiddenBy ??= [];
      if (!g.hiddenBy.includes(userId)) {
        g.hiddenBy.push(userId);
        n += 1;
      }
    }
    return { ok: true as const, cleared: n };
  });
}

export const CALL_RECORDING_POLICY =
  "ضبط تماس در نیکسو فعال نیست. اگر بعداً اضافه شود، قبل از ضبط Indicator واضح و رضایت همهٔ طرف‌ها لازم است و فایل مخفی ذخیره نمی‌شود.";

export function refuseCallRecording() {
  return { ok: false as const, error: CALL_RECORDING_POLICY, status: 403 as const };
}

