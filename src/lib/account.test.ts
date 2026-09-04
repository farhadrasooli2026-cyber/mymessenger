import { afterEach, describe, expect, it } from "vitest";
import { hashIp } from "./crypto-utils";
import { completeProfile, searchUsers, updateProfile } from "./profile";
import { getOutbox } from "./outbox";
import { ackHumanChallenge, getUserById, issueHumanChallenge, startRegistration, verifyOtp } from "./registration";
import { mutateStore, readStoreSnapshot, resetStoreForTests } from "./store";
import { wrapBackup, unwrapBackup, generateRecoveryKey } from "./backup-crypto";
import { cancelDeletion, deactivateAccount, reactivateAccount, scheduleDeletion, startDeletionChallenge, updateAccountPrefs } from "./account";
import { DELETION_PHRASE, DEACTIVATION_PHRASE } from "./account-types";
import { inspectImageBuffer, validateAvatarBuffer } from "./photo-files";
import { enableBackupSecrets, storeEncryptedBackup, loadBackupForRestore, nextAutoDue } from "./backup";

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
    firstName: "حساب",
    lastName: "ماندگار",
    username,
    bio: "بیو",
    privacyPhoto: "everyone",
    privacyBio: "everyone",
    photoAllowIds: [],
    bioAllowIds: [],
  });
  if (!done.ok) throw new Error("profile");
  return verified.userId;
}

describe("NIXO account persistence", () => {
  afterEach(async () => {
    await resetStoreForTests();
  });

  it("does not delete an inactive user", async () => {
    const id = await activeUser("persist_ok");
    await mutateStore((data) => {
      const u = data.users.find((x) => x.id === id);
      if (u) u.lastSeenAt = Date.now() - 400 * 86_400_000;
    });
    const snap = await readStoreSnapshot();
    expect(snap.users.some((u) => u.id === id)).toBe(true);
    expect(snap.users.find((u) => u.id === id)?.accountStatus ?? "active").toBe("active");
  });

  it("optionally purges only the opted-in account after long inactivity", async () => {
    const gone = await activeUser("away_self");
    const stay = await activeUser("away_other");
    await updateAccountPrefs(gone, { inactivityDeleteEnabled: true, inactivityDeleteMonths: 6 });
    await mutateStore((data) => {
      const u = data.users.find((x) => x.id === gone);
      const o = data.users.find((x) => x.id === stay);
      const past = Date.now() - 200 * 86_400_000;
      if (u) u.lastSeenAt = past;
      if (o) o.lastSeenAt = past;
    });
    await mutateStore(() => undefined);
    const snap = await readStoreSnapshot();
    expect(snap.users.some((u) => u.id === gone)).toBe(false);
    expect(snap.users.some((u) => u.id === stay)).toBe(true);
  });

  it("schedules pending deletion only after OTP and phrase, and allows cancel", async () => {
    const id = await activeUser("persist_del");
    const otp = await startDeletionChallenge(id, "10.0.0.9");
    expect(otp.ok).toBe(true);
    if (!otp.ok) return;
    const code = getOutbox(otp.challengeId)?.body.match(/\b(\d{6})\b/)?.[1] ?? "";
    const bad = await scheduleDeletion(id, { phrase: "delete", code, challengeId: otp.challengeId }, "10.0.0.9");
    expect(bad.ok).toBe(false);
    const ok = await scheduleDeletion(id, { phrase: DELETION_PHRASE, code, challengeId: otp.challengeId }, "10.0.0.9");
    expect(ok.ok).toBe(true);
    const user = await getUserById(id);
    expect(user?.accountStatus).toBe("pending_deletion");
    const cancel = await cancelDeletion(id, "10.0.0.9");
    expect(cancel.ok).toBe(true);
    expect((await getUserById(id))?.accountStatus).toBe("active");
  });

  it("deactivates discovery without deleting the account, and prefs stay owner-scoped", async () => {
    const a = await activeUser("acct_hide_a");
    const b = await activeUser("acct_hide_b");
    const found = await searchUsers("acct_hide_a", b);
    expect(found.some((u) => u.id === a)).toBe(true);
    const bad = await deactivateAccount(a, "deactivate", "10.0.0.4");
    expect(bad.ok).toBe(false);
    const off = await deactivateAccount(a, DEACTIVATION_PHRASE, "10.0.0.4");
    expect(off.ok).toBe(true);
    const hidden = await searchUsers("acct_hide_a", b);
    expect(hidden.some((u) => u.id === a)).toBe(false);
    expect((await getUserById(a))?.accountStatus).toBe("deactivated");
    const stolenPrefs = await updateAccountPrefs(b, { locale: "en" });
    expect(stolenPrefs.ok && stolenPrefs.prefs.locale === "en").toBe(true);
    const aPrefs = await updateAccountPrefs(a, { locale: "tr", timeFormat: "12" });
    expect(aPrefs.ok && aPrefs.prefs.locale === "tr" && aPrefs.prefs.timeFormat === "12").toBe(true);
    const snap = await readStoreSnapshot();
    expect(snap.users.find((u) => u.id === b)?.prefs.locale).toBe("en");
    expect(snap.users.find((u) => u.id === a)?.prefs.locale).toBe("tr");
    const on = await reactivateAccount(a, "10.0.0.4");
    expect(on.ok).toBe(true);
    const visible = await searchUsers("acct_hide_a", b);
    expect(visible.some((u) => u.id === a)).toBe(true);
    const banned = await updateProfile(a, { bio: "visit https://spam.example" });
    expect(banned.ok).toBe(false);
    const png = Buffer.alloc(40);
    png[0] = 0x89;
    png[1] = 0x50;
    png[2] = 0x4e;
    png[3] = 0x47;
    png.writeUInt32BE(32, 16);
    png.writeUInt32BE(32, 20);
    expect(validateAvatarBuffer(png).ok).toBe(false);
    png.writeUInt32BE(64, 16);
    png.writeUInt32BE(64, 20);
    expect(inspectImageBuffer(png)?.width).toBe(64);
  });

  it("purges user data after grace period, not before", async () => {
    const id = await activeUser("persist_gone");
    const otp = await startDeletionChallenge(id, "10.0.0.2");
    if (!otp.ok) throw new Error("otp");
    const code = getOutbox(otp.challengeId)?.body.match(/\b(\d{6})\b/)?.[1] ?? "";
    await scheduleDeletion(id, { phrase: DELETION_PHRASE, code, challengeId: otp.challengeId }, "10.0.0.2");
    await mutateStore((data) => {
      const u = data.users.find((x) => x.id === id);
      if (u) u.deletionFinalizeAt = Date.now() - 1;
    });
    const snap = await readStoreSnapshot();
    expect(snap.users.some((u) => u.id === id)).toBe(false);
    expect(snap.closedAccounts.length).toBeGreaterThan(0);
  });

  it("wraps backup so the ciphertext is not plaintext", async () => {
    const secret = "backup-pass-word";
    const wrapped = await wrapBackup(secret, JSON.stringify({ hello: "private-chat" }));
    expect(wrapped.ciphertext).not.toContain("private-chat");
    const out = await unwrapBackup(secret, wrapped);
    expect(JSON.parse(out).hello).toBe("private-chat");
    expect(generateRecoveryKey().split("-").length).toBe(4);
    expect(nextAutoDue(null, "weekly")).toBe(true);
    expect(nextAutoDue(Date.now(), "monthly")).toBe(false);
  });

  it("stores only encrypted backup envelopes and rejects plaintext password in store", async () => {
    const id = await activeUser("persist_bak");
    const password = "vault-secret-99";
    await enableBackupSecrets(id, password, generateRecoveryKey(), "10.0.0.3");
    const wrapped = await wrapBackup(password, JSON.stringify({ v: 1, chats: ["secret-text"] }));
    const saved = await storeEncryptedBackup(
      id,
      wrapped,
      { chats: true, settings: true, photos: true, videos: false, files: false, voice: false },
      "10.0.0.3",
    );
    expect(saved.ok).toBe(true);
    const snap = await readStoreSnapshot();
    expect(JSON.stringify(snap.backups)).not.toContain("secret-text");
    expect(JSON.stringify(snap.users.find((u) => u.id === id))).not.toContain(password);
    const loaded = await loadBackupForRestore(id, password);
    expect(loaded.ok).toBe(true);
  });
});
