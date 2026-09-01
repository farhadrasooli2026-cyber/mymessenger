export const VAULT_USER_QUOTA = 200 * 1024 * 1024;
export const VAULT_GROUP_QUOTA = 400 * 1024 * 1024;
export const VAULT_CHANNEL_QUOTA = 800 * 1024 * 1024;
export const VAULT_SESSION_TTL_MS = 60 * 60 * 1000;
export const VAULT_SOFT_MS = 30 * 24 * 60 * 60 * 1000;
export const VAULT_TOKEN_MS = 12 * 60 * 1000;
export const VAULT_CHUNK_MAX = 280_000;
export const VAULT_MAX_CHUNKS = 200;
export const VAULT_RETRY_MAX = 3;
export const VAULT_ALERT_RATIO = 0.85;

export type VaultScope = "user" | "group" | "channel";
export type VaultStatus = "uploading" | "processing" | "ready" | "failed" | "deleted" | "quarantined";
export type VaultPrivacy = "private" | "public";
export type VaultKind = "image" | "video" | "audio" | "document" | "archive" | "text" | "unknown";
export type VaultScan = "pending" | "clean" | "suspect" | "blocked";

export type VaultObject = {
  id: string;
  ownerUserId: string;
  scope: VaultScope;
  scopeId: string;
  originalName: string;
  storageKey: string;
  thumbKey?: string;
  mime: string;
  kind: VaultKind;
  size: number;
  hash: string;
  status: VaultStatus;
  privacy: VaultPrivacy;
  scan: VaultScan;
  width?: number;
  height?: number;
  durationMs?: number;
  duplicateOf: string | null;
  generation: number;
  retries: number;
  lastError?: string;
  createdAt: number;
  updatedAt: number;
  deletedAt: number | null;
};

export type VaultSession = {
  id: string;
  ownerUserId: string;
  objectId: string;
  expectedSize: number;
  expectedChunks: number;
  received: number[];
  originalName: string;
  declaredMime: string;
  clientNonce: string;
  scope: VaultScope;
  scopeId: string;
  privacy: VaultPrivacy;
  expiresAt: number;
  createdAt: number;
};

export type VaultJob = {
  id: string;
  ownerUserId: string;
  objectId: string;
  kind: "scan" | "thumb" | "exif" | "cleanup";
  status: "queued" | "running" | "done" | "failed";
  retries: number;
  lastError?: string;
  idempotencyKey: string;
  createdAt: number;
  updatedAt: number;
};

export type StorageMetrics = {
  uploads: number;
  uploadFail: number;
  downloads: number;
  downloadFail: number;
  processFail: number;
  lastUploadMs: number;
  lastDownloadMs: number;
  lastProcessMs: number;
  alertAt: number | null;
};
