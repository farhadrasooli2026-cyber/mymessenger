import "server-only";
import { randomId } from "@/lib/crypto-utils";
import { SEED_PEERS } from "@/lib/chat-copy";
import { postingBlocked } from "@/lib/account-gate";
import { canAddToGroup } from "@/lib/privacy";
import { hitRateLimit } from "@/lib/rate-limit";
import { mutateStore, readStoreSnapshot } from "@/lib/store";
import type { GroupMember, GroupMessage, GroupRecord, StoreData } from "@/lib/store";
import { applyUserReaction, allowedReactionSet, publicReactionView, prefsOf, canUseSticker, historicalStickerView, replayReactionNonce, rememberReactionNonce, putReactionCache, type ReactionIntent } from "@/lib/stickers";
import { validateVoiceDuration, VOICE_SEND_PER_MIN } from "@/lib/voice";
import { declaredExtAllowed, scanNamedFile, stripJpegExif } from "@/lib/files";
import { emitNotification } from "@/lib/notify";
import { enqueueSearchIndexSync, enqueueSearchTombstone } from "@/lib/search";
import { claimSpaceHandle } from "@/lib/space-handles";
import { decodeDataUrl, validateAvatarBuffer } from "@/lib/photo-files";
import { collate } from "@/lib/i18n/collate";
import { cacheInvalidate, invalidatePermCache } from "@/lib/perf";
import {
  DEFAULT_GROUP_ADMIN_PERMS,
  DEFAULT_GROUP_PERMS,
  GROUP_CREATE_MAX,
  GROUP_CREATE_WINDOW_MS,
  GROUP_DESC_MAX,
  GROUP_FLOOD_MAX,
  GROUP_FLOOD_WINDOW_MS,
  GROUP_INVITE_MAX,
  GROUP_INVITE_WINDOW_MS,
  GROUP_JOIN_MAX,
  GROUP_JOIN_WINDOW_MS,
  GROUP_LINK_MAX,
  GROUP_LINK_WINDOW_MS,
  GROUP_MAX_MEMBERS,
  GROUP_MAX_PINS,
  GROUP_MEMBER_PAGE,
  GROUP_OWNED_MAX,
  GROUP_REQUEST_TTL_MS,
  GROUP_STORAGE_MAX_ITEMS,
  rankRole,
  validateGroupDescription,
  validateGroupName,
  type CustomGroupRole,
  type GroupAdminPerms,
  type GroupHistoryMode,
  type GroupMembershipState,
  type GroupPerms,
  type GroupRole,
} from "@/lib/group-types";
import { validCategory } from "@/lib/group-discovery";

const B64 = /^[A-Za-z0-9+/]+=*$/;
const COLORS = ["#fbbf24", "#34d399", "#7dd3fc", "#c4b5fd", "#fda4af", "#67e8f9"];

function liveMember(m: GroupMember) {
  return !m.leftAt;
}

function findMember(group: GroupRecord, key: string) {
  return group.members.find((m) => m.key === key && liveMember(m));
}

function isBanned(group: GroupRecord, key: string, now = Date.now()) {
  return group.bans.some((b) => b.key === key && (b.until == null || b.until > now));
}

function permsOf(group: GroupRecord): GroupPerms {
  return { ...DEFAULT_GROUP_PERMS, ...group.perms };
}

function adminPermsOf(group: GroupRecord): GroupAdminPerms {
  return { ...DEFAULT_GROUP_ADMIN_PERMS, ...group.adminPerms };
}

function requestStillPending(r: { status: string; createdAt: number; expiresAt?: number }, now = Date.now()) {
  if (r.status !== "pending") return false;
  const exp = r.expiresAt ?? r.createdAt + GROUP_REQUEST_TTL_MS;
  return exp >= now;
}

function expireJoinRequests(group: GroupRecord, now = Date.now()) {
  for (const r of group.requests) {
    if (r.status === "pending" && !requestStillPending(r, now)) r.status = "expired";
  }
}

export function membershipState(group: GroupRecord, member: GroupMember, now = Date.now()): GroupMembershipState {
  if (isBanned(group, member.key, now)) return "banned";
  if (member.leftAt) return member.removedBy ? "removed" : "left";
  return "active";
}

function processGroupAvatar(raw: string | null | undefined): { ok: true; url: string | null } | { ok: false; error: string } {
  if (raw === undefined) return { ok: true, url: null };
  if (raw === null || raw === "") return { ok: true, url: null };
  const buf = decodeDataUrl(raw);
  if (!buf) return { ok: false, error: "عکس گروه معتبر نیست. فقط JPEG/PNG/WEBP با اندازه و ابعاد مجاز." };
  const check = validateAvatarBuffer(buf);
  if (!check.ok) return check;
  const cleaned = Buffer.from(check.info.mime === "jpeg" ? stripJpegExif(buf) : buf);
  const mime = check.info.mime === "jpeg" ? "image/jpeg" : check.info.mime === "png" ? "image/png" : "image/webp";
  const url = `data:${mime};base64,${cleaned.toString("base64")}`;
  if (url.length > 400_000) return { ok: false, error: "عکس گروه پس از بهینه‌سازی هنوز بزرگ است." };
  return { ok: true, url };
}

function inviteLive(group: GroupRecord, now = Date.now()) {
  if (!group.inviteToken) return false;
  if (group.inviteExpiresAt && now > group.inviteExpiresAt) return false;
  if (group.inviteMaxUses != null && (group.inviteUses ?? 0) >= group.inviteMaxUses) return false;
  return true;
}

function rulesBlock(group: GroupRecord, accept?: boolean) {
  if (group.rules.trim() && accept !== true) {
    return { ok: false as const, error: "برای پیوستن باید قوانین گروه را بپذیری.", status: 400 };
  }
  return null;
}

function makeMember(input: Omit<GroupMember, "id" | "customRoleId"> & { id?: string; customRoleId?: string | null }): GroupMember {
  return {
    id: input.id ?? randomId(),
    customRoleId: input.customRoleId ?? null,
    key: input.key,
    kind: input.kind,
    role: input.role,
    name: input.name,
    joinedAt: input.joinedAt,
    mutedUntil: input.mutedUntil,
    restrictedUntil: input.restrictedUntil,
    notifyMutedUntil: input.notifyMutedUntil,
    notifyMentions: input.notifyMentions,
    lastSentAt: input.lastSentAt,
    leftAt: input.leftAt,
    removedBy: input.removedBy ?? null,
  };
}

function customFlag(group: GroupRecord, member: GroupMember, flag: keyof Omit<CustomGroupRole, "id" | "name">) {
  if (!member.customRoleId) return false;
  const role = group.customRoles.find((r) => r.id === member.customRoleId);
  return Boolean(role?.[flag]);
}

export function canManage(actor: GroupMember, target?: GroupMember) {
  if (actor.role === "owner") return true;
  if (!target) return rankRole(actor.role) >= 3;
  return rankRole(actor.role) > rankRole(target.role);
}

export function canModContent(actor: GroupMember, group: GroupRecord) {
  if (actor.role === "owner") return true;
  if (actor.role === "admin") return group.adminPerms.deleteMessages;
  if (customFlag(group, actor, "deleteMessages")) return true;
  return rankRole(actor.role) >= 2;
}

export function adminCan(group: GroupRecord, actor: GroupMember, perm: keyof GroupAdminPerms) {
  const perms = adminPermsOf(group);
  if (actor.role === "owner") return true;
  if (actor.role === "admin") {
    if (perm === "banMembers") return perms.banMembers || perms.removeMembers;
    if (perm === "manageLinks") return perms.manageLinks || perms.manageInvites;
    if (perm === "manageRoles") return perms.manageRoles || perms.manageAdmins;
    if (perm === "manageSettings") return perms.manageSettings || perms.manageGroup;
    if (perm === "manageMedia") return perms.manageMedia || perms.manageGroup;
    return Boolean(perms[perm]);
  }
  if (perm === "manageAdmins" && customFlag(group, actor, "manageAdmins")) return true;
  if (perm === "manageRoles" && customFlag(group, actor, "manageRoles")) return true;
  if (perm === "manageLinks" && (customFlag(group, actor, "manageLinks") || customFlag(group, actor, "inviteMembers"))) return true;
  if (perm === "manageSettings" && customFlag(group, actor, "manageSettings")) return true;
  if (perm === "manageMedia" && customFlag(group, actor, "manageMedia")) return true;
  if (actor.role === "moderator" && (perm === "deleteMessages" || perm === "pinMessages")) return true;
  return false;
}

function pushAudit(group: GroupRecord, actor: GroupMember, kind: string, detail: string) {
  group.audit = [
    { id: randomId(), at: Date.now(), actorKey: actor.key, actorName: actor.name, kind, detail },
    ...(group.audit ?? []),
  ].slice(0, 80);
}

function memberCanSend(group: GroupRecord, member: GroupMember, kind: GroupMessage["kind"], now: number) {
  if (member.kind === "bot") return { ok: false as const, error: "ربات بدون مجوز هسته نمی‌تواند در گروه پیام بفرستد." };
  if (member.mutedUntil && member.mutedUntil > now) return { ok: false as const, error: "ارسال پیام برای تو محدود شده است." };
  if (member.restrictedUntil && member.restrictedUntil > now && rankRole(member.role) < 2) {
    return { ok: false as const, error: "حسابت در این گروه محدود است." };
  }
  const perms = permsOf(group);
  const allowed =
    kind === "poll"
      ? perms.createPolls || rankRole(member.role) >= 3
      : kind === "photo" || kind === "gif" || kind === "contact" || kind === "location"
        ? perms.sendPhotos
        : kind === "video"
          ? perms.sendVideos
          : kind === "file"
            ? perms.sendFiles
            : kind === "voice"
              ? perms.sendVoice
              : kind === "sticker"
                ? perms.sendStickers
              : perms.sendMessages;
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

function notifyOwnerJoin(data: StoreData, group: GroupRecord, joinerId: string, now: number) {
  const owner = group.members.find((m) => m.role === "owner" && !m.leftAt);
  if (!owner || owner.key === joinerId) return;
  emitNotification(data, {
    userId: owner.key,
    category: "groups",
    kind: "group_join",
    title: group.name,
    body: "عضو جدید به گروه پیوست.",
    sourceId: `gjoin:${group.id}:${joinerId}`,
    eventId: `gjoin:${group.id}:${joinerId}:${now}`,
    muteType: "group",
    muteId: group.id,
    target: { type: "group", id: group.id },
  });
}

function publicGroup(group: GroupRecord, viewerKey: string) {
  const me = findMember(group, viewerKey);
  const staff = Boolean(me && rankRole(me.role) >= 3);
  const visibility = group.joinMode === "open" ? "public" : "private";
  const now = Date.now();
  const live = group.members.filter(liveMember);
  const hideList = Boolean(group.hideMemberList) && !staff;
  const visibleMembers = hideList ? live.filter((m) => m.key === viewerKey || rankRole(m.role) >= 3) : live;
  return {
    id: group.id,
    name: group.name,
    description: group.description,
    rules: group.rules,
    welcome: group.welcome,
    username: group.username,
    publicLink: group.username && visibility === "public" ? `/join/u/${group.username}` : null,
    color: group.color,
    photoDataUrl: group.photoDataUrl ?? null,
    joinMode: group.joinMode,
    visibility,
    searchVisible: group.searchVisible !== false,
    hideMemberList: Boolean(group.hideMemberList),
    category: group.category || "general",
    tags: group.tags ?? [],
    maxMembers: group.maxMembers,
    perms: permsOf(group),
    adminPerms: staff ? adminPermsOf(group) : null,
    slowModeMs: group.slowModeMs ?? 0,
    historyMode: group.historyMode ?? "all",
    inviteToken: me && adminCan(group, me, "manageInvites") ? group.inviteToken : null,
    inviteExpiresAt: me && adminCan(group, me, "manageInvites") ? group.inviteExpiresAt ?? null : null,
    inviteMaxUses: me && adminCan(group, me, "manageInvites") ? group.inviteMaxUses ?? null : null,
    inviteUses: me && adminCan(group, me, "manageInvites") ? group.inviteUses ?? 0 : null,
    memberCount: live.length,
    pinIds: group.pinIds,
    reactionsEnabled: group.reactionsEnabled !== false,
    allowedReactions: group.allowedReactions ?? null,
    allowForward: group.allowForward !== false,
    myRole: me?.role ?? null,
    myMembershipId: me?.id ?? null,
    myMembershipState: me ? membershipState(group, me, now) : null,
    notifyMutedUntil: me?.notifyMutedUntil ?? null,
    notifyMentions: me?.notifyMentions !== false,
    createdAt: group.createdAt,
    updatedAt: group.updatedAt,
    customRoles: staff ? group.customRoles ?? [] : (group.customRoles ?? []).map((r) => ({ id: r.id, name: r.name })),
    members: visibleMembers.map((m) => ({
      id: m.id,
      key: m.key,
      kind: m.kind,
      role: m.role,
      customRoleId: m.customRoleId ?? null,
      name: m.name,
      state: membershipState(group, m, now),
      mutedUntil: staff ? m.mutedUntil : null,
      restrictedUntil: staff ? m.restrictedUntil : null,
    })),
    pendingRequests: me && adminCan(group, me, "addMembers") ? group.requests.filter((r) => requestStillPending(r, now)) : [],
    bans: me && adminCan(group, me, "removeMembers")
      ? group.bans.map((b) => ({
          id: b.id,
          key: b.key,
          at: b.at,
          until: b.until ?? null,
          permanent: b.until == null,
          byName: b.byName,
          reason: b.reason,
        }))
      : [],
    audit: staff ? (group.audit ?? []).slice(0, 40) : [],
    fileMaxBytes: group.fileMaxBytes ?? null,
    allowedFileExts: group.allowedFileExts ?? null,
  };
}

export function publicGroupMessage(m: GroupMessage, viewerId?: string, data?: StoreData) {
  if (m.deleted) {
    return { ...m, ciphertext: "", nonce: "", bodyFa: "این پیام حذف شد.", enc: "purged" as const, reactions: [] };
  }
  return {
    ...m,
    reactions: viewerId && data ? publicReactionView(data, m.reactions, viewerId) : m.reactions,
    ...(m.kind === "sticker" && viewerId && data ? historicalStickerView(data, m.stickerId, viewerId) : {}),
  };
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
  const me = findMember(group, userId)!;
  const messages = data.groupMessages
    .filter((m) => m.groupId === groupId)
    .filter((m) => {
      if ((group.historyMode ?? "all") === "from-join" && me && rankRole(me.role) < 3) {
        return m.createdAt >= me.joinedAt || m.kind === "system";
      }
      return true;
    })
    .sort((a, b) => a.createdAt - b.createdAt)
    .map((m) => publicGroupMessage(m, userId, data));
  return { group: publicGroup(group, userId), messages };
}

export async function createGroup(
  userId: string,
  input: {
    name: string;
    description?: string;
    color?: string;
    photoDataUrl?: string | null;
    memberKeys?: string[];
    joinMode?: GroupRecord["joinMode"];
    username?: string;
    category?: string;
    tags?: string[];
  },
) {
  const named = validateGroupName(input.name);
  if (!named.ok) return { ok: false as const, error: named.error, status: 400 };
  const name = named.name;
  const desc = validateGroupDescription(input.description ?? "");
  if (!desc.ok) return { ok: false as const, error: desc.error, status: 400 };
  const avatar = processGroupAvatar(input.photoDataUrl);
  if (!avatar.ok) return { ok: false as const, error: avatar.error, status: 400 };
  const user = (await readStoreSnapshot()).users.find((u) => u.id === userId);
  if (!user) return { ok: false as const, error: "حساب فعال نیست.", status: 401 };

  return mutateStore((data) => {
    const now = Date.now();
    const createLimit = hitRateLimit(data, `gcreate:${userId}`, GROUP_CREATE_WINDOW_MS, GROUP_CREATE_MAX, now);
    if (!createLimit.allowed) {
      return { ok: false as const, error: "ساخت گروه در این ساعت به سقف رسیده است.", status: 429 };
    }
    const owned = data.groups.filter((g) => !g.deletedAt && g.ownerUserId === userId).length;
    if (owned >= GROUP_OWNED_MAX) {
      return { ok: false as const, error: "تعداد گروه‌های قابل ساخت به سقف سیاست نیکسو رسیده است.", status: 429 };
    }
    const claimed = claimSpaceHandle(data, input.username);
    if (!claimed.ok) return claimed;
    const handle = claimed.username;
    const owner = makeMember({
      key: userId,
      kind: "user",
      role: "owner",
      name: user.displayName || user.firstName || "مالک",
      joinedAt: now,
      mutedUntil: null,
      restrictedUntil: null,
      notifyMutedUntil: null,
      leftAt: null,
    });
    const members = [owner];
    const seen = new Set([userId]);
    for (const raw of input.memberKeys ?? []) {
      if (members.length >= GROUP_MAX_MEMBERS) break;
      if (seen.has(raw)) continue;
      seen.add(raw);
      const seed = SEED_PEERS.find((p) => p.peerKey === raw);
      if (seed) {
        members.push(
          makeMember({
            key: `seed:${seed.peerKey}`,
            kind: "seed",
            role: "member",
            name: seed.peerName,
            joinedAt: now,
            mutedUntil: null,
            restrictedUntil: null,
            notifyMutedUntil: null,
            leftAt: null,
          }),
        );
        continue;
      }
      const other = data.users.find((u) => u.id === raw || u.username === raw.replace(/^@/, ""));
      if (!other || other.id === userId) continue;
      if (!canAddToGroup(data, userId, other.id)) continue;
      members.push(
        makeMember({
          key: other.id,
          kind: "user",
          role: "member",
          name: other.displayName || other.username || "عضو",
          joinedAt: now,
          mutedUntil: null,
          restrictedUntil: null,
          notifyMutedUntil: null,
          leftAt: null,
        }),
      );
    }
    const group: GroupRecord = {
      id: randomId(),
      name,
      description: desc.text.slice(0, GROUP_DESC_MAX),
      rules: "",
      welcome: "",
      username: handle,
      color: input.color && COLORS.includes(input.color) ? input.color : COLORS[members.length % COLORS.length]!,
      photoDataUrl: avatar.url,
      ownerUserId: userId,
      joinMode: input.joinMode ?? "invite",
      maxMembers: GROUP_MAX_MEMBERS,
      perms: { ...DEFAULT_GROUP_PERMS },
      adminPerms: { ...DEFAULT_GROUP_ADMIN_PERMS },
      slowModeMs: 0,
      historyMode: "all",
      inviteToken: randomId(),
      inviteExpiresAt: null,
      inviteMaxUses: null,
      inviteUses: 0,
      members,
      requests: [],
      bans: [],
    pinIds: [],
    reactionsEnabled: true,
    allowedReactions: null,
    audit: [],
      communityId: null,
      createdAt: now,
      updatedAt: now,
      deletedAt: null,
      category: validCategory(input.category),
      tags: (input.tags ?? []).map((t) => t.trim().toLowerCase().slice(0, 24)).filter(Boolean).slice(0, 8),
      searchVisible: (input.joinMode ?? "invite") === "open",
      customRoles: [],
      allowForward: true,
      previousUsernames: [],
      hideMemberList: (input.joinMode ?? "invite") !== "open",
    };
    data.groups.push(group);
    enqueueSearchIndexSync(data, "group-create");
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
    photoDataUrl: string | null;
    joinMode: GroupRecord["joinMode"];
    perms: GroupPerms;
    adminPerms: GroupAdminPerms;
    slowModeMs: number;
    historyMode: GroupHistoryMode;
    maxMembers: number;
    reactionsEnabled: boolean;
    allowedReactions: string[] | null;
    fileMaxBytes?: number | null;
    allowedFileExts?: string[] | null;
    category?: string;
    tags?: string[];
    searchVisible?: boolean;
    inviteExpiresAt?: number | null;
    inviteMaxUses?: number | null;
    customRoles?: CustomGroupRole[];
    allowForward?: boolean;
    hideMemberList?: boolean;
  }>,
) {
  return mutateStore((data) => {
    const group = data.groups.find((g) => g.id === groupId && !g.deletedAt);
    if (!group) return { ok: false as const, error: "گروه یافت نشد.", status: 404 };
    const me = findMember(group, userId);
    if (!me) return { ok: false as const, error: "عضو این گروه نیستی.", status: 403 };
    const infoOk = me.role === "owner" || adminCan(group, me, "manageGroup") || adminCan(group, me, "manageSettings") || group.perms.changeInfo;
    if (patch.perms || patch.adminPerms) {
      if (me.role !== "owner" && !adminCan(group, me, "managePermissions")) {
        return { ok: false as const, error: "اجازهٔ تغییر مجوز نداری.", status: 403 };
      }
    }
    if (!infoOk && !patch.perms && !patch.adminPerms) return { ok: false as const, error: "اجازهٔ ویرایش اطلاعات نداری.", status: 403 };
    const now = Date.now();
    expireJoinRequests(group, now);
    if (typeof patch.name === "string") {
      const named = validateGroupName(patch.name);
      if (!named.ok) return { ok: false as const, error: named.error, status: 400 };
      group.name = named.name;
      pushSystem(data, group, `نام گروه به «${group.name}» تغییر کرد.`, now);
    }
    if (typeof patch.description === "string") {
      const desc = validateGroupDescription(patch.description);
      if (!desc.ok) return { ok: false as const, error: desc.error, status: 400 };
      group.description = desc.text;
    }
    if (typeof patch.rules === "string") group.rules = patch.rules.trim().slice(0, 2000);
    if (typeof patch.welcome === "string") group.welcome = patch.welcome.trim().slice(0, 400);
    if (patch.username !== undefined) {
      const claimed = claimSpaceHandle(data, patch.username, { groupId: group.id });
      if (!claimed.ok) return claimed;
      if (group.username && group.username !== claimed.username) {
        group.previousUsernames = [...(group.previousUsernames ?? []), group.username].slice(-8);
      }
      group.username = claimed.username;
    }
    if (typeof patch.allowForward === "boolean") group.allowForward = patch.allowForward;
    if (typeof patch.hideMemberList === "boolean") {
      if (!(me.role === "owner" || adminCan(group, me, "manageSettings"))) {
        return { ok: false as const, error: "اجازهٔ حریم فهرست اعضا نداری.", status: 403 };
      }
      group.hideMemberList = patch.hideMemberList;
      pushAudit(group, me, "privacy", group.hideMemberList ? "فهرست اعضا محدود شد" : "فهرست اعضا برای اعضا باز است");
    }
    if (patch.color && COLORS.includes(patch.color)) {
      group.color = patch.color;
      pushSystem(data, group, "عکس/رنگ گروه تغییر کرد.", now);
    }
    if (patch.photoDataUrl !== undefined) {
      if (!(me.role === "owner" || adminCan(group, me, "manageGroup") || adminCan(group, me, "manageMedia"))) {
        return { ok: false as const, error: "اجازهٔ تغییر عکس گروه نداری.", status: 403 };
      }
      const avatar = processGroupAvatar(patch.photoDataUrl);
      if (!avatar.ok) return { ok: false as const, error: avatar.error, status: 400 };
      group.photoDataUrl = avatar.url;
      pushAudit(group, me, "photo", "عکس گروه تغییر کرد");
    }
    if (patch.joinMode) {
      group.joinMode = patch.joinMode;
      pushAudit(group, me, "privacy", `عضویت: ${patch.joinMode}`);
    }
    if (patch.perms) {
      group.perms = { ...DEFAULT_GROUP_PERMS, ...patch.perms };
      pushAudit(group, me, "permission", "مجوز اعضا تغییر کرد");
    }
    if (patch.adminPerms) {
      group.adminPerms = { ...DEFAULT_GROUP_ADMIN_PERMS, ...patch.adminPerms };
      pushAudit(group, me, "permission", "مجوز ادمین تغییر کرد");
    }
    if (typeof patch.slowModeMs === "number") {
      group.slowModeMs = Math.max(0, Math.min(600_000, Math.floor(patch.slowModeMs)));
      pushAudit(group, me, "slowmode", `Slow Mode ${group.slowModeMs}ms`);
    }
    if (patch.historyMode === "all" || patch.historyMode === "from-join") {
      group.historyMode = patch.historyMode;
      pushAudit(group, me, "history", group.historyMode);
    }
    if (typeof patch.maxMembers === "number") {
      group.maxMembers = Math.min(GROUP_MAX_MEMBERS, Math.max(2, Math.floor(patch.maxMembers)));
    }
    if (typeof patch.reactionsEnabled === "boolean") {
      if (!(me.role === "owner" || adminCan(group, me, "manageGroup"))) {
        return { ok: false as const, error: "اجازهٔ مدیریت واکنش نداری.", status: 403 };
      }
      group.reactionsEnabled = patch.reactionsEnabled;
    }
    if (patch.allowedReactions !== undefined) {
      if (!(me.role === "owner" || adminCan(group, me, "manageGroup"))) {
        return { ok: false as const, error: "اجازهٔ مدیریت واکنش نداری.", status: 403 };
      }
      group.allowedReactions = patch.allowedReactions === null ? null : allowedReactionSet(patch.allowedReactions);
    }
    if (typeof patch.fileMaxBytes === "number") {
      if (!(me.role === "owner" || adminCan(group, me, "managePermissions"))) {
        return { ok: false as const, error: "اجازهٔ محدودیت فایل نداری.", status: 403 };
      }
      group.fileMaxBytes = Math.max(64 * 1024, Math.min(28 * 1024 * 1024, Math.floor(patch.fileMaxBytes)));
      pushAudit(group, me, "files", `سقف فایل ${group.fileMaxBytes}`);
    }
    if (patch.allowedFileExts !== undefined) {
      if (!(me.role === "owner" || adminCan(group, me, "managePermissions"))) {
        return { ok: false as const, error: "اجازهٔ محدودیت فایل نداری.", status: 403 };
      }
      group.allowedFileExts =
        patch.allowedFileExts === null
          ? null
          : patch.allowedFileExts.map((e) => e.replace(/^\./, "").toLowerCase().slice(0, 8)).filter(Boolean).slice(0, 24);
      pushAudit(group, me, "files", "فرمت‌های مجاز فایل تغییر کرد");
    }
    if (typeof patch.category === "string") {
      group.category = validCategory(patch.category);
      pushAudit(group, me, "category", group.category);
    }
    if (patch.tags) {
      group.tags = patch.tags.map((t) => t.trim().toLowerCase().slice(0, 24)).filter(Boolean).slice(0, 8);
    }
    if (typeof patch.searchVisible === "boolean") {
      group.searchVisible = group.joinMode === "open" ? patch.searchVisible : false;
      pushAudit(group, me, "search", group.searchVisible ? "قابل جستجو" : "مخفی از جستجو");
    }
    if (patch.joinMode === "invite" || patch.joinMode === "request") {
      group.searchVisible = false;
    }
    if (patch.inviteExpiresAt !== undefined) {
      if (!adminCan(group, me, "manageInvites")) return { ok: false as const, error: "اجازهٔ لینک دعوت نداری.", status: 403 };
      group.inviteExpiresAt = patch.inviteExpiresAt;
    }
    if (patch.inviteMaxUses !== undefined) {
      if (!adminCan(group, me, "manageInvites")) return { ok: false as const, error: "اجازهٔ لینک دعوت نداری.", status: 403 };
      group.inviteMaxUses = patch.inviteMaxUses === null ? null : Math.max(1, Math.min(10_000, Math.floor(patch.inviteMaxUses)));
    }
    if (patch.customRoles) {
      if (me.role !== "owner") return { ok: false as const, error: "فقط مالک نقش سفارشی می‌سازد.", status: 403 };
      group.customRoles = patch.customRoles.slice(0, 8).map((r) => ({
        id: r.id?.trim() || randomId(),
        name: String(r.name ?? "").trim().slice(0, 32) || "نقش",
        inviteMembers: Boolean(r.inviteMembers),
        pinMessages: Boolean(r.pinMessages),
        deleteMessages: Boolean(r.deleteMessages),
        muteMembers: Boolean(r.muteMembers),
        manageLinks: Boolean(r.manageLinks),
        manageRoles: Boolean(r.manageRoles),
        manageSettings: Boolean(r.manageSettings),
        manageMedia: Boolean(r.manageMedia),
        manageAdmins: Boolean(r.manageAdmins),
      }));
      pushAudit(group, me, "roles", "نقش‌های سفارشی به‌روز شد");
    }
    group.updatedAt = now;
    pushSystem(data, group, "تنظیمات گروه به‌روز شد.", now);
    return { ok: true as const, group: publicGroup(group, userId) };
  });
}

export async function rotateInvite(
  userId: string,
  groupId: string,
  action: "new" | "revoke",
  extra?: { expiresInHours?: number | null; maxUses?: number | null },
) {
  return mutateStore((data) => {
    const group = data.groups.find((g) => g.id === groupId && !g.deletedAt);
    if (!group) return { ok: false as const, error: "گروه یافت نشد.", status: 404 };
    const me = findMember(group, userId);
    if (!me || !(adminCan(group, me, "manageInvites") || adminCan(group, me, "manageLinks"))) {
      return { ok: false as const, error: "فقط ادمین مجاز لینک دعوت را مدیریت می‌کند.", status: 403 };
    }
    const inviteLimit = hitRateLimit(data, `ginvite:${userId}`, GROUP_INVITE_WINDOW_MS, GROUP_INVITE_MAX);
    if (!inviteLimit.allowed) {
      return { ok: false as const, error: "ساخت دعوت در این بازه به سقف رسیده است.", status: 429 };
    }
    group.inviteToken = action === "revoke" ? "" : randomId();
    if (action === "new") {
      group.inviteUses = 0;
      if (extra?.expiresInHours === null) group.inviteExpiresAt = null;
      else if (typeof extra?.expiresInHours === "number") {
        group.inviteExpiresAt = Date.now() + Math.max(1, extra.expiresInHours) * 3600_000;
      }
      if (extra?.maxUses === null) group.inviteMaxUses = null;
      else if (typeof extra?.maxUses === "number") {
        group.inviteMaxUses = Math.max(1, Math.min(10_000, Math.floor(extra.maxUses)));
      }
    }
    group.updatedAt = Date.now();
    pushAudit(group, me, "invite", action === "revoke" ? "Invite Revoked" : "Invite Reset");
    return { ok: true as const, inviteToken: group.inviteToken || null, inviteExpiresAt: group.inviteExpiresAt, inviteMaxUses: group.inviteMaxUses };
  });
}

export async function previewInvite(token: string) {
  const data = await readStoreSnapshot();
  const group = data.groups.find((g) => g.inviteToken && g.inviteToken === token && !g.deletedAt);
  if (!group || !inviteLive(group)) return null;
  return {
    id: group.id,
    name: group.name,
    description: group.description,
    color: group.color,
    memberCount: group.members.filter(liveMember).length,
    joinMode: group.joinMode,
    visibility: group.joinMode === "open" ? "public" : "private",
    rules: group.rules,
    requiresRules: Boolean(group.rules.trim()),
  };
}

export async function joinByToken(userId: string, token: string, extra?: { acceptRules?: boolean }) {
  return mutateStore((data) => {
    const now = Date.now();
    const joinLimit = hitRateLimit(data, `gjoin:${userId}`, GROUP_JOIN_WINDOW_MS, GROUP_JOIN_MAX, now);
    if (!joinLimit.allowed) {
      return { ok: false as const, error: "پیوستن در این بازه به سقف رسیده است.", status: 429 };
    }
    const group = data.groups.find((g) => g.inviteToken && g.inviteToken === token && !g.deletedAt);
    if (!group || !inviteLive(group, now)) return { ok: false as const, error: "لینک دعوت نامعتبر است.", status: 404 };
    expireJoinRequests(group, now);
    const user = data.users.find((u) => u.id === userId);
    if (!user) return { ok: false as const, error: "حساب فعال نیست.", status: 401 };
    if (isBanned(group, userId, now)) return { ok: false as const, error: "از این گروه بن شده‌ای.", status: 403 };
    if (findMember(group, userId)) return { ok: true as const, group: publicGroup(group, userId), already: true };
    if (group.members.filter(liveMember).length >= group.maxMembers) {
      return { ok: false as const, error: "ظرفیت گروه پر است.", status: 409 };
    }
    const blocked = rulesBlock(group, extra?.acceptRules);
    if (blocked) return blocked;
    if (group.joinMode === "request") {
      if (group.requests.some((r) => r.userId === userId && requestStillPending(r, now))) {
        return { ok: false as const, error: "درخواست عضویت قبلی در انتظار است.", status: 409 };
      }
      group.requests.push({
        id: randomId(),
        userId,
        name: user.displayName || user.username || "کاربر",
        createdAt: now,
        expiresAt: now + GROUP_REQUEST_TTL_MS,
        status: "pending",
      });
      group.inviteUses = (group.inviteUses ?? 0) + 1;
      return { ok: true as const, pending: true as const };
    }
    group.members.push(
      makeMember({
        key: userId,
        kind: "user",
        role: "member",
        name: user.displayName || user.username || "عضو",
        joinedAt: now,
        mutedUntil: null,
        restrictedUntil: null,
        notifyMutedUntil: null,
        leftAt: null,
      }),
    );
    group.inviteUses = (group.inviteUses ?? 0) + 1;
    pushSystem(data, group, `${user.displayName || "یک کاربر"} به گروه پیوست.`, now);
    if (group.welcome) pushSystem(data, group, group.welcome, now + 1);
    notifyOwnerJoin(data, group, userId, now);
    return { ok: true as const, group: publicGroup(group, userId) };
  });
}

export async function joinGroup(userId: string, groupId: string, extra?: { acceptRules?: boolean }) {
  return mutateStore((data) => {
    const now = Date.now();
    const joinLimit = hitRateLimit(data, `gjoin:${userId}`, GROUP_JOIN_WINDOW_MS, GROUP_JOIN_MAX, now);
    if (!joinLimit.allowed) {
      return { ok: false as const, error: "پیوستن در این بازه به سقف رسیده است.", status: 429 };
    }
    const group = data.groups.find((g) => g.id === groupId && !g.deletedAt);
    if (!group) return { ok: false as const, error: "گروه یافت نشد.", status: 404 };
    if (group.platformHold === "removed") {
      return { ok: false as const, error: "این گروه توسط ایمنی نیکسو محدود است.", status: 403 };
    }
    expireJoinRequests(group, now);
    const user = data.users.find((u) => u.id === userId);
    if (!user) return { ok: false as const, error: "حساب فعال نیست.", status: 401 };
    if (isBanned(group, userId, now)) return { ok: false as const, error: "از این گروه بن شده‌ای.", status: 403 };
    if (findMember(group, userId)) return { ok: true as const, group: publicGroup(group, userId), already: true };
    if (group.joinMode === "invite") {
      return { ok: false as const, error: "این گروه فقط با لینک دعوت قابل ورود است.", status: 403 };
    }
    if (group.members.filter(liveMember).length >= group.maxMembers) {
      return { ok: false as const, error: "ظرفیت گروه پر است.", status: 409 };
    }
    const blocked = rulesBlock(group, extra?.acceptRules);
    if (blocked) return blocked;
    if (group.joinMode === "request") {
      if (group.requests.some((r) => r.userId === userId && requestStillPending(r, now))) {
        return { ok: false as const, error: "درخواست عضویت قبلی در انتظار است.", status: 409 };
      }
      group.requests.push({
        id: randomId(),
        userId,
        name: user.displayName || user.username || "کاربر",
        createdAt: now,
        expiresAt: now + GROUP_REQUEST_TTL_MS,
        status: "pending",
      });
      return { ok: true as const, pending: true as const };
    }
    group.members.push(
      makeMember({
        key: userId,
        kind: "user",
        role: "member",
        name: user.displayName || user.username || "عضو",
        joinedAt: now,
        mutedUntil: null,
        restrictedUntil: null,
        notifyMutedUntil: null,
        leftAt: null,
      }),
    );
    pushSystem(data, group, `${user.displayName || "یک کاربر"} به گروه پیوست.`, now);
    if (group.welcome) pushSystem(data, group, group.welcome, now + 1);
    notifyOwnerJoin(data, group, userId, now);
    return { ok: true as const, group: publicGroup(group, userId) };
  });
}

export async function cancelJoinRequest(userId: string, groupId: string, requestId?: string) {
  return mutateStore((data) => {
    const group = data.groups.find((g) => g.id === groupId && !g.deletedAt);
    if (!group) return { ok: false as const, error: "گروه یافت نشد.", status: 404 };
    const req = group.requests.find(
      (r) => requestStillPending(r) && r.userId === userId && (!requestId || r.id === requestId),
    );
    if (!req) return { ok: false as const, error: "درخواست یافت نشد.", status: 404 };
    req.status = "cancelled";
    pushAudit(group, makeMember({
      key: userId,
      kind: "user",
      role: "member",
      name: req.name,
      joinedAt: req.createdAt,
      mutedUntil: null,
      restrictedUntil: null,
      notifyMutedUntil: null,
      leftAt: null,
    }), "request", "Join request cancelled");
    return { ok: true as const };
  });
}

export async function decideRequest(userId: string, groupId: string, requestId: string, approve: boolean) {
  return mutateStore((data) => {
    const group = data.groups.find((g) => g.id === groupId && !g.deletedAt);
    if (!group) return { ok: false as const, error: "گروه یافت نشد.", status: 404 };
    const me = findMember(group, userId);
    if (!me || !adminCan(group, me, "addMembers")) return { ok: false as const, error: "اجازه نداری.", status: 403 };
    expireJoinRequests(group);
    const req = group.requests.find((r) => r.id === requestId && requestStillPending(r));
    if (!req) return { ok: false as const, error: "درخواست یافت نشد.", status: 404 };
    const now = Date.now();
    req.status = approve ? "approved" : "rejected";
    if (approve) {
      if (isBanned(group, req.userId, now)) return { ok: false as const, error: "این کاربر بن است.", status: 403 };
      if (findMember(group, req.userId)) {
        return { ok: true as const, group: publicGroup(group, userId) };
      }
      group.members.push(
        makeMember({
          key: req.userId,
          kind: "user",
          role: "member",
          name: req.name,
          joinedAt: now,
          mutedUntil: null,
          restrictedUntil: null,
          notifyMutedUntil: null,
          leftAt: null,
        }),
      );
      pushSystem(data, group, `${req.name} به گروه پیوست.`, now);
      if (group.welcome) pushSystem(data, group, group.welcome, now + 1);
    }
    pushAudit(group, me, approve ? "approve" : "reject", req.name);
    return { ok: true as const, group: publicGroup(group, userId) };
  });
}

export async function addMembers(userId: string, groupId: string, keys: string[]) {
  return mutateStore((data) => {
    const group = data.groups.find((g) => g.id === groupId && !g.deletedAt);
    if (!group) return { ok: false as const, error: "گروه یافت نشد.", status: 404 };
    const me = findMember(group, userId);
    if (!me) return { ok: false as const, error: "عضو نیستی.", status: 403 };
    if (!(me.role === "owner" || adminCan(group, me, "addMembers") || group.perms.addMembers || customFlag(group, me, "inviteMembers"))) {
      return { ok: false as const, error: "اجازهٔ افزودن عضو نداری.", status: 403 };
    }
    const inviteLimit = hitRateLimit(data, `ginvite:${userId}`, GROUP_INVITE_WINDOW_MS, GROUP_INVITE_MAX);
    if (!inviteLimit.allowed) {
      return { ok: false as const, error: "دعوت در این بازه به سقف رسیده است.", status: 429 };
    }
    const now = Date.now();
    for (const raw of keys.slice(0, 40)) {
      if (group.members.filter(liveMember).length >= group.maxMembers) break;
      const seed = SEED_PEERS.find((p) => p.peerKey === raw);
      const uname = raw.replace(/^@/, "").toLowerCase();
      const bot = (data.bots ?? []).find((b) => b.status === "active" && (b.id === raw || b.username === uname || raw === `bot:${b.id}`));
      if (bot) continue;
      const key = seed ? `seed:${seed.peerKey}` : data.users.find((u) => u.id === raw || u.username === raw.replace(/^@/, ""))?.id;
      if (!key || findMember(group, key) || isBanned(group, key)) continue;
      if (seed) {
        group.members.push(
          makeMember({
            key,
            kind: "seed",
            role: "member",
            name: seed.peerName,
            joinedAt: now,
            mutedUntil: null,
            restrictedUntil: null,
            notifyMutedUntil: null,
            leftAt: null,
          }),
        );
        pushSystem(data, group, `${seed.peerName} به گروه اضافه شد.`, now);
        continue;
      }
      const other = data.users.find((u) => u.id === key);
      if (!other) continue;
      if (!canAddToGroup(data, userId, other.id)) continue;
      group.members.push(
        makeMember({
          key: other.id,
          kind: "user",
          role: "member",
          name: other.displayName || other.username || "عضو",
          joinedAt: now,
          mutedUntil: null,
          restrictedUntil: null,
          notifyMutedUntil: null,
          leftAt: null,
        }),
      );
      pushSystem(data, group, `${other.displayName || "یک کاربر"} به گروه اضافه شد.`, now);
      emitNotification(data, {
        userId: other.id,
        category: "groups",
        kind: "group_invite",
        title: group.name,
        body: "به گروه دعوت شدی.",
        senderName: me.name,
        sourceId: `ginvite:${group.id}:${other.id}`,
        eventId: `ginvite:${group.id}:${other.id}:${now}`,
        muteType: "group",
        muteId: group.id,
        target: { type: "group", id: group.id },
      });
    }
    return { ok: true as const, group: publicGroup(group, userId) };
  });
}

export async function moderateMember(
  userId: string,
  groupId: string,
  targetKey: string,
  action: "remove" | "ban" | "unban" | "mute" | "restrict" | "role" | "transfer" | "kick",
  extra?: { ms?: number; role?: GroupRole; confirm?: string; until?: number | null; membershipId?: string; customRoleId?: string | null; reason?: string },
) {
  return mutateStore((data) => {
    const group = data.groups.find((g) => g.id === groupId && !g.deletedAt);
    if (!group) return { ok: false as const, error: "گروه یافت نشد.", status: 404 };
    const me = findMember(group, userId);
    if (!me) return { ok: false as const, error: "عضو نیستی.", status: 403 };
    const target = group.members.find((m) => m.key === targetKey);
    if (extra?.membershipId && target && target.id !== extra.membershipId) {
      pushAudit(group, me, "security", "Membership IDOR blocked");
      return { ok: false as const, error: "عضویت نامعتبر است.", status: 403 };
    }
    const now = Date.now();
    if (action === "unban") {
      if (!adminCan(group, me, "removeMembers")) return { ok: false as const, error: "اجازه نداری.", status: 403 };
      group.bans = group.bans.filter((b) => b.key !== targetKey);
      pushAudit(group, me, "unban", targetKey);
      return { ok: true as const, group: publicGroup(group, userId) };
    }
    if (action === "transfer") {
      if (me.role !== "owner") return { ok: false as const, error: "فقط مالک می‌تواند مالکیت را واگذار کند.", status: 403 };
      if (extra?.confirm !== "TRANSFER") {
        return { ok: false as const, error: "برای انتقال مالکیت باید تأیید امنیتی TRANSFER ارسال شود.", status: 400 };
      }
      if (!target || !liveMember(target) || target.kind !== "user") {
        return { ok: false as const, error: "عضو معتبر نیست.", status: 400 };
      }
      me.role = "admin";
      target.role = "owner";
      group.ownerUserId = target.key;
      pushSystem(data, group, `مالکیت به ${target.name} منتقل شد.`, now);
      pushAudit(group, me, "owner", `مالکیت به ${target.name}`);
      invalidatePermCache(me.key);
      invalidatePermCache(target.key);
      cacheInvalidate(`pub:group:${group.id}`);
      return { ok: true as const, group: publicGroup(group, userId) };
    }
    if (!target || !liveMember(target)) return { ok: false as const, error: "عضو یافت نشد.", status: 404 };
    if (target.role === "owner" && me.role !== "owner") {
      return { ok: false as const, error: "مالک گروه قابل حذف یا تغییر نقش نیست.", status: 403 };
    }
    if (!canManage(me, target)) return { ok: false as const, error: "نمی‌توانی این عضو را مدیریت کنی.", status: 403 };
    if ((action === "remove" || action === "kick" || action === "ban") && !adminCan(group, me, "removeMembers")) {
      return { ok: false as const, error: "اجازهٔ حذف/بن نداری.", status: 403 };
    }
    if (action === "remove" || action === "kick") {
      target.leftAt = now;
      target.removedBy = me.key;
      pushSystem(data, group, `${target.name} از گروه ${action === "kick" ? "اخراج" : "حذف"} شد.`, now);
      pushAudit(group, me, action, target.name);
    } else if (action === "ban") {
      if (!adminCan(group, me, "banMembers") && !adminCan(group, me, "removeMembers")) {
        return { ok: false as const, error: "اجازهٔ بن نداری.", status: 403 };
      }
      target.leftAt = now;
      target.removedBy = me.key;
      const until = extra?.until === null ? null : typeof extra?.until === "number" ? extra.until : extra?.ms ? now + extra.ms : null;
      group.bans = group.bans.filter((b) => b.key !== targetKey);
      group.bans.push({
        id: randomId(),
        key: targetKey,
        at: now,
        until,
        byKey: me.key,
        byName: me.name,
        reason: typeof extra?.reason === "string" ? extra.reason.trim().slice(0, 160) : undefined,
        permanent: until == null,
      });
      pushSystem(data, group, until ? `${target.name} موقتاً بن شد.` : `${target.name} بن شد.`, now);
      pushAudit(group, me, "ban", `${target.name}${until ? ` until ${until}` : " permanent"}`);
    } else if (action === "mute") {
      if (!(adminCan(group, me, "removeMembers") || me.role === "moderator" || customFlag(group, me, "muteMembers"))) {
        return { ok: false as const, error: "اجازهٔ Mute نداری.", status: 403 };
      }
      target.mutedUntil = now + Math.min(30 * 24 * 3600_000, Math.max(60_000, extra?.ms ?? 3600_000));
      pushSystem(data, group, `ارسال پیام ${target.name} محدود شد.`, now);
      pushAudit(group, me, "mute", target.name);
    } else if (action === "restrict") {
      if (!adminCan(group, me, "removeMembers")) {
        return { ok: false as const, error: "اجازهٔ محدود کردن نداری.", status: 403 };
      }
      target.restrictedUntil = now + Math.min(30 * 24 * 3600_000, Math.max(60_000, extra?.ms ?? 3600_000));
      pushSystem(data, group, `${target.name} محدود شد.`, now);
      pushAudit(group, me, "restrict", target.name);
    } else if (action === "role") {
      if (extra?.customRoleId !== undefined) {
        if (me.role !== "owner" && me.role !== "admin") {
          return { ok: false as const, error: "اجازهٔ نقش سفارشی نداری.", status: 403 };
        }
        if (extra.customRoleId && !group.customRoles.some((r) => r.id === extra.customRoleId)) {
          return { ok: false as const, error: "نقش سفارشی این گروه نیست.", status: 403 };
        }
        target.customRoleId = extra.customRoleId;
        pushAudit(group, me, "custom-role", target.name);
      }
      const role = extra?.role;
      if (role) {
        if (role === "owner") return { ok: false as const, error: "انتقال مالکیت جداست.", status: 400 };
        if (role === "admin") {
          if (me.role !== "owner" && !adminCan(group, me, "manageAdmins")) {
            return { ok: false as const, error: "اجازهٔ تغییر نقش ادمین نداری.", status: 403 };
          }
        } else if (role === "moderator" || role === "member") {
          if (me.role !== "owner" && me.role !== "admin") {
            return { ok: false as const, error: "اجازهٔ تغییر نقش نداری.", status: 403 };
          }
        } else {
          return { ok: false as const, error: "نقش نامعتبر است.", status: 400 };
        }
        const prev = target.role;
        target.role = role;
        if (prev !== "admin" && role === "admin") pushSystem(data, group, `${target.name} ادمین شد.`, now);
        if (prev === "admin" && role !== "admin") pushSystem(data, group, `${target.name} دیگر ادمین نیست.`, now);
        pushAudit(group, me, "role", `${target.name} → ${role}`);
      }
    }
    if (target.kind === "user") {
      emitNotification(data, {
        userId: target.key,
        category: "groups",
        kind: "admin",
        title: group.name,
        body: `اقدام مدیر: ${action}`,
        senderName: me.name,
        sourceId: `groupadmin:${group.id}`,
        muteType: "group",
        muteId: group.id,
        target: { type: "group", id: group.id },
      });
    }
    invalidatePermCache(target.key);
    cacheInvalidate(`pub:group:${group.id}`);
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

export async function deleteGroup(userId: string, groupId: string, extra?: { confirm?: string }) {
  return mutateStore((data) => {
    const group = data.groups.find((g) => g.id === groupId && !g.deletedAt);
    if (!group) return { ok: false as const, error: "گروه یافت نشد.", status: 404 };
    const me = findMember(group, userId);
    if (!me || me.role !== "owner") return { ok: false as const, error: "فقط مالک می‌تواند گروه را حذف کند.", status: 403 };
    if (extra?.confirm !== "DELETE") {
      return { ok: false as const, error: "برای حذف گروه باید تأیید DELETE ارسال شود.", status: 400 };
    }
    group.deletedAt = Date.now();
    data.groupMessages = data.groupMessages.filter((m) => m.groupId !== groupId);
    enqueueSearchTombstone(data, `group:${group.id}`, "group-delete");
    enqueueSearchIndexSync(data, "group-delete");
    pushAudit(group, me, "delete", "Group deleted");
    return { ok: true as const };
  });
}

export async function listGroupMembers(
  userId: string,
  groupId: string,
  q = "",
  cursor = "",
  limit = GROUP_MEMBER_PAGE,
  sort: "joined" | "name" | "role" = "joined",
) {
  const data = await readStoreSnapshot();
  const group = data.groups.find((g) => g.id === groupId && !g.deletedAt);
  if (!group || !findMember(group, userId)) return null;
  const me = findMember(group, userId)!;
  const staff = rankRole(me.role) >= 3;
  if (group.hideMemberList && !staff) {
    return {
      members: [
        {
          id: me.id,
          key: me.key,
          role: me.role,
          customRoleId: me.customRoleId ?? null,
          name: me.name,
          joinedAt: me.joinedAt,
          state: membershipState(group, me),
        },
      ],
      nextCursor: null,
      total: 1,
    };
  }
  const needle = q.trim().toLowerCase();
  const live = group.members.filter(liveMember).slice();
  const loc = data.users.find((u) => u.id === userId)?.prefs?.locale;
  if (sort === "name") live.sort((a, b) => collate(a.name, b.name, loc));
  else if (sort === "role") live.sort((a, b) => rankRole(b.role) - rankRole(a.role) || collate(a.name, b.name, loc));
  else live.sort((a, b) => a.joinedAt - b.joinedAt);
  const filtered = needle
    ? live.filter((m) => m.name.toLowerCase().includes(needle) || m.role.includes(needle))
    : live;
  const start = cursor ? Math.max(0, filtered.findIndex((m) => m.id === cursor) + 1) : 0;
  const page = filtered.slice(start, start + Math.min(80, Math.max(1, limit)));
  const last = page[page.length - 1];
  return {
    members: page.map((m) => ({
      id: m.id,
      key: m.key,
      role: m.role,
      customRoleId: m.customRoleId ?? null,
      name: m.name,
      joinedAt: m.joinedAt,
      state: membershipState(group, m),
    })),
    nextCursor: page.length === Math.min(80, Math.max(1, limit)) && last ? last.id : null,
    total: filtered.length,
  };
}

export async function setNotifyMute(userId: string, groupId: string, ms?: number | null, mentions?: boolean) {
  return mutateStore((data) => {
    const group = data.groups.find((g) => g.id === groupId && !g.deletedAt);
    if (!group) return { ok: false as const, error: "گروه یافت نشد.", status: 404 };
    const me = findMember(group, userId);
    if (!me) return { ok: false as const, error: "عضو نیستی.", status: 403 };
    if (ms !== undefined) me.notifyMutedUntil = ms && ms > 0 ? Date.now() + ms : null;
    if (typeof mentions === "boolean") me.notifyMentions = mentions;
    return { ok: true as const, notifyMutedUntil: me.notifyMutedUntil, notifyMentions: me.notifyMentions !== false };
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
    tags?: string[];
    blobId?: string;
    chunkCount?: number;
    byteLength?: number;
    fileExt?: string;
    poll?: { question: string; options: string[]; anonymous?: boolean; multiple?: boolean; closesAt?: number | null };
    stickerId?: string;
    durationMs?: number;
    clientNonce?: string;
    containsLink?: boolean;
  },
) {
  return mutateStore((data) => {
    const blocked = postingBlocked(data.users.find((u) => u.id === userId));
    if (blocked.blocked) return { ok: false as const, error: blocked.error, status: 403 };
    const group = data.groups.find((g) => g.id === groupId && !g.deletedAt);
    if (!group) return { ok: false as const, error: "گروه یافت نشد.", status: 404 };
    if (group.platformHold === "removed" || group.platformHold === "restricted") {
      return { ok: false as const, error: "این گروه توسط ایمنی نیکسو محدود است.", status: 403 };
    }
    const me = findMember(group, userId);
    if (!me) return { ok: false as const, error: "عضو این گروه نیستی.", status: 403 };
    const now = Date.now();
    const kind =
      payload.kind === "voice" ||
      payload.kind === "photo" ||
      payload.kind === "video" ||
      payload.kind === "file" ||
      payload.kind === "poll" ||
      payload.kind === "gif" ||
      payload.kind === "contact" ||
      payload.kind === "location" ||
      payload.kind === "sticker"
        ? payload.kind
        : "text";
    const sendOk = memberCanSend(group, me, kind, now);
    if (!sendOk.ok) {
      return { ok: false as const, error: sendOk.error, status: 403 };
    }
    const memberPerms = permsOf(group);
    if (payload.containsLink && !memberPerms.sendLinks && rankRole(me.role) < 3) {
      return { ok: false as const, error: "ارسال لینک در این گروه محدود است.", status: 403 };
    }
    if (payload.containsLink) {
      const links = hitRateLimit(data, `glink:${userId}`, GROUP_LINK_WINDOW_MS, GROUP_LINK_MAX, now);
      if (!links.allowed) return { ok: false as const, error: "ارسال لینک پیاپی محدود شد.", status: 429 };
    }
    if ((group.slowModeMs ?? 0) > 0 && rankRole(me.role) < 3) {
      const last = me.lastSentAt ?? 0;
      if (now - last < group.slowModeMs) {
        return { ok: false as const, error: "Slow Mode فعال است. کمی صبر کن.", status: 429 };
      }
    }
    const stored = data.groupMessages.filter((m) => m.groupId === groupId && !m.deleted).length;
    if (stored >= GROUP_STORAGE_MAX_ITEMS) {
      return { ok: false as const, error: "ظرفیت ذخیرهٔ گروه پر است.", status: 413 };
    }
    const flood = hitRateLimit(data, `gmsg:${groupId}:${userId}`, GROUP_FLOOD_WINDOW_MS, GROUP_FLOOD_MAX, now);
    if (!flood.allowed) {
      me.mutedUntil = now + 5 * 60_000;
      return { ok: false as const, error: "ارسال پیاپی شناسایی شد و موقتاً محدود شدی.", status: 429 };
    }
    const clientNonce = typeof payload.clientNonce === "string" ? payload.clientNonce.trim().slice(0, 80) : "";
    if (clientNonce) {
      const dup = data.groupMessages.find(
        (m) => m.groupId === groupId && m.senderKey === userId && m.clientNonce === clientNonce && !m.deleted,
      );
      if (dup) return { ok: true as const, message: publicGroupMessage(dup, userId, data) };
    }
    if (payload.replyToId) {
      const orig = data.groupMessages.find((m) => m.id === payload.replyToId && m.groupId === groupId && !m.deleted);
      if (!orig) return { ok: false as const, error: "پیام اصلی در این گروه نیست.", status: 400 };
    }
    if (Array.isArray(payload.mentions)) {
      if (!permsOf(group).sendMentions && rankRole(me.role) < 3) {
        payload.mentions = [];
      } else {
        payload.mentions = payload.mentions.filter((id) => Boolean(findMember(group, String(id)))).slice(0, 12);
      }
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
      me.lastSentAt = now;
      for (const member of group.members) {
        if (member.leftAt || member.key === userId || member.kind !== "user") continue;
        emitNotification(data, {
          userId: member.key,
          category: "groups",
          kind: "poll",
          title: group.name,
          senderName: me.name,
          body: question.slice(0, 80),
          sourceId: `group:${group.id}:${userId}`,
          muteType: "group",
          muteId: group.id,
          target: { type: "group", id: group.id },
        });
      }
      return { ok: true as const, message: publicGroupMessage(msg, userId, data) };
    }
    if (kind === "sticker") {
      const sendLimit = hitRateLimit(data, `stsend:${userId}`, 60_000, 30);
      if (!sendLimit.allowed) return { ok: false as const, error: "ارسال استیکر محدود شد.", status: 429 };
      const use = canUseSticker(data, userId, String(payload.stickerId ?? ""));
      if (!use.ok) return { ok: false as const, error: use.error, status: use.status };
      const msg: GroupMessage = {
        id: randomId(),
        groupId,
        senderKey: userId,
        senderName: me.name,
        enc: "none",
        ciphertext: "",
        nonce: "",
        createdAt: now,
        kind: "sticker",
        stickerId: use.item.id,
        reactions: [],
        replyToId: payload.replyToId,
      };
      data.groupMessages.push(msg);
      group.updatedAt = now;
      me.lastSentAt = now;
      use.prefs.stickerRecent = [use.item.id, ...use.prefs.stickerRecent.filter((id) => id !== use.item.id)].slice(0, 24);
      return { ok: true as const, message: publicGroupMessage(msg, userId, data) };
    }
    const ciphertext = typeof payload.ciphertext === "string" ? payload.ciphertext.trim() : "";
    const nonce = typeof payload.nonce === "string" ? payload.nonce.trim() : "";
    if (payload.enc !== "e2ee-v1" || ciphertext.length < 8 || nonce.length < 8 || !B64.test(ciphertext) || !B64.test(nonce)) {
      return { ok: false as const, error: "فقط پاکت رمزنگاری‌شده پذیرفته می‌شود.", status: 400 };
    }
    if (kind === "photo" || kind === "video" || kind === "file") {
      const flim = hitRateLimit(data, `file:up:${userId}`, 60_000, 24, now);
      if (!flim.allowed) return { ok: false as const, error: "ارسال فایل پیاپی محدود شد.", status: 429 };
      const cap = group.fileMaxBytes && group.fileMaxBytes > 0 ? Math.min(group.fileMaxBytes, 28 * 1024 * 1024) : 28 * 1024 * 1024;
      if (typeof payload.byteLength === "number" && payload.byteLength > cap) {
        return { ok: false as const, error: "حجم فایل از سقف این گروه بیشتر است.", status: 413 };
      }
      if (kind === "file") {
        const ext = typeof payload.fileExt === "string" ? payload.fileExt.replace(/^\./, "").toLowerCase().slice(0, 8) : "";
        const named = scanNamedFile(ext ? `file.${ext}` : "file.bin", "application/octet-stream", payload.byteLength ?? 0);
        if (!named.ok) return { ok: false as const, error: named.warning ?? "نوع فایل مجاز نیست.", status: 400 };
        if (!declaredExtAllowed(group.allowedFileExts, ext)) {
          return { ok: false as const, error: "این فرمت در قوانین این گروه مجاز نیست.", status: 403 };
        }
      }
      const blobId = typeof payload.blobId === "string" ? payload.blobId : "";
      if (!/^[a-f0-9]{8,64}$/i.test(blobId)) return { ok: false as const, error: "شناسه فایل نامعتبر است.", status: 400 };
      const dup = data.groupMessages.find(
        (m) => m.groupId === groupId && m.senderKey === userId && m.blobId === blobId && !m.deleted && now - m.createdAt < 180_000,
      );
      if (dup) return { ok: true as const, message: publicGroupMessage(dup, userId, data) };
    }
    if (kind === "voice") {
      const d = validateVoiceDuration(payload.durationMs);
      if (!d.ok) return { ok: false as const, error: d.error, status: 400 };
      const vlim = hitRateLimit(data, `voice:up:${userId}`, 60_000, VOICE_SEND_PER_MIN, now);
      if (!vlim.allowed) return { ok: false as const, error: "ارسال صوت پیاپی محدود شد.", status: 429 };
      const dup = data.groupMessages.find(
        (m) =>
          m.groupId === groupId &&
          m.senderKey === userId &&
          m.nonce === nonce &&
          m.ciphertext === ciphertext &&
          m.kind === "voice" &&
          !m.deleted &&
          now - m.createdAt < 120_000,
      );
      if (dup) return { ok: true as const, message: publicGroupMessage(dup, userId, data) };
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
      tags: Array.isArray(payload.tags)
        ? payload.tags.map((t) => t.replace(/^#/, "").slice(0, 32)).filter(Boolean).slice(0, 8)
        : [],
      reactions: [],
      blobId: payload.blobId,
      chunkCount: payload.chunkCount,
      byteLength: payload.byteLength,
      durationMs: kind === "voice" ? payload.durationMs : undefined,
      clientNonce: clientNonce || undefined,
    };
    data.groupMessages.push(msg);
    group.updatedAt = now;
    me.lastSentAt = now;
    for (const member of group.members) {
      if (member.leftAt || member.key === userId || member.kind !== "user") continue;
      const mentioned = (msg.mentions ?? []).includes(member.key);
      const replied =
        Boolean(msg.replyToId) &&
        data.groupMessages.some((g) => g.id === msg.replyToId && g.senderKey === member.key);
      if (member.notifyMutedUntil && member.notifyMutedUntil > now && !mentioned && !replied) continue;
      if (mentioned && member.notifyMentions === false) continue;
      const kind = mentioned ? "mention" : replied ? "reply" : "group_message";
      emitNotification(data, {
        userId: member.key,
        category: "groups",
        kind,
        title: group.name,
        senderName: me.name,
        body: mentioned ? `@${member.name} در ${group.name}` : "پیام جدید در گروه",
        e2ee: true,
        mention: mentioned,
        reply: replied,
        sourceId: `group:${group.id}:${userId}`,
        muteType: "group",
        muteId: group.id,
        target: { type: "group", id: group.id, href: "/app" },
      });
    }
    return { ok: true as const, message: publicGroupMessage(msg, userId, data) };
  });
}

export async function reactToMessage(
  userId: string,
  groupId: string,
  messageId: string,
  emoji: string,
  extra?: { intent?: ReactionIntent; clientNonce?: string },
) {
  return mutateStore((data) => {
    const nonce = typeof extra?.clientNonce === "string" ? extra.clientNonce.trim().slice(0, 80) : "";
    const nonceKey = nonce.length >= 8 ? `g:${userId}:${groupId}:${messageId}:${nonce}` : null;
    const group = data.groups.find((g) => g.id === groupId && !g.deletedAt);
    const me = group ? findMember(group, userId) : undefined;
    if (!group || !me) return { ok: false as const, error: "اجازه نداری.", status: 403 };
    if (group.reactionsEnabled === false) return { ok: false as const, error: "واکنش در این گروه خاموش است.", status: 403 };
    if (!permsOf(group).sendReactions && rankRole(me.role) < 2) {
      return { ok: false as const, error: "واکنش در این گروه محدود است.", status: 403 };
    }
    const msg = data.groupMessages.find((m) => m.id === messageId && m.groupId === groupId);
    if (!msg) return { ok: false as const, error: "پیام یافت نشد.", status: 404 };
    const replay = replayReactionNonce(data, nonceKey);
    if (replay) {
      return { ok: true as const, reactions: publicReactionView(data, msg.reactions, userId), action: replay.action, idempotent: true as const };
    }
    const limit = hitRateLimit(data, `react:${userId}`, 60_000, 40);
    if (!limit.allowed) return { ok: false as const, error: "واکنش محدود شد.", status: 429 };
    const flood = hitRateLimit(data, `reactflood:${userId}`, 8_000, 12);
    if (!flood.allowed) return { ok: false as const, error: "ارسال پیاپی واکنش محدود شد.", status: 429 };
    const allowed = allowedReactionSet(group.allowedReactions);
    const applied = applyUserReaction(msg.reactions, userId, emoji, allowed, { intent: extra?.intent });
    if (!applied.ok) return { ok: false as const, error: applied.error, status: 400 };
    msg.reactions = applied.rows;
    putReactionCache(data, `g:${groupId}:${messageId}`, applied.rows);
    if (nonceKey) rememberReactionNonce(data, nonceKey, applied.action);
    prefsOf(data, userId).emojiRecent = [emoji.trim().slice(0, 24), ...prefsOf(data, userId).emojiRecent.filter((e) => e !== emoji)].slice(0, 32);
    if (applied.action !== "remove" && applied.action !== "noop" && msg.senderKey !== userId && msg.senderKey !== "system") {
      const lock = data.notifyPrefs?.find((p) => p.userId === msg.senderKey);
      emitNotification(data, {
        userId: msg.senderKey,
        category: "groups",
        kind: "reaction",
        title: lock?.lockScreen === "hidden" ? "NIXO" : group.name,
        senderName: lock?.lockScreen === "hidden" ? "NIXO" : findMember(group, userId)?.name || "عضو",
        body: lock?.lockScreen === "hidden" ? "" : "واکنش جدید",
        e2ee: true,
        sourceId: `greact:${group.id}:${messageId}`,
        muteType: "group",
        muteId: group.id,
        target: { type: "group", id: group.id },
      });
    }
    return { ok: true as const, reactions: publicReactionView(data, msg.reactions, userId), action: applied.action };
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
    if (!(me.role === "owner" || adminCan(group, me, "pinMessages") || group.perms.pinMessages || customFlag(group, me, "pinMessages"))) {
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

export async function editGroupMessage(
  userId: string,
  groupId: string,
  messageId: string,
  patch: { ciphertext?: string; nonce?: string },
) {
  return mutateStore((data) => {
    const group = data.groups.find((g) => g.id === groupId && !g.deletedAt);
    if (!group) return { ok: false as const, error: "گروه یافت نشد.", status: 404 };
    const me = findMember(group, userId);
    if (!me) return { ok: false as const, error: "عضو نیستی.", status: 403 };
    const msg = data.groupMessages.find((m) => m.id === messageId && m.groupId === groupId && !m.deleted);
    if (!msg) return { ok: false as const, error: "پیام یافت نشد.", status: 404 };
    if (msg.senderKey !== userId) return { ok: false as const, error: "فقط فرستنده می‌تواند ویرایش کند.", status: 403 };
    if (msg.kind === "system" || msg.enc !== "e2ee-v1") {
      return { ok: false as const, error: "این پیام قابل ویرایش نیست.", status: 400 };
    }
    if (Date.now() - msg.createdAt > 15 * 60_000) {
      return { ok: false as const, error: "مهلت ویرایش تمام شده است.", status: 403 };
    }
    const ciphertext = typeof patch.ciphertext === "string" ? patch.ciphertext.trim() : "";
    const nonce = typeof patch.nonce === "string" ? patch.nonce.trim() : "";
    if (ciphertext.length < 8 || nonce.length < 8) {
      return { ok: false as const, error: "پاکت ویرایش نامعتبر است.", status: 400 };
    }
    msg.ciphertext = ciphertext;
    msg.nonce = nonce;
    msg.editedAt = Date.now();
    return { ok: true as const, message: publicGroupMessage(msg, userId, data) };
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
    if (msg.senderKey !== userId && !canModContent(me, group)) {
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
    if (m.tags?.some((t) => t.toLowerCase().includes(needle) || `#${t}`.toLowerCase().includes(needle))) return true;
    if (m.kind === "poll") return (m.poll?.question ?? "").toLowerCase().includes(needle);
    return m.kind === "photo" || m.kind === "video" || m.kind === "file" || m.kind === "voice"
      ? needle === m.kind || ["عکس", "ویدیو", "فایل", "صوت", "photo", "video", "file", "voice", "link"].some((k) => k.includes(needle) || needle.includes(k))
      : false;
  });
  return { messages: hits.slice(-50) };
}
