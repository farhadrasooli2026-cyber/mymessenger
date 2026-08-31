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
  if (!/^09\d{9}$/.test(raw)) return null;
  return raw;
}

export function normalizeEmail(input: string): string | null {
  const raw = input.trim().toLowerCase();
  if (raw.length > 254) return null;
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(raw)) return null;
  if (raw.includes("..")) return null;
  return raw;
}

export function normalizeIdentifier(channel: Channel, input: string): string | null {
  return channel === "phone" ? normalizePhone(input) : normalizeEmail(input);
}
