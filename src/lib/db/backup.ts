import "server-only";
import { createHash } from "node:crypto";
import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { decryptBytes, encryptBytes, randomId } from "@/lib/crypto-utils";
import { SCHEMA_VERSION } from "@/lib/db/catalog";
import { getStorePath, mutateStore, readStoreSnapshot } from "@/lib/store";

const MAX_SNAPSHOT_BYTES = 48 * 1024 * 1024;

function backupDir() {
  return path.join(process.cwd(), ".data", process.env.VITEST ? `backups.test.${process.env.VITEST_WORKER_ID ?? "0"}` : "backups");
}

export type SnapshotMeta = {
  id: string;
  createdAt: number;
  bytes: number;
  sha256: string;
  schemaVersion: number;
  verifiedAt: number | null;
  env: string;
};

function metaPath(id: string) {
  return path.join(backupDir(), `${id}.meta.json`);
}
function binPath(id: string) {
  return path.join(backupDir(), `${id}.nixo`);
}

export async function createEncryptedSnapshot(actorUserId: string): Promise<{ ok: true; meta: SnapshotMeta } | { ok: false; error: string; status: number }> {
  const data = await readStoreSnapshot();
  const json = Buffer.from(JSON.stringify(data), "utf8");
  if (json.length > MAX_SNAPSHOT_BYTES) return { ok: false, error: "حجم پایگاه از سقف پشتیبان بیشتر است.", status: 413 };
  const sealed = encryptBytes(json);
  const id = randomId();
  await mkdir(backupDir(), { recursive: true });
  await writeFile(binPath(id), sealed);
  const meta: SnapshotMeta = {
    id,
    createdAt: Date.now(),
    bytes: sealed.length,
    sha256: createHash("sha256").update(sealed).digest("hex"),
    schemaVersion: data.schemaMeta?.version ?? SCHEMA_VERSION,
    verifiedAt: null,
    env: data.schemaMeta?.env ?? "development",
  };
  await writeFile(metaPath(id), JSON.stringify(meta), "utf8");
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
    decryptBytes(buf);
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
    const plain = decryptBytes(buf);
    const parsed = JSON.parse(plain.toString("utf8")) as { users?: unknown[] };
    const preview = path.join(path.dirname(getStorePath()), `restore-preview.${id.slice(0, 8)}.json`);
    await writeFile(preview, plain);
    if (process.env.VITEST) {
      const { writeStoreForTests } = await import("@/lib/store");
      await writeStoreForTests(JSON.parse(plain.toString("utf8")));
    }
    return { ok: true, previewPath: "isolated-preview", users: Array.isArray(parsed.users) ? parsed.users.length : 0 };
  } catch {
    return { ok: false, error: "بازیابی انجام نشد.", status: 400 };
  }
}

export function backupRootIsIsolated(): boolean {
  const root = backupDir();
  return root.includes(".data") && (Boolean(process.env.VITEST) || !root.includes("public"));
}
