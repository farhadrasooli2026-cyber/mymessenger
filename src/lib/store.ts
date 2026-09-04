import "server-only";
import { mkdir, readFile, unlink, writeFile } from "node:fs/promises";
import path from "node:path";
import type { Channel } from "@/lib/identifiers";
import type { CatalogCategory, CatalogItem, UserPhoto, UsernameChange, Visibility } from "@/lib/profile-types";
import { defaultUserFields } from "@/lib/profile-types";
import type { CustomGroupRole, GroupAdminPerms, GroupHistoryMode, GroupPerms, GroupRole } from "@/lib/group-types";
import type { LivePrefs, LiveRecordingMeta, LiveStream } from "@/lib/live-types";
import { DEFAULT_GROUP_ADMIN_PERMS, DEFAULT_GROUP_PERMS } from "@/lib/group-types";
import type { CommunityPerms, CommunityRole, NotifyMode } from "@/lib/community-types";
import { DEFAULT_COMMUNITY_PERMS } from "@/lib/community-types";
import type { ChannelAdminPerms, ChannelNotify, ChannelPostKind, ChannelPostStatus, ChannelStaffRole } from "@/lib/channel-types";
import { DEFAULT_CHANNEL_ADMIN_PERMS } from "@/lib/channel-types";
import { DEFAULT_CATEGORIES, seedCatalogItems } from "@/lib/avatar-catalog";
import { BG_CATEGORIES, seedBackgroundItems } from "@/lib/background-catalog";
import { randomId } from "@/lib/crypto-utils";
import type {
  BotAccessLog,
  BotChat,
  BotIdempotency,
  BotJob,
  BotKvItem,
  BotLog,
  BotMessage,
  BotPlacement,
  BotRecord,
  BotReview,
  BotUpdate,
  BotWebhookJob,
  MiniAppRecord,
  MiniGrant,
  MiniReview,
  MiniSession,
  MiniAccessLog,
} from "@/lib/bot-types";
import type { AiChatRecord, AiLog, AiMemoryItem, AiMessageRecord, AiPrefs } from "@/lib/ai-types";
import { emptyAiPersist, hydrateAiPersist, pruneAiPersist, type AiPersist } from "@/lib/ai-persist";
import type {
  BusinessRecord,
  BusinessStaff,
  BizCart,
  BizMessage,
  BizOrder,
  BizProduct,
  BizQuickReply,
  BizThread,
} from "@/lib/business-types";
import type {
  CouponRecord,
  DisputeRecord,
  InvoiceRecord,
  LedgerTx,
  PaymentRecord,
  RefundRecord,
  SettlementRecord,
  ShopAudit,
  ShopNotice,
  ShopRecord,
  UserAddress,
  WalletRecord,
} from "@/lib/shop-types";
import type { NotifyAudit, NotifyDeadLetter, NotifyPrefs, NotifyRecord, PushJob, PushToken } from "@/lib/notify-types";
import type { SearchDoc, SearchIndexJob, SearchMetrics, SearchQueryCache, SearchTombstone } from "@/lib/search-types";
import type { SecurityMetrics } from "@/lib/security-core";
import { emptySecurityMetrics } from "@/lib/security-core";
import { emptyAdminMetrics } from "@/lib/admin-types";
import { emptyMonitorPersist, hydrateMonitorPersist, type MonitorPersist } from "@/lib/monitor-types";
import { emptyDrPersist, hydrateDrPersist, type DrPersist } from "@/lib/dr-types";
import { rememberPlatformMode } from "@/lib/dr-mode";
import { emptyPerfPersist, hydratePerfPersist, type PerfPersist } from "@/lib/perf-types";
import { setShedLevel } from "@/lib/perf-mode";
import { emptyDeployPersist, hydrateDeployPersist, type DeployPersist } from "@/lib/deploy-types";
import { emptyI18nPersist, hydrateI18nPersist, type I18nPersist } from "@/lib/i18n/persist";
import { emptyBiPersist, hydrateBiPersist, purgeBiSubjectFromPersist, type BiPersist } from "@/lib/bi-persist";
import { emptyBillingPersist, hydrateBillingPersist, type BillingPersist } from "@/lib/billing-persist";
import { anonymizeBilling, syncBillingLifecycle } from "@/lib/billing-access";
import { emptyProdPersist, hydrateProdPersist, type ProdPersist } from "@/lib/prod-persist";
import { emptyCloudPersist, hydrateCloudPersist, type CloudPersist } from "@/lib/cloud-persist";
import { emptyEdgePersist, hydrateEdgePersist, type EdgePersist } from "@/lib/edge-persist";
import { emptyGraphPersist, hydrateGraphPersist, pruneGraphPersist, purgeGraphSubject, type GraphPersist } from "@/lib/graph-types";
import { currentDeployEnv } from "@/lib/env-config";
import { loadPersistedJson, persistMode, savePersistedJson, withPostgresDocument } from "@/lib/persist";
import { dataDir } from "@/lib/data-dir";
import type {
  AdminAlert,
  AdminAuditRow,
  AdminMetrics,
  AdminSessionRow,
  AccountWarning,
  AutoModFlag,
  ContentTombstone,
  ModerationAppeal,
  ModerationCase,
  StaffMember,
} from "@/lib/admin-types";
import { expireStaleRestriction } from "@/lib/account-gate";
import type { VaultJob, VaultObject, VaultSession, StorageMetrics } from "@/lib/storage-types";
import { applyMigrations, hydrateSchemaMeta } from "@/lib/db/migrate";
import { repairOrphans } from "@/lib/db/integrity";

export type { CatalogCategory, CatalogItem };

function hydrateChallenge(c: ChallengeRecord): ChallengeRecord {
  const st = c.deliveryStatus;
  return {
    ...c,
    deliveryStatus: st === "sent" || st === "failed" || st === "dev-outbox" ? st : st === "pending" ? "pending" : undefined,
    deliveryProvider: c.deliveryProvider ?? "",
    deliveryAt: c.deliveryAt ?? null,
    deliveryError: typeof c.deliveryError === "string" ? c.deliveryError.slice(0, 80) : "",
    deliveryFailedAt: c.deliveryFailedAt ?? null,
    intent: c.intent === "login" ? "login" : "register",
  };
}

function hydrateDevice(d: DeviceSession): DeviceSession {
  return {
    ...d,
    name: d.name || d.label || "Unknown Device",
    deviceType: d.deviceType ?? "unknown",
    os: d.os || "Unknown",
    appVersion: d.appVersion || "0.1.0-web",
    pending: Boolean(d.pending),
    trusted: d.pending ? false : d.trusted !== false,
    refreshHash: d.refreshHash,
    refreshSalt: d.refreshSalt,
    refreshRotatedAt: d.refreshRotatedAt,
  };
}

function hydrateUser(user: UserRecord): UserRecord {
  return {
    ...defaultUserFields(),
    ...user,
    usernameHistory: user.usernameHistory ?? [],
    photo: user.photo ?? { kind: "default" },
    privacyPhoto: user.privacyPhoto ?? "everyone",
    privacyBio: user.privacyBio ?? "everyone",
    photoAllowIds: user.photoAllowIds ?? [],
    bioAllowIds: user.bioAllowIds ?? [],
    contactIds: user.contactIds ?? [],
    appearance: user.appearance ?? defaultUserFields().appearance,
    blockedPeerKeys: Array.isArray(user.blockedPeerKeys) ? user.blockedPeerKeys : [],
    cryptoPublicKey: user.cryptoPublicKey ?? null,
    callPrivacy: user.callPrivacy ?? "everyone",
    callAllowIds: Array.isArray(user.callAllowIds) ? user.callAllowIds : [],
    hideCallOnLockScreen: Boolean(user.hideCallOnLockScreen),
    lowDataCalls: Boolean(user.lowDataCalls),
    callRestrictedUntil: user.callRestrictedUntil ?? null,
    callRingtone: user.callRingtone === "classic" || user.callRingtone === "silent" ? user.callRingtone : "nixo",
    callVibration: user.callVibration !== false,
    silentCallNotify: Boolean(user.silentCallNotify),
    callNotify: user.callNotify !== false,
    closeFriendIds: Array.isArray(user.closeFriendIds) ? user.closeFriendIds : [],
    mutedStoryUserIds: Array.isArray(user.mutedStoryUserIds) ? user.mutedStoryUserIds : [],
    storyNotifyOffIds: Array.isArray(user.storyNotifyOffIds) ? user.storyNotifyOffIds : [],
    statusPreset: user.statusPreset ?? "",
    statusText: user.statusText ?? "",
    statusPrivacy: user.statusPrivacy ?? "everyone",
    statusAllowIds: Array.isArray(user.statusAllowIds) ? user.statusAllowIds : [],
    defaultStoryPrivacy: user.defaultStoryPrivacy ?? "everyone",
    defaultHideFromIds: Array.isArray(user.defaultHideFromIds) ? user.defaultHideFromIds : [],
    storyAllowReplies: user.storyAllowReplies !== false,
    storyAllowShare: user.storyAllowShare !== false,
    storyArchiveEnabled: user.storyArchiveEnabled !== false,
    searchHistory: Array.isArray(user.searchHistory) ? user.searchHistory : [],
    searchHideIds: Array.isArray(user.searchHideIds) ? user.searchHideIds : [],
    searchPersonalize: user.searchPersonalize !== false,
    privacyPhone: user.privacyPhone ?? "contacts",
    privacyFindPhone: user.privacyFindPhone ?? "contacts",
    privacyEmail: user.privacyEmail ?? "nobody",
    privacyFindUsername: user.privacyFindUsername ?? "everyone",
    phoneAllowIds: Array.isArray(user.phoneAllowIds) ? user.phoneAllowIds : [],
    emailAllowIds: Array.isArray(user.emailAllowIds) ? user.emailAllowIds : [],
    findPhoneAllowIds: Array.isArray(user.findPhoneAllowIds) ? user.findPhoneAllowIds : [],
    findUsernameAllowIds: Array.isArray(user.findUsernameAllowIds) ? user.findUsernameAllowIds : [],
    officialVerified: Boolean(user.officialVerified),
    privacyLastSeen: user.privacyLastSeen ?? "everyone",
    lastSeenAllowIds: Array.isArray(user.lastSeenAllowIds) ? user.lastSeenAllowIds : [],
    privacyOnline: user.privacyOnline ?? "everyone",
    onlineAllowIds: Array.isArray(user.onlineAllowIds) ? user.onlineAllowIds : [],
    readReceipts: user.readReceipts !== false,
    showTyping: user.showTyping !== false,
    showVoiceRecording: user.showVoiceRecording !== false,
    privacyMessages: user.privacyMessages ?? "everyone",
    messageAllowIds: Array.isArray(user.messageAllowIds) ? user.messageAllowIds : [],
    privacyGroups: user.privacyGroups ?? "everyone",
    groupAllowIds: Array.isArray(user.groupAllowIds) ? user.groupAllowIds : [],
    privacyCommunities: user.privacyCommunities ?? "everyone",
    communityAllowIds: Array.isArray(user.communityAllowIds) ? user.communityAllowIds : [],
    privacyChannels: user.privacyChannels ?? "everyone",
    channelAllowIds: Array.isArray(user.channelAllowIds) ? user.channelAllowIds : [],
    restrictForward: Boolean(user.restrictForward),
    restrictSave: Boolean(user.restrictSave),
    restrictShare: Boolean(user.restrictShare),
    contactSyncEnabled: Boolean(user.contactSyncEnabled),
    syncedContactHashes: Array.isArray(user.syncedContactHashes) ? user.syncedContactHashes : [],
    contactOsPermission:
      user.contactOsPermission === "allow" || user.contactOsPermission === "deny" || user.contactOsPermission === "limited"
        ? user.contactOsPermission
        : "unknown",
    contactNotifyJoin: user.contactNotifyJoin !== false,
    contactAutoSync: Boolean(user.contactAutoSync),
    contactSyncStatus:
      user.contactSyncStatus === "syncing" || user.contactSyncStatus === "completed" || user.contactSyncStatus === "failed"
        ? user.contactSyncStatus
        : "idle",
    contactSyncError: String(user.contactSyncError ?? "").slice(0, 160),
    contactLastSyncAt: user.contactLastSyncAt ?? 0,
    contactSyncCursor: user.contactSyncCursor ?? 0,
    contactSyncRetries: user.contactSyncRetries ?? 0,
    contactConsentAt: user.contactConsentAt ?? 0,
    chatOrgSort:
      user.chatOrgSort === "unread" || user.chatOrgSort === "name" || user.chatOrgSort === "favorites" ? user.chatOrgSort : "recent",
    archiveUnarchiveOnNew: user.archiveUnarchiveOnNew !== false,
    listShowPreview: user.listShowPreview !== false,
    folderOrder: Array.isArray(user.folderOrder) ? user.folderOrder.map(String) : [],
    locationEnabled: Boolean(user.locationEnabled),
    lastSeenAt: user.lastSeenAt ?? 0,
    typingUntil: user.typingUntil ?? 0,
    typingThreadId: user.typingThreadId ?? "",
    recordingUntil: user.recordingUntil ?? 0,
    deletionRequestedAt: user.deletionRequestedAt ?? null,
    prefs: { ...defaultUserFields().prefs, ...(user.prefs ?? {}), consents: { ...defaultUserFields().prefs.consents, ...(user.prefs?.consents ?? {}) } },
    appLockHash: user.appLockHash,
    appLockSalt: user.appLockSalt,
    restrictedPeerKeys: Array.isArray(user.restrictedPeerKeys) ? user.restrictedPeerKeys : [],
    privacyMentions: user.privacyMentions ?? "everyone",
    mentionAllowIds: Array.isArray(user.mentionAllowIds) ? user.mentionAllowIds : [],
    privacyBirthday: user.privacyBirthday ?? "nobody",
    birthdayAllowIds: Array.isArray(user.birthdayAllowIds) ? user.birthdayAllowIds : [],
    privacyStoryMentions: user.privacyStoryMentions ?? "everyone",
    storyMentionAllowIds: Array.isArray(user.storyMentionAllowIds) ? user.storyMentionAllowIds : [],
    friendIds: Array.isArray(user.friendIds) ? user.friendIds : [],
    mutedPeerKeys: Array.isArray(user.mutedPeerKeys) ? user.mutedPeerKeys : [],
    privacyFollow: user.privacyFollow ?? "everyone",
    hideFollowers: Boolean(user.hideFollowers),
    hideFollowing: Boolean(user.hideFollowing),
    privacyFriends: user.privacyFriends ?? "friends",
    privacyFriendCount: user.privacyFriendCount ?? "friends",
    hideSuggestionIds: Array.isArray(user.hideSuggestionIds) ? user.hideSuggestionIds : [],
    notInterestedUserIds: Array.isArray(user.notInterestedUserIds) ? user.notInterestedUserIds : [],
    recPersonalize: user.recPersonalize !== false,
    recNotify: Boolean(user.recNotify),
    relationshipRev: typeof user.relationshipRev === "number" ? user.relationshipRev : 0,
    statusExpiresAt: typeof user.statusExpiresAt === "number" ? user.statusExpiresAt : null,
    statusHistory: Array.isArray(user.statusHistory) ? user.statusHistory.slice(-20) : [],
    accountStatus:
      user.accountStatus === "pending_deletion" ||
      user.accountStatus === "closed" ||
      user.accountStatus === "deactivated" ||
      user.accountStatus === "restricted" ||
      user.accountStatus === "suspended" ||
      user.accountStatus === "banned"
        ? user.accountStatus
        : "active",
    restrictionUntil: typeof user.restrictionUntil === "number" ? user.restrictionUntil : null,
    restrictionKind:
      user.restrictionKind === "restrict" || user.restrictionKind === "suspend" || user.restrictionKind === "ban"
        ? user.restrictionKind
        : "none",
    restrictionReason: typeof user.restrictionReason === "string" ? user.restrictionReason.slice(0, 400) : "",
    restrictionPermanent: Boolean(user.restrictionPermanent),
    deactivatedAt: typeof user.deactivatedAt === "number" ? user.deactivatedAt : null,
    deletionFinalizeAt: user.deletionFinalizeAt ?? null,
    backupPrefs: user.backupPrefs ?? {
      auto: false,
      schedule: "weekly",
      includePhotos: true,
      includeVideos: true,
      includeFiles: true,
      includeVoice: false,
    },
    backupPasswordSalt: user.backupPasswordSalt,
    backupPasswordHash: user.backupPasswordHash,
    backupRecoveryHash: user.backupRecoveryHash,
    pendingIdentifier: user.pendingIdentifier,
    twoStepEnabled: Boolean(user.twoStepEnabled),
    passwordHash: user.passwordHash,
    passwordSalt: user.passwordSalt,
    recoveryCodeHashes: Array.isArray(user.recoveryCodeHashes) ? user.recoveryCodeHashes : [],
    passkeys: Array.isArray(user.passkeys) ? user.passkeys : [],
    e2eeBackupVerifier: user.e2eeBackupVerifier,
    totpSecretCipher: user.totpSecretCipher,
    totpPendingCipher: user.totpPendingCipher,
  };
}

function hydrateKind(kind?: string): ChatMessage["kind"] {
  if (
    kind === "voice" ||
    kind === "photo" ||
    kind === "video" ||
    kind === "file" ||
    kind === "system" ||
    kind === "sticker" ||
    kind === "location" ||
    kind === "contact"
  ) {
    return kind;
  }
  return "text";
}

function hydrateSystemEvent(event: ChatMessage["systemEvent"]): ChatMessage["systemEvent"] {
  if (!event || typeof event !== "object") return undefined;
  if (event.type === "disappear") {
    return { type: "disappear", ms: typeof event.ms === "number" ? event.ms : null };
  }
  if (event.type === "capture" && typeof event.messageId === "string") {
    return { type: "capture", messageId: event.messageId };
  }
  if (event.type === "missed_call") {
    return { type: "missed_call", callKind: event.callKind === "video" ? "video" : "voice" };
  }
  return undefined;
}

function hydrateMessage(message: ChatMessage & { text?: string }): ChatMessage {
  const extra = {
    kind: hydrateKind(message.kind),
    durationMs: message.durationMs,
    viewOnce: Boolean(message.viewOnce),
    disappearAfterMs: message.disappearAfterMs ?? null,
    expiresAt: message.expiresAt ?? null,
    viewedAt: message.viewedAt ?? null,
    playCount: message.playCount ?? 0,
    hiddenFor: Array.isArray(message.hiddenFor) ? message.hiddenFor : [],
    deletedEverywhere: Boolean(message.deletedEverywhere),
    forwarded: Boolean(message.forwarded),
    blobId: message.blobId,
    chunkCount: message.chunkCount,
    byteLength: message.byteLength,
    mimeClass: message.mimeClass,
    expireFrom: (message.expireFrom === "view" ? "view" : message.expireFrom === "send" ? "send" : undefined) as
      | "send"
      | "view"
      | undefined,
    systemEvent: hydrateSystemEvent(message.systemEvent),
    captureCount: message.captureCount ?? 0,
    stickerId: typeof message.stickerId === "string" ? message.stickerId : undefined,
    reactions: Array.isArray(message.reactions) ? message.reactions : [],
    clientNonce: typeof message.clientNonce === "string" ? message.clientNonce : undefined,
    replyToId: typeof message.replyToId === "string" ? message.replyToId : undefined,
    syncId: typeof message.syncId === "string" ? message.syncId : undefined,
    editedAt: message.editedAt ?? null,
    editCount: message.editCount ?? 0,
    deliveredAt: message.deliveredAt ?? null,
    readAt: message.readAt ?? null,
  };
  if (message.kind === "sticker") {
    return {
      id: message.id,
      threadId: message.threadId,
      ownerUserId: message.ownerUserId,
      sender: message.sender,
      enc: "e2ee-v1",
      ciphertext: "",
      nonce: message.nonce || "",
      createdAt: message.createdAt,
      ...extra,
      kind: "sticker",
      stickerId: extra.stickerId,
    };
  }
  if (message.enc === "e2ee-v1" && message.ciphertext && message.nonce) {
    return {
      id: message.id,
      threadId: message.threadId,
      ownerUserId: message.ownerUserId,
      sender: message.sender,
      enc: "e2ee-v1",
      ciphertext: message.ciphertext,
      nonce: message.nonce,
      createdAt: message.createdAt,
      ...extra,
    };
  }
  return {
    id: message.id,
    threadId: message.threadId,
    ownerUserId: message.ownerUserId,
    sender: message.sender,
    enc: "purged",
    ciphertext: "",
    nonce: "",
    createdAt: message.createdAt,
    ...extra,
  };
}

function hydrateGroup(group: GroupRecord): GroupRecord {
  return {
    ...group,
    description: group.description ?? "",
    rules: group.rules ?? "",
    welcome: group.welcome ?? "",
    username: group.username ?? null,
    photoDataUrl: group.photoDataUrl ?? null,
    joinMode: group.joinMode === "open" || group.joinMode === "request" ? group.joinMode : "invite",
    maxMembers: group.maxMembers || 256,
    perms: { ...DEFAULT_GROUP_PERMS, ...(group.perms ?? {}) },
    adminPerms: { ...DEFAULT_GROUP_ADMIN_PERMS, ...(group.adminPerms ?? {}) },
    slowModeMs: typeof group.slowModeMs === "number" ? group.slowModeMs : 0,
    historyMode: group.historyMode === "from-join" ? "from-join" : "all",
    platformHold: group.platformHold === "restricted" || group.platformHold === "removed" ? group.platformHold : "ok",
    platformHoldReason: group.platformHoldReason ?? "",
    inviteToken: group.inviteToken || "",
    inviteExpiresAt: typeof group.inviteExpiresAt === "number" ? group.inviteExpiresAt : null,
    inviteMaxUses: typeof group.inviteMaxUses === "number" ? group.inviteMaxUses : null,
    inviteUses: typeof group.inviteUses === "number" ? group.inviteUses : 0,
    members: Array.isArray(group.members)
      ? group.members.map((m) => ({
          ...m,
          id: m.id || `gm_${m.key}_${m.joinedAt}`,
          customRoleId: m.customRoleId ?? null,
        }))
      : [],
    requests: Array.isArray(group.requests) ? group.requests : [],
    bans: Array.isArray(group.bans) ? group.bans : [],
    pinIds: Array.isArray(group.pinIds) ? group.pinIds : [],
    reactionsEnabled: group.reactionsEnabled !== false,
    allowedReactions: Array.isArray(group.allowedReactions)
      ? group.allowedReactions
      : group.allowedReactions === null
        ? null
        : null,
    audit: Array.isArray(group.audit) ? group.audit : [],
    communityId: group.communityId ?? null,
    deletedAt: group.deletedAt ?? null,
    category: group.category || "general",
    tags: Array.isArray(group.tags) ? group.tags.map(String).slice(0, 8) : [],
    searchVisible: group.searchVisible !== false,
    customRoles: Array.isArray(group.customRoles) ? group.customRoles : [],
    allowForward: group.allowForward !== false,
    previousUsernames: Array.isArray(group.previousUsernames) ? group.previousUsernames : [],
  };
}

function hydrateCommunity(community: CommunityRecord): CommunityRecord {
  return {
    ...community,
    description: community.description ?? "",
    rules: community.rules ?? "",
    username: community.username ?? null,
    joinMode: community.joinMode === "open" || community.joinMode === "request" ? community.joinMode : "invite",
    perms: { ...DEFAULT_COMMUNITY_PERMS, ...(community.perms ?? {}) },
    inviteToken: community.inviteToken || "",
    inviteExpiresAt: typeof community.inviteExpiresAt === "number" ? community.inviteExpiresAt : null,
    inviteMaxUses: typeof community.inviteMaxUses === "number" ? community.inviteMaxUses : null,
    inviteUses: typeof community.inviteUses === "number" ? community.inviteUses : 0,
    searchVisible: community.searchVisible !== false,
    groupIds: Array.isArray(community.groupIds) ? community.groupIds : [],
    channels: Array.isArray(community.channels) ? community.channels : [],
    members: Array.isArray(community.members)
      ? community.members.map((m) => ({
          ...m,
          id: m.id || `cm_${m.key}_${m.joinedAt}`,
        }))
      : [],
    requests: Array.isArray(community.requests) ? community.requests : [],
    bans: Array.isArray(community.bans) ? community.bans : [],
    announcements: Array.isArray(community.announcements) ? community.announcements : [],
    posts: Array.isArray(community.posts) ? community.posts : [],
    deletedAt: community.deletedAt ?? null,
  };
}

function hydratePubChannel(channel: PubChannelRecord): PubChannelRecord {
  return {
    ...channel,
    description: channel.description ?? "",
    rules: channel.rules ?? "",
    username: channel.username ?? null,
    photoDataUrl: channel.photoDataUrl ?? null,
    visibility: channel.visibility === "private" ? "private" : "public",
    status:
      channel.status === "restricted" || channel.status === "suspended" || channel.status === "deleted" || channel.deletedAt
        ? channel.deletedAt
          ? "deleted"
          : channel.status
        : "active",
    joinMode: channel.joinMode === "request" || channel.joinMode === "invite" || channel.joinMode === "open" ? channel.joinMode : channel.visibility === "private" ? "invite" : "open",
    showSubscriberCount: channel.showSubscriberCount !== false,
    purpose: channel.purpose ?? "general",
    businessId: channel.businessId ?? null,
    verified: Boolean(channel.verified),
    commentsEnabled: Boolean(channel.commentsEnabled),
    commentWho: channel.commentWho === "staff" ? "staff" : "subscribers",
    reactionsEnabled: channel.reactionsEnabled !== false,
    allowedReactions: Array.isArray(channel.allowedReactions)
      ? channel.allowedReactions
      : channel.allowedReactions === null
        ? null
        : undefined,
    allowForward: channel.allowForward !== false,
    allowCopy: channel.allowCopy !== false,
    discussionGroupId: channel.discussionGroupId ?? null,
    inviteToken: channel.inviteToken || "",
    inviteMaxUses: typeof channel.inviteMaxUses === "number" ? channel.inviteMaxUses : null,
    inviteUses: channel.inviteUses ?? 0,
    inviteExpiresAt: channel.inviteExpiresAt ?? null,
    adminPerms: { ...DEFAULT_CHANNEL_ADMIN_PERMS, ...(channel.adminPerms ?? {}) },
    staff: Array.isArray(channel.staff)
      ? channel.staff.map((s) => ({
          ...s,
          id: s.id || `cst_${s.userId}`,
          customRoleId: s.customRoleId ?? null,
        }))
      : [],
    customRoles: Array.isArray(channel.customRoles) ? channel.customRoles : [],
    subscribers: Array.isArray(channel.subscribers)
      ? channel.subscribers.map((s) => ({
          ...s,
          id: s.id || `csub_${s.userId}_${s.subscribedAt}`,
          mutedUntil: s.mutedUntil ?? null,
          removedBy: s.removedBy ?? null,
        }))
      : [],
    requests: Array.isArray(channel.requests)
      ? channel.requests.map((r) => ({
          ...r,
          expiresAt: r.expiresAt,
          status: r.status === "expired" || r.status === "approved" || r.status === "rejected" || r.status === "cancelled" ? r.status : "pending",
        }))
      : [],
    bans: Array.isArray(channel.bans)
      ? channel.bans.map((b) => ({
          ...b,
          id: b.id || `cban_${b.key}_${b.at}`,
          permanent: b.permanent ?? !b.until,
        }))
      : [],
    maxSubscribers: typeof channel.maxSubscribers === "number" ? channel.maxSubscribers : undefined,
    hideSubscriberList: Boolean(channel.hideSubscriberList),
    pinIds: Array.isArray(channel.pinIds) ? channel.pinIds : [],
    audit: Array.isArray(channel.audit) ? channel.audit : [],
    liveActive: Boolean(channel.liveActive),
    liveTitle: channel.liveTitle ?? "",
    liveChatEnabled: channel.liveChatEnabled !== false,
    liveChat: Array.isArray(channel.liveChat) ? channel.liveChat : [],
    liveStreamId: channel.liveStreamId ?? null,
    stories: Array.isArray(channel.stories) ? channel.stories : [],
    deletedAt: channel.deletedAt ?? null,
    previousUsernames: Array.isArray(channel.previousUsernames) ? channel.previousUsernames : [],
  };
}

function hydrateUserStory(story: UserStory): UserStory {
  const kinds = ["text", "photo", "video", "audio", "gif", "sticker", "location"] as const;
  return {
    ...story,
    kind: kinds.includes(story.kind as (typeof kinds)[number]) ? story.kind : "text",
    caption: story.caption ?? "",
    bg: story.bg || "#102824",
    font: story.font || "vazir",
    align: story.align === "left" || story.align === "center" ? story.align : "right",
    filter: story.filter || "none",
    rotate: Number(story.rotate) || 0,
    zoom: Number(story.zoom) || 1,
    overlay: story.overlay ?? "",
    textSize: typeof story.textSize === "number" ? story.textSize : 22,
    textX: typeof story.textX === "number" ? story.textX : 50,
    textY: typeof story.textY === "number" ? story.textY : 50,
    blur: Number(story.blur) || 0,
    drawData: story.drawData ?? "",
    stickers: Array.isArray(story.stickers) ? story.stickers : [],
    location: story.location ?? "",
    media: story.media ?? "",
    musicId: story.musicId ?? null,
    linkUrl: story.linkUrl ?? "",
    mentions: Array.isArray(story.mentions) ? story.mentions : [],
    allowShare: story.allowShare !== false,
    allowReplies: story.allowReplies !== false,
    allowReactions: story.allowReactions !== false,
    shareToken: story.shareToken ?? "",
    shareExpiresAt: typeof story.shareExpiresAt === "number" ? story.shareExpiresAt : 0,
    contentHash: story.contentHash ?? "",
    visibility: story.visibility ?? "everyone",
    allowIds: Array.isArray(story.allowIds) ? story.allowIds : [],
    hideFromIds: Array.isArray(story.hideFromIds) ? story.hideFromIds : [],
    purpose: story.purpose ?? "general",
    source: story.source === "business" || story.source === "channel" ? story.source : "user",
    sourceId: story.sourceId ?? null,
    draft: Boolean(story.draft),
    videoDurationMs: typeof story.videoDurationMs === "number" ? story.videoDurationMs : 0,
    deletedAt: story.deletedAt ?? null,
    processStatus: story.processStatus === "processing" || story.processStatus === "failed" ? story.processStatus : "ready",
    processError: story.processError ?? "",
    thumbnail: story.thumbnail ?? "",
    cropX: typeof story.cropX === "number" ? story.cropX : 50,
    cropY: typeof story.cropY === "number" ? story.cropY : 50,
  };
}

export type UserStatus = "pending_profile" | "active";

export type UserRecord = {
  id: string;
  status: UserStatus;
  channel: Channel;
  identifierHash: string;
  identifierMasked: string;
  identifierCipher: string;
  firstName?: string;
  lastName?: string;
  displayName?: string;
  username?: string;
  usernameChangedAt?: number;
  usernameHistory: UsernameChange[];
  bio?: string;
  photo: UserPhoto;
  privacyPhoto: Visibility;
  privacyBio: Visibility;
  photoAllowIds: string[];
  bioAllowIds: string[];
  contactIds: string[];
  appearance: import("@/lib/appearance-types").Appearance;
  blockedPeerKeys: string[];
  cryptoPublicKey: JsonWebKey | null;
  callPrivacy: Visibility;
  callAllowIds: string[];
  hideCallOnLockScreen: boolean;
  lowDataCalls: boolean;
  callRestrictedUntil?: number | null;
  callRingtone?: "nixo" | "classic" | "silent";
  callVibration?: boolean;
  silentCallNotify?: boolean;
  callNotify?: boolean;
  closeFriendIds: string[];
  mutedStoryUserIds: string[];
  storyNotifyOffIds: string[];
  statusPreset: "" | "available" | "busy" | "work" | "away" | "custom";
  statusText: string;
  statusPrivacy: Visibility;
  statusAllowIds: string[];
  defaultStoryPrivacy: "everyone" | "contacts" | "friends" | "closeFriends" | "selected" | "nobody";
  defaultHideFromIds: string[];
  storyAllowReplies: boolean;
  storyAllowShare: boolean;
  storyArchiveEnabled: boolean;
  searchHistory: string[];
  searchHideIds: string[];
  searchPersonalize: boolean;
  privacyPhone: import("@/lib/profile-types").Visibility3;
  privacyFindPhone: import("@/lib/profile-types").Visibility3;
  privacyEmail: import("@/lib/profile-types").Visibility3;
  privacyFindUsername: import("@/lib/profile-types").Visibility3;
  phoneAllowIds: string[];
  emailAllowIds: string[];
  findPhoneAllowIds: string[];
  findUsernameAllowIds: string[];
  officialVerified: boolean;
  privacyLastSeen: Visibility;
  lastSeenAllowIds: string[];
  privacyOnline: Visibility;
  onlineAllowIds: string[];
  readReceipts: boolean;
  showTyping: boolean;
  showVoiceRecording: boolean;
  privacyMessages: Visibility;
  messageAllowIds: string[];
  privacyGroups: Visibility;
  groupAllowIds: string[];
  privacyCommunities: Visibility;
  communityAllowIds: string[];
  privacyChannels: Visibility;
  channelAllowIds: string[];
  restrictForward: boolean;
  restrictSave: boolean;
  restrictShare: boolean;
  contactSyncEnabled: boolean;
  syncedContactHashes: string[];
  contactOsPermission: "unknown" | "allow" | "deny" | "limited";
  contactNotifyJoin: boolean;
  contactAutoSync: boolean;
  contactSyncStatus: "idle" | "syncing" | "completed" | "failed";
  contactSyncError: string;
  contactLastSyncAt: number;
  contactSyncCursor: number;
  contactSyncRetries: number;
  contactConsentAt: number;
  chatOrgSort: import("@/lib/inbox-types").ChatOrgSort;
  archiveUnarchiveOnNew: boolean;
  listShowPreview: boolean;
  folderOrder: string[];
  locationEnabled: boolean;
  lastSeenAt: number;
  typingUntil: number;
  typingThreadId: string;
  recordingUntil: number;
  deletionRequestedAt: number | null;
  prefs: import("@/lib/prefs-types").UserPrefs;
  appLockHash?: string;
  appLockSalt?: string;
  restrictedPeerKeys: string[];
  privacyMentions: Visibility;
  mentionAllowIds: string[];
  privacyBirthday: Visibility;
  birthdayAllowIds: string[];
  privacyStoryMentions: Visibility;
  storyMentionAllowIds: string[];
  friendIds: string[];
  mutedPeerKeys: string[];
  privacyFollow: Visibility;
  hideFollowers: boolean;
  hideFollowing: boolean;
  privacyFriends: Visibility;
  privacyFriendCount: Visibility;
  hideSuggestionIds: string[];
  notInterestedUserIds: string[];
  recPersonalize: boolean;
  recNotify: boolean;
  relationshipRev: number;
  statusExpiresAt: number | null;
  statusHistory: { at: number; preset: string; text: string }[];
  accountStatus?: "active" | "pending_deletion" | "closed" | "deactivated" | "restricted" | "suspended" | "banned";
  restrictionUntil?: number | null;
  restrictionKind?: "none" | "restrict" | "suspend" | "ban";
  restrictionReason?: string;
  restrictionPermanent?: boolean;
  deactivatedAt?: number | null;
  deletionFinalizeAt?: number | null;
  backupPrefs?: BackupPrefs;
  backupPasswordSalt?: string;
  backupPasswordHash?: string;
  backupRecoveryHash?: string;
  pendingIdentifier?: { channel: Channel; challengeId: string; masked: string } | null;
  createdAt: number;
  verifiedAt?: number;
  activatedAt?: number;
  twoStepEnabled?: boolean;
  passwordHash?: string;
  passwordSalt?: string;
  recoveryCodeHashes?: string[];
  passkeys?: PasskeyRecord[];
  e2eeBackupVerifier?: string;
  totpSecretCipher?: string;
  totpPendingCipher?: string;
};

export type BackupPrefs = {
  auto: boolean;
  schedule: "daily" | "weekly" | "monthly";
  includePhotos: boolean;
  includeVideos: boolean;
  includeFiles: boolean;
  includeVoice: boolean;
};

export type EncryptedBackup = {
  id: string;
  userId: string;
  createdAt: number;
  sizeBytes: number;
  status: "complete" | "failed" | "incomplete";
  error?: string;
  errorCode?: "storage" | "network" | "permission" | "integrity" | "empty";
  integrity: string;
  salt: string;
  nonce: string;
  ciphertext: string;
  include: {
    chats: boolean;
    settings: boolean;
    photos: boolean;
    videos: boolean;
    files: boolean;
    voice: boolean;
  };
  encryption: "aes-gcm-v1";
  location: "nixo-vault";
  version: 1;
};

export type ClosedAccount = {
  id: string;
  closedAt: number;
  reason: "user_request" | "tos" | "legal";
  userIdHint: string;
};

export type PasskeyRecord = {
  id: string;
  credentialId: string;
  name: string;
  createdAt: number;
};

export type DeviceSession = {
  id: string;
  userId: string;
  createdAt: number;
  lastSeenAt: number;
  userAgent: string;
  ipHint: string;
  approx: string;
  label: string;
  name: string;
  deviceType: "phone" | "tablet" | "desktop" | "unknown";
  os: string;
  appVersion: string;
  trusted: boolean;
  pending: boolean;
  revokedAt?: number;
  refreshHash?: string;
  refreshSalt?: string;
  refreshRotatedAt?: number;
};

export type SecurityEventKind =
  | "login"
  | "logout"
  | "new_device"
  | "revoke"
  | "twostep_on"
  | "twostep_off"
  | "password"
  | "recovery"
  | "passkey"
  | "backup"
  | "suspicious"
  | "vuln_report"
  | "account_delete"
  | "account_cancel"
  | "identifier_change"
  | "restore"
  | "device_trust"
  | "device_deny"
  | "privacy";

export type ConsentEvent = {
  id: string;
  userId: string;
  key: string;
  value: boolean;
  at: number;
};

export type PrivacyExportJob = {
  id: string;
  ownerUserId: string;
  tokenHash: string;
  expiresAt: number;
  createdAt: number;
  consumedAt?: number | null;
  cipher: string;
};

export type AuditEvent = {
  id: string;
  userId: string;
  kind: SecurityEventKind;
  createdAt: number;
  ipHint?: string;
  userAgent?: string;
  deviceSessionId?: string;
  detail?: string;
  chainHash?: string;
};

export type PasskeyChallenge = {
  id: string;
  userId: string;
  challenge: string;
  mode: "register" | "login";
  exp: number;
};

export type VulnReport = {
  id: string;
  createdAt: number;
  summary: string;
  contact?: string;
  reporterId?: string;
};

export type ChallengeRecord = {
  id: string;
  channel: Channel;
  identifierHash: string;
  identifierMasked: string;
  identifierCipher: string;
  salt: string;
  codeHash: string;
  expiresAt: number;
  usedAt: number | null;
  attemptCount: number;
  sendCount: number;
  lastSentAt: number;
  createdAt: number;
  invalidatedAt: number | null;
  ipHash: string;
  intent?: "login" | "register";
  deliveryStatus?: "pending" | "sent" | "failed" | "dev-outbox";
  deliveryProvider?: string;
  deliveryAt?: number | null;
  deliveryError?: string;
  deliveryFailedAt?: number | null;
};

export type RateBucket = {
  key: string;
  hits: number[];
  blockedUntil: number | null;
};

export type HumanChallenge = {
  id: string;
  ipHash: string;
  issuedAt: number;
  ackedAt: number | null;
  consumedAt: number | null;
};

export type FailedCycle = {
  identifierHash: string;
  count: number;
  lastAt: number;
};

export type UsernameHold = {
  username: string;
  fromUserId: string;
  until: number;
};

export type ContactGroupKind = "family" | "friends" | "work" | "custom" | "";

export type ContactRecord = {
  id: string;
  ownerUserId: string;
  nixoUserId: string | null;
  name: string;
  phone: string;
  email: string;
  username: string;
  notesCipher: string;
  custom: Record<string, string>;
  labels: string[];
  group: ContactGroupKind;
  favorite: boolean;
  localPhoto: string;
  source: "manual" | "sync" | "invite";
  createdAt: number;
  updatedAt: number;
  lastContactedAt: number;
  deviceStamp: string;
  mutedUntil: number | null;
  matchHash: string;
  nickname: string | null;
  notifyPreview: boolean;
  notifySound: boolean;
};

export type ContactInvite = {
  id: string;
  token: string;
  ownerUserId: string;
  maxUses: number | null;
  uses: number;
  expiresAt: number | null;
  createdAt: number;
  revokedAt: number | null;
};

export type ContactRequest = {
  id: string;
  fromUserId: string;
  toUserId: string;
  status: "pending" | "accepted" | "rejected" | "declined" | "cancelled" | "blocked" | "expired";
  createdAt: number;
  updatedAt: number;
  expiresAt: number;
};

export type FollowRecord = {
  id: string;
  followerId: string;
  followeeId: string;
  createdAt: number;
  status: "active" | "blocked";
};

export type FriendshipRecord = {
  id: string;
  pairKey: string;
  userA: string;
  userB: string;
  createdAt: number;
};

export type ContactList = {
  id: string;
  ownerUserId: string;
  name: string;
  contactIds: string[];
  createdAt: number;
  updatedAt: number;
};

export type ChatThread = {
  id: string;
  ownerUserId: string;
  peerKey: string;
  peerName: string;
  peerTitle: string;
  color: string;
  background?: import("@/lib/appearance-types").BackgroundSpec;
  disappearAfterMs?: number | null;
  updatedAt: number;
  muteUntil?: number | null;
};

export type InboxKind = import("@/lib/inbox-types").InboxKind;

export type InboxMeta = {
  id: string;
  ownerUserId: string;
  kind: InboxKind;
  targetId: string;
  pinnedAt: number | null;
  archivedAt: number | null;
  lastReadAt: number;
  markedUnread: boolean;
  favorite: boolean;
  labels: string[];
  notesCipher: string;
  draftCipher: string;
  hidden: boolean;
  updatedAt: number;
  deviceStamp: string;
};

export type ChatFolder = {
  id: string;
  ownerUserId: string;
  name: string;
  icon: string;
  sort: number;
  builtin: string | null;
  includeTypes: InboxKind[];
  includeIds: string[];
  excludeIds: string[];
  unreadOnly: boolean;
  favoritesOnly: boolean;
  muted: boolean;
  updatedAt: number;
  deviceStamp: string;
};

function hydrateInboxMeta(m: InboxMeta): InboxMeta {
  return {
    ...m,
    pinnedAt: m.pinnedAt ?? null,
    archivedAt: m.archivedAt ?? null,
    lastReadAt: m.lastReadAt ?? 0,
    markedUnread: Boolean(m.markedUnread),
    favorite: Boolean(m.favorite),
    labels: Array.isArray(m.labels) ? m.labels.map(String) : [],
    notesCipher: m.notesCipher ?? "",
    draftCipher: m.draftCipher ?? "",
    hidden: Boolean(m.hidden),
    updatedAt: m.updatedAt ?? 0,
    deviceStamp: m.deviceStamp ?? "",
  };
}

function hydrateChatFolder(f: ChatFolder): ChatFolder {
  return {
    ...f,
    includeTypes: Array.isArray(f.includeTypes) ? f.includeTypes : [],
    includeIds: Array.isArray(f.includeIds) ? f.includeIds.map(String) : [],
    excludeIds: Array.isArray(f.excludeIds) ? f.excludeIds.map(String) : [],
    unreadOnly: Boolean(f.unreadOnly),
    favoritesOnly: Boolean(f.favoritesOnly),
    muted: Boolean(f.muted),
    sort: f.sort ?? 0,
    builtin: f.builtin ?? null,
    deviceStamp: f.deviceStamp ?? "",
  };
}

export type ChatMessage = {
  id: string;
  threadId: string;
  ownerUserId: string;
  sender: "me" | "peer";
  enc: "e2ee-v1" | "purged";
  ciphertext: string;
  nonce: string;
  createdAt: number;
  kind: "text" | "voice" | "photo" | "video" | "file" | "system" | "sticker" | "location" | "contact";
  durationMs?: number;
  viewOnce?: boolean;
  disappearAfterMs?: number | null;
  expiresAt?: number | null;
  viewedAt?: number | null;
  playCount?: number;
  hiddenFor?: string[];
  deletedEverywhere?: boolean;
  forwarded?: boolean;
  blobId?: string;
  chunkCount?: number;
  byteLength?: number;
  mimeClass?: "image" | "video" | "file" | "audio";
  expireFrom?: "send" | "view";
  systemEvent?:
    | { type: "disappear"; ms: number | null }
    | { type: "capture"; messageId: string }
    | { type: "missed_call"; callKind: "voice" | "video" };
  captureCount?: number;
  stickerId?: string;
  reactions?: { emoji: string; keys: string[] }[];
  clientNonce?: string;
  replyToId?: string | null;
  syncId?: string;
  editedAt?: number | null;
  editCount?: number;
  deliveredAt?: number | null;
  readAt?: number | null;
};

export type SafetyReport = {
  id: string;
  reporterId: string;
  targetKind:
    | "user"
    | "chat"
    | "group"
    | "community"
    | "channel"
    | "story"
    | "bot"
    | "miniapp"
    | "business"
    | "sticker"
    | "live"
    | "call"
    | "file"
    | "profile"
    | "message";
  targetKey: string;
  threadId?: string;
  messageIds: string[];
  category: "spam" | "abuse" | "fake" | "harassment" | "other";
  details: string;
  createdAt: number;
  status?: import("@/lib/admin-types").ReportStatus;
  priority?: import("@/lib/admin-types").ReportPriority;
  assignedTo?: string | null;
  duplicateOf?: string | null;
  notes?: import("@/lib/admin-types").ModerationNote[];
  caseId?: string | null;
  autoFlagged?: boolean;
};

export type StoryView = {
  ownerUserId: string;
  storyId: string;
  viewedAt: number;
};

export type UserStory = {
  id: string;
  ownerUserId: string;
  kind: import("@/lib/story-types").StoryKind;
  body: string;
  caption: string;
  bg: string;
  font: string;
  align: "right" | "center" | "left";
  filter: string;
  rotate: number;
  zoom: number;
  overlay: string;
  textSize: number;
  textX: number;
  textY: number;
  blur: number;
  drawData: string;
  stickers: { emoji: string; x: number; y: number }[];
  location: string;
  media: string;
  musicId: string | null;
  linkUrl: string;
  mentions: string[];
  allowShare: boolean;
  allowReplies: boolean;
  allowReactions?: boolean;
  shareToken?: string;
  shareExpiresAt?: number;
  contentHash?: string;
  visibility: import("@/lib/story-types").StoryVisibility;
  allowIds: string[];
  hideFromIds: string[];
  purpose: import("@/lib/story-types").StoryPurpose;
  source: "user" | "business" | "channel";
  sourceId: string | null;
  draft: boolean;
  videoDurationMs: number;
  createdAt: number;
  expiresAt: number;
  deletedAt: number | null;
  processStatus?: "ready" | "processing" | "failed";
  processError?: string;
  thumbnail?: string;
  cropX?: number;
  cropY?: number;
};

export type StoryHighlight = {
  id: string;
  ownerUserId: string;
  name: string;
  coverStoryId: string | null;
  storyIds: string[];
  visibility: import("@/lib/story-types").StoryVisibility;
  allowIds: string[];
  hideFromIds: string[];
  createdAt: number;
  updatedAt: number;
};

export type StoryJob = {
  id: string;
  storyId: string;
  ownerUserId: string;
  status: "pending" | "done" | "failed";
  retries: number;
  error: string;
  at: number;
};

export type StoryWatch = {
  storyId: string;
  viewerId: string;
  viewerName: string;
  viewedAt: number;
  completed?: boolean;
};

export type StoryReaction = {
  id?: string;
  storyId: string;
  userId: string;
  emoji: string;
  at: number;
};

export type StoryReply = {
  id: string;
  storyId: string;
  fromId: string;
  fromName: string;
  body: string;
  createdAt: number;
};

export type CallKind = "voice" | "video";
export type CallStatus = "ringing" | "active" | "ended" | "declined" | "missed" | "queued";
export type CallDirection = "out" | "in";

export type CallRecord = {
  id: string;
  ownerUserId: string;
  threadId: string;
  peerKey: string;
  peerName: string;
  peerColor: string;
  kind: CallKind;
  direction: CallDirection;
  status: CallStatus;
  createdAt: number;
  connectedAt?: number | null;
  endedAt?: number | null;
  durationMs?: number;
  declineWithMessage?: boolean;
  endReason?: "hangup" | "cancel" | "timeout" | "failed" | "busy" | "declined";
  hiddenAt?: number | null;
  chatNotedAt?: number | null;
  /** Shared signaling room for a 1:1 pair. Never trust a client-supplied room id. */
  sessionId?: string;
  mediaTokenHash?: string;
  mediaTokenExpiresAt?: number;
  /** Short-lived room secret; never returned from list/history payloads. */
  mediaSecret?: string;
  reconnects?: number;
  reconnecting?: boolean;
  reconnectStartedAt?: number;
  sharing?: boolean;
  camOff?: boolean;
  voiceFallback?: boolean;
  connectionState?: "connecting" | "connected" | "reconnecting" | "disconnected" | "failed";
  micMuted?: boolean;
  speakerMode?: boolean;
  deviceId?: string | null;
  participantId?: string;
};

export type CallSignal = {
  id: string;
  callId: string;
  fromUserId: string;
  type: "offer" | "answer" | "ice" | "hangup" | "reconnect" | "quality";
  body: string;
  nonce?: string;
  createdAt: number;
};

export type CallQualitySample = {
  callId: string;
  rttMs: number;
  loss: number;
  jitterMs: number;
  at: number;
  framesDecoded?: number;
  bitrateKbps?: number;
  frozen?: boolean;
};

export type CallEvent = {
  id: string;
  userId: string;
  callId: string;
  kind: string;
  at: number;
  detail?: string;
};

export type CallParticipantState =
  | "invited"
  | "ringing"
  | "connecting"
  | "connected"
  | "muted"
  | "disconnected"
  | "declined"
  | "missed"
  | "removed";

export type GroupCallParticipant = {
  id: string;
  userId: string;
  name: string;
  role: "host" | "admin" | "member";
  joinedAt: number;
  leftAt: number | null;
  mutedByHost: boolean;
  kicked: boolean;
  camOff?: boolean;
  micMuted?: boolean;
  sharing?: boolean;
  speakingAt?: number;
  state?: CallParticipantState;
  videoState?: "camera-off" | "camera-on" | "connecting" | "connected" | "reconnecting" | "disconnected" | "failed";
  voiceFallback?: boolean;
  deviceId?: string | null;
};

export type GroupCallRoom = {
  id: string;
  groupId: string;
  groupName: string;
  hostUserId: string;
  kind: CallKind;
  status: "ringing" | "active" | "ended";
  maxParticipants: number;
  inviteToken: string | null;
  inviteExpiresAt?: number | null;
  sessionId?: string;
  mediaTokenHash?: string;
  mediaTokenExpiresAt?: number;
  mediaSecret?: string;
  hiddenBy?: string[];
  createdAt: number;
  endedAt: number | null;
  participants: GroupCallParticipant[];
};

export type GroupMember = {
  id: string;
  key: string;
  kind: "user" | "seed" | "bot";
  role: GroupRole;
  customRoleId?: string | null;
  name: string;
  joinedAt: number;
  mutedUntil: number | null;
  restrictedUntil: number | null;
  notifyMutedUntil: number | null;
  notifyMentions?: boolean;
  lastSentAt?: number | null;
  leftAt: number | null;
  removedBy?: string | null;
};

export type GroupAuditEvent = {
  id: string;
  at: number;
  actorKey: string;
  actorName: string;
  kind: string;
  detail: string;
};

export type GroupJoinRequest = {
  id: string;
  userId: string;
  name: string;
  createdAt: number;
  expiresAt?: number;
  status: "pending" | "approved" | "rejected" | "cancelled" | "expired";
};

export type GroupBan = {
  id?: string;
  key: string;
  at: number;
  until?: number | null;
  byKey?: string;
  byName?: string;
  reason?: string;
  permanent?: boolean;
};

export type GroupRecord = {
  id: string;
  name: string;
  description: string;
  rules: string;
  welcome: string;
  username: string | null;
  color: string;
  photoDataUrl: string | null;
  ownerUserId: string;
  joinMode: "invite" | "request" | "open";
  maxMembers: number;
  perms: GroupPerms;
  adminPerms: GroupAdminPerms;
  slowModeMs: number;
  historyMode: GroupHistoryMode;
  inviteToken: string;
  inviteExpiresAt: number | null;
  inviteMaxUses: number | null;
  inviteUses: number;
  members: GroupMember[];
  requests: GroupJoinRequest[];
  bans: GroupBan[];
  pinIds: string[];
  reactionsEnabled: boolean;
  allowedReactions: string[] | null;
  audit: GroupAuditEvent[];
  communityId: string | null;
  createdAt: number;
  updatedAt: number;
  deletedAt: number | null;
  fileMaxBytes?: number;
  allowedFileExts?: string[] | null;
  category: string;
  tags: string[];
  searchVisible: boolean;
  customRoles: CustomGroupRole[];
  allowForward?: boolean;
  previousUsernames?: string[];
  hideMemberList?: boolean;
  platformHold?: "ok" | "restricted" | "removed";
  platformHoldReason?: string;
};

export type GroupPoll = {
  question: string;
  options: string[];
  anonymous: boolean;
  multiple: boolean;
  closesAt: number | null;
  votes: { voterKey: string; indexes: number[] }[];
};

export type GroupMessage = {
  id: string;
  groupId: string;
  senderKey: string;
  senderName: string;
  enc: "e2ee-v1" | "none" | "purged";
  ciphertext: string;
  nonce: string;
  bodyFa?: string;
  createdAt: number;
  kind: "text" | "voice" | "photo" | "video" | "file" | "system" | "poll" | "gif" | "contact" | "location" | "sticker";
  replyToId?: string | null;
  mentions?: string[];
  tags?: string[];
  reactions: { emoji: string; keys: string[] }[];
  poll?: GroupPoll;
  blobId?: string;
  chunkCount?: number;
  byteLength?: number;
  fileName?: string;
  deleted?: boolean;
  stickerId?: string;
  durationMs?: number;
  editedAt?: number | null;
  clientNonce?: string;
};

export type CommunityMember = {
  id: string;
  key: string;
  kind: "user" | "seed";
  role: CommunityRole;
  name: string;
  username: string | null;
  joinedAt: number;
  mutedUntil: number | null;
  restrictedUntil: number | null;
  notifyMode: NotifyMode;
  leftAt: number | null;
};

export type CommunityJoinRequest = {
  id: string;
  userId: string;
  name: string;
  createdAt: number;
  status: "pending" | "approved" | "rejected" | "cancelled";
};

export type CommunityBan = { key: string; at: number; until?: number | null };

export type CommunityAnnouncement = {
  id: string;
  authorKey: string;
  authorName: string;
  body: string;
  createdAt: number;
};

export type CommunityPost = {
  id: string;
  channelId: string;
  authorKey: string;
  authorName: string;
  kind: "text" | "photo" | "video" | "file" | "link";
  body: string;
  createdAt: number;
  deleted?: boolean;
};

export type CommunityChannel = {
  id: string;
  name: string;
  description: string;
  color: string;
  createdAt: number;
};

export type CommunityRecord = {
  id: string;
  name: string;
  description: string;
  rules: string;
  username: string | null;
  color: string;
  ownerUserId: string;
  joinMode: "invite" | "request" | "open";
  perms: CommunityPerms;
  inviteToken: string;
  inviteExpiresAt: number | null;
  inviteMaxUses: number | null;
  inviteUses: number;
  searchVisible: boolean;
  groupIds: string[];
  channels: CommunityChannel[];
  members: CommunityMember[];
  requests: CommunityJoinRequest[];
  bans: CommunityBan[];
  announcements: CommunityAnnouncement[];
  posts: CommunityPost[];
  createdAt: number;
  updatedAt: number;
  deletedAt: number | null;
};

export type ChannelStaff = {
  id: string;
  userId: string;
  role: ChannelStaffRole;
  customRoleId?: string | null;
  name: string;
};

export type ChannelSubscriber = {
  id: string;
  userId: string;
  name: string;
  username: string | null;
  subscribedAt: number;
  notify: ChannelNotify;
  mutedUntil?: number | null;
  leftAt: number | null;
  removedBy?: string | null;
};

export type ChannelComment = {
  id: string;
  authorKey: string;
  authorName: string;
  body: string;
  createdAt: number;
  parentId?: string | null;
  deleted?: boolean;
};

export type ChannelJoinRequest = {
  id: string;
  userId: string;
  name: string;
  createdAt: number;
  expiresAt?: number;
  status: "pending" | "approved" | "rejected" | "cancelled" | "expired";
};

export type ChannelBroadcastJob = {
  id: string;
  channelId: string;
  postId: string;
  offset: number;
  status: "queued" | "running" | "done" | "failed";
  createdAt: number;
  attempts?: number;
  nextAt?: number;
  lastError?: string;
};

export type ChannelPoll = {
  question: string;
  options: string[];
  anonymous: boolean;
  multiple: boolean;
  closesAt: number | null;
  votes: { voterKey: string; indexes: number[] }[];
  quiz?: boolean;
  correctIndex?: number | null;
};

export type ChannelAuditEvent = {
  id: string;
  at: number;
  actorKey: string;
  actorName: string;
  kind: string;
  detail: string;
};

export type ChannelLiveChat = {
  id: string;
  authorKey: string;
  authorName: string;
  body: string;
  createdAt: number;
};

export type StickerPackPrivacy = "public" | "private";
export type StickerKind = "static" | "animated" | "custom-emoji";

export type StickerPack = {
  id: string;
  ownerUserId: string;
  name: string;
  description: string;
  privacy: StickerPackPrivacy;
  shareToken: string;
  official: boolean;
  memberIds: string[];
  createdAt: number;
  deletedAt?: number;
  groupId?: string;
  channelId?: string;
};

export type StickerItem = {
  id: string;
  packId: string;
  name: string;
  emoji: string;
  tags: string[];
  kind: StickerKind;
  mime: string;
  payload: string;
  w: number;
  h: number;
  bytes: number;
  deletedAt?: number;
};

export type StickerPrefs = {
  userId: string;
  emojiRecent: string[];
  emojiFavorites: string[];
  stickerRecent: string[];
  stickerFavorites: string[];
  installedPackIds: string[];
  reactionPrivacy: "everyone" | "contacts" | "nobody";
  reactionNotify: boolean;
  suggestions: boolean;
  customEmoji: boolean;
};

export type StickerModeration = {
  id: string;
  packId: string;
  stickerId?: string;
  reporterUserId: string;
  reason: string;
  createdAt: number;
  status: "open" | "removed" | "dismissed";
};

export type ChannelStory = {
  id: string;
  body: string;
  photoDataUrl: string | null;
  createdAt: number;
  expiresAt: number;
  views: string[];
};

export type ChannelPost = {
  id: string;
  channelId: string;
  authorKey: string;
  authorName: string;
  kind: ChannelPostKind;
  body: string;
  caption: string;
  status: ChannelPostStatus;
  scheduledAt: number | null;
  publishedAt: number | null;
  editedAt: number | null;
  reactions: { emoji: string; keys: string[] }[];
  comments: ChannelComment[];
  poll?: ChannelPoll;
  album: string[];
  views: string[];
  viewHits?: number;
  forwards: number;
  createdAt: number;
  durationMs?: number;
  deleted?: boolean;
  cancelled?: boolean;
  sourcePostId?: string | null;
  fileName?: string;
  clientNonce?: string;
  linkPreview?: { url: string; host: string } | null;
  silent?: boolean;
  announcement?: boolean;
  tags?: string[];
};

export type PubChannelRecord = {
  id: string;
  name: string;
  description: string;
  rules: string;
  username: string | null;
  color: string;
  photoDataUrl: string | null;
  visibility: "public" | "private";
  status: import("@/lib/channel-types").ChannelLifecycle;
  joinMode: import("@/lib/channel-types").ChannelJoinMode;
  showSubscriberCount: boolean;
  purpose: import("@/lib/channel-types").ChannelPurpose;
  businessId: string | null;
  ownerUserId: string;
  verified: boolean;
  commentsEnabled: boolean;
  commentWho: import("@/lib/channel-types").ChannelCommentWho;
  reactionsEnabled: boolean;
  allowedReactions?: string[] | null;
  allowForward: boolean;
  allowCopy: boolean;
  discussionGroupId: string | null;
  inviteToken: string;
  inviteMaxUses: number | null;
  inviteUses: number;
  inviteExpiresAt: number | null;
  adminPerms: ChannelAdminPerms;
  staff: ChannelStaff[];
  customRoles: import("@/lib/channel-types").CustomChannelRole[];
  subscribers: ChannelSubscriber[];
  requests: ChannelJoinRequest[];
  bans: { id?: string; key: string; at: number; until?: number | null; byKey?: string; byName?: string; reason?: string; permanent?: boolean }[];
  previousUsernames?: string[];
  pinIds: string[];
  audit: ChannelAuditEvent[];
  liveActive: boolean;
  liveTitle: string;
  liveChatEnabled: boolean;
  liveChat: ChannelLiveChat[];
  liveStreamId?: string | null;
  stories: ChannelStory[];
  createdAt: number;
  updatedAt: number;
  deletedAt: number | null;
  maxSubscribers?: number;
  hideSubscriberList?: boolean;
};

export type MusicTrack = {
  id: string;
  ownerUserId: string;
  kind: import("@/lib/music-types").MusicKind;
  title: string;
  artist: string;
  album: string;
  mime: string;
  size: number;
  durationMs: number;
  favorite: boolean;
  cache: boolean;
  blocked: boolean;
  privacy: "private" | "shared";
  lastPositionMs: number;
  createdAt: number;
  deletedAt: number | null;
};

export type MusicPlaylist = {
  id: string;
  ownerUserId: string;
  name: string;
  trackIds: string[];
  createdAt: number;
  deletedAt: number | null;
};

export type MusicClaim = {
  id: string;
  userId: string;
  trackId: string | null;
  catalogId: string | null;
  reason: string;
  status: "open" | "review" | "removed";
  createdAt: number;
};

export type GalleryItem = {
  id: string;
  ownerUserId: string;
  kind: import("@/lib/gallery-types").GalleryKind;
  name: string;
  mime: string;
  size: number;
  caption: string;
  privacy: import("@/lib/gallery-types").GalleryPrivacy;
  sourceChat: string;
  albumIds: string[];
  cache: boolean;
  hash: string;
  thumb: string;
  duplicateOf: string | null;
  createdAt: number;
  deletedAt: number | null;
  senderId?: string;
  checksum?: string;
};

export type GalleryAlbum = {
  id: string;
  ownerUserId: string;
  name: string;
  itemIds: string[];
  createdAt: number;
  deletedAt: number | null;
};

export type SavedItem = {
  id: string;
  ownerUserId: string;
  kind: import("@/lib/saved-types").SavedKind;
  body: string;
  bodyCipher: string;
  notesCipher: string;
  linkUrl: string;
  fileName: string;
  fileType: string;
  fileSize: number;
  media: string;
  mediaCipher: string;
  tag: string;
  tags: string[];
  folderId: string | null;
  bookmarked: boolean;
  favorite: boolean;
  pinned: boolean;
  source: {
    type: "chat" | "group" | "channel" | "community" | "manual";
    id: string;
    name: string;
    messageId?: string;
  } | null;
  createdAt: number;
  updatedAt: number;
  deviceStamp: string;
  deletedAt: number | null;
  purgedAt: number | null;
};

export type SavedFolder = {
  id: string;
  ownerUserId: string;
  name: string;
  icon: string;
  sort: number;
  updatedAt: number;
  deviceStamp: string;
};

function hydrateSavedItem(s: SavedItem): SavedItem {
  const kind = (
    [
      "text",
      "photo",
      "video",
      "audio",
      "voice",
      "file",
      "link",
      "contact",
      "location",
      "sticker",
      "message",
    ] as const
  ).includes(s.kind as SavedItem["kind"])
    ? s.kind
    : "text";
  return {
    ...s,
    kind,
    body: s.body ?? "",
    bodyCipher: s.bodyCipher ?? "",
    notesCipher: s.notesCipher ?? "",
    linkUrl: s.linkUrl ?? "",
    fileName: s.fileName ?? "",
    fileType: s.fileType ?? "",
    fileSize: s.fileSize ?? 0,
    media: s.media ?? "",
    mediaCipher: s.mediaCipher ?? "",
    tag: s.tag ?? "",
    tags: Array.isArray(s.tags) ? s.tags.map(String) : s.tag ? [s.tag] : [],
    folderId: s.folderId ?? null,
    bookmarked: Boolean(s.bookmarked),
    favorite: Boolean(s.favorite),
    pinned: Boolean(s.pinned),
    source: s.source ?? null,
    createdAt: s.createdAt ?? 0,
    updatedAt: s.updatedAt ?? s.createdAt ?? 0,
    deviceStamp: s.deviceStamp ?? "",
    deletedAt: s.deletedAt ?? null,
    purgedAt: s.purgedAt ?? null,
  };
}

function hydrateSavedFolder(f: SavedFolder): SavedFolder {
  return {
    ...f,
    icon: f.icon || "📁",
    sort: f.sort ?? 0,
    updatedAt: f.updatedAt ?? 0,
    deviceStamp: f.deviceStamp ?? "",
  };
}

function hydrateProduct(p: BizProduct): BizProduct {
  return {
    ...p,
    variants: p.variants ?? [],
    variantRows: p.variantRows ?? [],
    discount: p.discount ?? null,
  };
}

function hydrateCart(c: BizCart): BizCart {
  return {
    ...c,
    items: (c.items ?? []).map((i) => ({ productId: i.productId, qty: i.qty, variantKey: i.variantKey || "" })),
  };
}

function hydrateOrder(o: BizOrder): BizOrder {
  return {
    ...o,
    items: (o.items ?? []).map((i) => ({
      productId: i.productId,
      name: i.name,
      qty: i.qty,
      price: i.price,
      variantKey: i.variantKey || "",
      discount: i.discount ?? 0,
    })),
    subtotal: o.subtotal ?? o.total,
    discountTotal: o.discountTotal ?? 0,
    deliveryFee: o.deliveryFee ?? 0,
    fee: o.fee ?? 0,
    paymentStatus: o.paymentStatus ?? "unpaid",
    deliveryMethodId: o.deliveryMethodId ?? "pickup",
    addressSnapshot: o.addressSnapshot ?? o.delivery ?? "",
    couponCode: o.couponCode ?? "",
    invoiceId: o.invoiceId ?? null,
  };
}

export type MediaJob = {
  id: string;
  ownerUserId: string;
  itemId: string;
  kind: "exif" | "thumb" | "scan" | "cleanup";
  status: "queued" | "running" | "done" | "failed";
  retries: number;
  lastError?: string;
  createdAt: number;
  updatedAt: number;
};

export type DbJob = {
  id: string;
  kind: "backup" | "integrity" | "cleanup" | "verify";
  status: "queued" | "running" | "done" | "failed";
  actorUserId: string;
  detail: string;
  createdAt: number;
};

export type DbAudit = { id: string; actorUserId: string; action: string; at: number };

export type StoreData = {
  users: UserRecord[];
  challenges: ChallengeRecord[];
  rateBuckets: RateBucket[];
  humanChallenges: HumanChallenge[];
  failedCycles: FailedCycle[];
  threads: ChatThread[];
  messages: ChatMessage[];
  reports: SafetyReport[];
  storyViews: StoryView[];
  userStories: UserStory[];
  storyWatches: StoryWatch[];
  storyReactions: StoryReaction[];
  storyReplies: StoryReply[];
  storyHighlights: StoryHighlight[];
  storyJobs: StoryJob[];
  storyCacheGen: number;
  storyAudit: { id: string; actorUserId: string; action: string; storyId: string; at: number }[];
  calls: CallRecord[];
  groups: GroupRecord[];
  groupMessages: GroupMessage[];
  communities: CommunityRecord[];
  pubChannels: PubChannelRecord[];
  channelPosts: ChannelPost[];
  channelBroadcasts: ChannelBroadcastJob[];
  savedItems: SavedItem[];
  savedFolders: SavedFolder[];
  galleryItems: GalleryItem[];
  galleryAlbums: GalleryAlbum[];
  galleryPrefs: import("@/lib/gallery-types").GalleryPrefs[];
  musicTracks: MusicTrack[];
  musicPlaylists: MusicPlaylist[];
  musicPrefs: import("@/lib/music-types").MusicPrefs[];
  musicClaims: MusicClaim[];
  catalogCategories: CatalogCategory[];
  catalogItems: CatalogItem[];
  bgCategories: CatalogCategory[];
  bgItems: CatalogItem[];
  devices: DeviceSession[];
  audit: AuditEvent[];
  consentEvents: ConsentEvent[];
  privacyExports: PrivacyExportJob[];
  passkeyChallenges: PasskeyChallenge[];
  vulnReports: VulnReport[];
  backups: EncryptedBackup[];
  closedAccounts: ClosedAccount[];
  bots: BotRecord[];
  botChats: BotChat[];
  botMessages: BotMessage[];
  miniApps: MiniAppRecord[];
  miniGrants: MiniGrant[];
  miniReviews: MiniReview[];
  miniSessions: MiniSession[];
  miniAccessLogs: MiniAccessLog[];
  botPlacements: BotPlacement[];
  botLogs: BotLog[];
  botUpdates: BotUpdate[];
  botReviews: BotReview[];
  botAccessLogs: BotAccessLog[];
  botKv: BotKvItem[];
  botJobs: BotJob[];
  botIdempotency: BotIdempotency[];
  botWebhookJobs: BotWebhookJob[];
  aiChats: AiChatRecord[];
  aiMessages: AiMessageRecord[];
  aiMemory: AiMemoryItem[];
  aiPrefs: AiPrefs[];
  aiLogs: AiLog[];
  aiSys: AiPersist;
  businesses: BusinessRecord[];
  bizStaff: BusinessStaff[];
  bizProducts: BizProduct[];
  bizReplies: BizQuickReply[];
  bizThreads: BizThread[];
  bizMessages: BizMessage[];
  bizCarts: BizCart[];
  bizOrders: BizOrder[];
  shops: ShopRecord[];
  addresses: UserAddress[];
  coupons: CouponRecord[];
  payments: PaymentRecord[];
  invoices: InvoiceRecord[];
  refunds: RefundRecord[];
  wallets: WalletRecord[];
  ledger: LedgerTx[];
  settlements: SettlementRecord[];
  shopNotices: ShopNotice[];
  disputes: DisputeRecord[];
  shopAudit: ShopAudit[];
  notifications: NotifyRecord[];
  notifyPrefs: NotifyPrefs[];
  pushTokens: PushToken[];
  pushJobs: PushJob[];
  notifyDeadLetters: NotifyDeadLetter[];
  notifyAudit: NotifyAudit[];
  groupCalls: GroupCallRoom[];
  callSignals: CallSignal[];
  callQuality: CallQualitySample[];
  callEvents: CallEvent[];
  contacts: ContactRecord[];
  contactInvites: ContactInvite[];
  contactRequests: ContactRequest[];
  contactLists: ContactList[];
  follows: FollowRecord[];
  friendships: FriendshipRecord[];
  usernameHolds: UsernameHold[];
  reservedUsernames: string[];
  inboxMetas: InboxMeta[];
  chatFolders: ChatFolder[];
  stickerPacks: StickerPack[];
  stickers: StickerItem[];
  stickerPrefs: StickerPrefs[];
  stickerReports: StickerModeration[];
  reactionIdempotency: { key: string; at: number; action: string }[];
  reactionCountCache: { key: string; counts: Record<string, number>; at: number }[];
  stickerAnalytics: { reactions: number; stickersSent: number; packsInstalled: number; customOps: number };
  fileAccessLogs: { id: string; userId: string; action: string; target: string; at: number }[];
  mediaJobs: MediaJob[];
  vaultObjects: VaultObject[];
  vaultSessions: VaultSession[];
  vaultJobs: VaultJob[];
  vaultLinks: import("@/lib/storage-types").VaultLink[];
  storageMetrics: StorageMetrics;
  lives: LiveStream[];
  liveRecordings: LiveRecordingMeta[];
  livePrefs: LivePrefs[];
  searchIndex: { gen: number; rebuiltAt: number | null; version?: number };
  searchDocs: SearchDoc[];
  searchIndexJobs: SearchIndexJob[];
  searchQueryCache: SearchQueryCache[];
  searchMetrics: SearchMetrics;
  searchTombstones: SearchTombstone[];
  /** Public hashtag counts only. Never stores private queries, phones, or emails. */
  searchPopular: Record<string, number>;
  securityMetrics: SecurityMetrics;
  staffMembers: StaffMember[];
  adminSessions: AdminSessionRow[];
  adminAudit: AdminAuditRow[];
  moderationCases: ModerationCase[];
  moderationAppeals: ModerationAppeal[];
  accountWarnings: AccountWarning[];
  adminAlerts: AdminAlert[];
  autoModFlags: AutoModFlag[];
  contentTombstones: ContentTombstone[];
  adminMetrics: AdminMetrics;
  monitor: MonitorPersist;
  dr: DrPersist;
  perf: PerfPersist;
  deploy: DeployPersist;
  i18n: I18nPersist;
  bi: BiPersist;
  billing: BillingPersist;
  prod: ProdPersist;
  cloud: CloudPersist;
  edge: EdgePersist;
  graph: GraphPersist;
  schemaMeta: import("@/lib/db/migrate").SchemaMeta;
  dbJobs: DbJob[];
  dbAudit: DbAudit[];
};

const EMPTY: StoreData = {
  users: [],
  challenges: [],
  rateBuckets: [],
  humanChallenges: [],
  failedCycles: [],
  threads: [],
  messages: [],
  reports: [],
  storyViews: [],
  userStories: [],
  storyWatches: [],
  storyReactions: [],
  storyReplies: [],
  storyHighlights: [],
  storyJobs: [],
  storyCacheGen: 0,
  storyAudit: [],
  calls: [],
  groups: [],
  groupMessages: [],
  communities: [],
  pubChannels: [],
  channelPosts: [],
  channelBroadcasts: [],
  savedItems: [],
  savedFolders: [],
  galleryItems: [],
  galleryAlbums: [],
  galleryPrefs: [],
  musicTracks: [],
  musicPlaylists: [],
  musicPrefs: [],
  musicClaims: [],
  catalogCategories: [],
  catalogItems: [],
  bgCategories: [],
  bgItems: [],
  devices: [],
  audit: [],
  consentEvents: [],
  privacyExports: [],
  passkeyChallenges: [],
  vulnReports: [],
  backups: [],
  closedAccounts: [],
  bots: [],
  botChats: [],
  botMessages: [],
  miniApps: [],
  miniGrants: [],
  miniReviews: [],
  miniSessions: [],
  miniAccessLogs: [],
  botPlacements: [],
  botLogs: [],
  botUpdates: [],
  botReviews: [],
  botAccessLogs: [],
  botKv: [],
  botJobs: [],
  botIdempotency: [],
  botWebhookJobs: [],
  aiChats: [],
  aiMessages: [],
  aiMemory: [],
  aiPrefs: [],
  aiLogs: [],
  aiSys: emptyAiPersist(),
  businesses: [],
  bizStaff: [],
  bizProducts: [],
  bizReplies: [],
  bizThreads: [],
  bizMessages: [],
  bizCarts: [],
  bizOrders: [],
  shops: [],
  addresses: [],
  coupons: [],
  payments: [],
  invoices: [],
  refunds: [],
  wallets: [],
  ledger: [],
  settlements: [],
  shopNotices: [],
  disputes: [],
  shopAudit: [],
  notifications: [],
  notifyPrefs: [],
  pushTokens: [],
  pushJobs: [],
  notifyDeadLetters: [],
  notifyAudit: [],
  groupCalls: [],
  callSignals: [],
  callQuality: [],
  callEvents: [],
  contacts: [],
  contactInvites: [],
  contactRequests: [],
  contactLists: [],
  follows: [],
  friendships: [],
  usernameHolds: [],
  reservedUsernames: [],
  inboxMetas: [],
  chatFolders: [],
  stickerPacks: [],
  stickers: [],
  stickerPrefs: [],
  stickerReports: [],
  reactionIdempotency: [],
  reactionCountCache: [],
  stickerAnalytics: { reactions: 0, stickersSent: 0, packsInstalled: 0, customOps: 0 },
  fileAccessLogs: [],
  mediaJobs: [],
  vaultObjects: [],
  vaultSessions: [],
  vaultJobs: [],
  vaultLinks: [],
  storageMetrics: {
    uploads: 0,
    uploadFail: 0,
    downloads: 0,
    downloadFail: 0,
    processFail: 0,
    lastUploadMs: 0,
    lastDownloadMs: 0,
    lastProcessMs: 0,
    alertAt: null,
  },
  lives: [],
  liveRecordings: [],
  livePrefs: [],
  searchIndex: { gen: 0, rebuiltAt: null, version: 4 },
  searchDocs: [],
  searchIndexJobs: [],
  searchQueryCache: [],
  searchMetrics: { queries: 0, errors: 0, cacheHits: 0, lastLatencyMs: 0, latencySamples: [] },
  searchTombstones: [],
  searchPopular: {},
  securityMetrics: emptySecurityMetrics(),
  staffMembers: [],
  adminSessions: [],
  adminAudit: [],
  moderationCases: [],
  moderationAppeals: [],
  accountWarnings: [],
  adminAlerts: [],
  autoModFlags: [],
  contentTombstones: [],
  adminMetrics: emptyAdminMetrics(),
  monitor: emptyMonitorPersist(),
  dr: emptyDrPersist(),
  perf: emptyPerfPersist(),
  deploy: emptyDeployPersist(process.env.VITEST ? "testing" : "development"),
  i18n: emptyI18nPersist(),
  bi: emptyBiPersist(),
  billing: emptyBillingPersist(),
  prod: emptyProdPersist(),
  cloud: emptyCloudPersist(),
  edge: emptyEdgePersist(),
  graph: emptyGraphPersist(),
  schemaMeta: { version: 0, migratedAt: 0, env: process.env.VITEST ? "test" : "development" },
  dbJobs: [],
  dbAudit: [],
};

const STORE_PATH = path.join(
  dataDir(),
  process.env.VITEST ? `nixo-store.test.${process.env.VITEST_WORKER_ID ?? "0"}.json` : "nixo-store.json",
);

let queue: Promise<unknown> = Promise.resolve();

function enqueue<T>(fn: () => Promise<T>): Promise<T> {
  const run = queue.then(fn, fn);
  queue = run.then(
    () => undefined,
    () => undefined,
  );
  return run;
}

async function readStore(lockedJson?: string | null): Promise<StoreData> {
  try {
    let raw: string | null = null;
    if (arguments.length > 0) {
      raw = lockedJson ?? null;
      if (!raw) return structuredClone(EMPTY);
    } else if (persistMode() === "postgres") {
      raw = await loadPersistedJson();
      if (!raw) return structuredClone(EMPTY);
    } else {
      raw = await readFile(STORE_PATH, "utf8");
    }
    const parsed = JSON.parse(raw) as StoreData;
    return {
      users: (parsed.users ?? []).map(hydrateUser),
      challenges: (parsed.challenges ?? []).map(hydrateChallenge),
      rateBuckets: parsed.rateBuckets ?? [],
      humanChallenges: parsed.humanChallenges ?? [],
      failedCycles: parsed.failedCycles ?? [],
      threads: parsed.threads ?? [],
      messages: (parsed.messages ?? []).map(hydrateMessage),
      reports: parsed.reports ?? [],
      storyViews: parsed.storyViews ?? [],
      userStories: Array.isArray(parsed.userStories) ? parsed.userStories.map(hydrateUserStory) : [],
      storyWatches: Array.isArray(parsed.storyWatches) ? parsed.storyWatches : [],
      storyReactions: Array.isArray(parsed.storyReactions) ? parsed.storyReactions : [],
      storyReplies: Array.isArray(parsed.storyReplies) ? parsed.storyReplies : [],
      storyHighlights: Array.isArray(parsed.storyHighlights) ? parsed.storyHighlights : [],
      storyJobs: Array.isArray(parsed.storyJobs) ? parsed.storyJobs : [],
      storyCacheGen: typeof parsed.storyCacheGen === "number" ? parsed.storyCacheGen : 0,
      storyAudit: Array.isArray(parsed.storyAudit) ? parsed.storyAudit : [],
      calls: Array.isArray(parsed.calls) ? parsed.calls : [],
      groups: Array.isArray(parsed.groups) ? parsed.groups.map(hydrateGroup) : [],
      groupMessages: Array.isArray(parsed.groupMessages) ? parsed.groupMessages : [],
      communities: Array.isArray(parsed.communities) ? parsed.communities.map(hydrateCommunity) : [],
      pubChannels: Array.isArray(parsed.pubChannels) ? parsed.pubChannels.map(hydratePubChannel) : [],
      channelPosts: Array.isArray(parsed.channelPosts)
        ? parsed.channelPosts.map((p) => ({
            ...p,
            album: Array.isArray(p.album) ? p.album : [],
            views: Array.isArray(p.views) ? p.views : [],
            viewHits: typeof p.viewHits === "number" ? p.viewHits : 0,
            forwards: typeof p.forwards === "number" ? p.forwards : 0,
            reactions: Array.isArray(p.reactions) ? p.reactions : [],
            comments: Array.isArray(p.comments) ? p.comments : [],
            cancelled: Boolean(p.cancelled),
            sourcePostId: p.sourcePostId ?? null,
            fileName: typeof p.fileName === "string" ? p.fileName : "",
            clientNonce: typeof p.clientNonce === "string" ? p.clientNonce : undefined,
            linkPreview: p.linkPreview ?? null,
          }))
        : [],
      channelBroadcasts: Array.isArray(parsed.channelBroadcasts) ? parsed.channelBroadcasts : [],
      savedItems: Array.isArray(parsed.savedItems) ? parsed.savedItems.map(hydrateSavedItem) : [],
      savedFolders: Array.isArray(parsed.savedFolders) ? parsed.savedFolders.map(hydrateSavedFolder) : [],
      galleryItems: Array.isArray(parsed.galleryItems)
        ? parsed.galleryItems.map((i) => ({
            ...i,
            albumIds: Array.isArray(i.albumIds) ? i.albumIds : [],
            cache: Boolean(i.cache),
            hash: i.hash ?? "",
            thumb: i.thumb ?? "",
            duplicateOf: i.duplicateOf ?? null,
            deletedAt: i.deletedAt ?? null,
            senderId: i.senderId ?? "",
            checksum: i.checksum ?? "",
          }))
        : [],
      galleryAlbums: Array.isArray(parsed.galleryAlbums) ? parsed.galleryAlbums : [],
      galleryPrefs: Array.isArray(parsed.galleryPrefs) ? parsed.galleryPrefs : [],
      musicTracks: Array.isArray(parsed.musicTracks)
        ? parsed.musicTracks.map((i) => ({
            ...i,
            favorite: Boolean(i.favorite),
            cache: Boolean(i.cache),
            blocked: Boolean(i.blocked),
            lastPositionMs: i.lastPositionMs ?? 0,
            deletedAt: i.deletedAt ?? null,
          }))
        : [],
      musicPlaylists: Array.isArray(parsed.musicPlaylists) ? parsed.musicPlaylists : [],
      musicPrefs: Array.isArray(parsed.musicPrefs) ? parsed.musicPrefs : [],
      musicClaims: Array.isArray(parsed.musicClaims) ? parsed.musicClaims : [],
      catalogCategories: parsed.catalogCategories ?? [],
      catalogItems: parsed.catalogItems ?? [],
      bgCategories: parsed.bgCategories ?? [],
      bgItems: parsed.bgItems ?? [],
      devices: Array.isArray(parsed.devices) ? parsed.devices.map(hydrateDevice) : [],
      audit: Array.isArray(parsed.audit) ? parsed.audit : [],
      consentEvents: Array.isArray(parsed.consentEvents) ? parsed.consentEvents : [],
      privacyExports: Array.isArray(parsed.privacyExports) ? parsed.privacyExports : [],
      passkeyChallenges: Array.isArray(parsed.passkeyChallenges) ? parsed.passkeyChallenges : [],
      vulnReports: Array.isArray(parsed.vulnReports) ? parsed.vulnReports : [],
      backups: Array.isArray(parsed.backups) ? parsed.backups : [],
      closedAccounts: Array.isArray(parsed.closedAccounts) ? parsed.closedAccounts : [],
      bots: Array.isArray(parsed.bots) ? parsed.bots : [],
      botChats: Array.isArray(parsed.botChats) ? parsed.botChats : [],
      botMessages: Array.isArray(parsed.botMessages) ? parsed.botMessages : [],
      miniApps: Array.isArray(parsed.miniApps) ? parsed.miniApps : [],
      miniGrants: Array.isArray(parsed.miniGrants) ? parsed.miniGrants : [],
      miniReviews: Array.isArray(parsed.miniReviews) ? parsed.miniReviews : [],
      miniSessions: Array.isArray(parsed.miniSessions) ? parsed.miniSessions : [],
      miniAccessLogs: Array.isArray(parsed.miniAccessLogs) ? parsed.miniAccessLogs : [],
      botPlacements: Array.isArray(parsed.botPlacements) ? parsed.botPlacements : [],
      botLogs: Array.isArray(parsed.botLogs) ? parsed.botLogs : [],
      botUpdates: Array.isArray(parsed.botUpdates) ? parsed.botUpdates : [],
      botReviews: Array.isArray(parsed.botReviews) ? parsed.botReviews : [],
      botAccessLogs: Array.isArray(parsed.botAccessLogs) ? parsed.botAccessLogs : [],
      botKv: Array.isArray(parsed.botKv) ? parsed.botKv : [],
      botJobs: Array.isArray(parsed.botJobs) ? parsed.botJobs : [],
      botIdempotency: Array.isArray(parsed.botIdempotency) ? parsed.botIdempotency : [],
      botWebhookJobs: Array.isArray(parsed.botWebhookJobs) ? parsed.botWebhookJobs : [],
      aiChats: Array.isArray(parsed.aiChats) ? parsed.aiChats : [],
      aiMessages: Array.isArray(parsed.aiMessages) ? parsed.aiMessages : [],
      aiMemory: Array.isArray(parsed.aiMemory) ? parsed.aiMemory : [],
      aiPrefs: Array.isArray(parsed.aiPrefs) ? parsed.aiPrefs : [],
      aiLogs: Array.isArray(parsed.aiLogs) ? parsed.aiLogs : [],
      aiSys: hydrateAiPersist(parsed.aiSys),
      businesses: Array.isArray(parsed.businesses) ? parsed.businesses : [],
      bizStaff: Array.isArray(parsed.bizStaff) ? parsed.bizStaff : [],
      bizProducts: (Array.isArray(parsed.bizProducts) ? parsed.bizProducts : []).map(hydrateProduct),
      bizReplies: Array.isArray(parsed.bizReplies) ? parsed.bizReplies : [],
      bizThreads: Array.isArray(parsed.bizThreads) ? parsed.bizThreads : [],
      bizMessages: Array.isArray(parsed.bizMessages) ? parsed.bizMessages : [],
      bizCarts: (Array.isArray(parsed.bizCarts) ? parsed.bizCarts : []).map(hydrateCart),
      bizOrders: (Array.isArray(parsed.bizOrders) ? parsed.bizOrders : []).map(hydrateOrder),
      shops: Array.isArray(parsed.shops) ? parsed.shops : [],
      addresses: Array.isArray(parsed.addresses) ? parsed.addresses : [],
      coupons: Array.isArray(parsed.coupons) ? parsed.coupons : [],
      payments: Array.isArray(parsed.payments) ? parsed.payments : [],
      invoices: Array.isArray(parsed.invoices) ? parsed.invoices : [],
      refunds: Array.isArray(parsed.refunds) ? parsed.refunds : [],
      wallets: Array.isArray(parsed.wallets) ? parsed.wallets : [],
      ledger: Array.isArray(parsed.ledger) ? parsed.ledger : [],
      settlements: Array.isArray(parsed.settlements) ? parsed.settlements : [],
      shopNotices: Array.isArray(parsed.shopNotices) ? parsed.shopNotices : [],
      disputes: Array.isArray(parsed.disputes) ? parsed.disputes : [],
      shopAudit: Array.isArray(parsed.shopAudit) ? parsed.shopAudit : [],
      notifications: Array.isArray(parsed.notifications) ? parsed.notifications : [],
      notifyPrefs: Array.isArray(parsed.notifyPrefs) ? parsed.notifyPrefs : [],
      pushTokens: Array.isArray(parsed.pushTokens) ? parsed.pushTokens : [],
      pushJobs: Array.isArray(parsed.pushJobs) ? parsed.pushJobs : [],
      notifyDeadLetters: Array.isArray(parsed.notifyDeadLetters) ? parsed.notifyDeadLetters : [],
      notifyAudit: Array.isArray(parsed.notifyAudit) ? parsed.notifyAudit : [],
      groupCalls: Array.isArray(parsed.groupCalls)
        ? parsed.groupCalls.map((c: GroupCallRoom) => ({
            ...c,
            sessionId: c.sessionId || c.id,
            participants: (c.participants ?? []).map((p) => ({
              ...p,
              id: p.id || `gcp_${c.id}_${p.userId}`,
            })),
          }))
        : [],
      callSignals: Array.isArray(parsed.callSignals) ? parsed.callSignals : [],
      callQuality: Array.isArray(parsed.callQuality) ? parsed.callQuality : [],
      callEvents: Array.isArray(parsed.callEvents) ? parsed.callEvents : [],
      contacts: Array.isArray(parsed.contacts)
        ? parsed.contacts.map((c) => ({
            ...c,
            mutedUntil: typeof c.mutedUntil === "number" ? c.mutedUntil : null,
            matchHash: typeof c.matchHash === "string" ? c.matchHash : "",
            nickname: typeof c.nickname === "string" ? c.nickname : null,
            notifyPreview: c.notifyPreview !== false,
            notifySound: c.notifySound !== false,
          }))
        : [],
      contactInvites: Array.isArray(parsed.contactInvites)
        ? parsed.contactInvites.map((i) => ({ ...i, revokedAt: typeof i.revokedAt === "number" ? i.revokedAt : null }))
        : [],
      contactRequests: Array.isArray(parsed.contactRequests)
        ? parsed.contactRequests.map((r) => ({
            ...r,
            expiresAt: typeof r.expiresAt === "number" ? r.expiresAt : r.createdAt + 14 * 24 * 60 * 60_000,
          }))
        : [],
      contactLists: Array.isArray(parsed.contactLists) ? parsed.contactLists : [],
      follows: Array.isArray(parsed.follows)
        ? parsed.follows.map((f) => ({ ...f, status: f.status === "blocked" ? "blocked" : "active" }))
        : [],
      friendships: Array.isArray(parsed.friendships) ? parsed.friendships : [],
      usernameHolds: Array.isArray(parsed.usernameHolds) ? parsed.usernameHolds : [],
      reservedUsernames: Array.isArray(parsed.reservedUsernames) ? parsed.reservedUsernames : [],
      inboxMetas: Array.isArray(parsed.inboxMetas) ? parsed.inboxMetas.map(hydrateInboxMeta) : [],
      chatFolders: Array.isArray(parsed.chatFolders) ? parsed.chatFolders.map(hydrateChatFolder) : [],
      stickerPacks: Array.isArray(parsed.stickerPacks)
        ? parsed.stickerPacks.map((p) => ({
            ...p,
            groupId: typeof p.groupId === "string" ? p.groupId : undefined,
            channelId: typeof p.channelId === "string" ? p.channelId : undefined,
            deletedAt: typeof p.deletedAt === "number" ? p.deletedAt : undefined,
          }))
        : [],
      stickers: Array.isArray(parsed.stickers)
        ? parsed.stickers.map((s) => ({
            ...s,
            deletedAt: typeof s.deletedAt === "number" ? s.deletedAt : undefined,
          }))
        : [],
      stickerPrefs: Array.isArray(parsed.stickerPrefs) ? parsed.stickerPrefs : [],
      stickerReports: Array.isArray(parsed.stickerReports) ? parsed.stickerReports : [],
      reactionIdempotency: Array.isArray(parsed.reactionIdempotency) ? parsed.reactionIdempotency : [],
      reactionCountCache: Array.isArray(parsed.reactionCountCache) ? parsed.reactionCountCache : [],
      stickerAnalytics: {
        reactions: parsed.stickerAnalytics?.reactions ?? 0,
        stickersSent: parsed.stickerAnalytics?.stickersSent ?? 0,
        packsInstalled: parsed.stickerAnalytics?.packsInstalled ?? 0,
        customOps: parsed.stickerAnalytics?.customOps ?? 0,
      },
      fileAccessLogs: Array.isArray(parsed.fileAccessLogs) ? parsed.fileAccessLogs : [],
      mediaJobs: Array.isArray(parsed.mediaJobs) ? parsed.mediaJobs : [],
      vaultObjects: Array.isArray(parsed.vaultObjects) ? parsed.vaultObjects : [],
      vaultSessions: Array.isArray(parsed.vaultSessions) ? parsed.vaultSessions : [],
      vaultJobs: Array.isArray(parsed.vaultJobs) ? parsed.vaultJobs : [],
      vaultLinks: Array.isArray(parsed.vaultLinks) ? parsed.vaultLinks : [],
      storageMetrics: parsed.storageMetrics ?? {
        uploads: 0,
        uploadFail: 0,
        downloads: 0,
        downloadFail: 0,
        processFail: 0,
        lastUploadMs: 0,
        lastDownloadMs: 0,
        lastProcessMs: 0,
        alertAt: null,
      },
      lives: Array.isArray(parsed.lives) ? parsed.lives : [],
      liveRecordings: Array.isArray(parsed.liveRecordings) ? parsed.liveRecordings : [],
      livePrefs: Array.isArray(parsed.livePrefs) ? parsed.livePrefs : [],
      searchIndex: {
        gen: typeof parsed.searchIndex?.gen === "number" ? parsed.searchIndex.gen : 0,
        rebuiltAt: typeof parsed.searchIndex?.rebuiltAt === "number" ? parsed.searchIndex.rebuiltAt : null,
        version: typeof parsed.searchIndex?.version === "number" ? parsed.searchIndex.version : 0,
      },
      searchDocs: Array.isArray(parsed.searchDocs) ? parsed.searchDocs : [],
      searchIndexJobs: Array.isArray(parsed.searchIndexJobs) ? parsed.searchIndexJobs : [],
      searchQueryCache: Array.isArray(parsed.searchQueryCache) ? parsed.searchQueryCache : [],
      searchMetrics: parsed.searchMetrics ?? { queries: 0, errors: 0, cacheHits: 0, lastLatencyMs: 0, latencySamples: [] },
      searchTombstones: Array.isArray(parsed.searchTombstones) ? parsed.searchTombstones : [],
      searchPopular: parsed.searchPopular && typeof parsed.searchPopular === "object" ? parsed.searchPopular : {},
      securityMetrics: parsed.securityMetrics ?? emptySecurityMetrics(),
      staffMembers: Array.isArray(parsed.staffMembers) ? parsed.staffMembers : [],
      adminSessions: Array.isArray(parsed.adminSessions) ? parsed.adminSessions : [],
      adminAudit: Array.isArray(parsed.adminAudit) ? parsed.adminAudit : [],
      moderationCases: Array.isArray(parsed.moderationCases) ? parsed.moderationCases : [],
      moderationAppeals: Array.isArray(parsed.moderationAppeals) ? parsed.moderationAppeals : [],
      accountWarnings: Array.isArray(parsed.accountWarnings) ? parsed.accountWarnings : [],
      adminAlerts: Array.isArray(parsed.adminAlerts) ? parsed.adminAlerts : [],
      autoModFlags: Array.isArray(parsed.autoModFlags) ? parsed.autoModFlags : [],
      contentTombstones: Array.isArray(parsed.contentTombstones) ? parsed.contentTombstones : [],
      adminMetrics: parsed.adminMetrics ?? emptyAdminMetrics(),
      monitor: hydrateMonitorPersist(parsed.monitor),
      dr: hydrateDrPersist(parsed.dr),
      perf: hydratePerfPersist(parsed.perf),
      deploy: hydrateDeployPersist(parsed.deploy, currentDeployEnv()),
      i18n: hydrateI18nPersist(parsed.i18n),
      bi: hydrateBiPersist(parsed.bi),
      billing: hydrateBillingPersist(parsed.billing),
      prod: hydrateProdPersist(parsed.prod),
      cloud: hydrateCloudPersist(parsed.cloud),
      edge: hydrateEdgePersist(parsed.edge),
      graph: hydrateGraphPersist(parsed.graph),
      schemaMeta: hydrateSchemaMeta(parsed.schemaMeta),
      dbJobs: Array.isArray(parsed.dbJobs) ? parsed.dbJobs : [],
      dbAudit: Array.isArray(parsed.dbAudit) ? parsed.dbAudit : [],
    };
  } catch {
    return structuredClone(EMPTY);
  }
}

async function writeStore(data: StoreData): Promise<void> {
  const json = JSON.stringify(data);
  if (persistMode() === "postgres") {
    await savePersistedJson(json);
    return;
  }
  await mkdir(path.dirname(STORE_PATH), { recursive: true });
  const tmp = `${STORE_PATH}.${process.pid}.tmp`;
  await writeFile(tmp, json, "utf8");
  const { rename } = await import("node:fs/promises");
  await rename(tmp, STORE_PATH);
}

export function getStorePath(): string {
  return STORE_PATH;
}

export function writeStoreForTests(data: StoreData): Promise<void> {
  if (!process.env.VITEST) {
    return Promise.reject(new Error("forbidden"));
  }
  return enqueue(async () => {
    await writeStore(data);
  });
}

export function resetStoreForTests(): Promise<void> {
  return enqueue(async () => {
    await writeStore(structuredClone(EMPTY));
    const lock = path.join(dataDir(), `dr-lock.test.${process.env.VITEST_WORKER_ID ?? "0"}.json`);
    await unlink(lock).catch(() => undefined);
  });
}

export function bumpDiscoveryCaches(data: StoreData) {
  data.searchIndex = {
    gen: (data.searchIndex?.gen ?? 0) + 1,
    rebuiltAt: Date.now(),
    version: data.searchIndex?.version ?? 4,
  };
  data.searchQueryCache = [];
}

export function mutateStore<T>(mutator: (data: StoreData) => T | Promise<T>): Promise<T> {
  return enqueue(async () => {
    if (persistMode() === "postgres") {
      return withPostgresDocument(async (raw) => {
        const data = await readStore(raw);
        ensureCatalog(data);
        prune(data, Date.now());
        const result = await mutator(data);
        return { json: JSON.stringify(data), result };
      });
    }
    const data = await readStore();
    ensureCatalog(data);
    prune(data, Date.now());
    const result = await mutator(data);
    await writeStore(data);
    return result;
  });
}

export function readStoreSnapshot(): Promise<StoreData> {
  return enqueue(async () => {
    const data = await readStore();
    const wasEmpty = data.catalogCategories.length === 0 || data.bgCategories.length === 0;
    ensureCatalog(data);
    prune(data, Date.now());
    if (wasEmpty) await writeStore(data);
    return data;
  });
}

function ensureCatalog(data: StoreData): void {
  if (data.catalogCategories.length === 0) {
    data.catalogCategories = DEFAULT_CATEGORIES.map((c) => ({ ...c }));
    data.catalogItems = seedCatalogItems();
  }
  if (data.bgCategories.length === 0) {
    data.bgCategories = BG_CATEGORIES.map((c) => ({ ...c }));
    data.bgItems = seedBackgroundItems();
  }
  applyMigrations(data);
}

function prune(data: StoreData, now: number): void {
  const keepChallengeMs = 24 * 60 * 60 * 1000;
  data.challenges = data.challenges.filter((c) => now - c.createdAt < keepChallengeMs);
  data.humanChallenges = data.humanChallenges.filter((h) => now - h.issuedAt < 60 * 60 * 1000);
  data.rateBuckets = data.rateBuckets
    .map((b) => ({
      ...b,
      hits: b.hits.filter((t) => now - t < 60 * 60 * 1000),
    }))
    .filter((b) => b.hits.length > 0 || (b.blockedUntil !== null && b.blockedUntil > now));
  data.failedCycles = data.failedCycles.filter((f) => now - f.lastAt < 24 * 60 * 60 * 1000);
  const gallerySoftMs = 30 * 24 * 60 * 60 * 1000;
  data.galleryItems = (data.galleryItems ?? []).filter((i) => !i.deletedAt || now - i.deletedAt < gallerySoftMs);
  data.mediaJobs = (data.mediaJobs ?? []).filter((j) => now - j.createdAt < 7 * 24 * 60 * 60 * 1000);
  data.vaultSessions = (data.vaultSessions ?? []).filter((s) => s.expiresAt > now);
  data.vaultObjects = (data.vaultObjects ?? []).filter((o) => !o.deletedAt || now - o.deletedAt < 30 * 24 * 60 * 60 * 1000);
  data.vaultJobs = (data.vaultJobs ?? []).filter((j) => now - j.createdAt < 7 * 24 * 60 * 60 * 1000);
  data.vaultLinks = (data.vaultLinks ?? []).filter((l) => !l.revokedAt && l.expiresAt > now - 24 * 60 * 60 * 1000);
  data.dbJobs = (data.dbJobs ?? []).filter((j) => now - j.createdAt < 30 * 24 * 60 * 60 * 1000);
  data.dbAudit = (data.dbAudit ?? []).filter((j) => now - j.at < 30 * 24 * 60 * 60 * 1000);
  data.adminAudit = (data.adminAudit ?? []).filter((j) => now - j.createdAt < 180 * 24 * 60 * 60 * 1000).slice(0, 2000);
  data.adminSessions = (data.adminSessions ?? []).filter((s) => !s.revokedAt || now - (s.revokedAt ?? 0) < 14 * 24 * 60 * 60 * 1000);
  data.adminAlerts = (data.adminAlerts ?? []).filter((a) => now - a.createdAt < 90 * 24 * 60 * 60 * 1000).slice(0, 400);
  data.monitor = hydrateMonitorPersist(data.monitor);
  const monitorKeep = 14 * 24 * 60 * 60 * 1000;
  data.monitor.logs = data.monitor.logs.filter((l) => now - l.at < monitorKeep).slice(0, 300);
  data.monitor.samples = data.monitor.samples.filter((s) => now - s.at < 7 * 24 * 60 * 60 * 1000).slice(0, 48);
  data.monitor.alerts = data.monitor.alerts.filter((a) => now - a.at < 90 * 24 * 60 * 60 * 1000).slice(0, 120);
  data.monitor.incidents = data.monitor.incidents.filter((i) => now - i.createdAt < 180 * 24 * 60 * 60 * 1000).slice(0, 80);
  data.monitor.errors = data.monitor.errors.slice(0, 80);
  data.dr = hydrateDrPersist(data.dr);
  data.dr.jobs = data.dr.jobs.filter((j) => now - j.createdAt < 90 * 24 * 60 * 60 * 1000).slice(0, 200);
  data.dr.audits = data.dr.audits.filter((a) => now - a.at < 180 * 24 * 60 * 60 * 1000).slice(0, 400);
  rememberPlatformMode(data.dr.mode);
  data.perf = hydratePerfPersist(data.perf);
  data.perf.jobs = data.perf.jobs.filter((j) => now - j.createdAt < 7 * 24 * 60 * 60 * 1000).slice(0, 400);
  data.perf.dlq = data.perf.dlq.filter((j) => now - j.at < 14 * 24 * 60 * 60 * 1000).slice(0, 200);
  setShedLevel(data.perf.shed);
  data.deploy = hydrateDeployPersist(data.deploy, currentDeployEnv());
  data.deploy.deployments = data.deploy.deployments.filter((d) => now - d.startedAt < 180 * 24 * 60 * 60 * 1000).slice(0, 200);
  data.deploy.artifacts = data.deploy.artifacts.slice(0, 80);
  if (data.deploy.lock && data.deploy.lock.until < now) data.deploy.lock = null;
  data.i18n = hydrateI18nPersist(data.i18n);
  data.bi = hydrateBiPersist(data.bi);
  data.billing = hydrateBillingPersist(data.billing);
  data.prod = hydrateProdPersist(data.prod);
  data.cloud = hydrateCloudPersist(data.cloud);
  data.edge = hydrateEdgePersist(data.edge);
  data.graph = pruneGraphPersist(hydrateGraphPersist(data.graph), now);
  data.searchTombstones = (data.searchTombstones ?? [])
    .filter((t) => now - t.at < 180 * 24 * 60 * 60 * 1000)
    .slice(0, 2000);
  data.searchMetrics = {
    queries: data.searchMetrics?.queries ?? 0,
    errors: data.searchMetrics?.errors ?? 0,
    cacheHits: data.searchMetrics?.cacheHits ?? 0,
    lastLatencyMs: data.searchMetrics?.lastLatencyMs ?? 0,
    lastError: data.searchMetrics?.lastError,
    emptyResults: data.searchMetrics?.emptyResults ?? 0,
    opens: data.searchMetrics?.opens ?? 0,
    resultHits: data.searchMetrics?.resultHits ?? 0,
    latencySamples: (data.searchMetrics?.latencySamples ?? []).slice(-200),
  };
  data.aiSys = pruneAiPersist(hydrateAiPersist(data.aiSys), now);
  data.aiLogs = (data.aiLogs ?? []).filter((l) => now - l.at < (data.aiSys.policy.retentionDays || 90) * 24 * 60 * 60 * 1000).slice(0, 800);
  syncBillingLifecycle(data, now);
  for (const user of data.users) expireStaleRestriction(user, now);
  data.callEvents = (data.callEvents ?? []).filter((e) => now - e.at < 7 * 24 * 60 * 60 * 1000).slice(-4000);
  data.callSignals = (data.callSignals ?? []).filter((s) => now - s.createdAt < 10 * 60 * 1000).slice(-800);
  data.callQuality = (data.callQuality ?? []).filter((q) => now - q.at < 10 * 60 * 1000).slice(-400);
  repairOrphans(data);
  // Accounts are never removed for inactivity. Only a confirmed pending deletion past its grace period is purged.
  finalizeDueAccounts(data, now);
}

export function finalizeDueAccounts(data: StoreData, now: number) {
  const keep: UserRecord[] = [];
  for (const user of data.users) {
    if (user.accountStatus === "pending_deletion" && user.deletionFinalizeAt && user.deletionFinalizeAt <= now) {
      purgeUserData(data, user, now);
      continue;
    }
    keep.push(user);
  }
  data.users = keep;
}

function purgeUserData(data: StoreData, user: UserRecord, now: number) {
  const uid = user.id;
  if (data.bi) data.bi = purgeBiSubjectFromPersist(data.bi, uid);
  anonymizeBilling(data, uid);
  data.closedAccounts = [
    { id: randomId(), closedAt: now, reason: "user_request" as const, userIdHint: uid.slice(0, 8) },
    ...(data.closedAccounts ?? []),
  ].slice(0, 200);
  data.threads = data.threads.filter((t) => t.ownerUserId !== uid);
  data.messages = data.messages.filter((m) => m.ownerUserId !== uid);
  data.savedItems = (data.savedItems ?? []).filter((s) => s.ownerUserId !== uid);
  data.savedFolders = (data.savedFolders ?? []).filter((s) => s.ownerUserId !== uid);
  data.galleryItems = (data.galleryItems ?? []).filter((s) => s.ownerUserId !== uid);
  data.galleryAlbums = (data.galleryAlbums ?? []).filter((s) => s.ownerUserId !== uid);
  data.galleryPrefs = (data.galleryPrefs ?? []).filter((s) => s.userId !== uid);
  data.musicTracks = (data.musicTracks ?? []).filter((s) => s.ownerUserId !== uid);
  data.musicPlaylists = (data.musicPlaylists ?? []).filter((s) => s.ownerUserId !== uid);
  data.musicPrefs = (data.musicPrefs ?? []).filter((s) => s.userId !== uid);
  data.musicClaims = (data.musicClaims ?? []).filter((s) => s.userId !== uid);
  data.backups = (data.backups ?? []).filter((b) => b.userId !== uid);
  data.calls = (data.calls ?? []).filter((c) => c.ownerUserId !== uid && c.peerKey !== uid);
  data.callSignals = (data.callSignals ?? []).filter((s) => s.fromUserId !== uid);
  data.callEvents = (data.callEvents ?? []).filter((e) => e.userId !== uid);
  const liveCallIds = new Set((data.calls ?? []).map((c) => c.id).concat((data.groupCalls ?? []).map((c) => c.id)));
  data.callQuality = (data.callQuality ?? []).filter((q) => liveCallIds.has(q.callId));
  data.userStories = (data.userStories ?? []).filter((s) => s.ownerUserId !== uid);
  data.storyHighlights = (data.storyHighlights ?? []).filter((h) => h.ownerUserId !== uid);
  data.storyJobs = (data.storyJobs ?? []).filter((j) => j.ownerUserId !== uid);
  data.storyWatches = (data.storyWatches ?? []).filter((w) => w.viewerId !== uid);
  data.storyReactions = (data.storyReactions ?? []).filter((r) => r.userId !== uid);
  data.storyReplies = (data.storyReplies ?? []).filter((r) => r.fromId !== uid);
  data.storyAudit = (data.storyAudit ?? []).filter((a) => a.actorUserId !== uid);
  for (const d of data.devices ?? []) {
    if (d.userId === uid && !d.revokedAt) d.revokedAt = now;
  }
  for (const g of data.groups ?? []) {
    g.members = g.members.filter((m) => m.key !== uid);
  }
  for (const c of data.communities ?? []) {
    c.members = c.members.filter((m) => m.key !== uid);
  }
  for (const ch of data.pubChannels ?? []) {
    ch.subscribers = ch.subscribers.filter((s) => s.userId !== uid);
    ch.staff = ch.staff.filter((s) => s.userId !== uid);
  }
  for (const bot of data.bots ?? []) {
    if (bot.ownerUserId === uid && bot.status === "active") {
      bot.status = "disabled";
      bot.tokenRevokedAt = now;
    }
  }
  data.botChats = (data.botChats ?? []).filter((c) => c.userId !== uid);
  data.botMessages = (data.botMessages ?? []).filter((m) => m.userId !== uid);
  data.botReviews = (data.botReviews ?? []).filter((r) => r.userId !== uid);
  data.botAccessLogs = (data.botAccessLogs ?? []).filter((l) => l.userId !== uid);
  data.botJobs = (data.botJobs ?? []).filter((j) => j.userId !== uid);
  data.botUpdates = (data.botUpdates ?? []).filter((u) => u.userId !== uid);
  const ownedBots = (data.bots ?? []).filter((b) => b.ownerUserId === uid).map((b) => b.id);
  data.botKv = (data.botKv ?? []).filter((k) => !ownedBots.includes(k.botId));
  data.botWebhookJobs = (data.botWebhookJobs ?? []).filter((j) => !ownedBots.includes(j.botId));
  data.botIdempotency = (data.botIdempotency ?? []).filter((i) => !ownedBots.includes(i.botId));
  data.miniGrants = (data.miniGrants ?? []).filter((g) => g.userId !== uid);
  data.miniReviews = (data.miniReviews ?? []).filter((r) => r.userId !== uid);
  data.miniSessions = (data.miniSessions ?? []).filter((s) => s.userId !== uid);
  data.miniAccessLogs = (data.miniAccessLogs ?? []).filter((l) => l.userId !== uid);
  data.aiChats = (data.aiChats ?? []).filter((c) => c.userId !== uid);
  data.aiMessages = (data.aiMessages ?? []).filter((m) => m.userId !== uid);
  data.aiMemory = (data.aiMemory ?? []).filter((m) => m.userId !== uid);
  data.aiPrefs = (data.aiPrefs ?? []).filter((p) => p.userId !== uid);
  if (data.aiSys) {
    data.aiSys.jobs = data.aiSys.jobs.filter((j) => j.userId !== uid);
    data.aiSys.idempotency = data.aiSys.idempotency.filter((i) => i.userId !== uid);
    data.aiSys.cache = data.aiSys.cache.filter((c) => c.userId !== uid);
    data.aiSys.vectors = data.aiSys.vectors.filter((v) => v.userId !== uid);
  }
  data.aiLogs = (data.aiLogs ?? []).filter((l) => l.userId !== uid);
  const ownedBiz = (data.businesses ?? []).filter((b) => b.ownerUserId === uid).map((b) => b.id);
  data.businesses = (data.businesses ?? []).filter((b) => b.ownerUserId !== uid);
  data.bizStaff = (data.bizStaff ?? []).filter((s) => s.userId !== uid && !ownedBiz.includes(s.businessId));
  data.bizProducts = (data.bizProducts ?? []).filter((p) => !ownedBiz.includes(p.businessId));
  data.bizReplies = (data.bizReplies ?? []).filter((r) => !ownedBiz.includes(r.businessId));
  data.bizThreads = (data.bizThreads ?? []).filter((t) => t.customerId !== uid && !ownedBiz.includes(t.businessId));
  const keepThreads = new Set((data.bizThreads ?? []).map((t) => t.id));
  data.bizMessages = (data.bizMessages ?? []).filter((m) => keepThreads.has(m.threadId));
  data.bizCarts = (data.bizCarts ?? []).filter((c) => c.userId !== uid && !ownedBiz.includes(c.businessId));
  data.bizOrders = (data.bizOrders ?? []).filter((o) => o.customerId !== uid && !ownedBiz.includes(o.businessId));
  data.shops = (data.shops ?? []).filter((s) => !ownedBiz.includes(s.businessId));
  data.addresses = (data.addresses ?? []).filter((a) => a.userId !== uid);
  data.payments = (data.payments ?? []).filter((p) => p.userId !== uid && !ownedBiz.includes(p.businessId));
  data.wallets = (data.wallets ?? []).filter((w) => w.userId !== uid);
  data.notifications = (data.notifications ?? []).filter((n) => n.userId !== uid);
  data.notifyPrefs = (data.notifyPrefs ?? []).filter((p) => p.userId !== uid);
  data.pushTokens = (data.pushTokens ?? []).filter((t) => t.userId !== uid);
  data.pushJobs = (data.pushJobs ?? []).filter((j) => j.userId !== uid);
  data.notifyDeadLetters = (data.notifyDeadLetters ?? []).filter((d) => d.userId !== uid);
  data.notifyAudit = (data.notifyAudit ?? []).filter((a) => a.userId !== uid);
  data.contacts = (data.contacts ?? []).filter((c) => c.ownerUserId !== uid);
  data.contactInvites = (data.contactInvites ?? []).filter((i) => i.ownerUserId !== uid);
  data.contactRequests = (data.contactRequests ?? []).filter((r) => r.fromUserId !== uid && r.toUserId !== uid);
  data.contactLists = (data.contactLists ?? []).filter((l) => l.ownerUserId !== uid);
  data.follows = (data.follows ?? []).filter((f) => f.followerId !== uid && f.followeeId !== uid);
  data.friendships = (data.friendships ?? []).filter((f) => f.userA !== uid && f.userB !== uid);
  for (const c of data.contacts ?? []) {
    if (c.nixoUserId === uid) c.nixoUserId = null;
  }
  for (const u of data.users) {
    u.friendIds = (u.friendIds ?? []).filter((id) => id !== uid);
    u.mutedPeerKeys = (u.mutedPeerKeys ?? []).filter((id) => id !== uid);
    u.contactIds = (u.contactIds ?? []).filter((id) => id !== uid);
    u.hideSuggestionIds = (u.hideSuggestionIds ?? []).filter((id) => id !== uid);
    u.notInterestedUserIds = (u.notInterestedUserIds ?? []).filter((id) => id !== uid);
    u.relationshipRev = (u.relationshipRev ?? 0) + 1;
  }
  data.inboxMetas = (data.inboxMetas ?? []).filter((m) => m.ownerUserId !== uid);
  data.chatFolders = (data.chatFolders ?? []).filter((f) => f.ownerUserId !== uid);
  data.stickerPrefs = (data.stickerPrefs ?? []).filter((p) => p.userId !== uid);
  data.stickerReports = (data.stickerReports ?? []).filter((r) => r.reporterUserId !== uid);
  data.fileAccessLogs = (data.fileAccessLogs ?? []).filter((s) => s.userId !== uid);
  data.mediaJobs = (data.mediaJobs ?? []).filter((j) => j.ownerUserId !== uid);
  data.vaultObjects = (data.vaultObjects ?? []).filter((o) => o.ownerUserId !== uid);
  data.vaultSessions = (data.vaultSessions ?? []).filter((s) => s.ownerUserId !== uid);
  data.vaultJobs = (data.vaultJobs ?? []).filter((j) => j.ownerUserId !== uid);
  data.vaultLinks = (data.vaultLinks ?? []).filter((l) => l.ownerUserId !== uid);
  data.dbJobs = (data.dbJobs ?? []).filter((j) => j.actorUserId !== uid);
  data.dbAudit = (data.dbAudit ?? []).filter((j) => j.actorUserId !== uid);
  data.lives = (data.lives ?? []).map((l) => {
    if (l.hostUserId === uid && l.status !== "ended") {
      return {
        ...l,
        status: "ended" as const,
        endedAt: now,
        emergencyStopped: l.emergencyStopped,
        participants: l.participants.map((p) => (p.leftAt ? p : { ...p, leftAt: now })),
      };
    }
    return {
      ...l,
      participants: l.participants.map((p) => (p.userId === uid && !p.leftAt ? { ...p, leftAt: now } : p)),
      uniqueJoins: l.uniqueJoins.filter((id) => id !== uid),
      reminders: l.reminders.filter((r) => r.userId !== uid),
      guestQueue: l.guestQueue.filter((g) => g.userId !== uid),
    };
  });
  data.liveRecordings = (data.liveRecordings ?? []).map((r) => (r.hostUserId === uid ? { ...r, deletedAt: now } : r));
  data.livePrefs = (data.livePrefs ?? []).filter((p) => p.userId !== uid);
  data.stickerPacks = (data.stickerPacks ?? []).map((p) =>
    p.ownerUserId === uid
      ? { ...p, deletedAt: now, memberIds: p.memberIds.filter((id) => id !== uid) }
      : { ...p, memberIds: p.memberIds.filter((id) => id !== uid) },
  );
  for (const m of data.messages ?? []) {
    if (m.reactions?.length) m.reactions = m.reactions.map((r) => ({ ...r, keys: r.keys.filter((k) => k !== uid) })).filter((r) => r.keys.length > 0);
  }
  for (const m of data.groupMessages ?? []) {
    if (m.reactions?.length) m.reactions = m.reactions.map((r) => ({ ...r, keys: r.keys.filter((k) => k !== uid) })).filter((r) => r.keys.length > 0);
  }
  for (const p of data.channelPosts ?? []) {
    if (p.reactions?.length) p.reactions = p.reactions.map((r) => ({ ...r, keys: r.keys.filter((k) => k !== uid) })).filter((r) => r.keys.length > 0);
  }
  for (const c of data.contacts ?? []) {
    if (c.nixoUserId === uid) c.nixoUserId = null;
  }
  data.groupCalls = (data.groupCalls ?? []).map((c) => ({
    ...c,
    participants: c.participants.map((p) => (p.userId === uid && !p.leftAt ? { ...p, leftAt: now } : p)),
    hostUserId: c.hostUserId === uid && c.status !== "ended" ? c.hostUserId : c.hostUserId,
  }));
  data.searchDocs = (data.searchDocs ?? []).filter((d) => d.entityId !== uid && d.parentId !== uid);
  data.searchQueryCache = [];
  data.searchTombstones = [
    { id: randomId(), docId: `user:${uid}`, reason: "account-delete", at: now },
    ...(data.searchTombstones ?? []).filter((t) => t.docId !== `user:${uid}`),
  ].slice(0, 2000);
  data.searchIndex = {
    gen: (data.searchIndex?.gen ?? 0) + 1,
    rebuiltAt: now,
    version: data.searchIndex?.version ?? 4,
  };
  if (data.graph) data.graph = purgeGraphSubject(data.graph, uid);
  data.consentEvents = (data.consentEvents ?? []).filter((e) => e.userId !== uid);
  data.privacyExports = (data.privacyExports ?? []).filter((e) => e.ownerUserId !== uid);
  data.ledger = (data.ledger ?? []).filter((t) => t.userId !== uid);
  data.shopNotices = (data.shopNotices ?? []).filter((n) => n.userId !== uid);
}
