import "server-only";
import { randomId } from "@/lib/crypto-utils";
import { SEED_PEERS } from "@/lib/chat-copy";
import { hitRateLimit } from "@/lib/rate-limit";
import { mutateStore, readStoreSnapshot } from "@/lib/store";
import type { CommunityMember, CommunityRecord, StoreData } from "@/lib/store";
import { canAddToCommunity } from "@/lib/privacy";
import { rankRole, type GroupRole } from "@/lib/group-types";
import {
  COMMUNITY_FLOOD_MAX,
  COMMUNITY_FLOOD_WINDOW_MS,
  DEFAULT_COMMUNITY_PERMS,
  type CommunityPerms,
  type NotifyMode,
} from "@/lib/community-types";

const COLORS = ["#fbbf24", "#34d399", "#7dd3fc", "#c4b5fd", "#fda4af", "#67e8f9"];

function live(m: CommunityMember) {
  return !m.leftAt;
}

function findMember(community: CommunityRecord, key: string) {
  return community.members.find((m) => m.key === key && live(m));
}

function isBanned(community: CommunityRecord, key: string) {
  return community.bans.some((b) => b.key === key);
}

function canManage(actor: CommunityMember, target?: CommunityMember) {
  if (actor.role === "owner") return true;
  if (!target) return rankRole(actor.role) >= 3;
  return rankRole(actor.role) > rankRole(target.role);
}

function staff(actor: CommunityMember) {
  return rankRole(actor.role) >= 3;
}

function publicCommunity(community: CommunityRecord, viewerKey: string, data: StoreData) {
  const me = findMember(community, viewerKey);
  const groups = community.groupIds
    .map((id) => data.groups.find((g) => g.id === id && !g.deletedAt))
    .filter(Boolean)
    .map((g) => ({
      id: g!.id,
      name: g!.name,
      color: g!.color,
      memberCount: g!.members.filter((m) => !m.leftAt).length,
    }));
  return {
    id: community.id,
    name: community.name,
    description: community.description,
    rules: community.rules,
    username: community.username,
    color: community.color,
    joinMode: community.joinMode,
    perms: community.perms,
    inviteToken: me && staff(me) ? community.inviteToken : null,
    memberCount: community.members.filter(live).length,
    myRole: me?.role ?? null,
    notifyMode: me?.notifyMode ?? "all",
    createdAt: community.createdAt,
    updatedAt: community.updatedAt,
    groups,
    channels: community.channels,
    announcements: community.announcements.slice(-20).reverse(),
    posts: community.posts.filter((p) => !p.deleted).slice(-80),
    members: community.members.filter(live).map((m) => ({
      key: m.key,
      kind: m.kind,
      role: m.role,
      name: m.name,
      username: m.username,
      mutedUntil: m.mutedUntil,
      restrictedUntil: m.restrictedUntil,
    })),
    pendingRequests: me && staff(me) ? community.requests.filter((r) => r.status === "pending") : [],
    bans: me && staff(me) ? community.bans : [],
  };
}

export async function listCommunities(userId: string) {
  const data = await readStoreSnapshot();
  return data.communities
    .filter((c) => !c.deletedAt && findMember(c, userId))
    .sort((a, b) => b.updatedAt - a.updatedAt)
    .map((c) => publicCommunity(c, userId, data));
}

export async function getCommunity(userId: string, communityId: string) {
  const data = await readStoreSnapshot();
  const community = data.communities.find((c) => c.id === communityId && !c.deletedAt);
  if (!community || !findMember(community, userId)) return null;
  return { community: publicCommunity(community, userId, data) };
}

export async function createCommunity(
  userId: string,
  input: {
    name: string;
    description?: string;
    color?: string;
    username?: string;
    joinMode?: CommunityRecord["joinMode"];
    groupIds?: string[];
    channelNames?: string[];
  },
) {
  const name = input.name.trim().slice(0, 48);
  if (name.length < 2) return { ok: false as const, error: "نام جامعه خیلی کوتاه است.", status: 400 };
  const data0 = await readStoreSnapshot();
  const user = data0.users.find((u) => u.id === userId);
  if (!user) return { ok: false as const, error: "حساب فعال نیست.", status: 401 };

  return mutateStore((data) => {
    const now = Date.now();
    const username = input.username?.trim().replace(/^@/, "").toLowerCase() || null;
    if (username) {
      if (!/^[a-z][a-z0-9_]{2,23}$/.test(username)) {
        return { ok: false as const, error: "نام کاربری جامعه نامعتبر است.", status: 400 };
      }
      if (data.communities.some((c) => c.username === username && !c.deletedAt)) {
        return { ok: false as const, error: "این نام کاربری گرفته شده است.", status: 409 };
      }
    }
    const owner: CommunityMember = {
      key: userId,
      kind: "user",
      role: "owner",
      name: user.displayName || user.firstName || "مالک",
      username: user.username ?? null,
      joinedAt: now,
      mutedUntil: null,
      restrictedUntil: null,
      notifyMode: "all",
      leftAt: null,
    };
    const groupIds: string[] = [];
    for (const gid of input.groupIds ?? []) {
      const group = data.groups.find((g) => g.id === gid && !g.deletedAt);
      if (!group || group.ownerUserId !== userId) continue;
      if (group.communityId) continue;
      groupIds.push(group.id);
    }
    const channels = (input.channelNames ?? [])
      .map((n) => n.trim().slice(0, 40))
      .filter((n) => n.length >= 2)
      .slice(0, 8)
      .map((n, i) => ({
        id: randomId(),
        name: n,
        description: "",
        color: COLORS[i % COLORS.length]!,
        createdAt: now,
      }));
    const community: CommunityRecord = {
      id: randomId(),
      name,
      description: (input.description ?? "").trim().slice(0, 800),
      rules: "",
      username,
      color: input.color && COLORS.includes(input.color) ? input.color : COLORS[0]!,
      ownerUserId: userId,
      joinMode: input.joinMode ?? "invite",
      perms: { ...DEFAULT_COMMUNITY_PERMS },
      inviteToken: randomId(),
      groupIds,
      channels,
      members: [owner],
      requests: [],
      bans: [],
      announcements: [],
      posts: [],
      createdAt: now,
      updatedAt: now,
      deletedAt: null,
    };
    for (const gid of groupIds) {
      const group = data.groups.find((g) => g.id === gid);
      if (group) group.communityId = community.id;
    }
    data.communities.push(community);
    return { ok: true as const, community: publicCommunity(community, userId, data) };
  });
}

export async function updateCommunity(
  userId: string,
  communityId: string,
  patch: Partial<{
    name: string;
    description: string;
    rules: string;
    username: string | null;
    color: string;
    joinMode: CommunityRecord["joinMode"];
    perms: CommunityPerms;
  }>,
) {
  return mutateStore((data) => {
    const community = data.communities.find((c) => c.id === communityId && !c.deletedAt);
    if (!community) return { ok: false as const, error: "جامعه یافت نشد.", status: 404 };
    const me = findMember(community, userId);
    if (!me) return { ok: false as const, error: "عضو این جامعه نیستی.", status: 403 };
    if (patch.perms && me.role !== "owner") {
      return { ok: false as const, error: "فقط مالک مجوزها را تغییر می‌دهد.", status: 403 };
    }
    if (!staff(me) && !patch.perms) return { ok: false as const, error: "اجازهٔ ویرایش نداری.", status: 403 };
    const now = Date.now();
    if (typeof patch.name === "string" && patch.name.trim().length >= 2) community.name = patch.name.trim().slice(0, 48);
    if (typeof patch.description === "string") community.description = patch.description.trim().slice(0, 800);
    if (typeof patch.rules === "string") community.rules = patch.rules.trim().slice(0, 3000);
    if (patch.username !== undefined) {
      const u = patch.username?.trim().replace(/^@/, "").toLowerCase() || null;
      if (u && !/^[a-z][a-z0-9_]{2,23}$/.test(u)) {
        return { ok: false as const, error: "نام کاربری نامعتبر است.", status: 400 };
      }
      if (u && data.communities.some((c) => c.id !== community.id && c.username === u && !c.deletedAt)) {
        return { ok: false as const, error: "این نام کاربری گرفته شده است.", status: 409 };
      }
      community.username = u;
    }
    if (patch.color && COLORS.includes(patch.color)) community.color = patch.color;
    if (patch.joinMode) community.joinMode = patch.joinMode;
    if (patch.perms) community.perms = { ...DEFAULT_COMMUNITY_PERMS, ...patch.perms };
    community.updatedAt = now;
    return { ok: true as const, community: publicCommunity(community, userId, data) };
  });
}

export async function rotateInvite(userId: string, communityId: string, action: "new" | "revoke") {
  return mutateStore((data) => {
    const community = data.communities.find((c) => c.id === communityId && !c.deletedAt);
    if (!community) return { ok: false as const, error: "جامعه یافت نشد.", status: 404 };
    const me = findMember(community, userId);
    if (!me || !staff(me)) return { ok: false as const, error: "فقط ادمین لینک دعوت را مدیریت می‌کند.", status: 403 };
    community.inviteToken = action === "revoke" ? "" : randomId();
    community.updatedAt = Date.now();
    return { ok: true as const, inviteToken: community.inviteToken || null };
  });
}

export async function previewInvite(token: string) {
  const data = await readStoreSnapshot();
  const community = data.communities.find((c) => c.inviteToken && c.inviteToken === token && !c.deletedAt);
  if (!community) return null;
  return {
    id: community.id,
    name: community.name,
    description: community.description,
    color: community.color,
    memberCount: community.members.filter(live).length,
    joinMode: community.joinMode,
    rules: community.rules,
    groupCount: community.groupIds.length,
    channelCount: community.channels.length,
  };
}

export async function joinByToken(userId: string, token: string) {
  return mutateStore((data) => {
    const community = data.communities.find((c) => c.inviteToken && c.inviteToken === token && !c.deletedAt);
    if (!community) return { ok: false as const, error: "لینک دعوت نامعتبر است.", status: 404 };
    const user = data.users.find((u) => u.id === userId);
    if (!user) return { ok: false as const, error: "حساب فعال نیست.", status: 401 };
    if (isBanned(community, userId)) return { ok: false as const, error: "از این جامعه بن شده‌ای.", status: 403 };
    if (findMember(community, userId)) return { ok: true as const, community: publicCommunity(community, userId, data), already: true };
    const now = Date.now();
    if (community.joinMode === "request") {
      if (community.requests.some((r) => r.userId === userId && r.status === "pending")) {
        return { ok: false as const, error: "درخواست عضویت قبلی در انتظار است.", status: 409 };
      }
      community.requests.push({
        id: randomId(),
        userId,
        name: user.displayName || user.username || "کاربر",
        createdAt: now,
        status: "pending",
      });
      return { ok: true as const, pending: true as const };
    }
    community.members.push({
      key: userId,
      kind: "user",
      role: "member",
      name: user.displayName || user.username || "عضو",
      username: user.username ?? null,
      joinedAt: now,
      mutedUntil: null,
      restrictedUntil: null,
      notifyMode: "all",
      leftAt: null,
    });
    community.updatedAt = now;
    return { ok: true as const, community: publicCommunity(community, userId, data) };
  });
}

export async function decideRequest(userId: string, communityId: string, requestId: string, approve: boolean) {
  return mutateStore((data) => {
    const community = data.communities.find((c) => c.id === communityId && !c.deletedAt);
    if (!community) return { ok: false as const, error: "جامعه یافت نشد.", status: 404 };
    const me = findMember(community, userId);
    if (!me || !staff(me)) return { ok: false as const, error: "اجازه نداری.", status: 403 };
    const req = community.requests.find((r) => r.id === requestId && r.status === "pending");
    if (!req) return { ok: false as const, error: "درخواست یافت نشد.", status: 404 };
    req.status = approve ? "approved" : "rejected";
    if (approve) {
      if (isBanned(community, req.userId)) return { ok: false as const, error: "این کاربر بن است.", status: 403 };
      community.members.push({
        key: req.userId,
        kind: "user",
        role: "member",
        name: req.name,
        username: null,
        joinedAt: Date.now(),
        mutedUntil: null,
        restrictedUntil: null,
        notifyMode: "all",
        leftAt: null,
      });
    }
    community.updatedAt = Date.now();
    return { ok: true as const, community: publicCommunity(community, userId, data) };
  });
}

export async function addMembers(userId: string, communityId: string, keys: string[]) {
  return mutateStore((data) => {
    const community = data.communities.find((c) => c.id === communityId && !c.deletedAt);
    if (!community) return { ok: false as const, error: "جامعه یافت نشد.", status: 404 };
    const me = findMember(community, userId);
    if (!me) return { ok: false as const, error: "عضو نیستی.", status: 403 };
    if (!(me.role === "owner" || staff(me) || community.perms.inviteMembers)) {
      return { ok: false as const, error: "اجازهٔ دعوت نداری.", status: 403 };
    }
    const now = Date.now();
    for (const raw of keys.slice(0, 40)) {
      const seed = SEED_PEERS.find((p) => p.peerKey === raw);
      const key = seed ? `seed:${seed.peerKey}` : data.users.find((u) => u.id === raw || u.username === raw.replace(/^@/, ""))?.id;
      if (!key || findMember(community, key) || isBanned(community, key)) continue;
      if (seed) {
        community.members.push({
          key,
          kind: "seed",
          role: "member",
          name: seed.peerName,
          username: seed.peerKey,
          joinedAt: now,
          mutedUntil: null,
          restrictedUntil: null,
          notifyMode: "all",
          leftAt: null,
        });
        continue;
      }
      const other = data.users.find((u) => u.id === key);
      if (!other) continue;
      if (!canAddToCommunity(data, userId, other.id)) continue;
      community.members.push({
        key: other.id,
        kind: "user",
        role: "member",
        name: other.displayName || other.username || "عضو",
        username: other.username ?? null,
        joinedAt: now,
        mutedUntil: null,
        restrictedUntil: null,
        notifyMode: "all",
        leftAt: null,
      });
    }
    community.updatedAt = now;
    return { ok: true as const, community: publicCommunity(community, userId, data) };
  });
}

export async function moderateMember(
  userId: string,
  communityId: string,
  targetKey: string,
  action: "remove" | "ban" | "unban" | "mute" | "restrict" | "role",
  extra?: { ms?: number; role?: GroupRole },
) {
  return mutateStore((data) => {
    const community = data.communities.find((c) => c.id === communityId && !c.deletedAt);
    if (!community) return { ok: false as const, error: "جامعه یافت نشد.", status: 404 };
    const me = findMember(community, userId);
    if (!me) return { ok: false as const, error: "عضو نیستی.", status: 403 };
    const now = Date.now();
    if (action === "unban") {
      if (!canManage(me) || (me.role !== "owner" && !community.perms.manageMembers && !staff(me))) {
        return { ok: false as const, error: "اجازه نداری.", status: 403 };
      }
      community.bans = community.bans.filter((b) => b.key !== targetKey);
      return { ok: true as const, community: publicCommunity(community, userId, data) };
    }
    const target = community.members.find((m) => m.key === targetKey);
    if (!target || !live(target)) return { ok: false as const, error: "عضو یافت نشد.", status: 404 };
    if (action === "role") {
      if (me.role !== "owner") return { ok: false as const, error: "فقط مالک نقش ادمین/ناظم را عوض می‌کند.", status: 403 };
      const role = extra?.role;
      if (role !== "admin" && role !== "moderator" && role !== "member") {
        return { ok: false as const, error: "نقش نامعتبر است.", status: 400 };
      }
      target.role = role;
      community.updatedAt = now;
      return { ok: true as const, community: publicCommunity(community, userId, data) };
    }
    const allowed =
      me.role === "owner" ||
      staff(me) ||
      (me.role === "moderator" && (action === "restrict" || action === "mute")) ||
      community.perms.manageMembers;
    if (!allowed || !canManage(me, target)) return { ok: false as const, error: "نمی‌توانی این عضو را مدیریت کنی.", status: 403 };
    if (action === "remove") target.leftAt = now;
    else if (action === "ban") {
      target.leftAt = now;
      if (!community.bans.some((b) => b.key === targetKey)) community.bans.push({ key: targetKey, at: now });
    } else if (action === "mute") {
      target.mutedUntil = now + Math.min(30 * 24 * 3600_000, Math.max(60_000, extra?.ms ?? 3600_000));
    } else if (action === "restrict") {
      target.restrictedUntil = now + Math.min(30 * 24 * 3600_000, Math.max(60_000, extra?.ms ?? 3600_000));
    }
    community.updatedAt = now;
    return { ok: true as const, community: publicCommunity(community, userId, data) };
  });
}

export async function setNotifyMode(userId: string, communityId: string, mode: NotifyMode) {
  return mutateStore((data) => {
    const community = data.communities.find((c) => c.id === communityId && !c.deletedAt);
    if (!community) return { ok: false as const, error: "جامعه یافت نشد.", status: 404 };
    const me = findMember(community, userId);
    if (!me) return { ok: false as const, error: "عضو نیستی.", status: 403 };
    me.notifyMode = mode;
    return { ok: true as const, notifyMode: me.notifyMode };
  });
}

export async function leaveCommunity(userId: string, communityId: string) {
  return mutateStore((data) => {
    const community = data.communities.find((c) => c.id === communityId && !c.deletedAt);
    if (!community) return { ok: false as const, error: "جامعه یافت نشد.", status: 404 };
    const me = findMember(community, userId);
    if (!me) return { ok: false as const, error: "عضو نیستی.", status: 403 };
    if (me.role === "owner") {
      return { ok: false as const, error: "ابتدا مالکیت را واگذار کن یا جامعه را حذف کن.", status: 400 };
    }
    me.leftAt = Date.now();
    community.updatedAt = Date.now();
    return { ok: true as const };
  });
}

export async function deleteCommunity(userId: string, communityId: string) {
  return mutateStore((data) => {
    const community = data.communities.find((c) => c.id === communityId && !c.deletedAt);
    if (!community) return { ok: false as const, error: "جامعه یافت نشد.", status: 404 };
    const me = findMember(community, userId);
    if (!me || me.role !== "owner") return { ok: false as const, error: "فقط مالک می‌تواند جامعه را حذف کند.", status: 403 };
    community.deletedAt = Date.now();
    for (const gid of community.groupIds) {
      const group = data.groups.find((g) => g.id === gid);
      if (group && group.communityId === communityId) group.communityId = null;
    }
    return { ok: true as const };
  });
}

export async function attachGroup(userId: string, communityId: string, groupId: string) {
  return mutateStore((data) => {
    const community = data.communities.find((c) => c.id === communityId && !c.deletedAt);
    if (!community) return { ok: false as const, error: "جامعه یافت نشد.", status: 404 };
    const me = findMember(community, userId);
    if (!me) return { ok: false as const, error: "عضو نیستی.", status: 403 };
    if (!(me.role === "owner" || staff(me) || community.perms.addGroups)) {
      return { ok: false as const, error: "اجازهٔ افزودن گروه نداری.", status: 403 };
    }
    const group = data.groups.find((g) => g.id === groupId && !g.deletedAt);
    if (!group) return { ok: false as const, error: "گروه یافت نشد.", status: 404 };
    if (group.ownerUserId !== userId) {
      return { ok: false as const, error: "فقط مالک گروه می‌تواند آن را وصل کند.", status: 403 };
    }
    if (group.communityId && group.communityId !== communityId) {
      return { ok: false as const, error: "این گروه به جامعهٔ دیگری وصل است.", status: 409 };
    }
    if (!community.groupIds.includes(groupId)) community.groupIds.push(groupId);
    group.communityId = communityId;
    community.updatedAt = Date.now();
    return { ok: true as const, community: publicCommunity(community, userId, data) };
  });
}

export async function detachGroup(userId: string, communityId: string, groupId: string) {
  return mutateStore((data) => {
    const community = data.communities.find((c) => c.id === communityId && !c.deletedAt);
    if (!community) return { ok: false as const, error: "جامعه یافت نشد.", status: 404 };
    const me = findMember(community, userId);
    if (!me || !(me.role === "owner" || staff(me))) {
      return { ok: false as const, error: "اجازه نداری.", status: 403 };
    }
    community.groupIds = community.groupIds.filter((id) => id !== groupId);
    const group = data.groups.find((g) => g.id === groupId);
    if (group && group.communityId === communityId) group.communityId = null;
    community.updatedAt = Date.now();
    return { ok: true as const, community: publicCommunity(community, userId, data) };
  });
}

export async function addChannel(userId: string, communityId: string, name: string, description = "") {
  const trimmed = name.trim().slice(0, 40);
  if (trimmed.length < 2) return { ok: false as const, error: "نام کانال کوتاه است.", status: 400 };
  return mutateStore((data) => {
    const community = data.communities.find((c) => c.id === communityId && !c.deletedAt);
    if (!community) return { ok: false as const, error: "جامعه یافت نشد.", status: 404 };
    const me = findMember(community, userId);
    if (!me) return { ok: false as const, error: "عضو نیستی.", status: 403 };
    if (!(me.role === "owner" || staff(me) || community.perms.addChannels)) {
      return { ok: false as const, error: "اجازهٔ افزودن کانال نداری.", status: 403 };
    }
    community.channels.push({
      id: randomId(),
      name: trimmed,
      description: description.trim().slice(0, 200),
      color: COLORS[community.channels.length % COLORS.length]!,
      createdAt: Date.now(),
    });
    community.updatedAt = Date.now();
    return { ok: true as const, community: publicCommunity(community, userId, data) };
  });
}

export async function removeChannel(userId: string, communityId: string, channelId: string) {
  return mutateStore((data) => {
    const community = data.communities.find((c) => c.id === communityId && !c.deletedAt);
    if (!community) return { ok: false as const, error: "جامعه یافت نشد.", status: 404 };
    const me = findMember(community, userId);
    if (!me || !(me.role === "owner" || staff(me))) {
      return { ok: false as const, error: "اجازه نداری.", status: 403 };
    }
    community.channels = community.channels.filter((c) => c.id !== channelId);
    community.posts = community.posts.filter((p) => p.channelId !== channelId);
    community.updatedAt = Date.now();
    return { ok: true as const, community: publicCommunity(community, userId, data) };
  });
}

export async function publishAnnouncement(userId: string, communityId: string, body: string) {
  const text = body.trim().slice(0, 1000);
  if (text.length < 2) return { ok: false as const, error: "متن اطلاعیه کوتاه است.", status: 400 };
  return mutateStore((data) => {
    const community = data.communities.find((c) => c.id === communityId && !c.deletedAt);
    if (!community) return { ok: false as const, error: "جامعه یافت نشد.", status: 404 };
    const me = findMember(community, userId);
    if (!me || !staff(me)) return { ok: false as const, error: "فقط ادمین اطلاعیه می‌گذارد.", status: 403 };
    const flood = hitRateLimit(data, `cann:${communityId}:${userId}`, COMMUNITY_FLOOD_WINDOW_MS, COMMUNITY_FLOOD_MAX);
    if (!flood.allowed) return { ok: false as const, error: "ارسال پیاپی محدود شد.", status: 429 };
    community.announcements.push({
      id: randomId(),
      authorKey: userId,
      authorName: me.name,
      body: text,
      createdAt: Date.now(),
    });
    community.updatedAt = Date.now();
    return { ok: true as const, community: publicCommunity(community, userId, data) };
  });
}

export async function publishPost(
  userId: string,
  communityId: string,
  channelId: string,
  input: { body: string; kind?: CommunityRecord["posts"][number]["kind"] },
) {
  const text = input.body.trim().slice(0, 2000);
  if (text.length < 1) return { ok: false as const, error: "پست خالی است.", status: 400 };
  return mutateStore((data) => {
    const community = data.communities.find((c) => c.id === communityId && !c.deletedAt);
    if (!community) return { ok: false as const, error: "جامعه یافت نشد.", status: 404 };
    const me = findMember(community, userId);
    if (!me) return { ok: false as const, error: "عضو نیستی.", status: 403 };
    if (me.mutedUntil && me.mutedUntil > Date.now()) {
      return { ok: false as const, error: "ارسال برای تو محدود شده است.", status: 403 };
    }
    if (me.restrictedUntil && me.restrictedUntil > Date.now() && rankRole(me.role) < 2) {
      return { ok: false as const, error: "حسابت در این جامعه محدود است.", status: 403 };
    }
    const channel = community.channels.find((c) => c.id === channelId);
    if (!channel) return { ok: false as const, error: "کانال یافت نشد.", status: 404 };
    const canPost = me.role === "owner" || staff(me) || community.perms.createPosts;
    if (!canPost) return { ok: false as const, error: "اجازهٔ انتشار پست نداری.", status: 403 };
    const kind = input.kind === "photo" || input.kind === "video" || input.kind === "file" || input.kind === "link" ? input.kind : "text";
    if ((kind === "photo" || kind === "video") && !community.perms.sendMedia && !staff(me) && me.role !== "owner") {
      return { ok: false as const, error: "اجازهٔ رسانه نداری.", status: 403 };
    }
    if (kind === "file" && !community.perms.sendFiles && !staff(me) && me.role !== "owner") {
      return { ok: false as const, error: "اجازهٔ فایل نداری.", status: 403 };
    }
    if (kind === "link" && /https?:\/\//i.test(text)) {
      const floodLink = hitRateLimit(data, `clink:${communityId}:${userId}`, 60_000, 6);
      if (!floodLink.allowed) return { ok: false as const, error: "لینک پیاپی محدود شد.", status: 429 };
    }
    const flood = hitRateLimit(data, `cpost:${communityId}:${userId}`, COMMUNITY_FLOOD_WINDOW_MS, COMMUNITY_FLOOD_MAX);
    if (!flood.allowed) return { ok: false as const, error: "ارسال پیاپی محدود شد.", status: 429 };
    community.posts.push({
      id: randomId(),
      channelId,
      authorKey: userId,
      authorName: me.name,
      kind,
      body: text,
      createdAt: Date.now(),
    });
    community.updatedAt = Date.now();
    return { ok: true as const, community: publicCommunity(community, userId, data) };
  });
}

export async function deletePost(userId: string, communityId: string, postId: string) {
  return mutateStore((data) => {
    const community = data.communities.find((c) => c.id === communityId && !c.deletedAt);
    if (!community) return { ok: false as const, error: "جامعه یافت نشد.", status: 404 };
    const me = findMember(community, userId);
    if (!me) return { ok: false as const, error: "عضو نیستی.", status: 403 };
    const post = community.posts.find((p) => p.id === postId);
    if (!post) return { ok: false as const, error: "پست یافت نشد.", status: 404 };
    const can =
      post.authorKey === userId ||
      me.role === "owner" ||
      staff(me) ||
      me.role === "moderator" ||
      community.perms.manageMessages;
    if (!can) return { ok: false as const, error: "اجازهٔ حذف نداری.", status: 403 };
    post.deleted = true;
    return { ok: true as const, community: publicCommunity(community, userId, data) };
  });
}

export async function searchCommunity(userId: string, communityId: string, q: string) {
  const listed = await getCommunity(userId, communityId);
  if (!listed) return null;
  const needle = q.trim().toLowerCase();
  if (needle.length < 2) return { groups: [], channels: [], posts: [], announcements: [], media: [] as string[] };
  const { community } = listed;
  const data = await readStoreSnapshot();
  const groups = community.groups.filter((g) => g.name.toLowerCase().includes(needle));
  const channels = community.channels.filter(
    (c) => c.name.toLowerCase().includes(needle) || c.description.toLowerCase().includes(needle),
  );
  const posts = community.posts.filter((p) => p.body.toLowerCase().includes(needle) || p.kind.includes(needle));
  const announcements = community.announcements.filter((a) => a.body.toLowerCase().includes(needle));
  const mediaKinds = ["photo", "video", "file", "link"] as const;
  const media = community.posts.filter((p) => mediaKinds.includes(p.kind as (typeof mediaKinds)[number]));
  const groupMedia = data.groupMessages.filter(
    (m) =>
      community.groups.some((g) => g.id === m.groupId) &&
      (m.kind === "photo" || m.kind === "video" || m.kind === "file" || m.kind === "voice") &&
      (needle === m.kind || ["عکس", "ویدیو", "فایل", "لینک", "photo", "video", "file", "link"].some((k) => k.includes(needle) || needle.includes(k))),
  );
  return {
    groups,
    channels,
    posts: posts.slice(-40),
    announcements: announcements.slice(-20),
    media: [...media.map((p) => p.kind), ...groupMedia.map((m) => m.kind)].slice(-40),
  };
}
