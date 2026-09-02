import { afterEach, describe, expect, it } from "vitest";
import { hashIp } from "./crypto-utils";
import { canonicalizeEmail, normalizeEmail, normalizePhone, toE164Phone, detectChannel, normalizePhoneWithCountry, toEnglishDigits } from "./identifiers";
import { searchDialCountries } from "./dial-codes";
import { getOutbox } from "./outbox";
import { completeProfile } from "./profile";
import {
  ackHumanChallenge,
  issueHumanChallenge,
  startRegistration,
  verifyOtp,
} from "./registration";
import { readStoreSnapshot, resetStoreForTests } from "./store";

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
    expect(normalizePhone("+14155552671")).toBe("+14155552671");
    expect(toE164Phone("09123456789")).toBe("+989123456789");
    expect(toE164Phone("+14155552671")).toBe("+14155552671");
  });

  it("canonicalizes Gmail aliases to one mailbox", () => {
    expect(canonicalizeEmail("A.B+promo@Gmail.com")).toBe("ab@gmail.com");
    expect(canonicalizeEmail("ab@gmail.com")).toBe("ab@gmail.com");
  });

  it("detects email vs phone from a unified identifier", () => {
    expect(detectChannel("user@nixo.test")).toBe("email");
    expect(detectChannel("09123456789")).toBe("phone");
    expect(detectChannel("+98 912 345 6789")).toBe("phone");
  });

  it("composes E.164 from a selected country code and national number", () => {
    expect(normalizePhoneWithCountry("TR", "05352100432")).toBe("+905352100432");
    expect(normalizePhoneWithCountry("TR", "905352100432")).toBe("+905352100432");
    expect(normalizePhoneWithCountry("TR", "+90 535 210 0432")).toBe("+905352100432");
    expect(toE164Phone(normalizePhoneWithCountry("TR", "05352100432")!)).toBe("+905352100432");
    expect(normalizePhoneWithCountry("IR", "09121234567")).toBe("09121234567");
    expect(toE164Phone(normalizePhoneWithCountry("IR", "09121234567")!)).toBe("+989121234567");
    expect(normalizePhoneWithCountry("DE", "15123456789")).toBe("+4915123456789");
    expect(normalizePhoneWithCountry("AF", "701234567")).toBe("+93701234567");
    expect(normalizePhoneWithCountry("TR", "09121234567")).toBeNull();
    expect(normalizePhoneWithCountry("IR", "05352100432")).toBeNull();
    expect(searchDialCountries("Türkiye")[0]?.iso).toBe("TR");
    expect(searchDialCountries("ترکیه")[0]?.iso).toBe("TR");
    expect(toEnglishDigits("۳۹۶۷۱۳")).toBe("396713");
  });
});

describe("registration security", () => {
  afterEach(async () => {
    await resetStoreForTests();
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
    expect(snapshot.challenges[0]?.deliveryStatus).toBe("dev-outbox");
    expect(snapshot.challenges[0]?.deliveryError).toBeFalsy();
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
    const result = await completeProfile("missing-user", {
      firstName: "آزمایش",
      lastName: "",
      username: "azmayesh1",
      bio: "",
      privacyPhoto: "everyone",
      privacyBio: "everyone",
      photoAllowIds: [],
      bioAllowIds: [],
    });
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
    const done = await completeProfile(verified.userId, {
      firstName: "نیکی",
      lastName: "نکسو",
      username: "niki_nixo",
      bio: "Developer & Gamer",
      privacyPhoto: "everyone",
      privacyBio: "everyone",
      photoAllowIds: [],
      bioAllowIds: [],
    });
    expect(done.ok).toBe(true);
    const after = await readStoreSnapshot();
    expect(after.users[0]?.status).toBe("active");
    expect(after.users[0]?.username).toBe("niki_nixo");
    expect(after.users[0]?.firstName).toBe("نیکی");
    expect(after.users[0]?.bio).toBe("Developer & Gamer");
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

  it("reuses the same user id for the same email on a second OTP", async () => {
    const firstToken = await readyHuman();
    const start = await startRegistration(
      { channel: "email", identifier: "same.person@nixo.test", humanToken: firstToken, website: "", intent: "register" },
      ip,
    );
    expect(start.ok).toBe(true);
    if (!start.ok) return;
    const code = getOutbox(start.challengeId)?.body.match(/\b(\d{6})\b/)?.[1] ?? "";
    const first = await verifyOtp(start.challengeId, code, ip);
    expect(first.ok).toBe(true);
    if (!first.ok) return;
    const secondToken = await readyHuman();
    const again = await startRegistration(
      { channel: "email", identifier: "same.person@nixo.test", humanToken: secondToken, website: "", intent: "register" },
      ip,
    );
    expect(again.ok).toBe(true);
    if (!again.ok) return;
    const code2 = getOutbox(again.challengeId)?.body.match(/\b(\d{6})\b/)?.[1] ?? "";
    const second = await verifyOtp(again.challengeId, code2, ip);
    expect(second.ok).toBe(true);
    if (!second.ok) return;
    expect(second.userId).toBe(first.userId);
    const after = await readStoreSnapshot();
    expect(after.users.filter((u) => u.identifierMasked.includes("nixo.test")).length).toBe(1);
  });

  it("does not create a user when login intent has no account", async () => {
    const token = await readyHuman();
    const start = await startRegistration(
      { channel: "email", identifier: "ghost@nixo.test", humanToken: token, website: "", intent: "login" },
      ip,
    );
    expect(start.ok).toBe(true);
    if (!start.ok) return;
    const code = getOutbox(start.challengeId)?.body.match(/\b(\d{6})\b/)?.[1] ?? "";
    const verified = await verifyOtp(start.challengeId, code, ip);
    expect(verified.ok).toBe(false);
    if (verified.ok) return;
    expect(verified.status).toBe(404);
    const after = await readStoreSnapshot();
    expect(after.users).toHaveLength(0);
  });

  it("keeps two emails as two separate users", async () => {
    async function make(email: string) {
      const token = await readyHuman();
      const start = await startRegistration(
        { channel: "email", identifier: email, humanToken: token, website: "", intent: "register" },
        ip,
      );
      if (!start.ok) throw new Error("start");
      const code = getOutbox(start.challengeId)?.body.match(/\b(\d{6})\b/)?.[1] ?? "";
      const verified = await verifyOtp(start.challengeId, code, ip);
      if (!verified.ok) throw new Error("verify");
      return verified.userId;
    }
    const a = await make("user-a@nixo.test");
    const b = await make("user-b@nixo.test");
    expect(a).not.toBe(b);
    const after = await readStoreSnapshot();
    expect(after.users).toHaveLength(2);
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
