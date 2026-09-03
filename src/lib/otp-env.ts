/** OTP provider env resolution. Accepts NIXO_* names and common provider aliases used on Render. */

const UNSET_PROVIDER = new Set(["", "none", "off", "false", "disabled", "unset", "null", "undefined", "-"]);

export function envFirst(...names: string[]): string {
  for (const name of names) {
    let v = (process.env[name] ?? "").trim();
    if (
      (v.startsWith('"') && v.endsWith('"') && v.length >= 2) ||
      (v.startsWith("'") && v.endsWith("'") && v.length >= 2)
    ) {
      v = v.slice(1, -1).trim();
    }
    v = v.replace(/\r?\n/g, "").trim();
    if (v) return v;
  }
  return "";
}

export function sendTimeoutMs(): number {
  const n = Number(envFirst("NIXO_OTP_TIMEOUT_MS"));
  if (Number.isFinite(n) && n >= 3_000 && n <= 60_000) return n;
  return 20_000;
}

export function emailProviderName(): string {
  const explicit = envFirst("NIXO_EMAIL_PROVIDER").toLowerCase();
  if (explicit && !UNSET_PROVIDER.has(explicit)) return explicit;
  if (envFirst("RESEND_API_KEY", "RESEND_KEY")) return "resend";
  if (envFirst("SENDGRID_API_KEY")) return "sendgrid";
  if (envFirst("POSTMARK_SERVER_TOKEN", "POSTMARK_API_TOKEN")) return "postmark";
  if (envFirst("MAILGUN_API_KEY")) return "mailgun";
  if (envFirst("NIXO_SMTP_HOST", "SMTP_HOST", "SMTP_SERVER")) return "smtp";
  return "";
}

export function emailFromAddress(): string {
  return envFirst(
    "NIXO_EMAIL_FROM",
    "NIXO_EMAIL",
    "NIXO_SMTP_FROM",
    "RESEND_FROM_EMAIL",
    "RESEND_FROM",
    "EMAIL_FROM",
    "MAIL_FROM",
    "SMTP_FROM",
  );
}

export function emailApiKey(): string {
  return envFirst(
    "NIXO_EMAIL_API_KEY",
    "RESEND_API_KEY",
    "RESEND_KEY",
    "SENDGRID_API_KEY",
    "POSTMARK_SERVER_TOKEN",
    "POSTMARK_API_TOKEN",
    "MAILGUN_API_KEY",
  );
}

export function mailgunDomain(): string {
  return envFirst("NIXO_MAILGUN_DOMAIN", "MAILGUN_DOMAIN");
}

export function smtpHost(): string {
  return envFirst("NIXO_SMTP_HOST", "SMTP_HOST", "SMTP_SERVER");
}

export function smtpUser(): string {
  return envFirst("NIXO_SMTP_USER", "SMTP_USER", "SMTP_USERNAME");
}

export function smtpPass(): string {
  return envFirst("NIXO_SMTP_PASS", "SMTP_PASS", "SMTP_PASSWORD");
}

export function smtpPort(): string {
  return envFirst("NIXO_SMTP_PORT", "SMTP_PORT") || "465";
}

export function smtpSecureFlag(): string {
  return envFirst("NIXO_SMTP_SECURE", "SMTP_SECURE");
}

export function smsProviderName(): string {
  const explicit = envFirst("NIXO_SMS_PROVIDER").toLowerCase();
  if (explicit && !UNSET_PROVIDER.has(explicit)) return explicit;
  if (envFirst("TWILIO_ACCOUNT_SID", "TWILIO_AUTH_TOKEN")) return "twilio";
  if (envFirst("KAVENEGAR_API_KEY")) return "kavenegar";
  if (envFirst("SMSIR_API_KEY", "SMS_IR_API_KEY")) return "smsir";
  return "";
}

export function smsApiKey(): string {
  return envFirst("NIXO_SMS_API_KEY", "TWILIO_ACCOUNT_SID", "KAVENEGAR_API_KEY", "SMSIR_API_KEY", "SMS_IR_API_KEY");
}

export function smsApiSecret(): string {
  return envFirst("NIXO_SMS_API_SECRET", "TWILIO_AUTH_TOKEN");
}

export function normalizeSmsFrom(raw: string): string {
  const v = raw.trim();
  if (!v) return "";
  if (/^MG[A-Za-z0-9]+$/i.test(v)) return v;
  if (/^\+[1-9]\d{7,14}$/.test(v)) return v;
  const digits = v.replace(/\D/g, "");
  if (digits.length >= 8 && digits.length <= 15) return `+${digits}`;
  return v;
}

export function smsFrom(): string {
  return normalizeSmsFrom(
    envFirst("NIXO_SMS_FROM", "TWILIO_FROM", "TWILIO_PHONE_NUMBER", "TWILIO_MESSAGING_SERVICE_SID", "SMSIR_LINE"),
  );
}

export function emailConfigured(): boolean {
  const p = emailProviderName();
  if (p === "smtp") {
    return Boolean(smtpHost() && smtpUser() && smtpPass() && emailFromAddress());
  }
  if (p === "resend" || p === "sendgrid" || p === "postmark") {
    return Boolean(emailApiKey() && emailFromAddress());
  }
  if (p === "mailgun") {
    return Boolean(emailApiKey() && emailFromAddress() && (mailgunDomain() || emailFromAddress().includes("@")));
  }
  return false;
}

export function smsConfigured(): boolean {
  const p = smsProviderName();
  if (p === "twilio") {
    return Boolean(smsApiKey() && smsApiSecret() && smsFrom());
  }
  if (p === "kavenegar") {
    return Boolean(smsApiKey());
  }
  if (p === "smsir") {
    return Boolean(smsApiKey() && smsFrom());
  }
  return false;
}

export function emailFromLooksSandbox(): boolean {
  return /resend\.dev/i.test(emailFromAddress());
}

export function otpProvidersReady(): {
  email: boolean;
  sms: boolean;
  emailSandbox: boolean;
  missingEmail: string;
  missingSms: string;
} {
  return {
    email: emailConfigured(),
    sms: smsConfigured(),
    emailSandbox: emailFromLooksSandbox(),
    missingEmail: emailConfigured() ? "" : emailMissingVars(),
    missingSms: smsConfigured() ? "" : smsMissingVars(),
  };
}

export function emailMissingVars(): string {
  const missing: string[] = [];
  const p = emailProviderName();
  if (!p) missing.push("NIXO_EMAIL_PROVIDER|RESEND_API_KEY");
  if (!emailFromAddress()) missing.push("NIXO_EMAIL_FROM|RESEND_FROM");
  if (p === "smtp") {
    if (!smtpHost()) missing.push("NIXO_SMTP_HOST|SMTP_HOST");
    if (!smtpUser()) missing.push("NIXO_SMTP_USER|SMTP_USER");
    if (!smtpPass()) missing.push("NIXO_SMTP_PASS");
  } else if (p === "resend" || p === "sendgrid" || p === "postmark" || p === "mailgun") {
    if (!emailApiKey()) missing.push("NIXO_EMAIL_API_KEY|RESEND_API_KEY");
  }
  if (p === "mailgun" && !mailgunDomain() && !emailFromAddress().includes("@")) {
    missing.push("NIXO_MAILGUN_DOMAIN");
  }
  return missing.join(",") || "email_config";
}

export function smsMissingVars(): string {
  const missing: string[] = [];
  const p = smsProviderName();
  if (!p) missing.push("NIXO_SMS_PROVIDER|TWILIO_ACCOUNT_SID");
  if (p === "twilio") {
    if (!smsApiKey()) missing.push("NIXO_SMS_API_KEY|TWILIO_ACCOUNT_SID");
    if (!smsApiSecret()) missing.push("NIXO_SMS_API_SECRET|TWILIO_AUTH_TOKEN");
    if (!smsFrom()) missing.push("NIXO_SMS_FROM|TWILIO_FROM");
  } else if (p === "kavenegar") {
    if (!smsApiKey()) missing.push("NIXO_SMS_API_KEY|KAVENEGAR_API_KEY");
  } else if (p === "smsir") {
    if (!smsApiKey()) missing.push("NIXO_SMS_API_KEY|SMSIR_API_KEY");
    if (!smsFrom()) missing.push("NIXO_SMS_FROM|SMSIR_LINE");
  }
  return missing.join(",") || "sms_config";
}
