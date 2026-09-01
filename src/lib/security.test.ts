import { afterEach, describe, expect, it } from "vitest";
import { hashIp } from "./crypto-utils";
import { completeProfile } from "./profile";
import { getOutbox } from "./outbox";
import { ackHumanChallenge, getUserById, issueHumanChallenge, startRegistration, verifyOtp } from "./registration";
import { mutateStore, readStoreSnapshot, resetStoreForTests } from "./store";
import {
  backupVerifier,
  beginAuthenticator,
  challengeMatchesClientData,
  changeAccountPassword,
  confirmAuthenticator,
  consumeRecoveryCode,
  createDeviceSessionForUser,
  createPrivacyExport,
  downloadPrivacyExport,
  enableTwoStep,
  generateRecoveryCodes,
  getSecurityDashboard,
  isDeviceActive,
  passwordMatches,
  requestOriginAllowed,
  revokeDevice,
  rotateDeviceRefresh,
  storeContainsPlainPassword,
  userNeedsTwoStep,
  verifySecondFactor,
} from "./security";
import { totpCode } from "./totp";
import { inspectLink, inspectTextLinks } from "./link-safety";

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
    firstName: "امن",
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

describe("NIXO security", () => {
  afterEach(async () => {
    await resetStoreForTests();
  });

  it("hashes two-step password and never stores plaintext", async () => {
    const id = await activeUser("sec_pwd");
    const password = "correct-horse-battery";
    const enabled = await enableTwoStep(id, password, "10.0.0.1");
    expect(enabled.ok).toBe(true);
    if (enabled.ok) expect(enabled.codes.length).toBe(8);
    const user = await getUserById(id);
    expect(user?.twoStepEnabled).toBe(true);
    expect(user?.passwordHash).toBeTruthy();
    expect(user?.passwordHash).not.toContain(password);
    expect(passwordMatches(user!, password)).toBe(true);
    expect(passwordMatches(user!, "wrong-password-xx")).toBe(false);
    const snap = await readStoreSnapshot();
    expect(storeContainsPlainPassword(snap, password)).toBe(false);
    expect(userNeedsTwoStep(user)).toBe(true);
  });

  it("rejects a revoked device session", async () => {
    const id = await activeUser("sec_dev");
    const { device } = await createDeviceSessionForUser({
      userId: id,
      ip: "203.0.113.9",
      userAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/120",
      approx: "شبکه",
    });
    expect(await isDeviceActive(device.id, id)).toBe(true);
    const ok = await revokeDevice(id, device.id, "203.0.113.9");
    expect(ok).toBe(true);
    expect(await isDeviceActive(device.id, id)).toBe(false);
    const snap = await readStoreSnapshot();
    expect(snap.audit.some((e) => e.userId === id && (e.kind === "new_device" || e.kind === "login"))).toBe(true);
    expect(snap.audit.some((e) => e.kind === "revoke")).toBe(true);
  });

  it("consumes a one-time recovery code as second factor", async () => {
    const id = await activeUser("sec_rec");
    await enableTwoStep(id, "recovery-code-pass", "10.1.1.1");
    const rec = generateRecoveryCodes();
    await mutateStore((data) => {
      const u = data.users.find((x) => x.id === id);
      if (u) u.recoveryCodeHashes = rec.hashes;
    });
    const first = await verifySecondFactor(id, "10.1.1.1", { recovery: rec.codes[0] });
    expect(first.ok).toBe(true);
    const second = await verifySecondFactor(id, "10.1.1.1", { recovery: rec.codes[0] });
    expect(second.ok).toBe(false);
    const user = await getUserById(id);
    expect(consumeRecoveryCode(user!, rec.codes[1]!)).toBe(true);
  });

  it("stores only an HMAC verifier for E2EE backup", async () => {
    const secret = "user-held-backup-phrase";
    const a = backupVerifier(secret);
    const b = backupVerifier(secret);
    expect(a).toBe(b);
    expect(a).not.toContain(secret);
    expect(backupVerifier("other-secret-phrase")).not.toBe(a);
  });

  it("matches passkey clientData challenge", () => {
    const challenge = "abcDEF123_-";
    const json = Buffer.from(JSON.stringify({ type: "webauthn.create", challenge }), "utf8").toString("base64url");
    expect(challengeMatchesClientData(json, challenge)).toBe(true);
    expect(challengeMatchesClientData(json, "nope")).toBe(false);
  });

  it("flags suspicious links", () => {
    expect(inspectLink("javascript:alert(1)").warn).toBe(true);
    expect(inspectLink("https://bit.ly/x").warn).toBe(true);
    expect(inspectLink("https://xn--exmple-cua.com").warn).toBe(true);
    expect(inspectTextLinks("ببین https://nixo.app/help").warn).toBe(false);
  });

  it("marks a second user-agent as a suspicious new device", async () => {
    const id = await activeUser("sec_sus");
    await createDeviceSessionForUser({
      userId: id,
      ip: "198.51.100.2",
      userAgent: "Mozilla/5.0 iPhone",
      approx: "شبکه",
    });
    const second = await createDeviceSessionForUser({
      userId: id,
      ip: "198.51.100.8",
      userAgent: "Mozilla/5.0 Windows",
      approx: "شبکه",
    });
    expect(second.suspicious).toBe(true);
    const snap = await readStoreSnapshot();
    expect(snap.audit.some((e) => e.kind === "suspicious")).toBe(true);
  });

  it("changes password only with current password and never stores plaintext", async () => {
    const id = await activeUser("sec_chg");
    const current = "correct-horse-battery";
    await enableTwoStep(id, current, "10.0.0.2");
    const denied = await changeAccountPassword(id, "wrong-password-xx", "fresh-nixo-passphrase", "10.0.0.2");
    expect(denied.ok).toBe(false);
    const ok = await changeAccountPassword(id, current, "fresh-nixo-passphrase", "10.0.0.2");
    expect(ok.ok).toBe(true);
    const user = await getUserById(id);
    expect(passwordMatches(user!, "fresh-nixo-passphrase")).toBe(true);
    expect(passwordMatches(user!, current)).toBe(false);
    const snap = await readStoreSnapshot();
    expect(storeContainsPlainPassword(snap, current)).toBe(false);
    expect(storeContainsPlainPassword(snap, "fresh-nixo-passphrase")).toBe(false);
  });

  it("activates TOTP only after a valid authenticator code", async () => {
    const id = await activeUser("sec_totp");
    const begin = await beginAuthenticator(id, "10.0.0.3");
    expect(begin.ok).toBe(true);
    if (!begin.ok) return;
    const bad = await confirmAuthenticator(id, "000000", "10.0.0.3");
    expect(bad.ok).toBe(false);
    const good = await confirmAuthenticator(id, totpCode(begin.secret), "10.0.0.3");
    expect(good.ok).toBe(true);
    const user = await getUserById(id);
    expect(userNeedsTwoStep(user)).toBe(true);
    const via = await verifySecondFactor(id, "10.0.0.3", { totp: totpCode(begin.secret) });
    expect(via.ok).toBe(true);
  });

  it("rotates refresh tokens and rejects reuse", async () => {
    const id = await activeUser("sec_ref");
    const created = await createDeviceSessionForUser({
      userId: id,
      ip: "198.51.100.40",
      userAgent: "Mozilla/5.0 Linux",
      approx: "شبکه",
    });
    const first = await rotateDeviceRefresh(id, created.device.id, created.refreshToken);
    expect(first.ok).toBe(true);
    if (!first.ok) return;
    const second = await rotateDeviceRefresh(id, created.device.id, first.refreshToken);
    expect(second.ok).toBe(true);
    const reuse = await rotateDeviceRefresh(id, created.device.id, created.refreshToken);
    expect(reuse.ok).toBe(false);
    expect(await isDeviceActive(created.device.id, id)).toBe(false);
  });

  it("does not let another account download a privacy export", async () => {
    const owner = await activeUser("sec_ex1");
    const other = await activeUser("sec_ex2");
    const job = await createPrivacyExport(owner, "10.0.0.9");
    expect(job.ok).toBe(true);
    if (!job.ok) return;
    const steal = await downloadPrivacyExport(other, job.token);
    expect(steal.ok).toBe(false);
    const own = await downloadPrivacyExport(owner, job.token);
    expect(own.ok).toBe(true);
    const again = await downloadPrivacyExport(owner, job.token);
    expect(again.ok).toBe(false);
    const snap = await readStoreSnapshot();
    expect(JSON.stringify(snap.privacyExports)).not.toContain(job.token);
  });

  it("allows same-host Origin and rejects a foreign Origin", () => {
    const ok = new Request("http://127.0.0.1:43151/api/security", {
      method: "POST",
      headers: { origin: "http://127.0.0.1:43151", host: "127.0.0.1:43151" },
    });
    const bad = new Request("http://127.0.0.1:43151/api/security", {
      method: "POST",
      headers: { origin: "https://evil.example", host: "127.0.0.1:43151" },
    });
    const none = new Request("http://127.0.0.1:43151/api/security", { method: "POST" });
    expect(requestOriginAllowed(ok)).toBe(true);
    expect(requestOriginAllowed(bad)).toBe(false);
    expect(requestOriginAllowed(none)).toBe(true);
  });

  it("flags impossible travel between country hints", async () => {
    const id = await activeUser("sec_travel");
    await createDeviceSessionForUser({
      userId: id,
      ip: "203.0.113.10",
      userAgent: "Mozilla/5.0 (Macintosh) Safari/17",
      approx: "کشور تقریبی: US — بدون GPS",
    });
    await createDeviceSessionForUser({
      userId: id,
      ip: "198.51.100.4",
      userAgent: "Mozilla/5.0 (Linux) Chrome/122",
      approx: "کشور تقریبی: IR — بدون GPS",
    });
    const snap = await readStoreSnapshot();
    expect(snap.audit.some((e) => e.userId === id && e.kind === "suspicious" && e.detail?.includes("مکان"))).toBe(true);
    expect(snap.audit.every((e) => !e.chainHash || e.chainHash.length > 8)).toBe(true);
    const dash = await getSecurityDashboard(id);
    expect(dash?.incidentPlaybook?.length).toBe(4);
  });
});
