import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { hashIp } from "./crypto-utils";
import { normalizeEmail, normalizePhone } from "./identifiers";
import { getOutbox } from "./outbox";
import {
  ackHumanChallenge,
  completeProfile,
  issueHumanChallenge,
  startRegistration,
  verifyOtp,
} from "./registration";
import { readStoreSnapshot } from "./store";

const ip = hashIp("203.0.113.10");

async function readyHuman() {
  const issued = await issueHumanChallenge(ip);
  const ack = await ackHumanChallenge(issued.token, ip);
  expect(ack.ok).toBe(true);
  return issued.token;
}

describe("identifiers", () => {
  it("normalizes Iranian phone numbers", () => {
    expect(normalizePhone("۰۹۱۲۳۴۵۶۷۸۹")).toBe("09123456789");
    expect(normalizePhone("+98 912 345 6789")).toBe("09123456789");
    expect(normalizePhone("123")).toBeNull();
  });

  it("normalizes email", () => {
    expect(normalizeEmail("  A@B.Com ")).toBe("a@b.com");
    expect(normalizeEmail("bad")).toBeNull();
  });
});

describe("registration security", () => {
  afterEach(async () => {
    const { rm } = await import("node:fs/promises");
    await rm(path.join(process.cwd(), ".data", "nixo-store.test.json"), { force: true });
  });

  it("does not create an active user before OTP verification and profile", async () => {
    const token = await readyHuman();
    const start = await startRegistration(
      { channel: "phone", identifier: "09123456789", humanToken: token, website: "" },
      ip,
    );
    expect(start.ok).toBe(true);
    if (!start.ok) return;
    const before = await readStoreSnapshot();
    expect(before.users).toHaveLength(0);
    expect(JSON.stringify(before)).not.toMatch(/09123456789/);
  });

  it("stores OTP as a salted hash, never plaintext", async () => {
    const token = await readyHuman();
    const start = await startRegistration(
      { channel: "email", identifier: "user@nixo.test", humanToken: token, website: "" },
      ip,
    );
    expect(start.ok).toBe(true);
    if (!start.ok) return;
    const mail = getOutbox(start.challengeId);
    expect(mail?.body).toMatch(/\d{6}/);
    const code = mail?.body.match(/\b(\d{6})\b/)?.[1];
    expect(code).toBeTruthy();
    const snapshot = await readStoreSnapshot();
    const raw = JSON.stringify(snapshot);
    expect(raw.includes(code!)).toBe(false);
    expect(snapshot.challenges[0]?.codeHash).toHaveLength(64);
    expect(snapshot.challenges[0]?.salt.length).toBeGreaterThan(8);
  });

  it("rejects a wrong code and consumes the one-time code after success", async () => {
    const token = await readyHuman();
    const start = await startRegistration(
      { channel: "phone", identifier: "09351234567", humanToken: token, website: "" },
      ip,
    );
    expect(start.ok).toBe(true);
    if (!start.ok) return;
    const code = getOutbox(start.challengeId)?.body.match(/\b(\d{6})\b/)?.[1] ?? "";
    const wrong = await verifyOtp(start.challengeId, code === "000000" ? "111111" : "000000", ip);
    expect(wrong.ok).toBe(false);
    const good = await verifyOtp(start.challengeId, code, ip);
    expect(good.ok).toBe(true);
    const reuse = await verifyOtp(start.challengeId, code, ip);
    expect(reuse.ok).toBe(false);
  });

  it("does not allow profile completion without verification", async () => {
    const result = await completeProfile("missing-user", "آزمایش");
    expect(result.ok).toBe(false);
  });

  it("activates the account only after verify then profile", async () => {
    const token = await readyHuman();
    const start = await startRegistration(
      { channel: "email", identifier: "final@nixo.test", humanToken: token, website: "" },
      ip,
    );
    expect(start.ok).toBe(true);
    if (!start.ok) return;
    const code = getOutbox(start.challengeId)?.body.match(/\b(\d{6})\b/)?.[1] ?? "";
    const verified = await verifyOtp(start.challengeId, code, ip);
    expect(verified.ok).toBe(true);
    if (!verified.ok) return;
    const pending = await readStoreSnapshot();
    expect(pending.users[0]?.status).toBe("pending_profile");
    const done = await completeProfile(verified.userId, "نیکی نکسو");
    expect(done.ok).toBe(true);
    const after = await readStoreSnapshot();
    expect(after.users[0]?.status).toBe("active");
    expect(after.users[0]?.verifiedAt).toBeTruthy();
    expect(after.threads.filter((t) => t.ownerUserId === after.users[0]?.id).length).toBeGreaterThan(0);
  });

  it("invalidates the code after too many attempts", async () => {
    const token = await readyHuman();
    const start = await startRegistration(
      { channel: "phone", identifier: "09120000000", humanToken: token, website: "" },
      ip,
    );
    expect(start.ok).toBe(true);
    if (!start.ok) return;
    const real = getOutbox(start.challengeId)?.body.match(/\b(\d{6})\b/)?.[1] ?? "";
    for (let i = 0; i < 5; i += 1) {
      await verifyOtp(start.challengeId, "999999", ip);
    }
    const late = await verifyOtp(start.challengeId, real, ip);
    expect(late.ok).toBe(false);
  });

  it("returns a generic success when the honeypot is filled", async () => {
    const token = await readyHuman();
    const start = await startRegistration(
      { channel: "phone", identifier: "09121112233", humanToken: token, website: "http://spam.test" },
      ip,
    );
    expect(start.ok).toBe(true);
    if (!start.ok) return;
    expect(getOutbox(start.challengeId)).toBeNull();
    const snapshot = await readStoreSnapshot();
    expect(snapshot.challenges).toHaveLength(0);
  });
});
