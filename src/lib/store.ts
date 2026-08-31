import "server-only";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import type { Channel } from "@/lib/identifiers";

export type UserStatus = "pending_profile" | "active";

export type UserRecord = {
  id: string;
  status: UserStatus;
  channel: Channel;
  identifierHash: string;
  identifierMasked: string;
  identifierCipher: string;
  displayName?: string;
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
  updatedAt: number;
};

export type ChatMessage = {
  id: string;
  threadId: string;
  ownerUserId: string;
  sender: "me" | "peer";
  text: string;
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
  storyViews: StoryView[];
};

const EMPTY: StoreData = {
  users: [],
  challenges: [],
  rateBuckets: [],
  humanChallenges: [],
  failedCycles: [],
  threads: [],
  messages: [],
  storyViews: [],
};

const STORE_PATH = path.join(
  process.cwd(),
  ".data",
  process.env.VITEST ? "nixo-store.test.json" : "nixo-store.json",
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
      users: parsed.users ?? [],
      challenges: parsed.challenges ?? [],
      rateBuckets: parsed.rateBuckets ?? [],
      humanChallenges: parsed.humanChallenges ?? [],
      failedCycles: parsed.failedCycles ?? [],
      threads: parsed.threads ?? [],
      messages: parsed.messages ?? [],
      storyViews: parsed.storyViews ?? [],
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

export function mutateStore<T>(mutator: (data: StoreData) => T | Promise<T>): Promise<T> {
  return enqueue(async () => {
    const data = await readStore();
    prune(data, Date.now());
    const result = await mutator(data);
    await writeStore(data);
    return result;
  });
}

export function readStoreSnapshot(): Promise<StoreData> {
  return enqueue(async () => {
    const data = await readStore();
    prune(data, Date.now());
    return data;
  });
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
