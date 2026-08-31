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
import { DEFAULT_CATEGORIES, seedCatalogItems } from "@/lib/avatar-catalog";
import { BG_CATEGORIES, seedBackgroundItems } from "@/lib/background-catalog";

export type { CatalogCategory, CatalogItem };

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
  createdAt: number;
  verifiedAt?: number;
  activatedAt?: number;
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
  targetKind: "user" | "chat" | "group" | "community" | "channel";
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
  calls: CallRecord[];
  groups: GroupRecord[];
  groupMessages: GroupMessage[];
  communities: CommunityRecord[];
  catalogCategories: CatalogCategory[];
  catalogItems: CatalogItem[];
  bgCategories: CatalogCategory[];
  bgItems: CatalogItem[];
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
  calls: [],
  groups: [],
  groupMessages: [],
  communities: [],
  catalogCategories: [],
  catalogItems: [],
  bgCategories: [],
  bgItems: [],
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
      calls: Array.isArray(parsed.calls) ? parsed.calls : [],
      groups: Array.isArray(parsed.groups) ? parsed.groups.map(hydrateGroup) : [],
      groupMessages: Array.isArray(parsed.groupMessages) ? parsed.groupMessages : [],
      communities: Array.isArray(parsed.communities) ? parsed.communities.map(hydrateCommunity) : [],
      catalogCategories: parsed.catalogCategories ?? [],
      catalogItems: parsed.catalogItems ?? [],
      bgCategories: parsed.bgCategories ?? [],
      bgItems: parsed.bgItems ?? [],
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
}
