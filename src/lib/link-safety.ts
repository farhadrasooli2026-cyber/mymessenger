/** Client-side link heuristics. Server never fetches the target. */

const SHORTENERS = new Set([
  "bit.ly",
  "tinyurl.com",
  "t.co",
  "goo.gl",
  "ow.ly",
  "is.gd",
  "cutt.ly",
]);

export function inspectLink(raw: string): { warn: boolean; reason?: string } {
  const trimmed = raw.trim();
  if (/^javascript:/i.test(trimmed) || /^data:/i.test(trimmed)) {
    return { warn: true, reason: "این لینک از پروتکل خطرناک استفاده می‌کند." };
  }
  let url: URL;
  try {
    url = new URL(trimmed.includes("://") ? trimmed : `https://${trimmed}`);
  } catch {
    return { warn: false };
  }
  const host = url.hostname.toLowerCase();
  if (/^\d{1,3}(\.\d{1,3}){3}$/.test(host)) {
    return { warn: true, reason: "لینک به آدرس IP خام اشاره دارد." };
  }
  if (host.includes("xn--")) {
    return { warn: true, reason: "دامنهٔ Punycode ممکن است جعلی باشد." };
  }
  if (SHORTENERS.has(host)) {
    return { warn: true, reason: "کوتاه‌کنندهٔ لینک مقصد را پنهان می‌کند." };
  }
  if (url.username || url.password) {
    return { warn: true, reason: "لینک شامل اطلاعات ورود در خود آدرس است." };
  }
  return { warn: false };
}

export function inspectTextLinks(text: string): { warn: boolean; reason?: string } {
  const matches = text.match(/https?:\/\/[^\s]+|(?:www\.)[^\s]+/gi) ?? [];
  for (const m of matches) {
    const hit = inspectLink(m.replace(/[),.]+$/, ""));
    if (hit.warn) return hit;
  }
  return { warn: false };
}
