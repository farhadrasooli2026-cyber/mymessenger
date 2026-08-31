import "server-only";
import { randomId } from "@/lib/crypto-utils";
import { SEED_PEERS } from "@/lib/chat-copy";
import { blockState } from "@/lib/safety";
import { audienceAllows } from "@/lib/privacy";
import { mutateStore, readStoreSnapshot } from "@/lib/store";
import type { CallDirection, CallKind, CallRecord, CallStatus, StoreData } from "@/lib/store";
import { emitNotification } from "@/lib/notify";

export const CALL_RING_MS = 30_000;

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
};

function expireRinging(call: CallRecord, now: number, data?: StoreData): CallRecord {
  if (call.status === "ringing" && now - call.createdAt >= CALL_RING_MS) {
    call.status = "missed";
    call.endedAt = call.createdAt + CALL_RING_MS;
    if (data && call.direction === "in") {
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
    let rows = data.calls.filter((c) => c.ownerUserId === userId).map((c) => publicCall(expireRinging(c, now, data), now));
    if (filter === "missed") rows = rows.filter((c) => c.status === "missed");
    else if (filter === "incoming") rows = rows.filter((c) => c.direction === "in");
    else if (filter === "outgoing") rows = rows.filter((c) => c.direction === "out");
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
  const user = data.users.find((u) => u.id === userId);
  return {
    call: live ? publicCall(live, now) : null,
    lowDataCalls: Boolean(user?.lowDataCalls),
    hideCallOnLockScreen: Boolean(user?.hideCallOnLockScreen),
    callPrivacy: user?.callPrivacy ?? "everyone",
  };
}

export async function startOutgoing(userId: string, threadId: string, kind: CallKind) {
  return mutateStore((data) => {
    const thread = data.threads.find((t) => t.id === threadId && t.ownerUserId === userId);
    if (!thread) return { ok: false as const, error: "گفتگو یافت نشد.", status: 404 };
    const safety = blockState(data, userId, thread.peerKey);
    if (!safety.callsAllowed) {
      return { ok: false as const, error: "تماس با این شخص محدود شده است.", status: 403 };
    }
    if (busyCall(data, userId)) {
      return { ok: false as const, error: "یک تماس دیگر در جریان است.", status: 409 };
    }
    const now = Date.now();
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
    if (busyCall(data, userId)) {
      return { ok: false as const, error: "یک تماس دیگر در جریان است.", status: 409 };
    }
    const now = Date.now();
    const call: CallRecord = {
      id: randomId(),
      ownerUserId: userId,
      threadId: thread.id,
      peerKey: thread.peerKey,
      peerName: thread.peerName,
      peerColor: thread.color,
      kind,
      direction: "in",
      status: "ringing",
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
  action: "accept" | "connect" | "decline" | "end" | "message-decline",
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
      if (call.direction !== "in" || call.status !== "ringing") {
        return { ok: false as const, error: "تماس ورودی فعالی نیست.", status: 400 };
      }
      call.status = "active";
      call.connectedAt = now;
    } else if (action === "decline" || action === "message-decline") {
      if (call.status !== "ringing") {
        return { ok: false as const, error: "تماس در حال زنگ نیست.", status: 400 };
      }
      call.status = call.direction === "in" ? "declined" : "ended";
      call.endedAt = now;
      call.declineWithMessage = action === "message-decline";
    } else if (action === "end") {
      if (call.status === "active") {
        call.durationMs = call.connectedAt ? now - call.connectedAt : 0;
      }
      if (call.status === "ringing" && call.direction === "in") call.status = "missed";
      else if (call.status === "ringing") call.status = "ended";
      else call.status = "ended";
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
