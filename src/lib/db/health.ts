import "server-only";
import { SCHEMA_VERSION, WRITER_POOL_SIZE, QUERY_TIMEOUT_MS } from "@/lib/db/catalog";
import { hydrateSchemaMeta } from "@/lib/db/migrate";
import { collectIntegrityIssues } from "@/lib/db/integrity";
import { getStorePath, readStoreSnapshot } from "@/lib/store";
import { stat } from "node:fs/promises";

export async function dbHealth(): Promise<{
  ok: boolean;
  ready: boolean;
  schemaVersion: number;
  env: string;
  writerPool: number;
  queryTimeoutMs: number;
  storeBytes: number | null;
  integrityIssues: number;
}> {
  try {
    const data = await readStoreSnapshot();
    const meta = hydrateSchemaMeta(data.schemaMeta);
    let storeBytes: number | null = null;
    try {
      storeBytes = (await stat(getStorePath())).size;
    } catch {
      storeBytes = null;
    }
    const issues = collectIntegrityIssues(data);
    const ready = meta.version <= SCHEMA_VERSION;
    return {
      ok: true,
      ready,
      schemaVersion: meta.version,
      env: meta.env,
      writerPool: WRITER_POOL_SIZE,
      queryTimeoutMs: QUERY_TIMEOUT_MS,
      storeBytes,
      integrityIssues: issues.length,
    };
  } catch {
    return {
      ok: false,
      ready: false,
      schemaVersion: 0,
      env: "unknown",
      writerPool: WRITER_POOL_SIZE,
      queryTimeoutMs: QUERY_TIMEOUT_MS,
      storeBytes: null,
      integrityIssues: -1,
    };
  }
}

export async function userDataSummary(userId: string) {
  const data = await readStoreSnapshot();
  return {
    messages: data.messages.filter((m) => m.ownerUserId === userId).length,
    threads: data.threads.filter((t) => t.ownerUserId === userId).length,
    contacts: (data.contacts ?? []).filter((c) => c.ownerUserId === userId).length,
    notifications: (data.notifications ?? []).filter((n) => n.userId === userId).length,
    gallery: (data.galleryItems ?? []).filter((g) => g.ownerUserId === userId && !g.deletedAt).length,
    vault: (data.vaultObjects ?? []).filter((v) => v.ownerUserId === userId && !v.deletedAt).length,
    devices: (data.devices ?? []).filter((d) => d.userId === userId).length,
    schemaVersion: hydrateSchemaMeta(data.schemaMeta).version,
  };
}
