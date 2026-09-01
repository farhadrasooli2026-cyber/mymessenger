import { afterEach, describe, expect, it } from "vitest";
import { hashIp } from "./crypto-utils";
import { getOutbox } from "./outbox";
import { loginWithPassword } from "./password-login";
import { completeProfile } from "./profile";
import { ackHumanChallenge, issueHumanChallenge, startRegistration, verifyOtp } from "./registration";
import { enableTwoStep } from "./security";
import { resetStoreForTests } from "./store";

const ip = hashIp("198.51.100.20");

async function readyHuman() {
  const issued = await issueHumanChallenge(ip);
  const ack = await ackHumanChallenge(issued.token, ip);
  expect(ack.ok).toBe(true);
  return issued.token;
}

async function activeUser(email: string) {
  const token = await readyHuman();
  const start = await startRegistration(
    { channel: "email", identifier: email, humanToken: token, website: "" },
    ip,
  );
  if (!start.ok) throw new Error("start");
  const code = getOutbox(start.challengeId)?.body.match(/\b(\d{6})\b/)?.[1] ?? "";
  const verified = await verifyOtp(start.challengeId, code, ip);
  if (!verified.ok) throw new Error("verify");
  const done = await completeProfile(verified.userId, {
    firstName: "ورود",
    lastName: "آزمایش",
    username: email.split("@")[0]!.slice(0, 20),
    bio: "بیو",
    privacyPhoto: "everyone",
    privacyBio: "everyone",
    photoAllowIds: [],
    bioAllowIds: [],
  });
  if (!done.ok) throw new Error("profile");
  return verified.userId;
}

describe("password-first login", () => {
  afterEach(async () => {
    await resetStoreForTests();
  });

  it("rejects unknown or password-less accounts without enumerating them", async () => {
    await activeUser("nopw@nixo.test");
    const token = await readyHuman();
    const missing = await loginWithPassword(
      { identifier: "ghost@nixo.test", password: "not-a-real-pass-1", humanToken: token, website: "" },
      ip,
    );
    expect(missing.ok).toBe(false);
    if (missing.ok) return;
    expect(missing.status).toBe(401);
    expect(missing.error).toContain("تأیید با کد");

    const token2 = await readyHuman();
    const noPw = await loginWithPassword(
      { identifier: "nopw@nixo.test", password: "not-a-real-pass-1", humanToken: token2, website: "" },
      ip,
    );
    expect(noPw.ok).toBe(false);
    if (noPw.ok) return;
    expect(noPw.status).toBe(401);
    expect(noPw.error).toBe(missing.error);
  });

  it("logs in an active user who has a password and does not store the password in the result", async () => {
    const id = await activeUser("pwduser@nixo.test");
    const password = "correct-horse-battery";
    const enabled = await enableTwoStep(id, password, "10.0.0.8");
    expect(enabled.ok).toBe(true);
    const token = await readyHuman();
    const result = await loginWithPassword(
      { identifier: "pwduser@nixo.test", password, humanToken: token, website: "" },
      ip,
    );
    expect(result.ok).toBe(true);
    if (!result.ok || result.bait) return;
    expect(result.next).toBe("complete");
    expect(result.userId).toBe(id);
    expect(JSON.stringify(result)).not.toContain(password);
  });

  it("treats honeypot submissions as a silent success without a session user", async () => {
    const token = await readyHuman();
    const bait = await loginWithPassword(
      { identifier: "bait@nixo.test", password: "whatever-pass-99", humanToken: token, website: "http://spam.test" },
      ip,
    );
    expect(bait.ok).toBe(true);
    if (!bait.ok) return;
    expect(bait.bait).toBe(true);
  });
});
