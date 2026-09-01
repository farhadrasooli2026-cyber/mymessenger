import { afterEach, describe, expect, it } from "vitest";
import { hashIp } from "./crypto-utils";
import { decryptBytes, encryptBytes } from "./crypto-utils";
import { completeProfile } from "./profile";
import { ackHumanChallenge, issueHumanChallenge, startRegistration, verifyOtp } from "./registration";
import { getOutbox } from "./outbox";
import { mutateStore, readStoreSnapshot, resetStoreForTests, getStorePath } from "./store";
import { bindSql, quoteIdent, scopedRows } from "./db/query";
import { SCHEMA_VERSION } from "./db/catalog";
import { collectIntegrityIssues } from "./db/integrity";
import { createEncryptedSnapshot, restoreSnapshotPreview, verifySnapshot } from "./db/backup";
import { dbHealth, userDataSummary } from "./db/health";
import { isNixoOps } from "./db/access";
import { listThreads } from "./chat";

async function activeUser(username: string) {
  const ip = hashIp(`test-ip:${username}`);
  const issued = await issueHumanChallenge(ip);
  await ackHumanChallenge(issued.token, ip);
  const start = await startRegistration(
    { channel: "email", identifier: `${username}@nixo.test`, humanToken: issued.token, website: "" },
    ip,
  );
  if (!start.ok) throw new Error("start");
  const code = getOutbox(start.challengeId)?.body.match(/\b(\d{6})\b/)?.[1] ?? "";
  const verified = await verifyOtp(start.challengeId, code, ip);
  if (!verified.ok) throw new Error("verify");
  const done = await completeProfile(verified.userId, {
    firstName: "داده",
    lastName: "آزمایش",
    username,
    bio: "",
    privacyPhoto: "everyone",
    privacyBio: "everyone",
    photoAllowIds: [],
    bioAllowIds: [],
  });
  if (!done.ok) throw new Error("profile");
  return verified.userId;
}

describe("NIXO database architecture", () => {
  afterEach(async () => {
    await resetStoreForTests();
  });

  it("keeps the test store off the production file", () => {
    expect(getStorePath()).toContain("nixo-store.test");
    expect(getStorePath()).not.toContain("nixo-store.json");
  });

  it("migrates schema version on first write", async () => {
    await activeUser("db_schema");
    const snap = await readStoreSnapshot();
    expect(snap.schemaMeta.version).toBe(SCHEMA_VERSION);
    expect(snap.schemaMeta.env).toBe("test");
  });

  it("rejects concatenated / injected SQL", () => {
    expect(bindSql("SELECT * FROM users WHERE id = '${id}'", []).ok).toBe(false);
    expect(bindSql("SELECT * FROM users WHERE id = ?", ["abc"]).ok).toBe(true);
    expect(quoteIdent("users;drop table", ["users"])).toBeNull();
    expect(quoteIdent("users", ["users"])).toBe("users");
  });

  it("scopes rows so another user id cannot read owner data", async () => {
    const a = await activeUser("db_own");
    const b = await activeUser("db_oth");
    const snap = await readStoreSnapshot();
    const page = scopedRows(snap.contacts, (c) => c.ownerUserId, b, { limit: 20 });
    expect(page.items.every((c) => c.ownerUserId === b)).toBe(true);
    expect(page.items.some((c) => c.ownerUserId === a)).toBe(false);
    const stolen = scopedRows(snap.messages, (m) => m.ownerUserId, "not-a-user");
    expect(stolen.items.length).toBe(0);
  });

  it("summarizes only the session user's counts", async () => {
    const a = await activeUser("db_sum_a");
    await activeUser("db_sum_b");
    await listThreads(a);
    const mine = await userDataSummary(a);
    expect(mine.threads).toBeGreaterThan(0);
  });

  it("repairs ownerless messages without touching other users", async () => {
    const userId = await activeUser("db_orphan");
    await mutateStore((data) => {
      data.messages.push({
        id: "orphan1",
        threadId: "missing-thread",
        ownerUserId: userId,
        sender: "me",
        enc: "e2ee-v1",
        ciphertext: "AAAAAAAA",
        nonce: "BBBBBBBB",
        createdAt: Date.now(),
        kind: "text",
      });
    });
    const after = await readStoreSnapshot();
    expect(after.messages.some((m) => m.id === "orphan1")).toBe(false);
    expect(collectIntegrityIssues(after).some((i) => i.code === "orphan_message")).toBe(false);
  });

  it("encrypts system snapshots and verifies checksum", async () => {
    const userId = await activeUser("db_bak");
    const made = await createEncryptedSnapshot(userId);
    expect(made.ok).toBe(true);
    if (!made.ok) return;
    const verified = await verifySnapshot(made.meta.id);
    expect(verified.ok).toBe(true);
    const round = decryptBytes(encryptBytes(Buffer.from("nixo-db")));
    expect(round.toString()).toBe("nixo-db");
  });

  it("restores a snapshot onto the isolated test store", async () => {
    const userId = await activeUser("db_restore");
    const made = await createEncryptedSnapshot(userId);
    expect(made.ok).toBe(true);
    if (!made.ok) return;
    await resetStoreForTests();
    const empty = await readStoreSnapshot();
    expect(empty.users.some((u) => u.id === userId)).toBe(false);
    const restored = await restoreSnapshotPreview(made.meta.id);
    expect(restored.ok).toBe(true);
    const again = await readStoreSnapshot();
    expect(again.users.some((u) => u.id === userId)).toBe(true);
  });

  it("reports health without secrets", async () => {
    await activeUser("db_health");
    const h = await dbHealth();
    expect(h.ok).toBe(true);
    expect(h.ready).toBe(true);
    expect(JSON.stringify(h)).not.toMatch(/otp|password|pepper/i);
  });

  it("limits ops usernames", () => {
    expect(isNixoOps("nixo_ops")).toBe(true);
    expect(isNixoOps("random_user")).toBe(false);
  });
});
