/** BCP-47 language metadata. Adding a language: new pack + this row. No core UI rewrite. */

export const DEFAULT_LOCALE = "fa" as const;
export const FALLBACK_LOCALE = "fa" as const;
export const TRANSLATION_VERSION = 1;

export const LANGUAGE_CATALOG = [
  {
    code: "fa",
    locale: "fa-IR",
    region: "IR",
    displayName: "Persian",
    nativeName: "فارسی",
    direction: "rtl",
    numbering: "arabext",
    calendar: "persian",
    measurement: "metric",
    voice: true,
    plural: "one_other",
  },
  {
    code: "en",
    locale: "en-US",
    region: "US",
    displayName: "English",
    nativeName: "English",
    direction: "ltr",
    numbering: "latn",
    calendar: "gregory",
    measurement: "imperial",
    voice: true,
    plural: "one_other",
  },
  {
    code: "tr",
    locale: "tr-TR",
    region: "TR",
    displayName: "Turkish",
    nativeName: "Türkçe",
    direction: "ltr",
    numbering: "latn",
    calendar: "gregory",
    measurement: "metric",
    voice: true,
    plural: "one_other",
  },
  {
    code: "ar",
    locale: "ar-SA",
    region: "SA",
    displayName: "Arabic",
    nativeName: "العربية",
    direction: "rtl",
    numbering: "arab",
    calendar: "gregory",
    measurement: "metric",
    voice: true,
    plural: "arabic",
  },
  {
    code: "ru",
    locale: "ru-RU",
    region: "RU",
    displayName: "Russian",
    nativeName: "Русский",
    direction: "ltr",
    numbering: "latn",
    calendar: "gregory",
    measurement: "metric",
    voice: false,
    plural: "slavic",
  },
] as const;

export type NixoLocale = (typeof LANGUAGE_CATALOG)[number]["code"];
export const NIXO_LOCALES = LANGUAGE_CATALOG.map((l) => l.code) as NixoLocale[];
export const DEFAULT_ENABLED_LOCALES: NixoLocale[] = ["fa", "en", "tr", "ar"];

export type LanguageMeta = (typeof LANGUAGE_CATALOG)[number];

export function languageMeta(code: string | null | undefined): LanguageMeta {
  return LANGUAGE_CATALOG.find((l) => l.code === code) ?? LANGUAGE_CATALOG[0];
}

export function parseLocale(raw: string | null | undefined): NixoLocale {
  if (!raw) return DEFAULT_LOCALE;
  const lower = raw.trim().toLowerCase().replace("_", "-");
  const base = lower.split("-")[0] ?? "";
  const hit = LANGUAGE_CATALOG.find((l) => l.code === base || l.locale.toLowerCase() === lower);
  return hit?.code ?? DEFAULT_LOCALE;
}

export function detectLocaleFromAccept(header: string | null | undefined): NixoLocale {
  if (!header) return DEFAULT_LOCALE;
  const parts = header.split(",").map((p) => p.trim().split(";")[0] ?? "");
  for (const p of parts) {
    const code = parseLocale(p);
    if (p && (LANGUAGE_CATALOG.some((l) => l.code === (p.split("-")[0] ?? "").toLowerCase()) || p.toLowerCase().startsWith(code))) {
      const base = (p.split("-")[0] ?? "").toLowerCase();
      if (LANGUAGE_CATALOG.some((l) => l.code === base)) return base as NixoLocale;
    }
  }
  return DEFAULT_LOCALE;
}

export function localeDir(code: string | null | undefined): "rtl" | "ltr" {
  return languageMeta(code).direction;
}

export function isRtl(code: string | null | undefined): boolean {
  return localeDir(code) === "rtl";
}

export function bcp47(code: string | null | undefined, region?: string | null): string {
  const meta = languageMeta(code);
  if (region && /^[A-Z]{2}$/i.test(region)) return `${meta.code}-${region.toUpperCase()}`;
  return meta.locale;
}
