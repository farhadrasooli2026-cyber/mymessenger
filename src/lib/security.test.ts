import { afterEach, describe, expect, it } from "vitest";
import { hashIp } from "./crypto-utils";
import { completeProfile } from "./profile";
import { getOutbox } from "./outbox";
import { ackHumanChallenge, getUserById, issueHumanChallenge, startRegistration, verifyOtp } from "./registration";
import { mutateStore, readStoreSnapshot, resetStoreForTests } from "./store";
import {
  backupVerifier,
  challengeMatchesClientData,
  consumeRecoveryCode,
  createDeviceSessionForUser,
  enableTwoStep,
  generateRecoveryCodes,
  isDeviceActive,
  passwordMatches,
  revokeDevice,
  storeContainsPlainPassword,
  userNeedsTwoStep,
  verifySecondFactor,
} from "./security";
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
});
