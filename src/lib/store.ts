import "server-only";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import type { Channel } from "@/lib/identifiers";
import type { CatalogCategory, CatalogItem, UserPhoto, UsernameChange, Visibility } from "@/lib/profile-types";
import { defaultUserFields } from "@/lib/profile-types";
import type { GroupPerms, GroupRole } from "@/lib/group-types";
import { DEFAULT_GROUP_PERMS } from "@/lib/group-types";
import type { CommunityPerms, CommunityRole, NotifyMode } from "@/lib/community-types";
import { DEFAULT_COMMUNITY_PERMS } from "@/lib/community-types";
import type { ChannelAdminPerms, ChannelNotify, ChannelPostKind, ChannelPostStatus, ChannelStaffRole } from "@/lib/channel-types";
import { DEFAULT_CHANNEL_ADMIN_PERMS } from "@/lib/channel-types";
import { DEFAULT_CATEGORIES, seedCatalogItems } from "@/lib/avatar-catalog";
import { BG_CATEGORIES, seedBackgroundItems } from "@/lib/background-catalog";
import { randomId } from "@/lib/crypto-utils";

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
    searchHistory: Array.isArray(user.searchHistory) ? user.searchHistory : [],
    privacyPhone: user.privacyPhone ?? "contacts",
    privacyFindPhone: user.privacyFindPhone ?? "contacts",
    privacyEmail: user.privacyEmail ?? "nobody",
    phoneAllowIds: Array.isArray(user.phoneAllowIds) ? user.phoneAllowIds : [],
    emailAllowIds: Array.isArray(user.emailAllowIds) ? user.emailAllowIds : [],
    findPhoneAllowIds: Array.isArray(user.findPhoneAllowIds) ? user.findPhoneAllowIds : [],
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
  if (kind === "voice" || kind === "photo" || kind === "video" || kind === "file" || kind === "system") return kind;
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
  };
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
    joinMode: group.joinMode === "open" || group.joinMode === "request" ? group.joinMode : "invite",
    maxMembers: group.maxMembers || 256,
    perms: { ...DEFAULT_GROUP_PERMS, ...(group.perms ?? {}) },
    inviteToken: group.inviteToken || "",
    members: Array.isArray(group.members) ? group.members : [],
    requests: Array.isArray(group.requests) ? group.requests : [],
    bans: Array.isArray(group.bans) ? group.bans : [],
    pinIds: Array.isArray(group.pinIds) ? group.pinIds : [],
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
    username: channel.username ?? null,
    visibility: channel.visibility === "private" ? "private" : "public",
    verified: Boolean(channel.verified),
    commentsEnabled: Boolean(channel.commentsEnabled),
    allowForward: channel.allowForward !== false,
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
    deletedAt: channel.deletedAt ?? null,
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
  searchHistory: string[];
  privacyPhone: import("@/lib/profile-types").Visibility3;
  privacyFindPhone: import("@/lib/profile-types").Visibility3;
  privacyEmail: import("@/lib/profile-types").Visibility3;
  phoneAllowIds: string[];
  emailAllowIds: string[];
  findPhoneAllowIds: string[];
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
};

export type ChatMessage = {
  id: string;
  threadId: string;
  ownerUserId: string;
  sender: "me" | "peer";
  enc: "e2ee-v1" | "purged";
  ciphertext: string;
  nonce: string;
  createdAt: number;
  kind: "text" | "voice" | "photo" | "video" | "file" | "system";
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
};

export type SafetyReport = {
  id: string;
  reporterId: string;
  targetKind: "user" | "chat" | "group" | "community" | "channel" | "story";
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
  kind: "text" | "photo" | "video";
  body: string;
  caption: string;
  bg: string;
  font: string;
  align: "right" | "center" | "left";
  filter: string;
  rotate: number;
  zoom: number;
  overlay: string;
  media: string;
  musicId: string | null;
  linkUrl: string;
  mentions: string[];
  allowShare: boolean;
  visibility: "everyone" | "contacts" | "closeFriends" | "selected";
  allowIds: string[];
  hideFromIds: string[];
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
export type CallStatus = "ringing" | "active" | "ended" | "declined" | "missed";
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

export type GroupMember = {
  key: string;
  kind: "user" | "seed";
  role: GroupRole;
  name: string;
  joinedAt: number;
  mutedUntil: number | null;
  restrictedUntil: number | null;
  notifyMutedUntil: number | null;
  leftAt: number | null;
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
  ownerUserId: string;
  joinMode: "invite" | "request" | "open";
  maxMembers: number;
  perms: GroupPerms;
  inviteToken: string;
  members: GroupMember[];
  requests: GroupJoinRequest[];
  bans: GroupBan[];
  pinIds: string[];
  communityId: string | null;
  createdAt: number;
  updatedAt: number;
  deletedAt: number | null;
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
  kind: "text" | "voice" | "photo" | "video" | "file" | "system" | "poll";
  replyToId?: string | null;
  mentions?: string[];
  reactions: { emoji: string; keys: string[] }[];
  poll?: GroupPoll;
  blobId?: string;
  chunkCount?: number;
  deleted?: boolean;
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
  createdAt: number;
  deleted?: boolean;
};

export type PubChannelRecord = {
  id: string;
  name: string;
  description: string;
  username: string | null;
  color: string;
  visibility: "public" | "private";
  ownerUserId: string;
  verified: boolean;
  commentsEnabled: boolean;
  allowForward: boolean;
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
  createdAt: number;
  updatedAt: number;
  deletedAt: number | null;
};

export type SavedItem = {
  id: string;
  ownerUserId: string;
  kind: "text" | "photo" | "video" | "voice" | "file" | "link" | "message";
  body: string;
  linkUrl: string;
  fileName: string;
  fileType: string;
  fileSize: number;
  media: string;
  tag: string;
  pinned: boolean;
  source: {
    type: "chat" | "group" | "channel" | "community" | "manual";
    id: string;
    name: string;
    messageId?: string;
  } | null;
  createdAt: number;
  deletedAt: number | null;
};

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
      userStories: Array.isArray(parsed.userStories) ? parsed.userStories : [],
      storyWatches: Array.isArray(parsed.storyWatches) ? parsed.storyWatches : [],
      storyReactions: Array.isArray(parsed.storyReactions) ? parsed.storyReactions : [],
      storyReplies: Array.isArray(parsed.storyReplies) ? parsed.storyReplies : [],
      calls: Array.isArray(parsed.calls) ? parsed.calls : [],
      groups: Array.isArray(parsed.groups) ? parsed.groups.map(hydrateGroup) : [],
      groupMessages: Array.isArray(parsed.groupMessages) ? parsed.groupMessages : [],
      communities: Array.isArray(parsed.communities) ? parsed.communities.map(hydrateCommunity) : [],
      pubChannels: Array.isArray(parsed.pubChannels) ? parsed.pubChannels.map(hydratePubChannel) : [],
      channelPosts: Array.isArray(parsed.channelPosts) ? parsed.channelPosts : [],
      savedItems: Array.isArray(parsed.savedItems) ? parsed.savedItems : [],
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
}
