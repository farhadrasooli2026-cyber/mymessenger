import "server-only";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import type { Channel } from "@/lib/identifiers";
import type { CatalogCategory, CatalogItem, UserPhoto, UsernameChange, Visibility } from "@/lib/profile-types";
import { defaultUserFields } from "@/lib/profile-types";
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
  targetKind: "user" | "chat";
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
