import "server-only";
import { hmacIdentifier, randomId } from "@/lib/crypto-utils";
import { SEED_PEERS } from "@/lib/chat-copy";
import { blockState } from "@/lib/safety";
import { audienceAllows } from "@/lib/privacy";
import { mutateStore, readStoreSnapshot } from "@/lib/store";
import type { CallDirection, CallKind, CallRecord, CallStatus, StoreData } from "@/lib/store";
import { hitRateLimit } from "@/lib/rate-limit";
import { emitNotification } from "@/lib/notify";
import { appendCallEvent } from "@/lib/call-events";

export const CALL_RING_MS = 30_000;
export const CALL_FLOOD_WINDOW_MS = 60_000;
export const CALL_FLOOD_MAX = 8;
export const CALL_TOKEN_TTL_MS = 2 * 60 * 60 * 1000;
export const CALL_RECONNECT_MAX = 8;

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
  sessionId: string | null;
  bridged: boolean;
  phase:
    | "calling"
    | "ringing"
    | "connecting"
    | "connected"
    | "reconnecting"
    | "ended"
    | "rejected"
    | "missed"
    | "failed"
    | "busy";
  reconnects: number;
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
    call.mediaTokenHash = undefined;
    if (data) {
      for (const copy of twins(data, call)) {
        if (copy.id === call.id) continue;
        if (copy.status === "ringing") {
          copy.status = copy.direction === "out" ? "ended" : "missed";
          copy.endedAt = call.endedAt;
          copy.endReason = "timeout";
          copy.mediaTokenHash = undefined;
          if (copy.direction === "in") noteMissedInChat(data, copy, now);
        }
      }
          if (call.direction === "in") {
        noteMissedInChat(data, call, now);
        appendCallEvent(data, { userId: call.ownerUserId, callId: call.id, kind: "missed" });
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
  }
  return call;
}

export function callPhase(call: CallRecord): PublicCall["phase"] {
  if (call.status === "missed") return "missed";
  if (call.status === "declined") return "rejected";
  if (call.status === "queued") return "busy";
  if (call.status === "ended" && call.endReason === "failed") return "failed";
  if (call.status === "ended") return "ended";
  if (call.status === "active" && call.reconnecting) return "reconnecting";
  if (call.status === "active") return "connected";
  if (call.status === "ringing" && call.direction === "out") return "calling";
  if (call.status === "ringing") return "ringing";
  return "ended";
}

export function hashCallToken(token: string) {
  return hmacIdentifier(`call-token:${token}`);
}

function twins(data: StoreData, call: CallRecord): CallRecord[] {
  if (!call.sessionId) return [call];
  return data.calls.filter((c) => c.sessionId === call.sessionId);
}

function ensurePeerThread(data: StoreData, fromId: string, toUser: { id: string; displayName?: string; username?: string | null }, now: number) {
  let thread = data.threads.find((t) => t.ownerUserId === toUser.id && t.peerKey === fromId);
  if (thread) return thread;
  const from = data.users.find((u) => u.id === fromId);
  thread = {
    id: randomId(),
    ownerUserId: toUser.id,
    peerKey: fromId,
    peerName: from?.displayName || from?.username || "کاربر نیکسو",
    peerTitle: from?.username ? `@${from.username}` : "گفتگوی خصوصی",
    color: "#34d399",
    updatedAt: now,
  };
  data.threads.push(thread);
  return thread;
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
    sessionId: call.sessionId ?? null,
    bridged: Boolean(call.sessionId),
    phase: callPhase(call),
    reconnects: call.reconnects ?? 0,
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
  return audienceAllows(user.callPrivacy ?? "everyone", user.contactIds, user.callAllowIds ?? [], fromPeerKey, user.friendIds) ||
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
    if (existing) return { ok: true as const, call: publicCall(existing, now), mediaToken: null as string | null };
    if (busyCall(data, userId)) {
      return { ok: false as const, error: "یک تماس دیگر در جریان است.", status: 409, busy: true as const };
    }
    const flood = hitRateLimit(data, `callout:${userId}`, CALL_FLOOD_WINDOW_MS, CALL_FLOOD_MAX);
    if (!flood.allowed) return { ok: false as const, error: "تماس پیاپی محدود شد.", status: 429 };
    const peerUser = data.users.find((u) => u.id === thread.peerKey && u.status === "active");
    if (peerUser && !canReceiveCall(data, peerUser.id, userId)) {
      return { ok: false as const, error: "تنظیمات حریم خصوصی مخاطب تماس را محدود کرده است.", status: 403 };
    }
    const sessionId = peerUser ? randomId() : undefined;
    const token = peerUser ? randomId() : undefined;
    const tokenHash = token ? hashCallToken(token) : undefined;
    const tokenExp = token ? now + CALL_TOKEN_TTL_MS : undefined;
    const meUser = data.users.find((u) => u.id === userId);
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
      sessionId,
      mediaTokenHash: tokenHash,
      mediaTokenExpiresAt: tokenExp,
      reconnects: 0,
    };
    data.calls.push(call);
    appendCallEvent(data, { userId, callId: call.id, kind: "created" });
    if (peerUser) {
      const peerThread = ensurePeerThread(data, userId, peerUser, now);
      const peerBusy = busyCall(data, peerUser.id);
      const incoming: CallRecord = {
        id: randomId(),
        ownerUserId: peerUser.id,
        threadId: peerThread.id,
        peerKey: userId,
        peerName: meUser?.displayName || meUser?.username || "مخاطب",
        peerColor: thread.color,
        kind,
        direction: "in",
        status: peerBusy ? "queued" : "ringing",
        createdAt: now,
        sessionId,
        mediaTokenHash: tokenHash,
        mediaTokenExpiresAt: tokenExp,
        reconnects: 0,
      };
      data.calls.push(incoming);
      appendCallEvent(data, { userId: peerUser.id, callId: incoming.id, kind: "incoming" });
      const hide = Boolean(peerUser.hideCallOnLockScreen);
      emitNotification(data, {
        userId: peerUser.id,
        category: "calls",
        kind: kind === "video" ? "incoming_video" : "incoming_voice",
        title: kind === "video" ? "Incoming Video Call" : "Incoming Voice Call",
        senderName: hide ? "NIXO" : incoming.peerName,
        body: hide ? "تماس ورودی" : incoming.peerName,
        sourceId: `call:${userId}`,
        muteType: "chat",
        muteId: peerThread.id,
        target: { type: "call", id: incoming.id },
      });
    }
    return { ok: true as const, call: publicCall(call, now), mediaToken: token ?? null };
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
    appendCallEvent(data, { userId, callId: call.id, kind: "incoming_demo" });
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
  action: "accept" | "connect" | "decline" | "end" | "message-decline" | "end-current-accept" | "cancel" | "fail" | "reconnect",
) {
  return mutateStore((data) => {
    const call = data.calls.find((c) => c.id === callId && c.ownerUserId === userId);
    if (!call) return { ok: false as const, error: "تماس یافت نشد.", status: 404 };
    const now = Date.now();
    expireRinging(call, now, data);
    const applyTwins = (fn: (c: CallRecord) => void) => {
      for (const copy of twins(data, call)) fn(copy);
    };
    const note = (kind: string) => {
      for (const copy of twins(data, call)) {
        appendCallEvent(data, { userId: copy.ownerUserId, callId: copy.id, kind });
      }
    };
    if (action === "reconnect") {
      if (call.status !== "active") return { ok: false as const, error: "تماس فعال نیست.", status: 400 };
      const n = (call.reconnects ?? 0) + 1;
      if (n > CALL_RECONNECT_MAX) {
        applyTwins((c) => {
          c.status = "ended";
          c.endedAt = now;
          c.endReason = "failed";
          c.reconnecting = false;
          c.mediaTokenHash = undefined;
          if (c.connectedAt) c.durationMs = now - c.connectedAt;
        });
        note("reconnect_failed");
        return { ok: false as const, error: "تلاش اتصال مجدد به سقف رسید.", status: 429, call: publicCall(call, now) };
      }
      applyTwins((c) => {
        c.reconnects = n;
        c.reconnecting = true;
      });
      note("reconnect");
      return { ok: true as const, call: publicCall(call, now) };
    }
    if (action === "connect") {
      if (call.direction !== "out" || (call.status !== "ringing" && call.status !== "active")) {
        return { ok: false as const, error: "این تماس قابل اتصال نیست.", status: 400 };
      }
      if (call.sessionId && call.status === "ringing") {
        return { ok: false as const, error: "منتظر پذیرش طرف مقابل بمان.", status: 409 };
      }
      call.status = "active";
      call.connectedAt = call.connectedAt ?? now;
      call.reconnecting = false;
      note("connected");
    } else if (action === "accept") {
      if (call.direction !== "in" || (call.status !== "ringing" && call.status !== "queued")) {
        return { ok: false as const, error: "تماس ورودی فعالی نیست.", status: 400 };
      }
      applyTwins((c) => {
        c.status = "active";
        c.connectedAt = now;
        c.reconnecting = false;
      });
      note("accepted");
    } else if (action === "end-current-accept") {
      const current = busyCall(data, userId);
      if (current && current.id !== call.id) {
        current.status = "ended";
        current.endedAt = now;
        if (current.connectedAt) current.durationMs = now - current.connectedAt;
        current.mediaTokenHash = undefined;
      }
      if (call.direction !== "in" || (call.status !== "queued" && call.status !== "ringing")) {
        return { ok: false as const, error: "تماس منتظری نیست.", status: 400 };
      }
      applyTwins((c) => {
        c.status = "active";
        c.connectedAt = now;
        c.reconnecting = false;
      });
      note("accepted");
    } else if (action === "cancel") {
      if (call.direction !== "out" || call.status !== "ringing") {
        return { ok: false as const, error: "این تماس قابل لغو نیست.", status: 400 };
      }
      applyTwins((c) => {
        c.status = c.direction === "in" ? "missed" : "ended";
        c.endedAt = now;
        c.endReason = c.direction === "in" ? "timeout" : "cancel";
        c.mediaTokenHash = undefined;
        if (c.direction === "in") noteMissedInChat(data, c, now);
      });
      note("cancelled");
    } else if (action === "fail") {
      applyTwins((c) => {
        c.status = "ended";
        c.endedAt = now;
        c.endReason = "failed";
        c.mediaTokenHash = undefined;
        if (c.connectedAt) c.durationMs = now - c.connectedAt;
      });
      note("failed");
    } else if (action === "decline" || action === "message-decline") {
      if (call.status !== "ringing" && call.status !== "queued") {
        return { ok: false as const, error: "تماس در حال زنگ نیست.", status: 400 };
      }
      applyTwins((c) => {
        if (c.direction === "in") {
          c.status = "declined";
          c.endReason = "declined";
        } else {
          c.status = "ended";
          c.endReason = "declined";
        }
        c.endedAt = now;
        c.declineWithMessage = action === "message-decline";
        c.mediaTokenHash = undefined;
      });
      note("rejected");
    } else if (action === "end") {
      applyTwins((c) => {
        if (c.status === "active") {
          c.durationMs = c.connectedAt ? now - c.connectedAt : 0;
          c.endReason = "hangup";
        }
        if (c.status === "ringing" && c.direction === "in") {
          c.status = "missed";
          c.endReason = "timeout";
          noteMissedInChat(data, c, now);
        } else if (c.status === "ringing") {
          c.status = "ended";
          c.endReason = "cancel";
        } else c.status = "ended";
        c.endedAt = now;
        c.mediaTokenHash = undefined;
        c.reconnecting = false;
      });
      note("ended");
    }
    return { ok: true as const, call: publicCall(call, now) };
  });
}

export async function updateCallSettings(
  userId: string,
  patch: {
    callPrivacy?: "everyone" | "contacts" | "friends" | "nobody" | "selected";
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

