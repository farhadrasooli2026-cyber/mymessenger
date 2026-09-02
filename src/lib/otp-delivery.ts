import "server-only";
import { decryptText } from "@/lib/crypto-utils";
import { toE164Phone } from "@/lib/identifiers";
import { currentDeployEnv, isDemoInboxEnabled } from "@/lib/env-config";
import { buildOtpMessage, putOutbox } from "@/lib/outbox";
import { config } from "@/lib/config";
import { mutateStore, readStoreSnapshot } from "@/lib/store";
import type { Channel } from "@/lib/identifiers";

export type OtpDeliveryStatus = "pending" | "sent" | "failed" | "dev-outbox";

export type OtpDeliveryResult = {
  ok: boolean;
  status: OtpDeliveryStatus;
  provider: string;
  error?: string;
};

const SEND_TIMEOUT_MS = 8_000;

function envTrim(name: string): string {
  return (process.env[name] ?? "").trim();
}

function forceProvider(): boolean {
  return process.env.NIXO_OTP_FORCE_PROVIDER === "1";
}

function memoryTransport(): boolean {
  return Boolean(process.env.VITEST) && !forceProvider();
}

export function emailProviderName(): string {
  return envTrim("NIXO_EMAIL_PROVIDER").toLowerCase();
}

export function smsProviderName(): string {
  return envTrim("NIXO_SMS_PROVIDER").toLowerCase();
}

export function emailFromAddress(): string {
  return envTrim("NIXO_EMAIL_FROM") || envTrim("NIXO_SMTP_FROM");
}

function emailConfigured(): boolean {
  const p = emailProviderName();
  if (p === "smtp") {
    return Boolean(envTrim("NIXO_SMTP_HOST") && envTrim("NIXO_SMTP_USER") && envTrim("NIXO_SMTP_PASS") && emailFromAddress());
  }
  if (p === "resend" || p === "sendgrid" || p === "postmark") {
    return Boolean(envTrim("NIXO_EMAIL_API_KEY") && emailFromAddress());
  }
  if (p === "mailgun") {
    return Boolean(envTrim("NIXO_EMAIL_API_KEY") && emailFromAddress() && (envTrim("NIXO_MAILGUN_DOMAIN") || emailFromAddress().includes("@")));
  }
  return false;
}

function smsConfigured(): boolean {
  const p = smsProviderName();
  if (p === "twilio") {
    return Boolean(envTrim("NIXO_SMS_API_KEY") && envTrim("NIXO_SMS_API_SECRET") && envTrim("NIXO_SMS_FROM"));
  }
  if (p === "kavenegar") {
    return Boolean(envTrim("NIXO_SMS_API_KEY"));
  }
  if (p === "smsir") {
    return Boolean(envTrim("NIXO_SMS_API_KEY") && envTrim("NIXO_SMS_FROM"));
  }
  return false;
}

export function otpProvidersReady(): { email: boolean; sms: boolean } {
  return { email: emailConfigured(), sms: smsConfigured() };
}

export function otpProviderErrors(env = currentDeployEnv()): string[] {
  if (env !== "production" && env !== "staging") return [];
  const errors: string[] = [];
  if (!emailConfigured()) errors.push("production email provider missing");
  if (!smsConfigured()) errors.push("production sms provider missing");
  return errors;
}

function logOtp(level: "info" | "error", msg: string, extra: Record<string, string | number | boolean | undefined>) {
  const line = { service: "otp", level, msg, ...extra };
  if (level === "error") console.error(JSON.stringify(line));
  else console.info(JSON.stringify(line));
}

function redactSnippet(text: string): string {
  return text
    .replace(/Bearer\s+\S+/gi, "Bearer [redacted]")
    .replace(/api[:/][A-Za-z0-9_-]{8,}/gi, "api/[redacted]")
    .replace(/(api[_-]?key|token|secret|authorization)("?\s*[:=]\s*")[^"]+/gi, "$1$2[redacted]")
    .slice(0, 220);
}

async function providerHttpError(provider: string, res: Response): Promise<OtpDeliveryResult> {
  const raw = await res.text().catch(() => "");
  const snippet = redactSnippet(raw);
  logOtp("error", "otp_provider_http", {
    provider,
    httpStatus: res.status,
    body: snippet || undefined,
  });
  return { ok: false, status: "failed", provider, error: `http_${res.status}` };
}

function catchSendError(provider: string, err: unknown): OtpDeliveryResult {
  const isTimeout = err instanceof Error && (err.name === "AbortError" || /timeout/i.test(err.message));
  const isNetwork = err instanceof Error && /fetch|network|ENOTFOUND|ECONN|EAI_AGAIN/i.test(err.message);
  const error = isTimeout ? "timeout" : isNetwork ? "network" : "send_failed";
  logOtp("error", "otp_provider_exception", {
    provider,
    error,
    detail: err instanceof Error ? redactSnippet(err.message) : "unknown",
  });
  return { ok: false, status: "failed", provider, error };
}

export function liveOtpProviderEnabled(): boolean {
  if (forceProvider()) return true;
  if (isDemoInboxEnabled()) return false;
  return true;
}

export function deliveryFailureReason(error?: string): "config" | "provider" | "network" | "destination" | "database" | "api" {
  if (!error) return "provider";
  if (error === "not_configured" || error === "unknown_provider") return "config";
  if (error === "timeout" || error === "network" || error === "send_failed") return "network";
  if (error === "bad_destination") return "destination";
  if (error === "destination_unavailable") return "database";
  if (error === "missing_challenge") return "api";
  return "provider";
}

function emailMissingVars(): string {
  const missing: string[] = [];
  const p = emailProviderName();
  if (!p) missing.push("NIXO_EMAIL_PROVIDER");
  if (!emailFromAddress()) missing.push("NIXO_EMAIL_FROM");
  if (p === "smtp") {
    if (!envTrim("NIXO_SMTP_HOST")) missing.push("NIXO_SMTP_HOST");
    if (!envTrim("NIXO_SMTP_USER")) missing.push("NIXO_SMTP_USER");
    if (!envTrim("NIXO_SMTP_PASS")) missing.push("NIXO_SMTP_PASS");
  } else if (p === "resend" || p === "sendgrid" || p === "postmark" || p === "mailgun") {
    if (!envTrim("NIXO_EMAIL_API_KEY")) missing.push("NIXO_EMAIL_API_KEY");
  }
  if (p === "mailgun" && !envTrim("NIXO_MAILGUN_DOMAIN") && !emailFromAddress().includes("@")) {
    missing.push("NIXO_MAILGUN_DOMAIN");
  }
  return missing.join(",") || "email_config";
}

function smsMissingVars(): string {
  const missing: string[] = [];
  const p = smsProviderName();
  if (!p) missing.push("NIXO_SMS_PROVIDER");
  if (p === "twilio") {
    if (!envTrim("NIXO_SMS_API_KEY")) missing.push("NIXO_SMS_API_KEY");
    if (!envTrim("NIXO_SMS_API_SECRET")) missing.push("NIXO_SMS_API_SECRET");
    if (!envTrim("NIXO_SMS_FROM")) missing.push("NIXO_SMS_FROM");
  } else if (p === "kavenegar") {
    if (!envTrim("NIXO_SMS_API_KEY")) missing.push("NIXO_SMS_API_KEY");
  } else if (p === "smsir") {
    if (!envTrim("NIXO_SMS_API_KEY")) missing.push("NIXO_SMS_API_KEY");
    if (!envTrim("NIXO_SMS_FROM")) missing.push("NIXO_SMS_FROM");
  }
  return missing.join(",") || "sms_config";
}

function smsDestinations(toRaw: string) {
  const e164 = toE164Phone(toRaw);
  const localIr = /^09\d{9}$/.test(toRaw)
    ? toRaw
    : e164?.startsWith("+98")
      ? `0${e164.slice(3)}`
      : null;
  const receptor = localIr ?? (e164 ? e164.replace(/^\+/, "") : toRaw);
  return { e164, localIr, receptor };
}

async function fetchTimed(url: string, init: RequestInit): Promise<Response> {
  const ac = new AbortController();
  const t = setTimeout(() => ac.abort(), SEND_TIMEOUT_MS);
  try {
    return await fetch(url, { ...init, signal: ac.signal });
  } finally {
    clearTimeout(t);
  }
}

async function sendEmail(to: string, body: string): Promise<OtpDeliveryResult> {
  const provider = emailProviderName();
  const from = emailFromAddress();
  const key = envTrim("NIXO_EMAIL_API_KEY");
  const subject = "کد تأیید نیکسو";
  if (!emailConfigured()) {
    logOtp("error", "otp_send_failed", {
      provider: provider || "email",
      error: "not_configured",
      missing: emailMissingVars(),
      env: currentDeployEnv(),
    });
    return { ok: false, status: "failed", provider: provider || "email", error: "not_configured" };
  }
  try {
    if (provider === "resend") {
      const res = await fetchTimed("https://api.resend.com/emails", {
        method: "POST",
        headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
        body: JSON.stringify({ from, to: [to], subject, text: body }),
      });
      if (!res.ok) return providerHttpError(provider, res);
      return { ok: true, status: "sent", provider };
    }
    if (provider === "sendgrid") {
      const res = await fetchTimed("https://api.sendgrid.com/v3/mail/send", {
        method: "POST",
        headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          personalizations: [{ to: [{ email: to }] }],
          from: { email: from.includes("<") ? from.replace(/^.*<([^>]+)>.*$/, "$1") : from },
          subject,
          content: [{ type: "text/plain", value: body }],
        }),
      });
      if (!res.ok && res.status !== 202) return providerHttpError(provider, res);
      return { ok: true, status: "sent", provider };
    }
    if (provider === "postmark") {
      const res = await fetchTimed("https://api.postmarkapp.com/email", {
        method: "POST",
        headers: {
          "X-Postmark-Server-Token": key,
          "Content-Type": "application/json",
          Accept: "application/json",
        },
        body: JSON.stringify({ From: from, To: to, Subject: subject, TextBody: body }),
      });
      if (!res.ok) return providerHttpError(provider, res);
      return { ok: true, status: "sent", provider };
    }
    if (provider === "mailgun") {
      const domain = envTrim("NIXO_MAILGUN_DOMAIN") || from.replace(/^.*@/, "").replace(/>$/, "");
      const auth = Buffer.from(`api:${key}`).toString("base64");
      const form = new URLSearchParams({ from, to, subject, text: body });
      const res = await fetchTimed(`https://api.mailgun.net/v3/${domain}/messages`, {
        method: "POST",
        headers: { Authorization: `Basic ${auth}`, "Content-Type": "application/x-www-form-urlencoded" },
        body: form,
      });
      if (!res.ok) return providerHttpError(provider, res);
      return { ok: true, status: "sent", provider };
    }
    if (provider === "smtp") {
      const nodemailer = (await import("nodemailer")).default;
      const port = Number(envTrim("NIXO_SMTP_PORT") || "465");
      const secure = envTrim("NIXO_SMTP_SECURE") !== "false" && port === 465;
      const transporter = nodemailer.createTransport({
        host: envTrim("NIXO_SMTP_HOST"),
        port,
        secure: envTrim("NIXO_SMTP_SECURE") === "true" || secure,
        auth: { user: envTrim("NIXO_SMTP_USER"), pass: envTrim("NIXO_SMTP_PASS") },
        connectionTimeout: SEND_TIMEOUT_MS,
        socketTimeout: SEND_TIMEOUT_MS,
      });
      await transporter.sendMail({ from, to, subject, text: body });
      return { ok: true, status: "sent", provider };
    }
    return { ok: false, status: "failed", provider, error: "unknown_provider" };
  } catch (err) {
    return catchSendError(provider, err);
  }
}

async function sendSms(toRaw: string, body: string): Promise<OtpDeliveryResult> {
  const provider = smsProviderName();
  if (!smsConfigured()) {
    logOtp("error", "otp_send_failed", {
      provider: provider || "sms",
      error: "not_configured",
      missing: smsMissingVars(),
      env: currentDeployEnv(),
    });
    return { ok: false, status: "failed", provider: provider || "sms", error: "not_configured" };
  }
  const { e164, receptor } = smsDestinations(toRaw);
  try {
    if (provider === "twilio") {
      if (!e164) return { ok: false, status: "failed", provider, error: "bad_destination" };
      const sid = envTrim("NIXO_SMS_API_KEY");
      const token = envTrim("NIXO_SMS_API_SECRET");
      const from = envTrim("NIXO_SMS_FROM");
      const auth = Buffer.from(`${sid}:${token}`).toString("base64");
      const form = new URLSearchParams({ To: e164, From: from, Body: body });
      const res = await fetchTimed(`https://api.twilio.com/2010-04-01/Accounts/${sid}/Messages.json`, {
        method: "POST",
        headers: { Authorization: `Basic ${auth}`, "Content-Type": "application/x-www-form-urlencoded" },
        body: form,
      });
      if (!res.ok) return providerHttpError(provider, res);
      return { ok: true, status: "sent", provider };
    }
    if (provider === "kavenegar") {
      const key = envTrim("NIXO_SMS_API_KEY");
      const sender = envTrim("NIXO_SMS_FROM");
      const params = new URLSearchParams({ receptor, message: body });
      if (sender) params.set("sender", sender);
      const res = await fetchTimed(`https://api.kavenegar.com/v1/${key}/sms/send.json`, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: params,
      });
      if (!res.ok) return providerHttpError(provider, res);
      const json = (await res.json().catch(() => null)) as { return?: { status?: number; message?: string } } | null;
      const st = json?.return?.status;
      if (st && st >= 400) {
        logOtp("error", "otp_provider_http", {
          provider,
          httpStatus: st,
          body: redactSnippet(json?.return?.message ?? ""),
        });
        return { ok: false, status: "failed", provider, error: `kavenegar_${st}` };
      }
      return { ok: true, status: "sent", provider };
    }
    if (provider === "smsir") {
      const key = envTrim("NIXO_SMS_API_KEY");
      const line = envTrim("NIXO_SMS_FROM");
      const res = await fetchTimed("https://api.sms.ir/v1/send/bulk", {
        method: "POST",
        headers: { "X-API-KEY": key, "Content-Type": "application/json", Accept: "application/json" },
        body: JSON.stringify({ lineNumber: Number(line) || line, messageText: body, mobiles: [receptor], sendDateTime: null }),
      });
      if (!res.ok) return providerHttpError(provider, res);
      return { ok: true, status: "sent", provider };
    }
    return { ok: false, status: "failed", provider, error: "unknown_provider" };
  } catch (err) {
    return catchSendError(provider || "sms", err);
  }
}

export async function deliverOtpMessage(input: {
  channel: Channel;
  to: string;
  body: string;
  challengeId: string;
}): Promise<OtpDeliveryResult> {
  if (memoryTransport()) {
    return { ok: true, status: "dev-outbox", provider: "memory" };
  }
  const result = input.channel === "email" ? await sendEmail(input.to, input.body) : await sendSms(input.to, input.body);
  logOtp(result.ok ? "info" : "error", result.ok ? "otp_sent" : "otp_send_failed", {
    challengeId: input.challengeId,
    channel: input.channel,
    provider: result.provider,
    status: result.status,
    error: result.error,
  });
  return result;
}

export async function markChallengeDelivery(challengeId: string, delivery: OtpDeliveryResult) {
  await mutateStore((data) => {
    const ch = data.challenges.find((c) => c.id === challengeId);
    if (!ch) return;
    ch.deliveryStatus = delivery.status;
    ch.deliveryProvider = delivery.provider.slice(0, 40);
    ch.deliveryAt = Date.now();
    ch.deliveryError = delivery.ok ? "" : (delivery.error ?? "failed").slice(0, 80);
    if (!delivery.ok) ch.deliveryFailedAt = Date.now();
  });
}

export async function dispatchChallengeOtp(challengeId: string, code: string): Promise<OtpDeliveryResult> {
  const data = await readStoreSnapshot();
  const ch = data.challenges.find((c) => c.id === challengeId);
  if (!ch) return { ok: false, status: "failed", provider: "none", error: "missing_challenge" };
  let to = "";
  try {
    to = decryptText(ch.identifierCipher);
  } catch {
    return { ok: false, status: "failed", provider: "none", error: "destination_unavailable" };
  }
  const body = buildOtpMessage(ch.channel, code, Math.ceil(config.otp.ttlMs / 60_000));
  if (isDemoInboxEnabled()) {
    putOutbox({
      challengeId: ch.id,
      channel: ch.channel,
      maskedTo: ch.identifierMasked,
      body,
      createdAt: Date.now(),
    });
  }
  if (!liveOtpProviderEnabled()) {
    const delivery: OtpDeliveryResult = { ok: true, status: "dev-outbox", provider: "demo-inbox" };
    logOtp("info", "otp_sent", {
      challengeId: ch.id,
      channel: ch.channel,
      provider: "demo-inbox",
      status: "dev-outbox",
      live: false,
    });
    await markChallengeDelivery(ch.id, delivery);
    return delivery;
  }
  const delivery = await deliverOtpMessage({ channel: ch.channel, to, body, challengeId: ch.id });
  await markChallengeDelivery(ch.id, delivery);
  return delivery;
}

export const OTP_DELIVERY_CLIENT_ERROR = "ارسال کد تأیید انجام نشد. بعداً تلاش کنید.";
