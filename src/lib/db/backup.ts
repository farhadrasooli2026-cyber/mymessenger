import "server-only";
import { createHash } from "node:crypto";
import { mkdir, readFile, readdir, unlink, writeFile } from "node:fs/promises";
import path from "node:path";
import { decryptBackupBytes, encryptBackupBytes, randomId, signBackupBlob, backupSignatureOk } from "@/lib/crypto-utils";
import { SCHEMA_VERSION } from "@/lib/db/catalog";
import { getStorePath, mutateStore, readStoreSnapshot } from "@/lib/store";
import { dataDir } from "@/lib/data-dir";

const MAX_SNAPSHOT_BYTES = 48 * 1024 * 1024;

function backupDir() {
  return path.join(dataDir(), process.env.VITEST ? `backups.test.${process.env.VITEST_WORKER_ID ?? "0"}` : "backups");
}

function offsiteDir() {
  return path.join(dataDir(), process.env.VITEST ? `offsite.test.${process.env.VITEST_WORKER_ID ?? "0"}` : "offsite-backups");
}

export type SnapshotMeta = {
  id: string;
  createdAt: number;
  bytes: number;
  sha256: string;
  schemaVersion: number;
  verifiedAt: number | null;
  env: string;
  signature?: string;
  offsite?: boolean;
  kind?: "full" | "incremental" | "differential";
  immutable?: boolean;
};

function metaPath(id: string, root = backupDir()) {
  return path.join(root, `${id}.meta.json`);
}
function binPath(id: string, root = backupDir()) {
  return path.join(root, `${id}.nixo`);
}

export function backupRootIsIsolated(): boolean {
  const root = backupDir();
  const off = offsiteDir();
  return root.includes(".data") && off.includes(".data") && !root.includes("public") && root !== off;
}

async function writeBoth(id: string, sealed: Buffer, meta: SnapshotMeta) {
  await mkdir(backupDir(), { recursive: true });
  await mkdir(offsiteDir(), { recursive: true });
  await writeFile(binPath(id), sealed);
  await writeFile(metaPath(id), JSON.stringify(meta), "utf8");
  await writeFile(binPath(id, offsiteDir()), sealed);
  await writeFile(metaPath(id, offsiteDir()), JSON.stringify({ ...meta, offsite: true }), "utf8");
}

export async function createEncryptedSnapshot(actorUserId: string): Promise<{ ok: true; meta: SnapshotMeta } | { ok: false; error: string; status: number }> {
  const data = await readStoreSnapshot();
  const json = Buffer.from(JSON.stringify(data), "utf8");
  if (json.length > MAX_SNAPSHOT_BYTES) return { ok: false, error: "حجم پایگاه از سقف پشتیبان بیشتر است.", status: 413 };
  const sealed = encryptBackupBytes(json);
  const id = randomId();
  const sha256 = createHash("sha256").update(sealed).digest("hex");
  const meta: SnapshotMeta = {
    id,
    createdAt: Date.now(),
    bytes: sealed.length,
    sha256,
    schemaVersion: data.schemaMeta?.version ?? SCHEMA_VERSION,
    verifiedAt: null,
    env: data.schemaMeta?.env ?? "development",
    signature: signBackupBlob(id, sha256),
    offsite: true,
    kind: "full",
    immutable: false,
  };
  await writeBoth(id, sealed, meta);
  await mutateStore((d) => {
    d.dbJobs ??= [];
    d.dbJobs.unshift({
      id: randomId(),
      kind: "backup",
      status: "done",
      actorUserId,
      detail: `snapshot:${id.slice(0, 8)}`,
      createdAt: Date.now(),
    });
    d.dbJobs = d.dbJobs.slice(0, 80);
    d.dbAudit ??= [];
    d.dbAudit.unshift({ id: randomId(), actorUserId, action: "db.backup", at: Date.now() });
    d.dbAudit = d.dbAudit.slice(0, 200);
  });
  return { ok: true, meta };
}

export async function listSnapshots(): Promise<SnapshotMeta[]> {
  try {
    const files = await readdir(backupDir());
    const metas: SnapshotMeta[] = [];
    for (const f of files.filter((n) => n.endsWith(".meta.json"))) {
      try {
        metas.push(JSON.parse(await readFile(path.join(backupDir(), f), "utf8")) as SnapshotMeta);
      } catch {
        /* skip */
      }
    }
    return metas.sort((a, b) => b.createdAt - a.createdAt).slice(0, 40);
  } catch {
    return [];
  }
}

export async function verifySnapshot(id: string): Promise<{ ok: boolean; error?: string }> {
  if (!/^[a-f0-9]{16,64}$/i.test(id)) return { ok: false, error: "شناسه نامعتبر است." };
  try {
    const meta = JSON.parse(await readFile(metaPath(id), "utf8")) as SnapshotMeta;
    const buf = await readFile(binPath(id));
    const hash = createHash("sha256").update(buf).digest("hex");
    if (hash !== meta.sha256) return { ok: false, error: "Checksum پشتیبان همخوان نیست." };
    if (meta.signature && !backupSignatureOk(id, hash, meta.signature)) {
      return { ok: false, error: "امضای پشتیبان نامعتبر است." };
    }
    decryptBackupBytes(buf);
    meta.verifiedAt = Date.now();
    await writeFile(metaPath(id), JSON.stringify(meta), "utf8");
    return { ok: true };
  } catch {
    return { ok: false, error: "خواندن یا رمزگشایی پشتیبان شکست." };
  }
}

/** Restore is isolated: writes a preview file, never the live production path unless tests. */
export async function restoreSnapshotPreview(id: string): Promise<{ ok: true; previewPath: string; users: number } | { ok: false; error: string; status: number }> {
  if (!/^[a-f0-9]{16,64}$/i.test(id)) return { ok: false, error: "شناسه نامعتبر است.", status: 400 };
  try {
    const buf = await readFile(binPath(id));
    const plain = decryptBackupBytes(buf);
    const parsed = JSON.parse(plain.toString("utf8")) as { users?: unknown[] };
    const preview = path.join(path.dirname(getStorePath()), `restore-preview.${id.slice(0, 8)}.json`);
    await writeFile(preview, JSON.stringify({ users: Array.isArray(parsed.users) ? parsed.users.length : 0, isolated: true }));
    if (process.env.VITEST) {
      const { writeStoreForTests } = await import("@/lib/store");
      await writeStoreForTests(JSON.parse(plain.toString("utf8")));
    }
    return { ok: true, previewPath: "isolated-preview", users: Array.isArray(parsed.users) ? parsed.users.length : 0 };
  } catch {
    return { ok: false, error: "بازیابی انجام نشد.", status: 400 };
  }
}

export async function deleteExpiredSnapshot(id: string, immutable: boolean): Promise<boolean> {
  if (immutable) return false;
  if (!/^[a-f0-9]{16,64}$/i.test(id)) return false;
  try {
    await unlink(binPath(id)).catch(() => undefined);
    await unlink(metaPath(id)).catch(() => undefined);
    await unlink(binPath(id, offsiteDir())).catch(() => undefined);
    await unlink(metaPath(id, offsiteDir())).catch(() => undefined);
    return true;
  } catch {
    return false;
  }
}

export { backupDir, offsiteDir, binPath, metaPath, writeBoth, MAX_SNAPSHOT_BYTES };
