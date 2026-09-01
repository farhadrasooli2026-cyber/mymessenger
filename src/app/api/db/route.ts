import { json, jsonError } from "@/lib/http";
import { requireActiveUser } from "@/lib/auth";
import { DB_COLLECTIONS, SCHEMA_VERSION } from "@/lib/db/catalog";
import { isNixoOps } from "@/lib/db/access";
import { dbHealth, userDataSummary } from "@/lib/db/health";
import { createEncryptedSnapshot, listSnapshots, restoreSnapshotPreview, verifySnapshot } from "@/lib/db/backup";
import { collectIntegrityIssues, repairOrphans } from "@/lib/db/integrity";
import { mutateStore, readStoreSnapshot } from "@/lib/store";
import { randomId } from "@/lib/crypto-utils";

export async function GET() {
  const user = await requireActiveUser();
  if (!user) return jsonError("نشست فعال نیست.", 401);
  const [health, mine] = await Promise.all([dbHealth(), userDataSummary(user.id)]);
  const ops = isNixoOps(user.username);
  const snapshots = ops ? (await listSnapshots()).map((s) => ({ id: s.id, createdAt: s.createdAt, bytes: s.bytes, schemaVersion: s.schemaVersion, verifiedAt: s.verifiedAt })) : [];
  return json({
    ok: true,
    health: { ...health, storeBytes: ops ? health.storeBytes : null, integrityIssues: ops ? health.integrityIssues : undefined },
    mine,
    schemaVersion: SCHEMA_VERSION,
    collections: DB_COLLECTIONS.map((c) => ({ name: c.name, pk: c.pk, service: c.service, owner: c.owner, lifecycle: c.lifecycle, notes: c.notes })),
    ops,
    snapshots,
  });
}

export async function POST(request: Request) {
  const user = await requireActiveUser();
  if (!user) return jsonError("نشست فعال نیست.", 401);
  const body = (await request.json().catch(() => null)) as { action?: string; id?: string } | null;
  if (!body?.action) return jsonError("درخواست نامعتبر است.");
  if (body.action === "mine") {
    return json({ ok: true, mine: await userDataSummary(user.id) });
  }
  if (!isNixoOps(user.username)) return jsonError("فقط ایمنی نیکسو.", 403);
  if (body.action === "backup") {
    const result = await createEncryptedSnapshot(user.id);
    if (!result.ok) return jsonError(result.error, result.status);
    return json({ ok: true, snapshot: { id: result.meta.id, createdAt: result.meta.createdAt, bytes: result.meta.bytes, schemaVersion: result.meta.schemaVersion } });
  }
  if (body.action === "verify") {
    if (!body.id) return jsonError("شناسه لازم است.");
    const result = await verifySnapshot(body.id);
    if (!result.ok) return jsonError(result.error ?? "نامعتبر", 400);
    return json({ ok: true });
  }
  if (body.action === "integrity") {
    const report = await mutateStore((data) => {
      const before = collectIntegrityIssues(data);
      const repaired = repairOrphans(data);
      data.dbJobs ??= [];
      data.dbJobs.unshift({
        id: randomId(),
        kind: "integrity",
        status: "done",
        actorUserId: user.id,
        detail: `removed:${repaired.removed}`,
        createdAt: Date.now(),
      });
      data.dbAudit ??= [];
      data.dbAudit.unshift({ id: randomId(), actorUserId: user.id, action: "db.integrity", at: Date.now() });
      return { before, repaired, after: collectIntegrityIssues(data) };
    });
    return json({ ok: true, ...report });
  }
  if (body.action === "restore-preview") {
    if (!body.id) return jsonError("شناسه لازم است.");
    const result = await restoreSnapshotPreview(body.id);
    if (!result.ok) return jsonError(result.error, result.status);
    return json({ ok: true, users: result.users, isolated: true });
  }
  if (body.action === "jobs") {
    const data = await readStoreSnapshot();
    const jobs = (data.dbJobs ?? []).filter((j) => j.actorUserId === user.id).slice(0, 20);
    return json({ ok: true, jobs });
  }
  return jsonError("عملیات ناشناخته است.");
}
