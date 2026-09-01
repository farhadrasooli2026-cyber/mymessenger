/** Sanitize and isolate user text before any AI provider. Never send secrets. */

const SECRET =
  /password\s*[:=]\s*\S+|Bearer\s+[A-Za-z0-9._\-]+|sk_(live|test)_[A-Za-z0-9]+|BEGIN (RSA |EC |OPENSSH )?PRIVATE KEY|api[_-]?key\s*[:=]\s*\S+|totp|cvv\s*[:=]|cvc\s*[:=]/i;
const PAN = /\b(?:\d[ \-]?){13,19}\b/;
const INJECTION =
  /ignore (all )?(previous|prior|above) (instructions|rules)|you are now (dan|unfiltered)|jailbreak|override (system|safety)|system prompt:/i;
const CALL_AUDIO = /ضبط تماس|call recording|transcribe (this |the )?call|voice of another user/i;
const FOREIGN_PRIVATE = /"ciphertext"|e2ee.?payload|private messages? of |پیام خصوصی کاربر دیگر/i;

export function estimateTokens(text: string) {
  return Math.ceil(text.length / 4);
}

export function sanitizeForAi(text: string): { text: string; omitted: boolean } {
  let next = text.slice(0, 20_000);
  let omitted = false;
  if (SECRET.test(next) || PAN.test(next)) {
    next = next.replace(SECRET, "[omitted-secret]").replace(PAN, "[omitted-card]");
    omitted = true;
  }
  return { text: next, omitted };
}

export function injectionAttempt(text: string) {
  return INJECTION.test(text);
}

export function blocksCallAudio(text: string) {
  return CALL_AUDIO.test(text);
}

export function looksLikeForeignPrivate(text: string) {
  return FOREIGN_PRIVATE.test(text);
}

export function embeddingTokens(text: string, max = 24) {
  return text
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]+/gu, " ")
    .split(/\s+/)
    .filter((w) => w.length > 1)
    .slice(0, max);
}

export function vectorAllowed(ownerUserId: string, requesterId: string) {
  return ownerUserId === requesterId;
}

export function applySafetyLayer(text: string, intent: string): { text: string; blocked: boolean } {
  if (/(permanent ban|حذف دائمی حساب|delete this account now|ban user automatically)/i.test(text) && intent === "spam") {
    return {
      text: "امتیاز کمکی است. AI نمی‌تواند حساب را حذف یا مسدود کند؛ بررسی انسانی لازم است.",
      blocked: true,
    };
  }
  if (SECRET.test(text) || PAN.test(text)) {
    return { text: "خروجی شامل دادهٔ حساس بود و حذف شد. دوباره بدون Secret بپرس.", blocked: true };
  }
  return { text, blocked: false };
}

export function confidenceFrom(uncertain: boolean, refused: boolean) {
  if (refused) return 0.95;
  if (uncertain) return 0.42;
  return 0.72;
}

export function markGenerated(text: string, intent: string) {
  if (intent === "summarize" && !/تولیدشده توسط AI|AI-generated/i.test(text)) {
    return "خلاصهٔ تولیدشده توسط AI (نه متن اصلی گفتگو):\n" + text;
  }
  return text;
}

export function experimentBucket(userId: string, name: string, percent: number): "a" | "b" {
  if (!name || percent <= 0) return "a";
  let h = 2166136261;
  const s = `${userId}:${name}`;
  for (let i = 0; i < s.length; i += 1) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return Math.abs(h) % 100 < percent ? "b" : "a";
}
