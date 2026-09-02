import { getDialCountry } from "@/lib/dial-codes";

export type Channel = "phone" | "email";

const PERSIAN_DIGITS = "۰۱۲۳۴۵۶۷۸۹";
const ARABIC_DIGITS = "٠١٢٣٤٥٦٧٨٩";

export function toEnglishDigits(value: string): string {
  return [...value]
    .map((ch) => {
      const p = PERSIAN_DIGITS.indexOf(ch);
      if (p >= 0) return String(p);
      const a = ARABIC_DIGITS.indexOf(ch);
      if (a >= 0) return String(a);
      return ch;
    })
    .join("");
}

export function normalizePhone(input: string): string | null {
  let raw = toEnglishDigits(input).trim();
  raw = raw.replace(/[\s\-()]/g, "");
  if (raw.startsWith("0098")) raw = `0${raw.slice(4)}`;
  if (raw.startsWith("+98")) raw = `0${raw.slice(3)}`;
  if (raw.startsWith("98") && raw.length === 12) raw = `0${raw.slice(2)}`;
  if (/^09\d{9}$/.test(raw)) return raw;
  if (raw.startsWith("00") && /^00[1-9]\d{7,14}$/.test(raw)) raw = `+${raw.slice(2)}`;
  if (/^\+[1-9]\d{7,14}$/.test(raw)) return raw;
  return null;
}

export function normalizeEmail(input: string): string | null {
  const raw = input.trim().toLowerCase();
  if (raw.length > 254) return null;
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(raw)) return null;
  if (raw.includes("..")) return null;
  return raw;
}

export function normalizeIdentifier(channel: Channel, input: string, countryIso?: string | null): string | null {
  if (channel === "email") return normalizeEmail(input);
  if (countryIso) return normalizePhoneWithCountry(countryIso, input);
  return normalizePhone(input);
}

/** Email if the value contains `@`, otherwise treat as phone. */
export function detectChannel(input: string): Channel {
  return input.trim().includes("@") ? "email" : "phone";
}

/**
 * Combine a selected ISO country with a national number the user typed.
 * Strips a local 0 and a repeated country code. Does not accept another
 * country's number just because the digit length happens to match.
 */
export function normalizePhoneWithCountry(iso: string, national: string): string | null {
  const country = getDialCountry(iso);
  if (!country) return null;
  let digits = toEnglishDigits(national).trim();
  digits = digits.replace(/[\s\-()]/g, "");
  if (digits.startsWith("00")) digits = digits.slice(2);
  if (digits.startsWith("+")) digits = digits.slice(1);
  digits = digits.replace(/\D/g, "");
  if (!digits) return null;

  if (digits.startsWith(country.dial)) {
    const rest = digits.slice(country.dial.length);
    if (rest.length >= country.nsnMin && rest.length <= country.nsnMax) {
      digits = rest;
    }
  }
  if (digits.startsWith("0")) digits = digits.slice(1);

  if (digits.length < country.nsnMin || digits.length > country.nsnMax) return null;
  if (country.nsnPattern && !country.nsnPattern.test(digits)) return null;

  if (country.iso === "IR") return `0${digits}`;
  return `+${country.dial}${digits}`;
}

/** E.164 for Twilio and similar. Iranian 09xxxxxxxxx → +98. */
export function toE164Phone(input: string): string | null {
  const compact = toEnglishDigits(input).replace(/[\s\-()]/g, "");
  if (/^\+[1-9]\d{7,14}$/.test(compact)) return compact;
  const n = normalizePhone(compact);
  if (!n) return null;
  if (n.startsWith("+")) return n;
  if (/^09\d{9}$/.test(n)) return `+98${n.slice(1)}`;
  return null;
}
