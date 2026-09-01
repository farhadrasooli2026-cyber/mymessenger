import "server-only";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import type { Channel } from "@/lib/identifiers";
import type { CatalogCategory, CatalogItem, UserPhoto, UsernameChange, Visibility } from "@/lib/profile-types";
import { defaultUserFields } from "@/lib/profile-types";
import type { GroupAdminPerms, GroupHistoryMode, GroupPerms, GroupRole } from "@/lib/group-types";
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
  BotChat,
  BotLog,
  BotMessage,
  BotPlacement,
  BotRecord,
  BotUpdate,
  MiniAppRecord,
  MiniGrant,
} from "@/lib/bot-types";
import type { AiChatRecord, AiLog, AiMemoryItem, AiMessageRecord, AiPrefs } from "@/lib/ai-types";
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
import type { NotifyPrefs, NotifyRecord } from "@/lib/notify-types";

export type { CatalogCategory, CatalogItem };

function hydrateDevice(d: DeviceSession): DeviceSession {
  return {
    ...d,
    name: d.name || d.label || "Unknown Device",
    deviceType: d.deviceType ?? "unknown",
    os: d.os || "Unknown",
    appVersion: d.appVersion || "0.1.0-web",
    pending: Boolean(d.pending),
    trusted: d.pending ? false : d.trusted !== false,
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
    accountStatus: user.accountStatus === "pending_deletion" || user.accountStatus === "closed" ? user.accountStatus : "active",
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
  };
}

function hydrateKind(kind?: string): ChatMessage["kind"] {
  if (kind === "voice" || kind === "photo" || kind === "video" || kind === "file" || kind === "system" || kind === "sticker") {
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
    inviteToken: group.inviteToken || "",
    members: Array.isArray(group.members) ? group.members : [],
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
    groupIds: Array.isArray(community.groupIds) ? community.groupIds : [],
    channels: Array.isArray(community.channels) ? community.channels : [],
    members: Array.isArray(community.members) ? community.members : [],
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
    purpose: channel.purpose ?? "general",
    businessId: channel.businessId ?? null,
    verified: Boolean(channel.verified),
    commentsEnabled: Boolean(channel.commentsEnabled),
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
    staff: Array.isArray(channel.staff) ? channel.staff : [],
    subscribers: Array.isArray(channel.subscribers) ? channel.subscribers : [],
    bans: Array.isArray(channel.bans) ? channel.bans : [],
    pinIds: Array.isArray(channel.pinIds) ? channel.pinIds : [],
    audit: Array.isArray(channel.audit) ? channel.audit : [],
    liveActive: Boolean(channel.liveActive),
    liveTitle: channel.liveTitle ?? "",
    liveChatEnabled: channel.liveChatEnabled !== false,
    liveChat: Array.isArray(channel.liveChat) ? channel.liveChat : [],
    liveStreamId: channel.liveStreamId ?? null,
    stories: Array.isArray(channel.stories) ? channel.stories : [],
    deletedAt: channel.deletedAt ?? null,
  };
}

function hydrateUserStory(story: UserStory): UserStory {
  const kinds = ["text", "photo", "video", "gif", "sticker", "location"] as const;
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
    visibility: story.visibility ?? "everyone",
    allowIds: Array.isArray(story.allowIds) ? story.allowIds : [],
    hideFromIds: Array.isArray(story.hideFromIds) ? story.hideFromIds : [],
    purpose: story.purpose ?? "general",
    source: story.source === "business" || story.source === "channel" ? story.source : "user",
    sourceId: story.sourceId ?? null,
    draft: Boolean(story.draft),
    videoDurationMs: typeof story.videoDurationMs === "number" ? story.videoDurationMs : 0,
    deletedAt: story.deletedAt ?? null,
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
  closeFriendIds: string[];
  mutedStoryUserIds: string[];
  storyNotifyOffIds: string[];
  statusPreset: "" | "available" | "busy" | "work" | "away" | "custom";
  statusText: string;
  statusPrivacy: Visibility;
  statusAllowIds: string[];
  defaultStoryPrivacy: "everyone" | "contacts" | "closeFriends" | "selected";
  defaultHideFromIds: string[];
  storyAllowReplies: boolean;
  storyAllowShare: boolean;
  storyArchiveEnabled: boolean;
  searchHistory: string[];
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
  accountStatus?: "active" | "pending_deletion" | "closed";
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
  | "device_deny";

export type AuditEvent = {
  id: string;
  userId: string;
  kind: SecurityEventKind;
  createdAt: number;
  ipHint?: string;
  userAgent?: string;
  deviceSessionId?: string;
  detail?: string;
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
};

export type ContactInvite = {
  id: string;
  token: string;
  ownerUserId: string;
  maxUses: number | null;
  uses: number;
  expiresAt: number | null;
  createdAt: number;
};

export type ContactRequest = {
  id: string;
  fromUserId: string;
  toUserId: string;
  status: "pending" | "accepted" | "declined";
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
  kind: "text" | "voice" | "photo" | "video" | "file" | "system" | "sticker";
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
  systemEvent?: { type: "disappear"; ms: number | null } | { type: "capture"; messageId: string };
  captureCount?: number;
  stickerId?: string;
  reactions?: { emoji: string; keys: string[] }[];
};

export type SafetyReport = {
  id: string;
  reporterId: string;
  targetKind: "user" | "chat" | "group" | "community" | "channel" | "story" | "bot" | "miniapp" | "business" | "sticker" | "live";
  targetKey: string;
  threadId?: string;
  messageIds: string[];
  category: "spam" | "abuse" | "fake" | "harassment" | "other";
  details: string;
  createdAt: number;
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
};

export type StoryWatch = {
  storyId: string;
  viewerId: string;
  viewerName: string;
  viewedAt: number;
};

export type StoryReaction = {
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
};

export type GroupCallParticipant = {
  userId: string;
  name: string;
  role: "host" | "admin" | "member";
  joinedAt: number;
  leftAt: number | null;
  mutedByHost: boolean;
  kicked: boolean;
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
  createdAt: number;
  endedAt: number | null;
  participants: GroupCallParticipant[];
};

export type GroupMember = {
  key: string;
  kind: "user" | "seed" | "bot";
  role: GroupRole;
  name: string;
  joinedAt: number;
  mutedUntil: number | null;
  restrictedUntil: number | null;
  notifyMutedUntil: number | null;
  notifyMentions?: boolean;
  lastSentAt?: number | null;
  leftAt: number | null;
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
  status: "pending" | "approved" | "rejected";
};

export type GroupBan = {
  key: string;
  at: number;
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
  deleted?: boolean;
  stickerId?: string;
  durationMs?: number;
};

export type CommunityMember = {
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
  status: "pending" | "approved" | "rejected";
};

export type CommunityBan = { key: string; at: number };

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
  userId: string;
  role: ChannelStaffRole;
  name: string;
};

export type ChannelSubscriber = {
  userId: string;
  name: string;
  username: string | null;
  subscribedAt: number;
  notify: ChannelNotify;
  leftAt: number | null;
};

export type ChannelComment = {
  id: string;
  authorKey: string;
  authorName: string;
  body: string;
  createdAt: number;
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
  forwards: number;
  createdAt: number;
  durationMs?: number;
  deleted?: boolean;
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
  purpose: import("@/lib/channel-types").ChannelPurpose;
  businessId: string | null;
  ownerUserId: string;
  verified: boolean;
  commentsEnabled: boolean;
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
  subscribers: ChannelSubscriber[];
  bans: { key: string; at: number }[];
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
  calls: CallRecord[];
  groups: GroupRecord[];
  groupMessages: GroupMessage[];
  communities: CommunityRecord[];
  pubChannels: PubChannelRecord[];
  channelPosts: ChannelPost[];
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
  passkeyChallenges: PasskeyChallenge[];
  vulnReports: VulnReport[];
  backups: EncryptedBackup[];
  closedAccounts: ClosedAccount[];
  bots: BotRecord[];
  botChats: BotChat[];
  botMessages: BotMessage[];
  miniApps: MiniAppRecord[];
  miniGrants: MiniGrant[];
  botPlacements: BotPlacement[];
  botLogs: BotLog[];
  botUpdates: BotUpdate[];
  aiChats: AiChatRecord[];
  aiMessages: AiMessageRecord[];
  aiMemory: AiMemoryItem[];
  aiPrefs: AiPrefs[];
  aiLogs: AiLog[];
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
  groupCalls: GroupCallRoom[];
  contacts: ContactRecord[];
  contactInvites: ContactInvite[];
  contactRequests: ContactRequest[];
  usernameHolds: UsernameHold[];
  reservedUsernames: string[];
  inboxMetas: InboxMeta[];
  chatFolders: ChatFolder[];
  stickerPacks: StickerPack[];
  stickers: StickerItem[];
  stickerPrefs: StickerPrefs[];
  stickerReports: StickerModeration[];
  fileAccessLogs: { id: string; userId: string; action: string; target: string; at: number }[];
  lives: LiveStream[];
  liveRecordings: LiveRecordingMeta[];
  livePrefs: LivePrefs[];
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
  calls: [],
  groups: [],
  groupMessages: [],
  communities: [],
  pubChannels: [],
  channelPosts: [],
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
  passkeyChallenges: [],
  vulnReports: [],
  backups: [],
  closedAccounts: [],
  bots: [],
  botChats: [],
  botMessages: [],
  miniApps: [],
  miniGrants: [],
  botPlacements: [],
  botLogs: [],
  botUpdates: [],
  aiChats: [],
  aiMessages: [],
  aiMemory: [],
  aiPrefs: [],
  aiLogs: [],
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
  groupCalls: [],
  contacts: [],
  contactInvites: [],
  contactRequests: [],
  usernameHolds: [],
  reservedUsernames: [],
  inboxMetas: [],
  chatFolders: [],
  stickerPacks: [],
  stickers: [],
  stickerPrefs: [],
  stickerReports: [],
  fileAccessLogs: [],
  lives: [],
  liveRecordings: [],
  livePrefs: [],
};

const STORE_PATH = path.join(
  process.cwd(),
  ".data",
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

async function readStore(): Promise<StoreData> {
  try {
    const raw = await readFile(STORE_PATH, "utf8");
    const parsed = JSON.parse(raw) as StoreData;
    return {
      users: (parsed.users ?? []).map(hydrateUser),
      challenges: parsed.challenges ?? [],
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
            forwards: typeof p.forwards === "number" ? p.forwards : 0,
            reactions: Array.isArray(p.reactions) ? p.reactions : [],
            comments: Array.isArray(p.comments) ? p.comments : [],
          }))
        : [],
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
      passkeyChallenges: Array.isArray(parsed.passkeyChallenges) ? parsed.passkeyChallenges : [],
      vulnReports: Array.isArray(parsed.vulnReports) ? parsed.vulnReports : [],
      backups: Array.isArray(parsed.backups) ? parsed.backups : [],
      closedAccounts: Array.isArray(parsed.closedAccounts) ? parsed.closedAccounts : [],
      bots: Array.isArray(parsed.bots) ? parsed.bots : [],
      botChats: Array.isArray(parsed.botChats) ? parsed.botChats : [],
      botMessages: Array.isArray(parsed.botMessages) ? parsed.botMessages : [],
      miniApps: Array.isArray(parsed.miniApps) ? parsed.miniApps : [],
      miniGrants: Array.isArray(parsed.miniGrants) ? parsed.miniGrants : [],
      botPlacements: Array.isArray(parsed.botPlacements) ? parsed.botPlacements : [],
      botLogs: Array.isArray(parsed.botLogs) ? parsed.botLogs : [],
      botUpdates: Array.isArray(parsed.botUpdates) ? parsed.botUpdates : [],
      aiChats: Array.isArray(parsed.aiChats) ? parsed.aiChats : [],
      aiMessages: Array.isArray(parsed.aiMessages) ? parsed.aiMessages : [],
      aiMemory: Array.isArray(parsed.aiMemory) ? parsed.aiMemory : [],
      aiPrefs: Array.isArray(parsed.aiPrefs) ? parsed.aiPrefs : [],
      aiLogs: Array.isArray(parsed.aiLogs) ? parsed.aiLogs : [],
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
      groupCalls: Array.isArray(parsed.groupCalls) ? parsed.groupCalls : [],
      contacts: Array.isArray(parsed.contacts) ? parsed.contacts : [],
      contactInvites: Array.isArray(parsed.contactInvites) ? parsed.contactInvites : [],
      contactRequests: Array.isArray(parsed.contactRequests) ? parsed.contactRequests : [],
      usernameHolds: Array.isArray(parsed.usernameHolds) ? parsed.usernameHolds : [],
      reservedUsernames: Array.isArray(parsed.reservedUsernames) ? parsed.reservedUsernames : [],
      inboxMetas: Array.isArray(parsed.inboxMetas) ? parsed.inboxMetas.map(hydrateInboxMeta) : [],
      chatFolders: Array.isArray(parsed.chatFolders) ? parsed.chatFolders.map(hydrateChatFolder) : [],
      stickerPacks: Array.isArray(parsed.stickerPacks) ? parsed.stickerPacks : [],
      stickers: Array.isArray(parsed.stickers) ? parsed.stickers : [],
      stickerPrefs: Array.isArray(parsed.stickerPrefs) ? parsed.stickerPrefs : [],
      stickerReports: Array.isArray(parsed.stickerReports) ? parsed.stickerReports : [],
      fileAccessLogs: Array.isArray(parsed.fileAccessLogs) ? parsed.fileAccessLogs : [],
      lives: Array.isArray(parsed.lives) ? parsed.lives : [],
      liveRecordings: Array.isArray(parsed.liveRecordings) ? parsed.liveRecordings : [],
      livePrefs: Array.isArray(parsed.livePrefs) ? parsed.livePrefs : [],
    };
  } catch {
    return structuredClone(EMPTY);
  }
}

async function writeStore(data: StoreData): Promise<void> {
  await mkdir(path.dirname(STORE_PATH), { recursive: true });
  const tmp = `${STORE_PATH}.${process.pid}.tmp`;
  await writeFile(tmp, JSON.stringify(data), "utf8");
  const { rename } = await import("node:fs/promises");
  await rename(tmp, STORE_PATH);
}

export function resetStoreForTests(): Promise<void> {
  return enqueue(async () => {
    await writeStore(structuredClone(EMPTY));
  });
}

export function mutateStore<T>(mutator: (data: StoreData) => T | Promise<T>): Promise<T> {
  return enqueue(async () => {
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
  data.userStories = (data.userStories ?? []).filter((s) => s.ownerUserId !== uid);
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
  data.miniGrants = (data.miniGrants ?? []).filter((g) => g.userId !== uid);
  data.aiChats = (data.aiChats ?? []).filter((c) => c.userId !== uid);
  data.aiMessages = (data.aiMessages ?? []).filter((m) => m.userId !== uid);
  data.aiMemory = (data.aiMemory ?? []).filter((m) => m.userId !== uid);
  data.aiPrefs = (data.aiPrefs ?? []).filter((p) => p.userId !== uid);
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
  data.contacts = (data.contacts ?? []).filter((c) => c.ownerUserId !== uid);
  data.contactInvites = (data.contactInvites ?? []).filter((i) => i.ownerUserId !== uid);
  data.contactRequests = (data.contactRequests ?? []).filter((r) => r.fromUserId !== uid && r.toUserId !== uid);
  data.inboxMetas = (data.inboxMetas ?? []).filter((m) => m.ownerUserId !== uid);
  data.chatFolders = (data.chatFolders ?? []).filter((f) => f.ownerUserId !== uid);
  data.stickerPrefs = (data.stickerPrefs ?? []).filter((p) => p.userId !== uid);
  data.stickerReports = (data.stickerReports ?? []).filter((r) => r.reporterUserId !== uid);
  data.fileAccessLogs = (data.fileAccessLogs ?? []).filter((s) => s.userId !== uid);
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
  data.ledger = (data.ledger ?? []).filter((t) => t.userId !== uid);
  data.shopNotices = (data.shopNotices ?? []).filter((n) => n.userId !== uid);
}
