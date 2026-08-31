import { afterEach, describe, expect, it } from "vitest";
import { hashIp } from "./crypto-utils";
import { completeProfile } from "./profile";
import { getOutbox } from "./outbox";
import { ackHumanChallenge, issueHumanChallenge, startRegistration, verifyOtp } from "./registration";
import { resetStoreForTests } from "./store";
import { approveDevice, createDeviceSessionForUser, isDeviceActive, revokeDevice } from "./security";
import { startRecovery, verifyRecovery } from "./recover";
import { parseUserAgent } from "./device-info";

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
    firstName: "دستگاه",
    lastName: "تست",
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

describe("NIXO devices and recovery", () => {
  afterEach(async () => {
    await resetStoreForTests();
  });

  it("parses device type and OS without GPS", () => {
    const p = parseUserAgent("Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X)");
    expect(p.kind).toBe("phone");
    expect(p.os).toBe("iOS");
  });

  it("marks a new user-agent pending until a trusted device approves", async () => {
    const id = await activeUser("dev_trust");
    const first = await createDeviceSessionForUser({
      userId: id,
      ip: "203.0.113.1",
      userAgent: "Mozilla/5.0 (iPhone) Mobile",
      approx: "شبکه",
    });
    expect(first.device.trusted).toBe(true);
    expect(first.pending).toBe(false);
    const second = await createDeviceSessionForUser({
      userId: id,
      ip: "203.0.113.8",
      userAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64)",
      approx: "شبکه",
    });
    expect(second.pending).toBe(true);
    expect(second.device.trusted).toBe(false);
    const denied = await approveDevice(id, second.device.id, "not-a-session", "203.0.113.1");
    expect(denied.ok).toBe(false);
    const ok = await approveDevice(id, second.device.id, first.device.id, "203.0.113.1");
    expect(ok.ok).toBe(true);
    expect(await isDeviceActive(second.device.id, id)).toBe(true);
  });

  it("revokes a session so it cannot be used", async () => {
    const id = await activeUser("dev_rev");
    const { device } = await createDeviceSessionForUser({
      userId: id,
      ip: "198.51.100.1",
      userAgent: "Mozilla/5.0 Linux",
      approx: "شبکه",
    });
    await revokeDevice(id, device.id, "198.51.100.1");
    expect(await isDeviceActive(device.id, id)).toBe(false);
  });

  it("does not invent an account during recovery and requires a live OTP", async () => {
    const ip = hashIp("recover-ip");
    const issued = await issueHumanChallenge(ip);
    await ackHumanChallenge(issued.token, ip);
    const start = await startRecovery(
      { channel: "email", identifier: "nobody@nixo.test", humanToken: issued.token, website: "" },
      ip,
    );
    expect(start.ok).toBe(true);
    if (!start.ok) return;
    const fake = await verifyRecovery(start.challengeId, "123456", ip);
    expect(fake.ok).toBe(false);
  });

  it("recovers an existing account only after OTP", async () => {
    const username = "dev_recov";
    const id = await activeUser(username);
    const ip = hashIp("recover-ok");
    const issued = await issueHumanChallenge(ip);
    await ackHumanChallenge(issued.token, ip);
    const start = await startRecovery(
      { channel: "email", identifier: `${username}@nixo.test`, humanToken: issued.token, website: "" },
      ip,
    );
    expect(start.ok).toBe(true);
    if (!start.ok) return;
    const code = getOutbox(start.challengeId)?.body.match(/\b(\d{6})\b/)?.[1] ?? "";
    const verified = await verifyRecovery(start.challengeId, code, ip);
    expect(verified.ok).toBe(true);
    if (verified.ok) expect(verified.userId).toBe(id);
  });
});
