import { afterEach, describe, expect, it, vi } from "vitest";
import { encryptText } from "./crypto-utils";
import { deliverOtpMessage, dispatchChallengeOtp, liveOtpProviderEnabled } from "./otp-delivery";
import { mutateStore, resetStoreForTests } from "./store";
import { validateRuntimeConfig } from "./env-config";

const origFetch = globalThis.fetch;

afterEach(async () => {
  globalThis.fetch = origFetch;
  delete process.env.NIXO_OTP_FORCE_PROVIDER;
  delete process.env.NIXO_EMAIL_PROVIDER;
  delete process.env.NIXO_EMAIL_FROM;
  delete process.env.NIXO_EMAIL_API_KEY;
  delete process.env.NIXO_SMS_PROVIDER;
  delete process.env.NIXO_SMS_API_KEY;
  delete process.env.NIXO_SMS_API_SECRET;
  delete process.env.NIXO_SMS_FROM;
  await resetStoreForTests();
});

describe("OTP providers", () => {
  it("sends email through Resend to the real destination", async () => {
    process.env.NIXO_OTP_FORCE_PROVIDER = "1";
    process.env.NIXO_EMAIL_PROVIDER = "resend";
    process.env.NIXO_EMAIL_FROM = "NIXO <noreply@nixo.test>";
    process.env.NIXO_EMAIL_API_KEY = "re_test_not_real";
    const calls: { url: string; body: string; auth: string }[] = [];
    globalThis.fetch = vi.fn(async (url, init) => {
      const headers = new Headers(init?.headers);
      calls.push({
        url: String(url),
        body: String(init?.body ?? ""),
        auth: headers.get("Authorization") ?? "",
      });
      return new Response(JSON.stringify({ id: "em_1" }), { status: 200 });
    }) as typeof fetch;
    const sent = await deliverOtpMessage({
      channel: "email",
      to: "user@nixo.test",
      body: "کد تأیید NIXO: 123456",
      challengeId: "ch1",
    });
    expect(sent.ok).toBe(true);
    expect(sent.provider).toBe("resend");
    expect(calls[0]?.url).toContain("api.resend.com");
    expect(calls[0]?.body).toContain("user@nixo.test");
    expect(calls[0]?.body).not.toContain("u***");
    expect(calls[0]?.auth).toContain("Bearer re_test_not_real");
  });

  it("sends SMS through Twilio in E.164 and records provider failure", async () => {
    process.env.NIXO_OTP_FORCE_PROVIDER = "1";
    process.env.NIXO_SMS_PROVIDER = "twilio";
    process.env.NIXO_SMS_API_KEY = "ACtestsidxxxxxxxxxxxxxxxxxxxx";
    process.env.NIXO_SMS_API_SECRET = "testtoken";
    process.env.NIXO_SMS_FROM = "+15005550006";
    globalThis.fetch = vi.fn(async (url, init) => {
      expect(String(url)).toContain("api.twilio.com");
      expect(String(init?.body)).toContain("To=%2B989123456789");
      expect(String(init?.body)).toContain("123456");
      return new Response("error", { status: 502 });
    }) as typeof fetch;
    const sent = await deliverOtpMessage({
      channel: "phone",
      to: "09123456789",
      body: "کد تأیید NIXO: 123456",
      challengeId: "ch2",
    });
    expect(sent.ok).toBe(false);
    expect(sent.status).toBe("failed");
    expect(sent.error).toBe("http_502");
  });

  it("sends SMS through Kavenegar to the local Iranian number", async () => {
    process.env.NIXO_OTP_FORCE_PROVIDER = "1";
    process.env.NIXO_SMS_PROVIDER = "kavenegar";
    process.env.NIXO_SMS_API_KEY = "kave-test-key";
    globalThis.fetch = vi.fn(async (url, init) => {
      expect(String(url)).toContain("api.kavenegar.com/v1/kave-test-key/sms/send.json");
      expect(String(init?.body)).toContain("receptor=09121112233");
      return new Response(JSON.stringify({ return: { status: 200 } }), { status: 200 });
    }) as typeof fetch;
    const sent = await deliverOtpMessage({
      channel: "phone",
      to: "09121112233",
      body: "کد تأیید NIXO: 654321",
      challengeId: "ch3",
    });
    expect(sent.ok).toBe(true);
    expect(sent.provider).toBe("kavenegar");
  });

  it("marks the stored challenge failed when the provider errors", async () => {
    process.env.NIXO_OTP_FORCE_PROVIDER = "1";
    process.env.NIXO_EMAIL_PROVIDER = "resend";
    process.env.NIXO_EMAIL_FROM = "noreply@nixo.test";
    process.env.NIXO_EMAIL_API_KEY = "re_fail";
    globalThis.fetch = vi.fn(async () => new Response("nope", { status: 401 })) as typeof fetch;
    const id = await mutateStore((data) => {
      data.challenges.push({
        id: "ch-fail",
        channel: "email",
        identifierHash: "h",
        identifierMasked: "u***@nixo.test",
        identifierCipher: encryptText("real@nixo.test"),
        salt: "s",
        codeHash: "a".repeat(64),
        expiresAt: Date.now() + 60_000,
        usedAt: null,
        attemptCount: 0,
        sendCount: 1,
        lastSentAt: Date.now(),
        createdAt: Date.now(),
        invalidatedAt: null,
        ipHash: "ip",
        deliveryStatus: "pending",
      });
      return "ch-fail";
    });
    const d = await dispatchChallengeOtp(id, "111111");
    expect(d.ok).toBe(false);
    const row = await mutateStore((data) => data.challenges.find((c) => c.id === id));
    expect(row?.deliveryStatus).toBe("failed");
    expect(row?.deliveryError).toBe("http_401");
    expect(JSON.stringify(row)).not.toContain("111111");
    expect(JSON.stringify(row)).not.toContain("real@nixo.test");
  });

  it("requires email and sms providers in production config", () => {
    expect(validateRuntimeConfig("production").errors.some((e) => e.includes("email"))).toBe(true);
    expect(validateRuntimeConfig("production").errors.some((e) => e.includes("sms"))).toBe(true);
  });

  it("uses the demo inbox in tests unless a live provider is forced", () => {
    expect(liveOtpProviderEnabled()).toBe(false);
    process.env.NIXO_OTP_FORCE_PROVIDER = "1";
    expect(liveOtpProviderEnabled()).toBe(true);
  });

  it("fails closed with a logged config error when live email is forced without env", async () => {
    process.env.NIXO_OTP_FORCE_PROVIDER = "1";
    delete process.env.NIXO_EMAIL_PROVIDER;
    const sent = await deliverOtpMessage({
      channel: "email",
      to: "user@nixo.test",
      body: "کد تأیید NIXO: 123456",
      challengeId: "ch-cfg",
    });
    expect(sent.ok).toBe(false);
    expect(sent.error).toBe("not_configured");
  });
});
