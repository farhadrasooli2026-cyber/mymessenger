/** ISO 3166-1 alpha-2 country metadata. Not a secret. */

export type CountryRow = {
  iso: string;
  name: string;
  nativeName: string;
  dial: string;
  currency: string;
  currencySymbol: string;
  measurement: "metric" | "imperial";
  phoneExample: string;
};

export const COUNTRIES: CountryRow[] = [
  { iso: "IR", name: "Iran", nativeName: "ایران", dial: "98", currency: "IRR", currencySymbol: "ریال", measurement: "metric", phoneExample: "9123456789" },
  { iso: "US", name: "United States", nativeName: "United States", dial: "1", currency: "USD", currencySymbol: "$", measurement: "imperial", phoneExample: "2025550123" },
  { iso: "GB", name: "United Kingdom", nativeName: "United Kingdom", dial: "44", currency: "GBP", currencySymbol: "£", measurement: "imperial", phoneExample: "7400123456" },
  { iso: "TR", name: "Türkiye", nativeName: "Türkiye", dial: "90", currency: "TRY", currencySymbol: "₺", measurement: "metric", phoneExample: "5320000000" },
  { iso: "SA", name: "Saudi Arabia", nativeName: "السعودية", dial: "966", currency: "SAR", currencySymbol: "ر.س", measurement: "metric", phoneExample: "501234567" },
  { iso: "AE", name: "United Arab Emirates", nativeName: "الإمارات", dial: "971", currency: "AED", currencySymbol: "د.إ", measurement: "metric", phoneExample: "501234567" },
  { iso: "DE", name: "Germany", nativeName: "Deutschland", dial: "49", currency: "EUR", currencySymbol: "€", measurement: "metric", phoneExample: "15123456789" },
  { iso: "FR", name: "France", nativeName: "France", dial: "33", currency: "EUR", currencySymbol: "€", measurement: "metric", phoneExample: "612345678" },
  { iso: "RU", name: "Russia", nativeName: "Россия", dial: "7", currency: "RUB", currencySymbol: "₽", measurement: "metric", phoneExample: "9123456789" },
  { iso: "CN", name: "China", nativeName: "中国", dial: "86", currency: "CNY", currencySymbol: "¥", measurement: "metric", phoneExample: "13800138000" },
  { iso: "JP", name: "Japan", nativeName: "日本", dial: "81", currency: "JPY", currencySymbol: "¥", measurement: "metric", phoneExample: "9012345678" },
  { iso: "IN", name: "India", nativeName: "भारत", dial: "91", currency: "INR", currencySymbol: "₹", measurement: "metric", phoneExample: "9876543210" },
  { iso: "AU", name: "Australia", nativeName: "Australia", dial: "61", currency: "AUD", currencySymbol: "A$", measurement: "imperial", phoneExample: "412345678" },
  { iso: "CA", name: "Canada", nativeName: "Canada", dial: "1", currency: "CAD", currencySymbol: "C$", measurement: "metric", phoneExample: "4165550123" },
  { iso: "IQ", name: "Iraq", nativeName: "العراق", dial: "964", currency: "IQD", currencySymbol: "د.ع", measurement: "metric", phoneExample: "7901234567" },
  { iso: "AF", name: "Afghanistan", nativeName: "افغانستان", dial: "93", currency: "AFN", currencySymbol: "؋", measurement: "metric", phoneExample: "701234567" },
];

const BY_ISO = new Map(COUNTRIES.map((c) => [c.iso, c]));

export function getCountry(iso: string | null | undefined): CountryRow | null {
  if (!iso) return null;
  return BY_ISO.get(iso.toUpperCase()) ?? null;
}

export function isIsoCountry(iso: string): boolean {
  return BY_ISO.has(iso.toUpperCase());
}

export function formatPhone(iso: string | null | undefined, national: string): string {
  const digits = national.replace(/\D/g, "");
  const c = getCountry(iso);
  if (!c) return digits;
  if (c.iso === "IR" && digits.length >= 10) {
    const n = digits.replace(/^0/, "");
    return `+${c.dial} ${n.slice(0, 3)} ${n.slice(3, 6)} ${n.slice(6)}`;
  }
  if (c.iso === "US" || c.iso === "CA") {
    const n = digits.slice(-10);
    if (n.length === 10) return `+${c.dial} (${n.slice(0, 3)}) ${n.slice(3, 6)}-${n.slice(6)}`;
  }
  if (c.iso === "TR" && digits.length >= 10) {
    const n = digits.replace(/^0/, "");
    return `+${c.dial} ${n.slice(0, 3)} ${n.slice(3, 6)} ${n.slice(6)}`;
  }
  return `+${c.dial} ${digits.replace(/^0/, "")}`;
}
