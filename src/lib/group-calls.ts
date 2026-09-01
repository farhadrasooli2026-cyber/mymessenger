import "server-only";
import { randomId } from "@/lib/crypto-utils";
import { hitRateLimit } from "@/lib/rate-limit";
import { mutateStore, type StoreData } from "@/lib/store";
import type { CallKind, GroupCallParticipant, GroupCallRoom } from "@/lib/store";
import { emitNotification } from "@/lib/notify";
import { rankRole } from "@/lib/group-types";

export const GROUP_CALL_DEFAULT_MAX = 8;
export const GROUP_CALL_HARD_MAX = 16;
export const CALL_FLOOD_WINDOW_MS = 60_000;
export const CALL_FLOOD_MAX = 8;
export const GROUP_CALL_INVITE_TTL_MS = 2 * 60 * 60 * 1000;

function liveMember(data: StoreData, groupId: string, userId: string) {
  const g = data.groups.find((x) => x.id === groupId && !x.deletedAt);
  if (!g) return null;
  const m = g.members.find((x) => x.key === userId && !x.leftAt);
  return m ? { group: g, member: m } : null;
}

function liveParts(room: GroupCallRoom) {
  return room.participants.filter((p) => !p.leftAt && !p.kicked);
}

function inviteLive(room: GroupCallRoom, now = Date.now()) {
  if (!room.inviteToken) return false;
  if (room.inviteExpiresAt && room.inviteExpiresAt < now) return false;
  return true;
}

export function publicGroupCall(room: GroupCallRoom, userId: string) {
  const me = room.participants.find((p) => p.userId === userId);
  const tokenLive = inviteLive(room);
  return {
    id: room.id,
    groupId: room.groupId,
    groupName: room.groupName,
    hostUserId: room.hostUserId,
    kind: room.kind,
    status: room.status,
    maxParticipants: room.maxParticipants,
    createdAt: room.createdAt,
    endedAt: room.endedAt,
    inviteToken: me && (me.role === "host" || me.role === "admin") ? (tokenLive ? room.inviteToken : null) : Boolean(tokenLive),
    inviteExpiresAt: me && (me.role === "host" || me.role === "admin") ? (tokenLive ? room.inviteExpiresAt ?? null : null) : null,
    participants: liveParts(room).map((p) => ({
      userId: p.userId,
      name: p.name,
      role: p.role,
      mutedByHost: p.mutedByHost,
      camOff: Boolean(p.camOff),
      micMuted: Boolean(p.micMuted),
      me: p.userId === userId,
    })),
    iAmHost: room.hostUserId === userId,
    canModerate: Boolean(me && (me.role === "host" || me.role === "admin")),
  };
}

function canModerate(room: GroupCallRoom, userId: string) {
  const me = room.participants.find((p) => p.userId === userId && !p.leftAt);
  return Boolean(me && (me.role === "host" || me.role === "admin"));
}

export async function startGroupCall(userId: string, groupId: string, kind: CallKind, maxParticipants?: number) {
  return mutateStore((data) => {
    const ctx = liveMember(data, groupId, userId);
    if (!ctx) return { ok: false as const, error: "عضو این گروه نیستی.", status: 403 };
    if (ctx.member.role !== "owner" && ctx.member.role !== "admin" && !ctx.group.perms.startCalls) {
      return { ok: false as const, error: "طبق مجوز گروه اجازهٔ شروع تماس نداری.", status: 403 };
    }
    const flood = hitRateLimit(data, `call:${userId}`, CALL_FLOOD_WINDOW_MS, CALL_FLOOD_MAX);
    if (!flood.allowed) return { ok: false as const, error: "تماس پیاپی محدود شد.", status: 429 };
    const open = (data.groupCalls ?? []).find((c) => c.groupId === groupId && c.status !== "ended");
    if (open) {
      return { ok: false as const, error: "یک تماس گروهی در جریان است. Join Call را بزن.", status: 409, call: publicGroupCall(open, userId) };
    }
    const cap = Math.min(GROUP_CALL_HARD_MAX, Math.max(2, maxParticipants ?? GROUP_CALL_DEFAULT_MAX));
    const now = Date.now();
    const host: GroupCallParticipant = {
      userId,
      name: ctx.member.name,
      role: "host",
      joinedAt: now,
      leftAt: null,
      mutedByHost: false,
      kicked: false,
    };
    const room: GroupCallRoom = {
      id: randomId(),
      groupId,
      groupName: ctx.group.name,
      hostUserId: userId,
      kind,
      status: "active",
      maxParticipants: cap,
      inviteToken: null,
      inviteExpiresAt: null,
      createdAt: now,
      endedAt: null,
      participants: [host],
    };
    data.groupCalls ??= [];
    data.groupCalls.unshift(room);
    for (const m of ctx.group.members) {
      if (m.leftAt || m.key === userId || m.kind !== "user") continue;
      emitNotification(data, {
        userId: m.key,
        category: "calls",
        kind: "group_call",
        title: `Group ${kind === "video" ? "Video" : "Voice"} Call`,
        senderName: ctx.group.name,
        body: `${ctx.member.name} تماس گروهی شروع کرد`,
        sourceId: `gcall:${room.id}`,
        muteType: "group",
        muteId: groupId,
        target: { type: "call", id: room.id },
      });
    }
    return { ok: true as const, call: publicGroupCall(room, userId) };
  });
}

export async function joinGroupCall(userId: string, callId: string) {
  return mutateStore((data) => {
    const room = (data.groupCalls ?? []).find((c) => c.id === callId);
    if (!room || room.status === "ended") return { ok: false as const, error: "تماس گروهی نیست.", status: 404 };
    const ctx = liveMember(data, room.groupId, userId);
    if (!ctx) return { ok: false as const, error: "فقط اعضای گروه می‌توانند وارد شوند.", status: 403 };
    const existing = room.participants.find((p) => p.userId === userId);
    if (existing?.kicked) return { ok: false as const, error: "از این تماس خارج شده‌ای.", status: 403 };
    if (existing && !existing.leftAt) return { ok: true as const, call: publicGroupCall(room, userId) };
    if (liveParts(room).length >= room.maxParticipants) {
      return { ok: false as const, error: `ظرفیت تماس ${room.maxParticipants} نفر است.`, status: 403 };
    }
    const role = rankRole(ctx.member.role) >= 3 ? "admin" : "member";
    if (existing) {
      existing.leftAt = null;
      existing.joinedAt = Date.now();
    } else {
      room.participants.push({
        userId,
        name: ctx.member.name,
        role: userId === room.hostUserId ? "host" : role,
        joinedAt: Date.now(),
        leftAt: null,
        mutedByHost: false,
        kicked: false,
      });
    }
    return { ok: true as const, call: publicGroupCall(room, userId) };
  });
}

export async function joinByToken(userId: string, token: string) {
  return mutateStore((data) => {
    const now = Date.now();
    const room = (data.groupCalls ?? []).find((c) => c.inviteToken === token && c.status !== "ended");
    if (!room || !inviteLive(room, now)) return { ok: false as const, error: "لینک تماس نامعتبر یا منقضی است.", status: 404 };
    const ctx = liveMember(data, room.groupId, userId);
    if (!ctx) return { ok: false as const, error: "برای Join Call باید عضو گروه باشی و وارد حساب شده باشی.", status: 403 };
    return joinGroupCallUnlocked(data, userId, room);
  });
}

function joinGroupCallUnlocked(data: StoreData, userId: string, room: GroupCallRoom) {
  const ctx = liveMember(data, room.groupId, userId);
  if (!ctx) return { ok: false as const, error: "عضو گروه نیستی.", status: 403 };
  const existing = room.participants.find((p) => p.userId === userId);
  if (existing?.kicked) return { ok: false as const, error: "از این تماس خارج شده‌ای.", status: 403 };
  if (existing && !existing.leftAt) return { ok: true as const, call: publicGroupCall(room, userId) };
  if (liveParts(room).length >= room.maxParticipants) {
    return { ok: false as const, error: `ظرفیت تماس ${room.maxParticipants} نفر است.`, status: 403 };
  }
  const role = rankRole(ctx.member.role) >= 3 ? "admin" : "member";
  if (existing) {
    existing.leftAt = null;
    existing.joinedAt = Date.now();
    existing.kicked = false;
  } else {
    room.participants.push({
      userId,
      name: ctx.member.name,
      role: userId === room.hostUserId ? "host" : role,
      joinedAt: Date.now(),
      leftAt: null,
      mutedByHost: false,
      kicked: false,
    });
  }
  return { ok: true as const, call: publicGroupCall(room, userId) };
}

export async function peekCallLink(userId: string, token: string) {
  const { readStoreSnapshot } = await import("@/lib/store");
  const data = await readStoreSnapshot();
  const room = (data.groupCalls ?? []).find((c) => c.inviteToken === token && c.status !== "ended");
  if (!room || !inviteLive(room)) return { ok: false as const, error: "لینک تماس معتبر نیست.", status: 404 };
  if (!liveMember(data, room.groupId, userId)) {
    return { ok: false as const, error: "برای دیدن این تماس باید عضو گروه و وارد حساب باشی.", status: 403 };
  }
  return {
    ok: true as const,
    groupTitle: room.groupName,
    kind: room.kind,
    live: room.status !== "ended",
    participantCount: liveParts(room).length,
    maxParticipants: room.maxParticipants,
  };
}

export async function listGroupCalls(userId: string) {
  const { readStoreSnapshot } = await import("@/lib/store");
  const data = await readStoreSnapshot();
  const now = Date.now();
  return (data.groupCalls ?? [])
    .filter((c) => {
      if ((c.hiddenBy ?? []).includes(userId)) return false;
      return c.participants.some((p) => p.userId === userId) || liveMember(data, c.groupId, userId);
    })
    .map((r) => {
      const me = r.participants.find((p) => p.userId === userId);
      const ended = r.endedAt ?? (r.status === "ended" ? now : null);
      return {
        id: r.id,
        groupId: r.groupId,
        threadId: r.groupId,
        peerKey: `group:${r.groupId}`,
        peerName: r.groupName,
        peerColor: "#34d399",
        kind: r.kind,
        direction: (r.hostUserId === userId ? "out" : "in") as "out" | "in",
        status: r.status === "ended" ? ("ended" as const) : ("active" as const),
        createdAt: r.createdAt,
        connectedAt: me?.joinedAt ?? r.createdAt,
        endedAt: ended,
        durationMs: ended ? ended - r.createdAt : r.status === "active" ? now - r.createdAt : 0,
        group: true as const,
        participantCount: liveParts(r).length,
      };
    })
    .sort((a, b) => b.createdAt - a.createdAt);
}

export async function addToGroupCall(actorId: string, callId: string, targetId: string) {
  return mutateStore((data) => {
    const room = (data.groupCalls ?? []).find((c) => c.id === callId && c.status !== "ended");
    if (!room) return { ok: false as const, error: "تماس نیست.", status: 404 };
    if (!canModerate(room, actorId)) return { ok: false as const, error: "فقط Host/Admin می‌تواند عضو اضافه کند.", status: 403 };
    const ctx = liveMember(data, room.groupId, targetId);
    if (!ctx) return { ok: false as const, error: "هدف عضو گروه نیست.", status: 400 };
    if (liveParts(room).length >= room.maxParticipants) {
      return { ok: false as const, error: "ظرفیت پر است.", status: 403 };
    }
    const existing = room.participants.find((p) => p.userId === targetId);
    if (existing?.kicked) existing.kicked = false;
    if (existing && !existing.leftAt) return { ok: true as const, call: publicGroupCall(room, actorId) };
    if (existing) {
      existing.leftAt = null;
      existing.joinedAt = Date.now();
    } else {
      room.participants.push({
        userId: targetId,
        name: ctx.member.name,
        role: "member",
        joinedAt: Date.now(),
        leftAt: null,
        mutedByHost: false,
        kicked: false,
      });
    }
    emitNotification(data, {
      userId: targetId,
      category: "calls",
      kind: "group_call",
      title: "به تماس گروهی اضافه شدی",
      senderName: room.groupName,
      sourceId: `gcall:${room.id}`,
      muteType: "group",
      muteId: room.groupId,
      target: { type: "call", id: room.id },
    });
    return { ok: true as const, call: publicGroupCall(room, actorId) };
  });
}

export async function moderateGroupCall(
  actorId: string,
  callId: string,
  action: "kick" | "mute" | "unmute" | "leave" | "end" | "link" | "revoke" | "cap",
  extra?: { targetId?: string; maxParticipants?: number },
) {
  return mutateStore((data) => {
    const room = (data.groupCalls ?? []).find((c) => c.id === callId);
    if (!room) return { ok: false as const, error: "تماس نیست.", status: 404 };
    const me = room.participants.find((p) => p.userId === actorId && !p.leftAt);
    if (!me && action !== "leave") return { ok: false as const, error: "داخل تماس نیستی.", status: 403 };
    if (action === "leave") {
      if (me) me.leftAt = Date.now();
      if (room.hostUserId === actorId && room.status !== "ended") {
        const next = liveParts(room)[0];
        if (next) {
          room.hostUserId = next.userId;
          next.role = "host";
        } else {
          room.status = "ended";
          room.endedAt = Date.now();
        }
      }
      return { ok: true as const, call: publicGroupCall(room, actorId) };
    }
    if (action === "end") {
      if (room.hostUserId !== actorId && me?.role !== "admin") {
        return { ok: false as const, error: "قطع تماس گروهی فقط با Host/Admin.", status: 403 };
      }
      room.status = "ended";
      room.endedAt = Date.now();
      room.inviteToken = null;
      room.inviteExpiresAt = null;
      for (const p of room.participants) if (!p.leftAt) p.leftAt = Date.now();
      return { ok: true as const, call: publicGroupCall(room, actorId) };
    }
    if (!canModerate(room, actorId)) return { ok: false as const, error: "اجازهٔ مدیریت تماس نداری.", status: 403 };
    if (action === "link") {
      room.inviteToken = randomId();
      room.inviteExpiresAt = Date.now() + GROUP_CALL_INVITE_TTL_MS;
      return { ok: true as const, call: publicGroupCall(room, actorId) };
    }
    if (action === "revoke") {
      room.inviteToken = null;
      room.inviteExpiresAt = null;
      return { ok: true as const, call: publicGroupCall(room, actorId) };
    }
    if (action === "cap") {
      const n = Math.min(GROUP_CALL_HARD_MAX, Math.max(2, extra?.maxParticipants ?? room.maxParticipants));
      if (n < liveParts(room).length) return { ok: false as const, error: "سقف از تعداد حاضر کمتر است.", status: 400 };
      room.maxParticipants = n;
      return { ok: true as const, call: publicGroupCall(room, actorId) };
    }
    const target = room.participants.find((p) => p.userId === extra?.targetId);
    if (!target) return { ok: false as const, error: "شرکت‌کننده نیست.", status: 404 };
    if (target.role === "host" && actorId !== room.hostUserId) {
      return { ok: false as const, error: "Host را نمی‌توان حذف کرد.", status: 403 };
    }
    if (action === "kick") {
      target.kicked = true;
      target.leftAt = Date.now();
    } else if (action === "mute") target.mutedByHost = true;
    else if (action === "unmute") target.mutedByHost = false;
    return { ok: true as const, call: publicGroupCall(room, actorId) };
  });
}

export async function setOwnCallMedia(userId: string, callId: string, patch: { camOff?: boolean; micMuted?: boolean }) {
  return mutateStore((data) => {
    const room = (data.groupCalls ?? []).find((c) => c.id === callId && c.status !== "ended");
    if (!room) return { ok: false as const, error: "تماس نیست.", status: 404 };
    const me = room.participants.find((p) => p.userId === userId && !p.leftAt && !p.kicked);
    if (!me) return { ok: false as const, error: "داخل تماس نیستی.", status: 403 };
    if (typeof patch.camOff === "boolean") me.camOff = patch.camOff;
    if (typeof patch.micMuted === "boolean") me.micMuted = patch.micMuted;
    return { ok: true as const, call: publicGroupCall(room, userId) };
  });
}

export async function getGroupCall(userId: string, callId: string) {
  return mutateStore((data) => {
    const room = (data.groupCalls ?? []).find((c) => c.id === callId);
    if (!room) return { ok: false as const, error: "تماس نیست.", status: 404 };
    if (!liveMember(data, room.groupId, userId)) return { ok: false as const, error: "اجازه نداری.", status: 403 };
    return { ok: true as const, call: publicGroupCall(room, userId) };
  });
}

export async function liveGroupCallForGroup(userId: string, groupId: string) {
  return mutateStore((data) => {
    if (!liveMember(data, groupId, userId)) return { ok: false as const, error: "عضو نیستی.", status: 403 };
    const room = (data.groupCalls ?? []).find((c) => c.groupId === groupId && c.status !== "ended");
    return { ok: true as const, call: room ? publicGroupCall(room, userId) : null };
  });
}
