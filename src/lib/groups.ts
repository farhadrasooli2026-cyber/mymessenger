import "server-only";
import { randomId } from "@/lib/crypto-utils";
import { SEED_PEERS } from "@/lib/chat-copy";
import { hitRateLimit } from "@/lib/rate-limit";
import { mutateStore, readStoreSnapshot } from "@/lib/store";
import type { GroupMember, GroupMessage, GroupRecord, StoreData } from "@/lib/store";
import { canAddToGroup } from "@/lib/privacy";
import {
  DEFAULT_GROUP_PERMS,
  GROUP_FLOOD_MAX,
  GROUP_FLOOD_WINDOW_MS,
  GROUP_MAX_MEMBERS,
  GROUP_MAX_PINS,
  rankRole,
  type GroupPerms,
  type GroupRole,
} from "@/lib/group-types";

const B64 = /^[A-Za-z0-9+/]+=*$/;
const COLORS = ["#fbbf24", "#34d399", "#7dd3fc", "#c4b5fd", "#fda4af", "#67e8f9"];

function liveMember(m: GroupMember) {
  return !m.leftAt;
}

function findMember(group: GroupRecord, key: string) {
  return group.members.find((m) => m.key === key && liveMember(m));
}

function isBanned(group: GroupRecord, key: string) {
  return group.bans.some((b) => b.key === key);
}

export function canManage(actor: GroupMember, target?: GroupMember) {
  if (actor.role === "owner") return true;
  if (!target) return rankRole(actor.role) >= 3;
  return rankRole(actor.role) > rankRole(target.role);
}

export function canModContent(actor: GroupMember) {
  return rankRole(actor.role) >= 2;
}

function memberCanSend(group: GroupRecord, member: GroupMember, kind: GroupMessage["kind"], now: number) {
  if (member.mutedUntil && member.mutedUntil > now) return { ok: false as const, error: "ارسال پیام برای تو محدود شده است." };
  if (member.restrictedUntil && member.restrictedUntil > now && rankRole(member.role) < 2) {
    return { ok: false as const, error: "حسابت در این گروه محدود است." };
  }
  const allowed =
    kind === "poll"
      ? group.perms.createPolls || rankRole(member.role) >= 3
      : kind === "photo"
        ? group.perms.sendPhotos
        : kind === "video"
          ? group.perms.sendVideos
          : kind === "file"
            ? group.perms.sendFiles
            : kind === "voice"
              ? group.perms.sendVoice
              : group.perms.sendMessages;
  if (!allowed) return { ok: false as const, error: "طبق مجوز گروه اجازهٔ این ارسال را نداری." };
  return { ok: true as const };
}

function pushSystem(data: StoreData, group: GroupRecord, text: string, now: number) {
  data.groupMessages.push({
    id: randomId(),
    groupId: group.id,
    senderKey: "system",
    senderName: "نیکسو",
    enc: "none",
    ciphertext: "",
    nonce: "",
    bodyFa: text,
    createdAt: now,
    kind: "system",
    reactions: [],
  });
  group.updatedAt = now;
}

function publicGroup(group: GroupRecord, viewerKey: string) {
  const me = findMember(group, viewerKey);
  return {
    id: group.id,
    name: group.name,
    description: group.description,
    rules: group.rules,
    welcome: group.welcome,
    username: group.username,
    color: group.color,
    joinMode: group.joinMode,
    maxMembers: group.maxMembers,
    perms: group.perms,
    inviteToken: me && rankRole(me.role) >= 3 ? group.inviteToken : null,
    memberCount: group.members.filter(liveMember).length,
    pinIds: group.pinIds,
    myRole: me?.role ?? null,
    notifyMutedUntil: me?.notifyMutedUntil ?? null,
    createdAt: group.createdAt,
    updatedAt: group.updatedAt,
    members: group.members.filter(liveMember).map((m) => ({
      key: m.key,
      kind: m.kind,
      role: m.role,
      name: m.name,
      mutedUntil: m.mutedUntil,
      restrictedUntil: m.restrictedUntil,
    })),
    pendingRequests: me && rankRole(me.role) >= 3 ? group.requests.filter((r) => r.status === "pending") : [],
  };
}

export function publicGroupMessage(m: GroupMessage) {
  if (m.deleted) {
    return { ...m, ciphertext: "", nonce: "", bodyFa: "این پیام حذف شد.", enc: "purged" as const };
  }
  return m;
}

export async function listGroups(userId: string) {
  const data = await readStoreSnapshot();
  return data.groups
    .filter((g) => !g.deletedAt && findMember(g, userId))
    .sort((a, b) => b.updatedAt - a.updatedAt)
    .map((g) => publicGroup(g, userId));
}

export async function getGroup(userId: string, groupId: string) {
  const data = await readStoreSnapshot();
  const group = data.groups.find((g) => g.id === groupId && !g.deletedAt);
  if (!group || !findMember(group, userId)) return null;
  const messages = data.groupMessages
    .filter((m) => m.groupId === groupId)
    .sort((a, b) => a.createdAt - b.createdAt)
    .map(publicGroupMessage);
  return { group: publicGroup(group, userId), messages };
}

export async function createGroup(
  userId: string,
  input: {
    name: string;
    description?: string;
    color?: string;
    memberKeys?: string[];
    joinMode?: GroupRecord["joinMode"];
    username?: string;
  },
) {
  const name = input.name.trim().slice(0, 48);
  if (name.length < 2) return { ok: false as const, error: "نام گروه خیلی کوتاه است.", status: 400 };
  const user = (await readStoreSnapshot()).users.find((u) => u.id === userId);
  if (!user) return { ok: false as const, error: "حساب فعال نیست.", status: 401 };

  return mutateStore((data) => {
    const now = Date.now();
    const username = input.username?.trim().replace(/^@/, "").toLowerCase() || null;
    if (username) {
      if (!/^[a-z][a-z0-9_]{2,23}$/.test(username)) {
        return { ok: false as const, error: "نام کاربری گروه نامعتبر است.", status: 400 };
      }
      if (data.groups.some((g) => g.username === username && !g.deletedAt)) {
        return { ok: false as const, error: "این نام کاربری گروه گرفته شده است.", status: 409 };
      }
    }
    const owner: GroupMember = {
      key: userId,
      kind: "user",
      role: "owner",
      name: user.displayName || user.firstName || "مالک",
      joinedAt: now,
      mutedUntil: null,
      restrictedUntil: null,
      notifyMutedUntil: null,
      leftAt: null,
    };
    const members = [owner];
    const seen = new Set([userId]);
    for (const raw of input.memberKeys ?? []) {
      if (members.length >= GROUP_MAX_MEMBERS) break;
      if (seen.has(raw)) continue;
      seen.add(raw);
      const seed = SEED_PEERS.find((p) => p.peerKey === raw);
      if (seed) {
        members.push({
          key: `seed:${seed.peerKey}`,
          kind: "seed",
          role: "member",
          name: seed.peerName,
          joinedAt: now,
          mutedUntil: null,
          restrictedUntil: null,
          notifyMutedUntil: null,
          leftAt: null,
        });
        continue;
      }
      const other = data.users.find((u) => u.id === raw || u.username === raw.replace(/^@/, ""));
      if (!other || other.id === userId) continue;
      if (!canAddToGroup(data, userId, other.id)) continue;
      members.push({
        key: other.id,
        kind: "user",
        role: "member",
        name: other.displayName || other.username || "عضو",
        joinedAt: now,
        mutedUntil: null,
        restrictedUntil: null,
        notifyMutedUntil: null,
        leftAt: null,
      });
    }
    const group: GroupRecord = {
      id: randomId(),
      name,
      description: (input.description ?? "").trim().slice(0, 500),
      rules: "",
      welcome: "",
      username,
      color: input.color && COLORS.includes(input.color) ? input.color : COLORS[members.length % COLORS.length]!,
      ownerUserId: userId,
      joinMode: input.joinMode ?? "invite",
      maxMembers: GROUP_MAX_MEMBERS,
      perms: { ...DEFAULT_GROUP_PERMS },
      inviteToken: randomId(),
      members,
      requests: [],
      bans: [],
      pinIds: [],
      communityId: null,
      createdAt: now,
      updatedAt: now,
      deletedAt: null,
    };
    data.groups.push(group);
    pushSystem(data, group, `گروه «${name}» ساخته شد.`, now);
    members
      .filter((m) => m.key !== userId)
      .forEach((m) => pushSystem(data, group, `${m.name} به گروه اضافه شد.`, now + 1));
    return { ok: true as const, group: publicGroup(group, userId) };
  });
}

export async function updateGroup(
  userId: string,
  groupId: string,
  patch: Partial<{
    name: string;
    description: string;
    rules: string;
    welcome: string;
    username: string | null;
    color: string;
    joinMode: GroupRecord["joinMode"];
    perms: GroupPerms;
    maxMembers: number;
  }>,
) {
  return mutateStore((data) => {
    const group = data.groups.find((g) => g.id === groupId && !g.deletedAt);
    if (!group) return { ok: false as const, error: "گروه یافت نشد.", status: 404 };
    const me = findMember(group, userId);
    if (!me) return { ok: false as const, error: "عضو این گروه نیستی.", status: 403 };
    const infoOk = me.role === "owner" || group.perms.changeInfo || rankRole(me.role) >= 3;
    if (patch.perms && me.role !== "owner") {
      return { ok: false as const, error: "فقط مالک مجوزها را تغییر می‌دهد.", status: 403 };
    }
    if (!infoOk && !patch.perms) return { ok: false as const, error: "اجازهٔ ویرایش اطلاعات نداری.", status: 403 };
    const now = Date.now();
    if (typeof patch.name === "string" && patch.name.trim().length >= 2) {
      group.name = patch.name.trim().slice(0, 48);
      pushSystem(data, group, `نام گروه به «${group.name}» تغییر کرد.`, now);
    }
    if (typeof patch.description === "string") group.description = patch.description.trim().slice(0, 500);
    if (typeof patch.rules === "string") group.rules = patch.rules.trim().slice(0, 2000);
    if (typeof patch.welcome === "string") group.welcome = patch.welcome.trim().slice(0, 400);
    if (patch.username !== undefined) {
      const u = patch.username?.trim().replace(/^@/, "").toLowerCase() || null;
      if (u && !/^[a-z][a-z0-9_]{2,23}$/.test(u)) {
        return { ok: false as const, error: "نام کاربری نامعتبر است.", status: 400 };
      }
      if (u && data.groups.some((g) => g.id !== group.id && g.username === u && !g.deletedAt)) {
        return { ok: false as const, error: "این نام کاربری گرفته شده است.", status: 409 };
      }
      group.username = u;
    }
    if (patch.color && COLORS.includes(patch.color)) {
      group.color = patch.color;
      pushSystem(data, group, "عکس/رنگ گروه تغییر کرد.", now);
    }
    if (patch.joinMode) group.joinMode = patch.joinMode;
    if (patch.perms) group.perms = { ...DEFAULT_GROUP_PERMS, ...patch.perms };
    if (typeof patch.maxMembers === "number") {
      group.maxMembers = Math.min(GROUP_MAX_MEMBERS, Math.max(2, Math.floor(patch.maxMembers)));
    }
    group.updatedAt = now;
    pushSystem(data, group, "تنظیمات گروه به‌روز شد.", now);
    return { ok: true as const, group: publicGroup(group, userId) };
  });
}

export async function rotateInvite(userId: string, groupId: string, action: "new" | "revoke") {
  return mutateStore((data) => {
    const group = data.groups.find((g) => g.id === groupId && !g.deletedAt);
    if (!group) return { ok: false as const, error: "گروه یافت نشد.", status: 404 };
    const me = findMember(group, userId);
    if (!me || rankRole(me.role) < 3) return { ok: false as const, error: "فقط ادمین لینک دعوت را مدیریت می‌کند.", status: 403 };
    group.inviteToken = action === "revoke" ? "" : randomId();
    group.updatedAt = Date.now();
    return { ok: true as const, inviteToken: group.inviteToken || null };
  });
}

export async function previewInvite(token: string) {
  const data = await readStoreSnapshot();
  const group = data.groups.find((g) => g.inviteToken && g.inviteToken === token && !g.deletedAt);
  if (!group) return null;
  return {
    id: group.id,
    name: group.name,
    description: group.description,
    color: group.color,
    memberCount: group.members.filter(liveMember).length,
    joinMode: group.joinMode,
    rules: group.rules,
  };
}

export async function joinByToken(userId: string, token: string) {
  return mutateStore((data) => {
    const group = data.groups.find((g) => g.inviteToken && g.inviteToken === token && !g.deletedAt);
    if (!group) return { ok: false as const, error: "لینک دعوت نامعتبر است.", status: 404 };
    const user = data.users.find((u) => u.id === userId);
    if (!user) return { ok: false as const, error: "حساب فعال نیست.", status: 401 };
    if (isBanned(group, userId)) return { ok: false as const, error: "از این گروه بن شده‌ای.", status: 403 };
    if (findMember(group, userId)) return { ok: true as const, group: publicGroup(group, userId), already: true };
    if (group.members.filter(liveMember).length >= group.maxMembers) {
      return { ok: false as const, error: "ظرفیت گروه پر است.", status: 409 };
    }
    const now = Date.now();
    if (group.joinMode === "request") {
      if (group.requests.some((r) => r.userId === userId && r.status === "pending")) {
        return { ok: false as const, error: "درخواست عضویت قبلی در انتظار است.", status: 409 };
      }
      group.requests.push({
        id: randomId(),
        userId,
        name: user.displayName || user.username || "کاربر",
        createdAt: now,
        status: "pending",
      });
      return { ok: true as const, pending: true as const };
    }
    group.members.push({
      key: userId,
      kind: "user",
      role: "member",
      name: user.displayName || user.username || "عضو",
      joinedAt: now,
      mutedUntil: null,
      restrictedUntil: null,
      notifyMutedUntil: null,
      leftAt: null,
    });
    pushSystem(data, group, `${user.displayName || "یک کاربر"} به گروه پیوست.`, now);
    if (group.welcome) pushSystem(data, group, group.welcome, now + 1);
    return { ok: true as const, group: publicGroup(group, userId) };
  });
}

export async function decideRequest(userId: string, groupId: string, requestId: string, approve: boolean) {
  return mutateStore((data) => {
    const group = data.groups.find((g) => g.id === groupId && !g.deletedAt);
    if (!group) return { ok: false as const, error: "گروه یافت نشد.", status: 404 };
    const me = findMember(group, userId);
    if (!me || rankRole(me.role) < 3) return { ok: false as const, error: "اجازه نداری.", status: 403 };
    const req = group.requests.find((r) => r.id === requestId && r.status === "pending");
    if (!req) return { ok: false as const, error: "درخواست یافت نشد.", status: 404 };
    const now = Date.now();
    req.status = approve ? "approved" : "rejected";
    if (approve) {
      if (isBanned(group, req.userId)) return { ok: false as const, error: "این کاربر بن است.", status: 403 };
      group.members.push({
        key: req.userId,
        kind: "user",
        role: "member",
        name: req.name,
        joinedAt: now,
        mutedUntil: null,
        restrictedUntil: null,
        notifyMutedUntil: null,
        leftAt: null,
      });
      pushSystem(data, group, `${req.name} به گروه پیوست.`, now);
      if (group.welcome) pushSystem(data, group, group.welcome, now + 1);
    }
    return { ok: true as const, group: publicGroup(group, userId) };
  });
}

export async function addMembers(userId: string, groupId: string, keys: string[]) {
  return mutateStore((data) => {
    const group = data.groups.find((g) => g.id === groupId && !g.deletedAt);
    if (!group) return { ok: false as const, error: "گروه یافت نشد.", status: 404 };
    const me = findMember(group, userId);
    if (!me) return { ok: false as const, error: "عضو نیستی.", status: 403 };
    if (!(me.role === "owner" || rankRole(me.role) >= 3 || group.perms.addMembers)) {
      return { ok: false as const, error: "اجازهٔ افزودن عضو نداری.", status: 403 };
    }
    const now = Date.now();
    for (const raw of keys.slice(0, 40)) {
      if (group.members.filter(liveMember).length >= group.maxMembers) break;
      const seed = SEED_PEERS.find((p) => p.peerKey === raw);
      const key = seed ? `seed:${seed.peerKey}` : data.users.find((u) => u.id === raw || u.username === raw.replace(/^@/, ""))?.id;
      if (!key || findMember(group, key) || isBanned(group, key)) continue;
      if (seed) {
        group.members.push({
          key,
          kind: "seed",
          role: "member",
          name: seed.peerName,
          joinedAt: now,
          mutedUntil: null,
          restrictedUntil: null,
          notifyMutedUntil: null,
          leftAt: null,
        });
        pushSystem(data, group, `${seed.peerName} به گروه اضافه شد.`, now);
        continue;
      }
      const other = data.users.find((u) => u.id === key);
      if (!other) continue;
      if (!canAddToGroup(data, userId, other.id)) continue;
      group.members.push({
        key: other.id,
        kind: "user",
        role: "member",
        name: other.displayName || other.username || "عضو",
        joinedAt: now,
        mutedUntil: null,
        restrictedUntil: null,
        notifyMutedUntil: null,
        leftAt: null,
      });
      pushSystem(data, group, `${other.displayName || "یک کاربر"} به گروه اضافه شد.`, now);
    }
    return { ok: true as const, group: publicGroup(group, userId) };
  });
}

export async function moderateMember(
  userId: string,
  groupId: string,
  targetKey: string,
  action: "remove" | "ban" | "unban" | "mute" | "restrict" | "role" | "transfer",
  extra?: { ms?: number; role?: GroupRole },
) {
  return mutateStore((data) => {
    const group = data.groups.find((g) => g.id === groupId && !g.deletedAt);
    if (!group) return { ok: false as const, error: "گروه یافت نشد.", status: 404 };
    const me = findMember(group, userId);
    if (!me) return { ok: false as const, error: "عضو نیستی.", status: 403 };
    const target = group.members.find((m) => m.key === targetKey);
    const now = Date.now();
    if (action === "unban") {
      if (!canManage(me)) return { ok: false as const, error: "اجازه نداری.", status: 403 };
      group.bans = group.bans.filter((b) => b.key !== targetKey);
      return { ok: true as const, group: publicGroup(group, userId) };
    }
    if (action === "transfer") {
      if (me.role !== "owner") return { ok: false as const, error: "فقط مالک می‌تواند مالکیت را واگذار کند.", status: 403 };
      if (!target || !liveMember(target) || target.kind !== "user") {
        return { ok: false as const, error: "عضو معتبر نیست.", status: 400 };
      }
      me.role = "admin";
      target.role = "owner";
      group.ownerUserId = target.key;
      pushSystem(data, group, `مالکیت به ${target.name} منتقل شد.`, now);
      return { ok: true as const, group: publicGroup(group, userId) };
    }
    if (!target || !liveMember(target)) return { ok: false as const, error: "عضو یافت نشد.", status: 404 };
    if (!canManage(me, target)) return { ok: false as const, error: "نمی‌توانی این عضو را مدیریت کنی.", status: 403 };
    if (action === "remove") {
      target.leftAt = now;
      pushSystem(data, group, `${target.name} از گروه حذف شد.`, now);
    } else if (action === "ban") {
      target.leftAt = now;
      if (!group.bans.some((b) => b.key === targetKey)) group.bans.push({ key: targetKey, at: now });
      pushSystem(data, group, `${target.name} بن شد.`, now);
    } else if (action === "mute") {
      target.mutedUntil = now + Math.min(30 * 24 * 3600_000, Math.max(60_000, extra?.ms ?? 3600_000));
      pushSystem(data, group, `ارسال پیام ${target.name} محدود شد.`, now);
    } else if (action === "restrict") {
      target.restrictedUntil = now + Math.min(30 * 24 * 3600_000, Math.max(60_000, extra?.ms ?? 3600_000));
      pushSystem(data, group, `${target.name} محدود شد.`, now);
    } else if (action === "role") {
      if (me.role !== "owner") return { ok: false as const, error: "فقط مالک نقش ادمین را عوض می‌کند.", status: 403 };
      const role = extra?.role;
      if (role !== "admin" && role !== "moderator" && role !== "member") {
        return { ok: false as const, error: "نقش نامعتبر است.", status: 400 };
      }
      const prev = target.role;
      target.role = role;
      if (prev !== "admin" && role === "admin") pushSystem(data, group, `${target.name} ادمین شد.`, now);
      if (prev === "admin" && role !== "admin") pushSystem(data, group, `${target.name} دیگر ادمین نیست.`, now);
    }
    return { ok: true as const, group: publicGroup(group, userId) };
  });
}

export async function leaveGroup(userId: string, groupId: string) {
  return mutateStore((data) => {
    const group = data.groups.find((g) => g.id === groupId && !g.deletedAt);
    if (!group) return { ok: false as const, error: "گروه یافت نشد.", status: 404 };
    const me = findMember(group, userId);
    if (!me) return { ok: false as const, error: "عضو نیستی.", status: 403 };
    if (me.role === "owner") {
      return { ok: false as const, error: "ابتدا مالکیت را واگذار کن یا گروه را حذف کن.", status: 400 };
    }
    const now = Date.now();
    me.leftAt = now;
    pushSystem(data, group, `${me.name} گروه را ترک کرد.`, now);
    return { ok: true as const };
  });
}

export async function deleteGroup(userId: string, groupId: string) {
  return mutateStore((data) => {
    const group = data.groups.find((g) => g.id === groupId && !g.deletedAt);
    if (!group) return { ok: false as const, error: "گروه یافت نشد.", status: 404 };
    const me = findMember(group, userId);
    if (!me || me.role !== "owner") return { ok: false as const, error: "فقط مالک می‌تواند گروه را حذف کند.", status: 403 };
    group.deletedAt = Date.now();
    data.groupMessages = data.groupMessages.filter((m) => m.groupId !== groupId);
    return { ok: true as const };
  });
}

export async function setNotifyMute(userId: string, groupId: string, ms: number | null) {
  return mutateStore((data) => {
    const group = data.groups.find((g) => g.id === groupId && !g.deletedAt);
    if (!group) return { ok: false as const, error: "گروه یافت نشد.", status: 404 };
    const me = findMember(group, userId);
    if (!me) return { ok: false as const, error: "عضو نیستی.", status: 403 };
    me.notifyMutedUntil = ms && ms > 0 ? Date.now() + ms : null;
    return { ok: true as const, notifyMutedUntil: me.notifyMutedUntil };
  });
}

export async function sendGroupMessage(
  userId: string,
  groupId: string,
  payload: {
    enc?: string;
    ciphertext?: string;
    nonce?: string;
    kind?: GroupMessage["kind"];
    replyToId?: string;
    mentions?: string[];
    blobId?: string;
    chunkCount?: number;
    poll?: { question: string; options: string[]; anonymous?: boolean; multiple?: boolean; closesAt?: number | null };
  },
) {
  return mutateStore((data) => {
    const group = data.groups.find((g) => g.id === groupId && !g.deletedAt);
    if (!group) return { ok: false as const, error: "گروه یافت نشد.", status: 404 };
    const me = findMember(group, userId);
    if (!me) return { ok: false as const, error: "عضو این گروه نیستی.", status: 403 };
    const now = Date.now();
    const kind = payload.kind === "voice" || payload.kind === "photo" || payload.kind === "video" || payload.kind === "file" || payload.kind === "poll" ? payload.kind : "text";
    const sendOk = memberCanSend(group, me, kind, now);
    if (!sendOk.ok) {
      return { ok: false as const, error: sendOk.error, status: 403 };
    }
    const flood = hitRateLimit(data, `gmsg:${groupId}:${userId}`, GROUP_FLOOD_WINDOW_MS, GROUP_FLOOD_MAX, now);
    if (!flood.allowed) {
      me.mutedUntil = now + 5 * 60_000;
      return { ok: false as const, error: "ارسال پیاپی شناسایی شد و موقتاً محدود شدی.", status: 429 };
    }
    if (kind === "poll") {
      const question = payload.poll?.question?.trim() ?? "";
      const options = (payload.poll?.options ?? []).map((o) => o.trim()).filter(Boolean).slice(0, 8);
      if (question.length < 2 || options.length < 2) {
        return { ok: false as const, error: "نظرسنجی نامعتبر است.", status: 400 };
      }
      const msg: GroupMessage = {
        id: randomId(),
        groupId,
        senderKey: userId,
        senderName: me.name,
        enc: "none",
        ciphertext: "",
        nonce: "",
        createdAt: now,
        kind: "poll",
        reactions: [],
        poll: {
          question: question.slice(0, 200),
          options: options.map((o) => o.slice(0, 80)),
          anonymous: Boolean(payload.poll?.anonymous),
          multiple: Boolean(payload.poll?.multiple),
          closesAt: payload.poll?.closesAt ?? null,
          votes: [],
        },
      };
      data.groupMessages.push(msg);
      group.updatedAt = now;
      return { ok: true as const, message: publicGroupMessage(msg) };
    }
    const ciphertext = typeof payload.ciphertext === "string" ? payload.ciphertext.trim() : "";
    const nonce = typeof payload.nonce === "string" ? payload.nonce.trim() : "";
    if (payload.enc !== "e2ee-v1" || ciphertext.length < 8 || nonce.length < 8 || !B64.test(ciphertext) || !B64.test(nonce)) {
      return { ok: false as const, error: "فقط پاکت رمزنگاری‌شده پذیرفته می‌شود.", status: 400 };
    }
    if (/https?:\/\//i.test(ciphertext) && !group.perms.sendLinks && rankRole(me.role) < 3) {
      /* ciphertext is not plaintext; skip */
    }
    const msg: GroupMessage = {
      id: randomId(),
      groupId,
      senderKey: userId,
      senderName: me.name,
      enc: "e2ee-v1",
      ciphertext,
      nonce,
      createdAt: now,
      kind,
      replyToId: payload.replyToId,
      mentions: Array.isArray(payload.mentions) ? payload.mentions.slice(0, 12) : [],
      reactions: [],
      blobId: payload.blobId,
      chunkCount: payload.chunkCount,
    };
    data.groupMessages.push(msg);
    group.updatedAt = now;
    return { ok: true as const, message: publicGroupMessage(msg) };
  });
}

export async function reactToMessage(userId: string, groupId: string, messageId: string, emoji: string) {
  const safe = emoji.slice(0, 8);
  return mutateStore((data) => {
    const group = data.groups.find((g) => g.id === groupId && !g.deletedAt);
    if (!group || !findMember(group, userId)) return { ok: false as const, error: "اجازه نداری.", status: 403 };
    const msg = data.groupMessages.find((m) => m.id === messageId && m.groupId === groupId);
    if (!msg) return { ok: false as const, error: "پیام یافت نشد.", status: 404 };
    let row = msg.reactions.find((r) => r.emoji === safe);
    if (!row) {
      row = { emoji: safe, keys: [] };
      msg.reactions.push(row);
    }
    if (row.keys.includes(userId)) row.keys = row.keys.filter((k) => k !== userId);
    else row.keys.push(userId);
    msg.reactions = msg.reactions.filter((r) => r.keys.length > 0);
    return { ok: true as const, reactions: msg.reactions };
  });
}

export async function votePoll(userId: string, groupId: string, messageId: string, indexes: number[]) {
  return mutateStore((data) => {
    const group = data.groups.find((g) => g.id === groupId && !g.deletedAt);
    if (!group || !findMember(group, userId)) return { ok: false as const, error: "اجازه نداری.", status: 403 };
    const msg = data.groupMessages.find((m) => m.id === messageId && m.groupId === groupId && m.kind === "poll");
    if (!msg?.poll) return { ok: false as const, error: "نظرسنجی یافت نشد.", status: 404 };
    if (msg.poll.closesAt && Date.now() > msg.poll.closesAt) {
      return { ok: false as const, error: "نظرسنجی بسته شده است.", status: 400 };
    }
    const clean = [...new Set(indexes.filter((i) => Number.isInteger(i) && i >= 0 && i < msg.poll!.options.length))];
    const picked = msg.poll.multiple ? clean : clean.slice(0, 1);
    const voterKey = msg.poll.anonymous ? `anon:${userId.slice(0, 8)}` : userId;
    msg.poll.votes = msg.poll.votes.filter((v) => v.voterKey !== voterKey && v.voterKey !== userId);
    msg.poll.votes.push({ voterKey, indexes: picked });
    return { ok: true as const, poll: msg.poll };
  });
}

export async function pinMessage(userId: string, groupId: string, messageId: string, pin: boolean) {
  return mutateStore((data) => {
    const group = data.groups.find((g) => g.id === groupId && !g.deletedAt);
    if (!group) return { ok: false as const, error: "گروه یافت نشد.", status: 404 };
    const me = findMember(group, userId);
    if (!me) return { ok: false as const, error: "عضو نیستی.", status: 403 };
    if (!(me.role === "owner" || rankRole(me.role) >= 3 || group.perms.pinMessages)) {
      return { ok: false as const, error: "اجازهٔ پین نداری.", status: 403 };
    }
    const exists = data.groupMessages.some((m) => m.id === messageId && m.groupId === groupId);
    if (!exists) return { ok: false as const, error: "پیام یافت نشد.", status: 404 };
    if (pin) {
      if (!group.pinIds.includes(messageId)) {
        if (group.pinIds.length >= GROUP_MAX_PINS) group.pinIds.shift();
        group.pinIds.push(messageId);
      }
    } else group.pinIds = group.pinIds.filter((id) => id !== messageId);
    return { ok: true as const, pinIds: group.pinIds };
  });
}

export async function deleteGroupMessage(userId: string, groupId: string, messageId: string) {
  return mutateStore((data) => {
    const group = data.groups.find((g) => g.id === groupId && !g.deletedAt);
    if (!group) return { ok: false as const, error: "گروه یافت نشد.", status: 404 };
    const me = findMember(group, userId);
    if (!me) return { ok: false as const, error: "عضو نیستی.", status: 403 };
    const msg = data.groupMessages.find((m) => m.id === messageId && m.groupId === groupId);
    if (!msg) return { ok: false as const, error: "پیام یافت نشد.", status: 404 };
    if (msg.senderKey !== userId && !canModContent(me)) {
      return { ok: false as const, error: "اجازهٔ حذف این پیام را نداری.", status: 403 };
    }
    msg.deleted = true;
    msg.enc = "purged";
    msg.ciphertext = "";
    msg.nonce = "";
    return { ok: true as const };
  });
}

export async function searchGroup(userId: string, groupId: string, q: string) {
  const listed = await getGroup(userId, groupId);
  if (!listed) return null;
  const needle = q.trim().toLowerCase();
  if (needle.length < 2) return { messages: [] as ReturnType<typeof publicGroupMessage>[] };
  const hits = listed.messages.filter((m) => {
    if (m.kind === "system") return (m.bodyFa ?? "").includes(q);
    if (m.kind === "poll") return (m.poll?.question ?? "").toLowerCase().includes(needle);
    return m.kind === "photo" || m.kind === "video" || m.kind === "file" || m.kind === "voice"
      ? needle === m.kind || ["عکس", "ویدیو", "فایل", "صوت", "photo", "video", "file", "voice", "link"].some((k) => k.includes(needle) || needle.includes(k))
      : false;
  });
  return { messages: hits.slice(-50) };
}
