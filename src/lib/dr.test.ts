import { existsSync } from "node:fs";
import { afterEach, describe, expect, it } from "vitest";
import { hashIp } from "./crypto-utils";
import { completeProfile } from "./profile";
import { getOutbox } from "./outbox";
import { ackHumanChallenge, issueHumanChallenge, startRegistration, verifyOtp } from "./registration";
import { resetStoreForTests } from "./store";
import { enableTwoStep } from "./security";
import { clearStaffCookie, staffLogin, writeStaffCookie } from "./admin-moderation";
import { postingBlocked } from "./account-gate";
import { rememberPlatformMode } from "./dr-mode";
import { createEncryptedSnapshot, listSnapshots, verifySnapshot, binPath, offsiteDir } from "./db/backup";
import {
  drDashboard,
  failover,
  importDrBackup,
  publicStatus,
  restorePreview,
  restoreProduction,
  runDrBackup,
  setDrMode,
  verifyDrPoint,
} from "./dr";
import { DR_CONFIRM } from "./dr-types";

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
    firstName: "بازیابی",
    lastName: "آزمایش",
    username,
    bio: "بیو تست",
    privacyPhoto: "everyone",
    privacyBio: "everyone",
    photoAllowIds: [],
    bioAllowIds: [],
  });
  if (!done.ok) throw new Error("profile");
  return verified.userId;
}

describe("backup disaster recovery", () => {
  afterEach(async () => {
    rememberPlatformMode("normal");
    await clearStaffCookie();
    await resetStoreForTests();
  });

  it("keeps backups encrypted, offsite, staff-gated, and confirmation-bound", async () => {
    expect((await drDashboard()).ok).toBe(false);

    const ops = await activeUser("nixo_ops");
    const pw = "NixoAdminPass12";
    await enableTwoStep(ops, pw, "127.0.0.1");
    const login = await staffLogin(ops, pw, undefined, "127.0.0.1", "vitest");
    if (!login.ok) throw new Error(login.error);
    await writeStaffCookie(ops, login.sid);

    const snap = await createEncryptedSnapshot(ops);
    expect(snap.ok).toBe(true);
    if (!snap.ok) return;
    expect(await verifySnapshot(snap.meta.id)).toEqual({ ok: true });
    expect(existsSync(binPath(snap.meta.id, offsiteDir()))).toBe(true);

    const full = await runDrBackup({ kind: "full", actorId: ops });
    expect(full.ok).toBe(true);
    if (!full.ok) return;
    expect(full.point.signature.length).toBeGreaterThan(20);
    expect(full.point.offsite).toBe(true);
    const incr = await runDrBackup({ kind: "incremental", actorId: ops });
    expect(incr.ok).toBe(true);

    const deniedRestore = await restoreProduction({
      id: full.point.id,
      password: pw,
      confirm: "nope",
    });
    expect(deniedRestore.ok).toBe(false);

    const preview = await restorePreview(full.point.id);
    expect(preview.ok).toBe(true);
    if (preview.ok) {
      expect(preview.isolated).toBe(true);
      expect(preview.summary.users).toBeGreaterThan(0);
    }

    const verified = await verifyDrPoint(full.point.id);
    expect(verified.ok).toBe(true);

    const dash = await drDashboard();
    expect(dash.ok).toBe(true);
    if (!dash.ok) return;
    const blob = JSON.stringify(dash);
    expect(blob).not.toMatch(/NIXO_PEPPER|ciphertext|totpSecret/i);
    expect(dash.downloadForbidden).toBe(true);
    expect(dash.credentialIsolated).toBe(true);
    expect(dash.isolated).toBe(true);
    expect(dash.runbook.length).toBeGreaterThan(5);

    const imported = await importDrBackup("deadbeefdeadbeef");
    expect(imported.ok).toBe(false);

    rememberPlatformMode("maintenance");
    const blocked = postingBlocked({ accountStatus: "active" });
    expect(blocked.blocked).toBe(true);
    if (blocked.blocked) expect(blocked.code).toBe("maintenance");
    rememberPlatformMode("normal");

    const fo = await failover(pw, DR_CONFIRM.failover);
    expect(fo.ok).toBe(true);
    if (fo.ok) expect(fo.generation).toBeGreaterThan(1);

    const status = await publicStatus();
    expect(status.product).toBe("NIXO");
    expect(JSON.stringify(status)).not.toMatch(/password|pepper|backupKey/i);

    const listed = await listSnapshots();
    expect(listed.some((s) => s.id === snap.meta.id)).toBe(true);
  });

  it("requires RESTORE_PRODUCTION before applying a restore", async () => {
    const ops = await activeUser("nixo_ops");
    const pw = "NixoAdminPass12";
    await enableTwoStep(ops, pw, "127.0.0.1");
    const login = await staffLogin(ops, pw, undefined, "127.0.0.1", "vitest");
    if (!login.ok) throw new Error(login.error);
    await writeStaffCookie(ops, login.sid);
    const full = await runDrBackup({ kind: "full", actorId: ops });
    if (!full.ok) throw new Error("backup");
    const restored = await restoreProduction({ id: full.point.id, password: pw, confirm: DR_CONFIRM.restoreProduction });
    expect(restored.ok).toBe(true);
    if (restored.ok) {
      expect(restored.validation.database).toBe(true);
      expect(restored.validation.messaging).toBe(true);
    }
  });

  it("does not change mode without the maintenance phrase", async () => {
    const ops = await activeUser("nixo_ops");
    const pw = "NixoAdminPass12";
    await enableTwoStep(ops, pw, "127.0.0.1");
    const login = await staffLogin(ops, pw, undefined, "127.0.0.1", "vitest");
    if (!login.ok) throw new Error(login.error);
    await writeStaffCookie(ops, login.sid);
    const bad = await setDrMode("maintenance", pw, "no");
    expect(bad.ok).toBe(false);
  });
});
