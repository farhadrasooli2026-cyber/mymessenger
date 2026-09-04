import "server-only";
import { hmacIdentifier, randomId } from "@/lib/crypto-utils";
import { normalizeEmail, normalizePhone } from "@/lib/identifiers";
import { hitRateLimit } from "@/lib/rate-limit";
import { bumpDiscoveryCaches, mutateStore, readStoreSnapshot } from "@/lib/store";
import { publishChatLive } from "@/lib/chat-live";
import type { StoreData, UserRecord } from "@/lib/store";
import type { Visibility, Visibility3 } from "@/lib/profile-types";
import { SEED_PEERS } from "@/lib/chat-copy";

export const ONLINE_MS = 90_000;

export function audienceAllows(
  visibility: Visibility | Visibility3,
  contactIds: string[],
  allowIds: string[],
  viewerId?: string | null,
  friendIds?: string[],
): boolean {
  if (viewerId && allowIds.includes(viewerId)) return true;
  if (visibility === "everyone") return true;
  if (visibility === "nobody") return false;
  if (!viewerId) return false;
  if (visibility === "friends") return (friendIds ?? []).includes(viewerId);
  if (visibility === "contacts") return contactIds.includes(viewerId);
  return allowIds.includes(viewerId);
}

export function canFindByUsername(data: StoreData, target: UserRecord, viewerId: string) {
  if (target.id === viewerId) return true;
  if (target.status !== "active") return false;
  if (target.accountStatus && target.accountStatus !== "active") return false;
  if (pairBlocked(data, viewerId, target.id)) return false;
  return audienceAllows(target.privacyFindUsername, target.contactIds, target.findUsernameAllowIds, viewerId);
}

export function pairBlocked(data: StoreData, a: string, b: string) {
  const ua = data.users.find((u) => u.id === a);
  const ub = data.users.find((u) => u.id === b);
  return Boolean(ua?.blockedPeerKeys.includes(b) || ub?.blockedPeerKeys.includes(a));
}

function seedPeer(key: string) {
  return SEED_PEERS.some((p) => p.peerKey === key);
}

export function canInteractWith(data: StoreData, actorId: string, targetId: string) {
  if (seedPeer(targetId) || seedPeer(actorId)) return true;
  if (actorId === targetId) return true;
  return !pairBlocked(data, actorId, targetId);
}

export function canMessageUser(data: StoreData, fromId: string, toPeerKey: string) {
  if (seedPeer(toPeerKey)) return true;
  const target = data.users.find((u) => u.id === toPeerKey);
  if (!target) return true;
  if (!canInteractWith(data, fromId, toPeerKey)) return false;
  return audienceAllows(target.privacyMessages, target.contactIds, target.messageAllowIds, fromId, target.friendIds);
}

export function canAddToGroup(data: StoreData, actorId: string, targetId: string) {
  if (seedPeer(targetId)) return true;
  const target = data.users.find((u) => u.id === targetId);
  if (!target) return false;
  if (!canInteractWith(data, actorId, targetId)) return false;
  return audienceAllows(target.privacyGroups, target.contactIds, target.groupAllowIds, actorId, target.friendIds);
}

export function canAddToCommunity(data: StoreData, actorId: string, targetId: string) {
  if (seedPeer(targetId)) return true;
  const target = data.users.find((u) => u.id === targetId);
  if (!target) return false;
  if (!canInteractWith(data, actorId, targetId)) return false;
  return audienceAllows(target.privacyCommunities, target.contactIds, target.communityAllowIds, actorId, target.friendIds);
}

export function canChannelInvite(data: StoreData, actorId: string, targetId: string) {
  if (seedPeer(targetId)) return true;
  const target = data.users.find((u) => u.id === targetId);
  if (!target) return false;
  if (!canInteractWith(data, actorId, targetId)) return false;
  return audienceAllows(target.privacyChannels, target.contactIds, target.channelAllowIds, actorId, target.friendIds);
}

export function snapshotPrivacy(user: UserRecord) {
  return {
    privacyPhone: user.privacyPhone,
    privacyFindPhone: user.privacyFindPhone,
    privacyEmail: user.privacyEmail,
    privacyFindUsername: user.privacyFindUsername,
    phoneAllowIds: user.phoneAllowIds,
    emailAllowIds: user.emailAllowIds,
    findPhoneAllowIds: user.findPhoneAllowIds,
    findUsernameAllowIds: user.findUsernameAllowIds,
    privacyPhoto: user.privacyPhoto,
    privacyBio: user.privacyBio,
    photoAllowIds: user.photoAllowIds,
    bioAllowIds: user.bioAllowIds,
    privacyLastSeen: user.privacyLastSeen,
    lastSeenAllowIds: user.lastSeenAllowIds,
    privacyOnline: user.privacyOnline,
    onlineAllowIds: user.onlineAllowIds,
    readReceipts: user.readReceipts,
    showTyping: user.showTyping,
    showVoiceRecording: user.showVoiceRecording,
    callPrivacy: user.callPrivacy,
    callAllowIds: user.callAllowIds,
    privacyMessages: user.privacyMessages,
    messageAllowIds: user.messageAllowIds,
    privacyGroups: user.privacyGroups,
    groupAllowIds: user.groupAllowIds,
    privacyCommunities: user.privacyCommunities,
    communityAllowIds: user.communityAllowIds,
    privacyChannels: user.privacyChannels,
    channelAllowIds: user.channelAllowIds,
    defaultStoryPrivacy: user.defaultStoryPrivacy,
    restrictForward: user.restrictForward,
    restrictSave: user.restrictSave,
    restrictShare: user.restrictShare,
    contactSyncEnabled: user.contactSyncEnabled,
    syncedCount: user.syncedContactHashes.length,
    contactOsPermission: user.contactOsPermission,
    contactNotifyJoin: user.contactNotifyJoin,
    contactAutoSync: Boolean(user.contactAutoSync),
    contactSyncStatus: user.contactSyncStatus ?? "idle",
    contactLastSyncAt: user.contactLastSyncAt ?? 0,
    privacyFollow: user.privacyFollow ?? "everyone",
    hideFollowers: Boolean(user.hideFollowers),
    hideFollowing: Boolean(user.hideFollowing),
    privacyFriends: user.privacyFriends ?? "friends",
    privacyFriendCount: user.privacyFriendCount ?? "friends",
    friendCount: (user.friendIds ?? []).length,
    mutedPeerKeys: user.mutedPeerKeys ?? [],
    privacyBirthday: user.privacyBirthday ?? "nobody",
    privacyMentions: user.privacyMentions ?? "everyone",
    privacyStoryMentions: user.privacyStoryMentions ?? "everyone",
    mentionAllowIds: user.mentionAllowIds,
    birthdayAllowIds: user.birthdayAllowIds,
    storyMentionAllowIds: user.storyMentionAllowIds,
    restrictedPeerKeys: user.restrictedPeerKeys ?? [],
  };
}

export function privacyCheckup(user: UserRecord) {
  const items = [
    { id: "photo", label: "عکس پروفایل", value: user.privacyPhoto, warn: user.privacyPhoto === "everyone" },
    { id: "bio", label: "بیو", value: user.privacyBio, warn: user.privacyBio === "everyone" },
    { id: "phone", label: "شماره تلفن", value: user.privacyPhone, warn: user.privacyPhone === "everyone" },
    { id: "findPhone", label: "پیدا شدن با شماره", value: user.privacyFindPhone, warn: user.privacyFindPhone === "everyone" },
    { id: "findUsername", label: "پیدا شدن با نام کاربری", value: user.privacyFindUsername, warn: user.privacyFindUsername === "everyone" },
    { id: "email", label: "ایمیل", value: user.privacyEmail, warn: user.privacyEmail === "everyone" },
    { id: "lastSeen", label: "آخرین بازدید", value: user.privacyLastSeen, warn: user.privacyLastSeen === "everyone" },
    { id: "online", label: "آنلاین", value: user.privacyOnline, warn: user.privacyOnline === "everyone" },
    { id: "messages", label: "پیام مستقیم", value: user.privacyMessages, warn: user.privacyMessages === "everyone" },
    { id: "calls", label: "تماس", value: user.callPrivacy, warn: user.callPrivacy === "everyone" },
    { id: "groups", label: "افزودن به گروه", value: user.privacyGroups, warn: user.privacyGroups === "everyone" },
    { id: "mentions", label: "منشن", value: user.privacyMentions ?? "everyone", warn: (user.privacyMentions ?? "everyone") === "everyone" },
    { id: "follow", label: "Follow", value: user.privacyFollow ?? "everyone", warn: (user.privacyFollow ?? "everyone") === "everyone" },
    { id: "friends", label: "فهرست دوستان", value: user.privacyFriends ?? "friends", warn: (user.privacyFriends ?? "friends") === "everyone" },
    { id: "friendCount", label: "تعداد دوستان", value: user.privacyFriendCount ?? "friends", warn: (user.privacyFriendCount ?? "friends") === "everyone" },
  ];
  return items;
}

export async function getPrivacy(userId: string) {
  return mutateStore((data) => {
    const me = data.users.find((u) => u.id === userId);
    if (!me) return null;
    me.lastSeenAt = Date.now();
    const people = data.users
      .filter((u) => u.id !== userId && u.status === "active")
      .map((u) => ({ id: u.id, name: u.displayName || u.username || "کاربر", username: u.username ?? null }));
    return {
      settings: snapshotPrivacy(me),
      checkup: privacyCheckup(me),
      people,
      blocked: me.blockedPeerKeys,
      muted: me.mutedPeerKeys ?? [],
      restricted: me.restrictedPeerKeys ?? [],
    };
  });
}

const vis3 = (v: unknown): Visibility3 | undefined =>
  v === "everyone" || v === "contacts" || v === "nobody" ? v : undefined;
const vis4 = (v: unknown): Visibility | undefined =>
  v === "everyone" || v === "contacts" || v === "friends" || v === "nobody" || v === "selected" ? v : undefined;
const ids = (v: unknown) => (Array.isArray(v) ? v.map(String).slice(0, 80) : undefined);

export async function updatePrivacy(userId: string, patch: Record<string, unknown>) {
  return mutateStore((data) => {
    const me = data.users.find((u) => u.id === userId);
    if (!me) return { ok: false as const, error: "حساب فعال نیست.", status: 401 };
    const p3 = vis3(patch.privacyPhone);
    if (p3) me.privacyPhone = p3;
    const f3 = vis3(patch.privacyFindPhone);
    if (f3) me.privacyFindPhone = f3;
    const fu = vis3(patch.privacyFindUsername);
    if (fu) me.privacyFindUsername = fu;
    const e3 = vis3(patch.privacyEmail);
    if (e3) me.privacyEmail = e3;
    const photo = vis4(patch.privacyPhoto);
    if (photo) me.privacyPhoto = photo;
    const bio = vis4(patch.privacyBio);
    if (bio) me.privacyBio = bio;
    const ls = vis4(patch.privacyLastSeen);
    if (ls) me.privacyLastSeen = ls;
    const on = vis4(patch.privacyOnline);
    if (on) me.privacyOnline = on;
    const msg = vis4(patch.privacyMessages);
    if (msg) me.privacyMessages = msg;
    const call = vis4(patch.callPrivacy);
    if (call) me.callPrivacy = call;
    const g = vis4(patch.privacyGroups);
    if (g) me.privacyGroups = g;
    const c = vis4(patch.privacyCommunities);
    if (c) me.privacyCommunities = c;
    const ch = vis4(patch.privacyChannels);
    if (ch) me.privacyChannels = ch;
    const lists: [string, keyof UserRecord][] = [
      ["phoneAllowIds", "phoneAllowIds"],
      ["emailAllowIds", "emailAllowIds"],
      ["findPhoneAllowIds", "findPhoneAllowIds"],
      ["findUsernameAllowIds", "findUsernameAllowIds"],
      ["photoAllowIds", "photoAllowIds"],
      ["bioAllowIds", "bioAllowIds"],
      ["lastSeenAllowIds", "lastSeenAllowIds"],
      ["onlineAllowIds", "onlineAllowIds"],
      ["messageAllowIds", "messageAllowIds"],
      ["callAllowIds", "callAllowIds"],
      ["groupAllowIds", "groupAllowIds"],
      ["communityAllowIds", "communityAllowIds"],
      ["channelAllowIds", "channelAllowIds"],
      ["mentionAllowIds", "mentionAllowIds"],
      ["birthdayAllowIds", "birthdayAllowIds"],
      ["storyMentionAllowIds", "storyMentionAllowIds"],
    ];
    for (const [key, field] of lists) {
      const next = ids(patch[key]);
      if (next) (me[field] as string[]) = next;
    }
    if (typeof patch.readReceipts === "boolean") me.readReceipts = patch.readReceipts;
    if (typeof patch.showTyping === "boolean") me.showTyping = patch.showTyping;
    if (typeof patch.showVoiceRecording === "boolean") me.showVoiceRecording = patch.showVoiceRecording;
    if (typeof patch.restrictForward === "boolean") me.restrictForward = patch.restrictForward;
    if (typeof patch.restrictSave === "boolean") me.restrictSave = patch.restrictSave;
    if (typeof patch.restrictShare === "boolean") me.restrictShare = patch.restrictShare;
    if (typeof patch.contactSyncEnabled === "boolean") {
      me.contactSyncEnabled = patch.contactSyncEnabled;
      if (patch.contactSyncEnabled) {
        me.contactConsentAt = Date.now();
      } else {
        wipeContactSyncData(data, userId);
      }
    }
    if (typeof patch.contactAutoSync === "boolean") me.contactAutoSync = patch.contactAutoSync;
    if (typeof patch.contactNotifyJoin === "boolean") me.contactNotifyJoin = patch.contactNotifyJoin;
    if (patch.contactOsPermission === "allow" || patch.contactOsPermission === "deny" || patch.contactOsPermission === "limited" || patch.contactOsPermission === "unknown") {
      me.contactOsPermission = patch.contactOsPermission;
    }
    const ment = vis4(patch.privacyMentions);
    if (ment) me.privacyMentions = ment;
    const bday = vis4(patch.privacyBirthday);
    if (bday) me.privacyBirthday = bday;
    const sm = vis4(patch.privacyStoryMentions);
    if (sm) me.privacyStoryMentions = sm;
    const fol = vis4(patch.privacyFollow);
    if (fol) me.privacyFollow = fol;
    const fr = vis4(patch.privacyFriends);
    if (fr) me.privacyFriends = fr;
    const fc = vis4(patch.privacyFriendCount);
    if (fc) me.privacyFriendCount = fc;
    if (typeof patch.hideFollowers === "boolean") me.hideFollowers = patch.hideFollowers;
    if (typeof patch.hideFollowing === "boolean") me.hideFollowing = patch.hideFollowing;
    if (typeof patch.locationEnabled === "boolean") me.locationEnabled = patch.locationEnabled;
    if (typeof patch.statusExpiresAt === "number" || patch.statusExpiresAt === null) {
      me.statusExpiresAt = typeof patch.statusExpiresAt === "number" ? patch.statusExpiresAt : null;
    }
    if (typeof patch.statusText === "string") me.statusText = patch.statusText.trim().slice(0, 80);
    if (
      patch.statusPreset === "" ||
      patch.statusPreset === "available" ||
      patch.statusPreset === "busy" ||
      patch.statusPreset === "work" ||
      patch.statusPreset === "away" ||
      patch.statusPreset === "custom"
    ) {
      me.statusPreset = patch.statusPreset;
    }
    me.lastSeenAt = Date.now();
    bumpDiscoveryCaches(data);
    data.audit = [
      {
        id: randomId(),
        userId,
        kind: "privacy" as const,
        createdAt: Date.now(),
        detail: "تغییر تنظیمات حریم خصوصی",
      },
      ...(data.audit ?? []),
    ].slice(0, 400);
    return { ok: true as const, settings: snapshotPrivacy(me), checkup: privacyCheckup(me) };
  });
}

export async function viewPresence(viewerId: string, targetId: string) {
  const data = await readStoreSnapshot();
  const target = data.users.find((u) => u.id === targetId);
  if (!target) return { ok: false as const, error: "کاربر یافت نشد.", status: 404 };
  if (pairBlocked(data, viewerId, targetId) && viewerId !== targetId) {
    return { ok: false as const, error: "در دسترس نیست.", status: 404 };
  }
  const now = Date.now();
  const lastSeen = audienceAllows(target.privacyLastSeen, target.contactIds, target.lastSeenAllowIds, viewerId, target.friendIds)
    ? target.lastSeenAt
    : null;
  const online =
    audienceAllows(target.privacyOnline, target.contactIds, target.onlineAllowIds, viewerId, target.friendIds) &&
    now - target.lastSeenAt < ONLINE_MS;
  const typing =
    target.showTyping &&
    target.typingUntil > now &&
    (viewerId === targetId || Boolean(target.typingThreadId));
  const recording = target.showVoiceRecording && target.recordingUntil > now;
  return {
    ok: true as const,
    lastSeen,
    online: online || false,
    typing: Boolean(typing),
    recording: Boolean(recording),
    readReceipts: target.readReceipts,
    restrictForward: target.restrictForward,
    restrictSave: target.restrictSave,
    restrictShare: target.restrictShare,
  };
}

export async function setPresence(
  userId: string,
  patch: { typingThreadId?: string; typing?: boolean; recording?: boolean },
) {
  const result = await mutateStore((data) => {
    const me = data.users.find((u) => u.id === userId);
    if (!me) return { ok: false as const, error: "حساب فعال نیست.", status: 401 };
    const now = Date.now();
    me.lastSeenAt = now;
    let live: { userId: string; threadId: string } | null = null;
    if (patch.typing === false) {
      me.typingUntil = 0;
      me.typingThreadId = "";
    } else if (patch.typing && me.showTyping && !me.prefs?.ghostMode) {
      me.typingUntil = now + 8_000;
      me.typingThreadId = String(patch.typingThreadId ?? "");
      const thread = data.threads.find((t) => t.id === me.typingThreadId && t.ownerUserId === userId);
      if (thread) {
        const peerThread = data.threads.find((t) => t.ownerUserId === thread.peerKey && t.peerKey === userId);
        if (peerThread) live = { userId: thread.peerKey, threadId: peerThread.id };
      }
    }
    if (patch.recording === false) me.recordingUntil = 0;
    else if (patch.recording && me.showVoiceRecording) me.recordingUntil = now + 20_000;
    return { ok: true as const, live };
  });
  if (result.ok && result.live) {
    publishChatLive(result.live.userId, result.live.threadId, "typing");
  }
  return result;
}

export async function findByIdentifier(viewerId: string, raw: string) {
  return mutateStore((data) => {
    const flood = hitRateLimit(data, `findid:${viewerId}`, 60_000, 20, Date.now());
    if (!flood.allowed) return { ok: false as const, error: "جستجو محدود شد.", status: 429 };
    const phone = normalizePhone(raw);
    const email = normalizeEmail(raw);
    const normalized = phone ?? email;
    if (!normalized) return { ok: true as const, user: null };
    const hash = hmacIdentifier(normalized);
    const found = data.users.find((u) => u.status === "active" && u.identifierHash === hash);
    if (!found || found.id === viewerId) return { ok: true as const, user: null };
    if (pairBlocked(data, viewerId, found.id)) return { ok: true as const, user: null };
    const vis = phone ? found.privacyFindPhone : found.privacyEmail;
    const allow = phone ? found.findPhoneAllowIds : found.emailAllowIds;
    if (!audienceAllows(vis, found.contactIds, allow, viewerId)) return { ok: true as const, user: null };
    return {
      ok: true as const,
      user: { id: found.id, username: found.username ?? null, displayName: found.displayName || found.username || "کاربر" },
    };
  });
}

export async function syncContacts(userId: string, hashes: string[], identifiers?: string[]) {
  return mutateStore((data) => {
    const me = data.users.find((u) => u.id === userId);
    if (!me) return { ok: false as const, error: "حساب فعال نیست.", status: 401 };
    if (!me.contactSyncEnabled) return { ok: false as const, error: "همگام‌سازی مخاطب خاموش است.", status: 403 };
    if (me.contactOsPermission === "deny") {
      return { ok: false as const, error: "مجوز مخاطبین گوشی رد شده است.", status: 403 };
    }
    const flood = hitRateLimit(data, `cthash:${userId}`, 60_000, 6);
    if (!flood.allowed) {
      me.contactSyncStatus = "failed";
      me.contactSyncError = "همگام‌سازی محدود شد.";
      me.contactSyncRetries = Math.min(8, (me.contactSyncRetries ?? 0) + 1);
      return { ok: false as const, error: "همگام‌سازی محدود شد.", status: 429 };
    }
    if ((me.contactSyncRetries ?? 0) >= 8) {
      me.contactSyncStatus = "failed";
      me.contactSyncError = "تعداد تلاش مجدد به سقف رسید.";
      return { ok: false as const, error: "تعداد تلاش مجدد به سقف رسید.", status: 429 };
    }
    me.contactSyncStatus = "syncing";
    const fromIds = (identifiers ?? [])
      .slice(0, 200)
      .map((raw) => normalizePhone(String(raw)) ?? normalizeEmail(String(raw)))
      .filter((v): v is string => Boolean(v))
      .map((n) => hmacIdentifier(n));
    const incoming = [...hashes.map(String).filter((h) => /^[a-f0-9]{16,64}$/i.test(h)), ...fromIds];
    me.syncedContactHashes = [...new Set([...(me.syncedContactHashes ?? []), ...incoming])].slice(0, 400);
    const matches = data.users.filter(
      (u) =>
        u.id !== userId &&
        u.status === "active" &&
        me.syncedContactHashes.includes(u.identifierHash) &&
        audienceAllows(
          u.channel === "email" ? u.privacyEmail : u.privacyFindPhone,
          u.contactIds,
          u.channel === "email" ? u.emailAllowIds : u.findPhoneAllowIds,
          userId,
        ) &&
        !pairBlocked(data, userId, u.id),
    );
    me.contactSyncStatus = "completed";
    me.contactSyncError = "";
    me.contactLastSyncAt = Date.now();
    me.contactSyncRetries = 0;
    me.contactSyncCursor = Date.now();
    data.audit = [
      { id: `ctsy-${Date.now()}`, userId, kind: "suspicious" as const, createdAt: Date.now(), detail: `contact-hash-sync n=${incoming.length}` },
      ...(data.audit ?? []),
    ].slice(0, 400);
    return {
      ok: true as const,
      syncedCount: me.syncedContactHashes.length,
      matches: matches.map((u) => ({
        id: u.id,
        username: u.username ?? null,
        displayName: u.displayName || u.username || "کاربر",
      })),
    };
  });
}

export function wipeContactSyncData(data: StoreData, userId: string) {
  const me = data.users.find((u) => u.id === userId);
  if (!me) return;
  me.syncedContactHashes = [];
  me.contactSyncEnabled = false;
  me.contactAutoSync = false;
  me.contactSyncStatus = "idle";
  me.contactSyncError = "";
  me.contactSyncCursor = 0;
  me.contactSyncRetries = 0;
  data.contacts = (data.contacts ?? []).filter((c) => !(c.ownerUserId === userId && c.source === "sync"));
}

export async function clearSyncedContacts(userId: string) {
  return mutateStore((data) => {
    const me = data.users.find((u) => u.id === userId);
    if (!me) return { ok: false as const, error: "حساب فعال نیست.", status: 401 };
    wipeContactSyncData(data, userId);
    data.audit = [
      { id: `ctcl-${Date.now()}`, userId, kind: "suspicious" as const, createdAt: Date.now(), detail: "contact-sync-cleared" },
      ...(data.audit ?? []),
    ].slice(0, 400);
    return { ok: true as const };
  });
}

export async function requestDeletion(userId: string) {
  return mutateStore((data) => {
    const me = data.users.find((u) => u.id === userId);
    if (!me) return { ok: false as const, error: "حساب فعال نیست.", status: 401 };
    me.deletionRequestedAt = Date.now();
    return { ok: true as const, deletionRequestedAt: me.deletionRequestedAt };
  });
}

export async function setBlockedPeer(userId: string, peerKey: string, blocked: boolean) {
  return mutateStore((data) => {
    const me = data.users.find((u) => u.id === userId);
    if (!me) return { ok: false as const, error: "حساب فعال نیست.", status: 401 };
    const key = peerKey.trim();
    if (!key || key === userId) return { ok: false as const, error: "کاربر نامعتبر است.", status: 400 };
    const flood = hitRateLimit(data, `blockop:${userId}`, 60 * 60_000, 40);
    if (!flood.allowed) return { ok: false as const, error: "مسدودسازی محدود شد.", status: 429 };
    const burst = hitRateLimit(data, `block-burst:${userId}`, 10 * 60_000, 12);
    if (!burst.allowed) {
      data.audit = [
        { id: `blkf-${Date.now()}`, userId, kind: "suspicious" as const, createdAt: Date.now(), detail: "block-flood" },
        ...(data.audit ?? []),
      ].slice(0, 400);
      return { ok: false as const, error: "مسدودسازی محدود شد.", status: 429 };
    }
    if (blocked) {
      if (!me.blockedPeerKeys.includes(key)) me.blockedPeerKeys.push(key);
      me.friendIds = (me.friendIds ?? []).filter((id) => id !== key);
      const peer = data.users.find((u) => u.id === key);
      if (peer) peer.friendIds = (peer.friendIds ?? []).filter((id) => id !== userId);
      data.follows = (data.follows ?? []).filter(
        (f) => !((f.followerId === userId && f.followeeId === key) || (f.followerId === key && f.followeeId === userId)),
      );
      data.friendships = (data.friendships ?? []).filter(
        (f) => !((f.userA === userId && f.userB === key) || (f.userA === key && f.userB === userId)),
      );
      for (const r of data.contactRequests ?? []) {
        if (r.status === "pending" && ((r.fromUserId === userId && r.toUserId === key) || (r.toUserId === userId && r.fromUserId === key))) {
          r.status = "blocked";
          r.updatedAt = Date.now();
        }
      }
      const now = Date.now();
      for (const c of data.calls ?? []) {
        const pair = (c.ownerUserId === userId && c.peerKey === key) || (c.ownerUserId === key && c.peerKey === userId);
        if (pair && (c.status === "ringing" || c.status === "active" || c.status === "queued")) {
          c.status = "ended";
          c.endedAt = now;
          c.endReason = "declined";
        }
      }
      me.relationshipRev = (me.relationshipRev ?? 0) + 1;
      if (peer) peer.relationshipRev = (peer.relationshipRev ?? 0) + 1;
    } else {
      me.blockedPeerKeys = me.blockedPeerKeys.filter((k) => k !== key);
      me.relationshipRev = (me.relationshipRev ?? 0) + 1;
    }
    bumpDiscoveryCaches(data);
    data.audit = [
      { id: `blk-${Date.now()}`, userId, kind: "suspicious" as const, createdAt: Date.now(), detail: blocked ? "block" : "unblock" },
      ...(data.audit ?? []),
    ].slice(0, 400);
    return { ok: true as const, blockedPeerKeys: me.blockedPeerKeys };
  });
}

export async function setMutedPeer(userId: string, peerKey: string, muted: boolean) {
  return mutateStore((data) => {
    const me = data.users.find((u) => u.id === userId);
    if (!me) return { ok: false as const, error: "حساب فعال نیست.", status: 401 };
    const key = peerKey.trim();
    if (!key || key === userId) return { ok: false as const, error: "کاربر نامعتبر است.", status: 400 };
    me.mutedPeerKeys = me.mutedPeerKeys ?? [];
    if (muted) {
      if (!me.mutedPeerKeys.includes(key)) me.mutedPeerKeys.push(key);
    } else {
      me.mutedPeerKeys = me.mutedPeerKeys.filter((id) => id !== key);
    }
    bumpDiscoveryCaches(data);
    data.audit = [
      { id: randomId(), userId, kind: "privacy" as const, createdAt: Date.now(), detail: muted ? "mute" : "unmute" },
      ...(data.audit ?? []),
    ].slice(0, 400);
    return { ok: true as const, muted: me.mutedPeerKeys };
  });
}

export async function setRestrictedPeer(userId: string, peerKey: string, restricted: boolean) {
  return mutateStore((data) => {
    const me = data.users.find((u) => u.id === userId);
    if (!me) return { ok: false as const, error: "حساب فعال نیست.", status: 401 };
    const key = peerKey.trim();
    if (!key || key === userId) return { ok: false as const, error: "کاربر نامعتبر است.", status: 400 };
    me.restrictedPeerKeys = me.restrictedPeerKeys ?? [];
    if (restricted) {
      if (!me.restrictedPeerKeys.includes(key)) me.restrictedPeerKeys.push(key);
    } else {
      me.restrictedPeerKeys = me.restrictedPeerKeys.filter((id) => id !== key);
    }
    bumpDiscoveryCaches(data);
    data.audit = [
      { id: randomId(), userId, kind: "privacy" as const, createdAt: Date.now(), detail: restricted ? "restrict" : "unrestrict" },
      ...(data.audit ?? []),
    ].slice(0, 400);
    return { ok: true as const, restricted: me.restrictedPeerKeys };
  });
}
