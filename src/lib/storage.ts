import "server-only";
import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import { randomId } from "@/lib/crypto-utils";
import { config } from "@/lib/config";
import { hitRateLimit } from "@/lib/rate-limit";
import { mutateStore, readStoreSnapshot } from "@/lib/store";
import type { StoreData } from "@/lib/store";
import {
  FILE_DL_PER_MIN,
  FILE_SEND_PER_MIN,
  jpegDimensions,
  maxBytesForKind,
  pngDimensions,
  sanitizeFileName,
  scanNamedFile,
  sniffFileBytes,
  sortFiles,
  stripJpegExif,
  type FileKind,
  type FileSort,
} from "@/lib/files";
import { logFileAccess } from "@/lib/file-access";
import {
  VAULT_ALERT_RATIO,
  VAULT_CHANNEL_QUOTA,
  VAULT_CHUNK_MAX,
  VAULT_GROUP_QUOTA,
  VAULT_MAX_CHUNKS,
  VAULT_RETRY_MAX,
  VAULT_SESSION_TTL_MS,
  VAULT_SOFT_MS,
  VAULT_TOKEN_MS,
  VAULT_USER_QUOTA,
  type VaultJob,
  type VaultKind,
  type VaultObject,
  type VaultPrivacy,
  type VaultScope,
  type VaultSession,
  type StorageMetrics,
} from "@/lib/storage-types";
import {
  deleteSessionDir,
  deleteVaultBlob,
  listSessionIndexes,
  listVaultKeys,
  readSessionChunks,
  readVaultBlob,
  readVaultRange,
  vaultBlobSize,
  writeSessionChunk,
  writeVaultBlob,
} from "@/lib/storage-files";

const TINY_PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
  "base64",
);

function metricsOf(data: StoreData): StorageMetrics {
  data.storageMetrics ??= {
    uploads: 0,
    uploadFail: 0,
    downloads: 0,
    downloadFail: 0,
    processFail: 0,
    lastUploadMs: 0,
    lastDownloadMs: 0,
    lastProcessMs: 0,
    alertAt: null,
  };
  return data.storageMetrics;
}

function quotaFor(scope: VaultScope) {
  if (scope === "group") return VAULT_GROUP_QUOTA;
  if (scope === "channel") return VAULT_CHANNEL_QUOTA;
  return VAULT_USER_QUOTA;
}

function usedBytes(data: StoreData, scope: VaultScope, scopeId: string) {
  return (data.vaultObjects ?? [])
    .filter((o) => o.scope === scope && o.scopeId === scopeId && o.status !== "deleted" && !o.deletedAt)
    .reduce((n, o) => n + (o.duplicateOf ? 0 : o.size), 0);
}

export async function authorizeVaultScope(userId: string, scope: VaultScope, scopeId: string) {
  const data = await readStoreSnapshot();
  if (scope === "user") {
    if (scopeId && scopeId !== userId) return { ok: false as const, error: "سهمیه فقط برای حساب خودت.", status: 403 };
    return { ok: true as const, scopeId: userId };
  }
  if (scope === "group") {
    const group = data.groups.find((g) => g.id === scopeId && !g.deletedAt);
    if (!group?.members.some((m) => m.key === userId && !m.leftAt)) {
      return { ok: false as const, error: "عضو این گروه نیستی.", status: 403 };
    }
    return { ok: true as const, scopeId };
  }
  const channel = data.pubChannels.find((c) => c.id === scopeId && !c.deletedAt);
  if (!channel) return { ok: false as const, error: "کانال یافت نشد.", status: 404 };
  const staff = channel.staff.some((s) => s.userId === userId);
  const sub = channel.subscribers.some((s) => s.userId === userId && !s.leftAt);
  if (!staff && !sub) return { ok: false as const, error: "مشترک این کانال نیستی.", status: 403 };
  return { ok: true as const, scopeId };
}

function canReadObject(data: StoreData, userId: string, obj: VaultObject) {
  if (obj.status === "deleted" || obj.deletedAt) return false;
  if (obj.ownerUserId === userId) return true;
  if (obj.status !== "ready" || obj.scan !== "clean") return false;
  if (obj.privacy === "public") return true;
  if (obj.scope === "group") {
    const group = data.groups.find((g) => g.id === obj.scopeId && !g.deletedAt);
    return Boolean(group?.members.some((m) => m.key === userId && !m.leftAt));
  }
  if (obj.scope === "channel") {
    const channel = data.pubChannels.find((c) => c.id === obj.scopeId && !c.deletedAt);
    if (!channel) return false;
    return channel.staff.some((s) => s.userId === userId) || channel.subscribers.some((s) => s.userId === userId && !s.leftAt);
  }
  return false;
}

export function signVaultMedia(objectId: string, userId: string, generation: number, exp = Date.now() + VAULT_TOKEN_MS) {
  const sig = createHmac("sha256", config.pepper).update(`v.${objectId}.${userId}.${generation}.${exp}`).digest("hex").slice(0, 32);
  return `${exp}.${sig}`;
}

export function verifyVaultMedia(objectId: string, userId: string, generation: number, token: string) {
  const [expRaw, sig] = token.split(".");
  const exp = Number(expRaw);
  if (!exp || !sig || Date.now() > exp) return false;
  const expected = signVaultMedia(objectId, userId, generation, exp);
  try {
    return timingSafeEqual(Buffer.from(expected), Buffer.from(`${exp}.${sig}`));
  } catch {
    return false;
  }
}

export function parseByteRange(header: string | null, size: number): { start: number; end: number } | null {
  if (!header) return null;
  const m = /^bytes=(\d*)-(\d*)$/i.exec(header.trim());
  if (!m) return null;
  let start = m[1] === "" ? Number.NaN : Number(m[1]);
  let end = m[2] === "" ? Number.NaN : Number(m[2]);
  if (Number.isNaN(start) && Number.isNaN(end)) return null;
  if (Number.isNaN(start)) {
    start = Math.max(0, size - end);
    end = size - 1;
  } else if (Number.isNaN(end)) {
    end = size - 1;
  }
  if (start < 0 || end >= size || start > end) return null;
  return { start, end };
}

function publicObject(obj: VaultObject, viewerId: string) {
  const token = obj.status === "ready" && !obj.deletedAt ? signVaultMedia(obj.id, viewerId, obj.generation) : "";
  return {
    id: obj.id,
    originalName: obj.originalName,
    mime: obj.mime,
    kind: obj.kind,
    size: obj.size,
    status: obj.status,
    privacy: obj.privacy,
    scan: obj.scan,
    width: obj.width,
    height: obj.height,
    durationMs: obj.durationMs,
    duplicateOf: obj.duplicateOf,
    createdAt: obj.createdAt,
    updatedAt: obj.updatedAt,
    deletedAt: obj.deletedAt,
    scope: obj.scope,
    owner: obj.ownerUserId === viewerId,
    mediaUrl: token ? `/api/storage/${obj.id}/media?t=${token}` : "",
    thumbUrl: token && obj.thumbKey ? `/api/storage/${obj.id}/media?t=${token}&thumb=1` : "",
  };
}

export async function storageDashboard(userId: string) {
  const data = await readStoreSnapshot();
  const mine = (data.vaultObjects ?? []).filter((o) => o.ownerUserId === userId && o.status !== "deleted");
  const live = mine.filter((o) => !o.deletedAt && o.status !== "quarantined");
  const used = usedBytes(data, "user", userId);
  const quota = VAULT_USER_QUOTA;
  const m = metricsOf(data);
  return {
    ok: true as const,
    used,
    quota,
    ratio: used / quota,
    alert: used / quota >= VAULT_ALERT_RATIO,
    counts: {
      total: live.length,
      image: live.filter((o) => o.kind === "image").length,
      video: live.filter((o) => o.kind === "video").length,
      audio: live.filter((o) => o.kind === "audio").length,
      file: live.filter((o) => o.kind !== "image" && o.kind !== "video" && o.kind !== "audio").length,
      trash: mine.filter((o) => o.deletedAt).length,
      processing: mine.filter((o) => o.status === "processing" || o.status === "uploading").length,
      failed: mine.filter((o) => o.status === "failed" || o.status === "quarantined").length,
    },
    queue: (data.vaultJobs ?? []).filter((j) => j.ownerUserId === userId && j.status !== "done").length,
    metrics: {
      uploads: m.uploads,
      uploadFail: m.uploadFail,
      downloads: m.downloads,
      downloadFail: m.downloadFail,
      processFail: m.processFail,
      lastUploadMs: m.lastUploadMs,
      lastDownloadMs: m.lastDownloadMs,
      lastProcessMs: m.lastProcessMs,
    },
    sessions: (data.vaultSessions ?? [])
      .filter((s) => s.ownerUserId === userId && s.expiresAt > Date.now())
      .map((s) => ({
        id: s.id,
        objectId: s.objectId,
        received: s.received.length,
        expectedChunks: s.expectedChunks,
        expiresAt: s.expiresAt,
        originalName: s.originalName,
      })),
  };
}

export async function listVault(
  userId: string,
  opts: { q?: string; kind?: string; sort?: FileSort; cursor?: string; trash?: boolean; status?: string },
) {
  const data = await readStoreSnapshot();
  let items = (data.vaultObjects ?? []).filter((o) => canReadObject(data, userId, o) || (opts.trash && o.ownerUserId === userId && o.deletedAt));
  if (opts.trash) items = items.filter((o) => o.ownerUserId === userId && o.deletedAt);
  else items = items.filter((o) => !o.deletedAt);
  if (opts.kind && opts.kind !== "all") items = items.filter((o) => o.kind === opts.kind);
  if (opts.status) items = items.filter((o) => o.status === opts.status);
  if (opts.q) {
    const q = opts.q.toLowerCase();
    items = items.filter((o) => o.originalName.toLowerCase().includes(q) || o.mime.toLowerCase().includes(q));
  }
  const mapped = items.map((o) => ({
    ...publicObject(o, userId),
    name: o.originalName,
    createdAt: o.createdAt,
  }));
  const sorted = sortFiles(mapped, opts.sort ?? "newest");
  const page = sorted.slice(0, 40);
  return { ok: true as const, items: page, total: sorted.length, next: sorted.length > 40 };
}

export async function beginVaultUpload(
  userId: string,
  input: {
    name: string;
    size: number;
    mime?: string;
    chunks: number;
    clientNonce?: string;
    scope?: VaultScope;
    scopeId?: string;
    privacy?: VaultPrivacy;
  },
) {
  const originalName = sanitizeFileName(input.name);
  const named = scanNamedFile(originalName, input.mime ?? "", input.size);
  if (!named.ok) return { ok: false as const, error: named.warning ?? "فایل رد شد.", status: 400 };
  const chunks = Math.floor(input.chunks);
  if (chunks < 1 || chunks > VAULT_MAX_CHUNKS) return { ok: false as const, error: "تعداد تکه نامعتبر است.", status: 400 };
  if (input.size < 1) return { ok: false as const, error: "حجم نامعتبر است.", status: 400 };
  const scope: VaultScope = input.scope === "group" || input.scope === "channel" ? input.scope : "user";
  const scoped = await authorizeVaultScope(userId, scope, input.scopeId || userId);
  if (!scoped.ok) return scoped;
  return mutateStore((data) => {
    const gate = hitRateLimit(data, `vault:up:${userId}`, 60_000, FILE_SEND_PER_MIN);
    if (!gate.allowed) return { ok: false as const, error: "آپلود پیاپی محدود شد.", status: 429 };
    const used = usedBytes(data, scope, scoped.scopeId);
    const quota = quotaFor(scope);
    if (used + input.size > quota) return { ok: false as const, error: "سهمیه ذخیره‌سازی پر است.", status: 413 };
    const nonce = (input.clientNonce ?? "").slice(0, 80);
    if (nonce) {
      const existing = (data.vaultSessions ?? []).find((s) => s.ownerUserId === userId && s.clientNonce === nonce && s.expiresAt > Date.now());
      if (existing) {
        return {
          ok: true as const,
          sessionId: existing.id,
          objectId: existing.objectId,
          received: existing.received,
          resume: true,
        };
      }
    }
    const objectId = randomId();
    const sessionId = randomId();
    const now = Date.now();
    const obj: VaultObject = {
      id: objectId,
      ownerUserId: userId,
      scope,
      scopeId: scoped.scopeId,
      originalName,
      storageKey: randomId(),
      mime: "application/octet-stream",
      kind: "unknown",
      size: input.size,
      hash: "",
      status: "uploading",
      privacy: input.privacy === "public" ? "public" : "private",
      scan: "pending",
      duplicateOf: null,
      generation: 1,
      retries: 0,
      createdAt: now,
      updatedAt: now,
      deletedAt: null,
    };
    const session: VaultSession = {
      id: sessionId,
      ownerUserId: userId,
      objectId,
      expectedSize: input.size,
      expectedChunks: chunks,
      received: [],
      originalName,
      declaredMime: (input.mime ?? "").slice(0, 80),
      clientNonce: nonce,
      scope,
      scopeId: scoped.scopeId,
      privacy: obj.privacy,
      expiresAt: now + VAULT_SESSION_TTL_MS,
      createdAt: now,
    };
    data.vaultObjects = [obj, ...(data.vaultObjects ?? [])].slice(0, 8000);
    data.vaultSessions = [session, ...(data.vaultSessions ?? [])].slice(0, 400);
    logFileAccess(data, userId, "vault-begin", objectId);
    return { ok: true as const, sessionId, objectId, received: [] as number[], resume: false };
  });
}

export async function putVaultChunk(userId: string, sessionId: string, index: number, payloadB64: string) {
  if (index < 0 || index >= VAULT_MAX_CHUNKS) return { ok: false as const, error: "شماره تکه نامعتبر است.", status: 400 };
  let bytes: Buffer;
  try {
    bytes = Buffer.from(payloadB64, "base64");
  } catch {
    return { ok: false as const, error: "تکه نامعتبر است.", status: 400 };
  }
  if (bytes.length < 1 || bytes.length > VAULT_CHUNK_MAX) return { ok: false as const, error: "حجم تکه بیش از حد است.", status: 400 };
  const session = await mutateStore((data) => {
    const s = (data.vaultSessions ?? []).find((x) => x.id === sessionId && x.ownerUserId === userId);
    if (!s) return null;
    if (s.expiresAt < Date.now()) return { expired: true as const };
    if (index >= s.expectedChunks) return { bad: true as const };
    if (!s.received.includes(index)) s.received.push(index);
    s.received.sort((a, b) => a - b);
    return s;
  });
  if (!session) return { ok: false as const, error: "نشست آپلود یافت نشد.", status: 404 };
  if ("expired" in session) return { ok: false as const, error: "نشست آپلود منقضی شد.", status: 410 };
  if ("bad" in session) return { ok: false as const, error: "ترتیب تکه نامعتبر است.", status: 400 };
  const written = await writeSessionChunk(sessionId, index, bytes);
  if (!written.ok) return { ok: false as const, error: written.error, status: 400 };
  return { ok: true as const, received: session.received, expectedChunks: session.expectedChunks };
}

export async function completeVaultUpload(userId: string, sessionId: string) {
  const started = Date.now();
  const data = await readStoreSnapshot();
  const session = (data.vaultSessions ?? []).find((s) => s.id === sessionId && s.ownerUserId === userId);
  if (!session) return { ok: false as const, error: "نشست یافت نشد.", status: 404 };
  if (session.expiresAt < Date.now()) return { ok: false as const, error: "نشست منقضی شد.", status: 410 };
  const indexes = await listSessionIndexes(sessionId);
  if (indexes.length !== session.expectedChunks || indexes.some((n, i) => n !== i)) {
    return { ok: false as const, error: "همهٔ تکه‌ها به ترتیب دریافت نشده‌اند.", status: 400 };
  }
  const assembled = await readSessionChunks(sessionId, session.expectedChunks);
  if (!assembled) return { ok: false as const, error: "مونتاژ فایل ناموفق بود.", status: 400 };
  if (assembled.length !== session.expectedSize) {
    await failObject(userId, session.objectId, "حجم نهایی با اعلام اولیه یکی نیست.");
    return { ok: false as const, error: "یکپارچگی حجم رد شد.", status: 400 };
  }
  const sniffed = sniffFileBytes(assembled);
  if (!sniffed.ok) {
    await quarantineObject(userId, session.objectId, sniffed.error ?? "اسکن امنیتی رد شد.");
    await deleteSessionDir(sessionId);
    return { ok: false as const, error: sniffed.error ?? "فایل قرنطینه شد.", status: 400 };
  }
  let bytes = assembled;
  if (sniffed.mime === "image/jpeg") bytes = stripJpegExif(bytes);
  const named = scanNamedFile(session.originalName, sniffed.mime, bytes.length, sniffed.kind);
  if (!named.ok) {
    await quarantineObject(userId, session.objectId, named.warning ?? "نوع فایل مجاز نیست.");
    await deleteSessionDir(sessionId);
    return { ok: false as const, error: named.warning ?? "فایل رد شد.", status: 400 };
  }
  if (bytes.length > maxBytesForKind(sniffed.kind)) {
    await failObject(userId, session.objectId, "حجم نوع فایل بیش از سقف است.");
    return { ok: false as const, error: "حجم این نوع فایل بیش از حد مجاز است.", status: 413 };
  }
  const hash = createHash("sha256").update(bytes).digest("hex");
  const dims =
    sniffed.kind === "image" ? jpegDimensions(bytes) ?? pngDimensions(bytes) : null;
  const objSnap = data.vaultObjects.find((o) => o.id === session.objectId && o.ownerUserId === userId);
  if (!objSnap) return { ok: false as const, error: "شیء فایل یافت نشد.", status: 404 };
  const dup = data.vaultObjects.find(
    (o) => o.ownerUserId === userId && o.hash === hash && o.id !== session.objectId && o.status === "ready" && !o.deletedAt,
  );
  if (!dup) {
    const written = await writeVaultBlob(userId, objSnap.storageKey, bytes);
    if (!written.ok) return { ok: false as const, error: written.error, status: 400 };
  }
  await deleteSessionDir(sessionId);
  const result = await mutateStore((store) => {
    const obj = store.vaultObjects.find((o) => o.id === session.objectId && o.ownerUserId === userId);
    if (!obj) return { ok: false as const, error: "شیء فایل یافت نشد.", status: 404 };
    obj.mime = sniffed.mime;
    obj.kind = sniffed.kind as VaultKind;
    obj.size = bytes.length;
    obj.hash = hash;
    obj.width = dims?.width;
    obj.height = dims?.height;
    obj.scan = "clean";
    obj.status = "processing";
    obj.updatedAt = Date.now();
    if (dup) {
      obj.duplicateOf = dup.id;
      obj.storageKey = dup.storageKey;
      obj.status = "ready";
    }
    store.vaultSessions = (store.vaultSessions ?? []).filter((s) => s.id !== sessionId);
    const key = `thumb:${obj.id}:${hash}`;
    const exists = (store.vaultJobs ?? []).some((j) => j.idempotencyKey === key);
    if (!exists) {
      const job: VaultJob = {
        id: randomId(),
        ownerUserId: userId,
        objectId: obj.id,
        kind: sniffed.kind === "image" ? "thumb" : sniffed.kind === "video" ? "thumb" : "scan",
        status: "queued",
        retries: 0,
        idempotencyKey: key,
        createdAt: Date.now(),
        updatedAt: Date.now(),
      };
      store.vaultJobs = [job, ...(store.vaultJobs ?? [])].slice(0, 800);
    }
    const m = metricsOf(store);
    m.uploads += 1;
    m.lastUploadMs = Date.now() - started;
    if (usedBytes(store, obj.scope, obj.scopeId) / quotaFor(obj.scope) >= VAULT_ALERT_RATIO) {
      m.alertAt = Date.now();
    }
    logFileAccess(store, userId, "vault-complete", obj.id);
    return { ok: true as const, objectId: obj.id };
  });
  if (!result.ok) return result;
  await processVaultJobs(userId);
  const snap = await readStoreSnapshot();
  const obj = snap.vaultObjects.find((o) => o.id === result.objectId && o.ownerUserId === userId);
  if (!obj) return { ok: false as const, error: "شیء فایل یافت نشد.", status: 404 };
  return { ok: true as const, item: publicObject(obj, userId) };
}

async function failObject(userId: string, objectId: string, error: string) {
  await mutateStore((data) => {
    const obj = data.vaultObjects.find((o) => o.id === objectId && o.ownerUserId === userId);
    if (obj) {
      obj.status = "failed";
      obj.lastError = error.slice(0, 180);
      obj.updatedAt = Date.now();
    }
    metricsOf(data).uploadFail += 1;
  });
}

async function quarantineObject(userId: string, objectId: string, error: string) {
  await mutateStore((data) => {
    const obj = data.vaultObjects.find((o) => o.id === objectId && o.ownerUserId === userId);
    if (obj) {
      obj.status = "quarantined";
      obj.scan = "blocked";
      obj.lastError = error.slice(0, 180);
      obj.updatedAt = Date.now();
    }
    metricsOf(data).uploadFail += 1;
    logFileAccess(data, userId, "vault-quarantine", objectId);
  });
}

export async function processVaultJobs(userId: string) {
  const started = Date.now();
  const pending = await mutateStore((data) =>
    (data.vaultJobs ?? []).filter((j) => j.ownerUserId === userId && j.status !== "done" && !(j.status === "failed" && j.retries >= VAULT_RETRY_MAX)),
  );
  for (const job of pending) {
    const objRow = (await readStoreSnapshot()).vaultObjects.find((o) => o.id === job.objectId && o.ownerUserId === userId);
    if (!objRow || objRow.deletedAt) {
      await mutateStore((data) => {
        const j = (data.vaultJobs ?? []).find((x) => x.id === job.id);
        if (j) {
          j.status = "failed";
          j.retries += 1;
          j.lastError = "شیء نیست.";
        }
      });
      continue;
    }
    if (objRow.duplicateOf) {
      await mutateStore((data) => {
        const j = (data.vaultJobs ?? []).find((x) => x.id === job.id);
        const o = data.vaultObjects.find((x) => x.id === job.objectId);
        if (j) j.status = "done";
        if (o) o.status = "ready";
      });
      continue;
    }
    if (job.kind === "thumb" || job.kind === "exif") {
      const bytes = await readVaultBlob(userId, objRow.storageKey);
      if (!bytes) {
        await mutateStore((data) => {
          const j = (data.vaultJobs ?? []).find((x) => x.id === job.id);
          if (j) {
            j.status = "failed";
            j.retries += 1;
            j.lastError = "بایت یافت نشد.";
            metricsOf(data).processFail += 1;
          }
        });
        continue;
      }
      const thumbKey = `${objRow.storageKey}-t`;
      await writeVaultBlob(userId, thumbKey, TINY_PNG);
      await mutateStore((data) => {
        const o = data.vaultObjects.find((x) => x.id === job.objectId && x.ownerUserId === userId);
        const j = (data.vaultJobs ?? []).find((x) => x.id === job.id);
        if (o) {
          o.thumbKey = thumbKey;
          o.status = "ready";
          o.updatedAt = Date.now();
          if (o.mime === "image/jpeg") {
            const next = stripJpegExif(bytes);
            if (next.length !== bytes.length) {
              /* already stripped on ingest */
            }
          }
        }
        if (j) {
          j.status = "done";
          j.updatedAt = Date.now();
        }
        metricsOf(data).lastProcessMs = Date.now() - started;
      });
      continue;
    }
    await mutateStore((data) => {
      const o = data.vaultObjects.find((x) => x.id === job.objectId);
      const j = data.vaultJobs.find((x) => x.id === job.id);
      if (o && o.status === "processing") o.status = "ready";
      if (j) j.status = "done";
    });
  }
  return { ok: true as const };
}

export async function getVaultMedia(
  userId: string,
  objectId: string,
  token: string,
  opts?: { thumb?: boolean; range?: string | null },
) {
  const started = Date.now();
  const data = await readStoreSnapshot();
  const obj = (data.vaultObjects ?? []).find((o) => o.id === objectId);
  if (!obj) {
    await bumpDownloadFail(userId);
    return { ok: false as const, error: "یافت نشد.", status: 404 };
  }
  if (!canReadObject(data, userId, obj)) {
    await bumpDownloadFail(userId);
    return { ok: false as const, error: "اجازه نداری.", status: 403 };
  }
  if (!verifyVaultMedia(objectId, userId, obj.generation, token)) {
    await bumpDownloadFail(userId);
    return { ok: false as const, error: "لینک منقضی یا نامعتبر است.", status: 403 };
  }
  if (obj.status !== "ready" || obj.scan !== "clean") {
    return { ok: false as const, error: "فایل آماده نیست.", status: 404 };
  }
  const allowed = await mutateStore((store) => {
    const gate = hitRateLimit(store, `vault:dl:${userId}`, 60_000, FILE_DL_PER_MIN);
    if (!gate.allowed) return { ok: false as const, error: "دانلود پیاپی محدود شد.", status: 429 };
    metricsOf(store).downloads += 1;
    metricsOf(store).lastDownloadMs = Date.now() - started;
    logFileAccess(store, userId, opts?.range ? "vault-range" : "vault-download", objectId);
    return { ok: true as const };
  });
  if (!allowed.ok) return allowed;
  const key = opts?.thumb ? obj.thumbKey : obj.storageKey;
  if (!key) return { ok: false as const, error: "فایل نیست.", status: 404 };
  const size = (await vaultBlobSize(obj.ownerUserId, key)) ?? 0;
  const range = parseByteRange(opts?.range ?? null, size);
  const bytes = range
    ? await readVaultRange(obj.ownerUserId, key, range.start, range.end)
    : await readVaultBlob(obj.ownerUserId, key);
  if (!bytes) return { ok: false as const, error: "فایل نیست.", status: 404 };
  const inline = obj.kind === "image" || obj.kind === "video" || obj.kind === "audio" || Boolean(opts?.thumb);
  const safe = sanitizeFileName(obj.originalName).replace(/"/g, "");
  return {
    ok: true as const,
    bytes,
    mime: opts?.thumb ? "image/png" : obj.mime,
    size,
    range,
    cacheControl: obj.privacy === "public" ? "private, max-age=120" : "private, no-store",
    disposition: `${inline ? "inline" : "attachment"}; filename="${safe}"`,
    etag: `"${obj.hash.slice(0, 16)}.${obj.generation}"`,
  };
}

async function bumpDownloadFail(userId: string) {
  await mutateStore((data) => {
    metricsOf(data).downloadFail += 1;
    logFileAccess(data, userId, "vault-deny", "id");
  });
}

export async function trashVault(userId: string, ids: string[], permanent: boolean) {
  return mutateStore(async (data) => {
    let n = 0;
    for (const id of ids.slice(0, 40)) {
      const obj = data.vaultObjects.find((o) => o.id === id && o.ownerUserId === userId);
      if (!obj) continue;
      obj.generation += 1;
      if (permanent) {
        obj.status = "deleted";
        obj.deletedAt = Date.now();
        if (!obj.duplicateOf) await deleteVaultBlob(userId, obj.storageKey);
        if (obj.thumbKey) await deleteVaultBlob(userId, obj.thumbKey);
      } else {
        obj.deletedAt = Date.now();
        obj.status = "deleted";
      }
      logFileAccess(data, userId, permanent ? "vault-purge" : "vault-trash", id);
      n += 1;
    }
    return { ok: true as const, count: n };
  });
}

export async function restoreVault(userId: string, ids: string[]) {
  return mutateStore((data) => {
    let n = 0;
    for (const id of ids.slice(0, 40)) {
      const obj = data.vaultObjects.find((o) => o.id === id && o.ownerUserId === userId);
      if (!obj?.deletedAt) continue;
      obj.deletedAt = null;
      obj.status = "ready";
      obj.generation += 1;
      n += 1;
    }
    return { ok: true as const, count: n };
  });
}

export async function setVaultPrivacy(userId: string, ids: string[], privacy: VaultPrivacy) {
  return mutateStore((data) => {
    let n = 0;
    for (const id of ids.slice(0, 40)) {
      const obj = data.vaultObjects.find((o) => o.id === id && o.ownerUserId === userId);
      if (!obj || obj.deletedAt) continue;
      obj.privacy = privacy;
      obj.generation += 1;
      n += 1;
    }
    logFileAccess(data, userId, "vault-privacy", privacy);
    return { ok: true as const, count: n };
  });
}

export async function sweepVault(now = Date.now()) {
  const expired = await mutateStore((data) => {
    const deadSessions = (data.vaultSessions ?? []).filter((s) => s.expiresAt < now);
    data.vaultSessions = (data.vaultSessions ?? []).filter((s) => s.expiresAt >= now);
    data.vaultObjects = (data.vaultObjects ?? []).filter((o) => !o.deletedAt || now - o.deletedAt < VAULT_SOFT_MS);
    data.vaultJobs = (data.vaultJobs ?? []).filter((j) => now - j.createdAt < 7 * 24 * 60 * 60 * 1000);
    return deadSessions;
  });
  for (const s of expired) await deleteSessionDir(s.id);
  const snap = await readStoreSnapshot();
  const liveKeys = new Set(
    (snap.vaultObjects ?? [])
      .filter((o) => o.status !== "deleted" || (o.deletedAt && now - o.deletedAt < VAULT_SOFT_MS))
      .flatMap((o) => (o.duplicateOf ? [] : [o.storageKey, o.thumbKey].filter(Boolean) as string[])),
  );
  const stored = await listVaultKeys();
  let orphans = 0;
  for (const row of stored) {
    if (!liveKeys.has(row.storageKey) && now - row.mtime > VAULT_SESSION_TTL_MS) {
      await deleteVaultBlob(row.ownerUserId, row.storageKey);
      orphans += 1;
    }
  }
  return { ok: true as const, expiredSessions: expired.length, orphans };
}

export function defaultStorageMetrics(): StorageMetrics {
  return {
    uploads: 0,
    uploadFail: 0,
    downloads: 0,
    downloadFail: 0,
    processFail: 0,
    lastUploadMs: 0,
    lastDownloadMs: 0,
    lastProcessMs: 0,
    alertAt: null,
  };
}
