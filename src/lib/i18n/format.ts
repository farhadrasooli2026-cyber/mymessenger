import { bcp47, languageMeta, parseLocale, type NixoLocale } from "./languages";
import { formatPhone, getCountry } from "./countries";

export type NumberingPref = "system" | "latn" | "arabext" | "arab";
export type MeasurementPref = "system" | "metric" | "imperial";
export type CalendarPref = "system" | "persian" | "gregory";

export type FormatContext = {
  locale?: string | null;
  timeZone?: string | null;
  numbering?: NumberingPref;
  measurement?: MeasurementPref;
  calendar?: CalendarPref;
  hour12?: boolean | "system";
  country?: string | null;
};

function tzOf(ctx?: FormatContext): string | undefined {
  const tz = ctx?.timeZone && ctx.timeZone !== "system" ? ctx.timeZone : undefined;
  return tz || "Asia/Tehran";
}

function numberingSystem(ctx?: FormatContext): string | undefined {
  if (!ctx?.numbering || ctx.numbering === "system") {
    return languageMeta(ctx?.locale).numbering;
  }
  return ctx.numbering;
}

function calendarOf(ctx?: FormatContext): string {
  if (!ctx?.calendar || ctx.calendar === "system") return languageMeta(ctx?.locale).calendar;
  return ctx.calendar === "persian" ? "persian" : "gregory";
}

export function formatDate(ms: number, ctx?: FormatContext, opts?: Intl.DateTimeFormatOptions) {
  const locale = bcp47(ctx?.locale);
  try {
    return new Intl.DateTimeFormat(locale, {
      dateStyle: "medium",
      timeZone: tzOf(ctx),
      calendar: calendarOf(ctx),
      numberingSystem: numberingSystem(ctx),
      ...opts,
    }).format(new Date(ms));
  } catch {
    return new Date(ms).toISOString();
  }
}

export function formatTime(ms: number, ctx?: FormatContext, opts?: Intl.DateTimeFormatOptions) {
  const locale = bcp47(ctx?.locale);
  const hour12 = ctx?.hour12 === "system" || ctx?.hour12 === undefined ? undefined : ctx.hour12;
  try {
    return new Intl.DateTimeFormat(locale, {
      timeStyle: "short",
      timeZone: tzOf(ctx),
      hour12,
      numberingSystem: numberingSystem(ctx),
      ...opts,
    }).format(new Date(ms));
  } catch {
    return new Date(ms).toISOString();
  }
}

export function formatDateTime(ms: number, ctx?: FormatContext) {
  return `${formatDate(ms, ctx)} ${formatTime(ms, ctx)}`;
}

/** DST-aware offset in minutes for a timezone at `ms`. */
export function timezoneOffsetMinutes(timeZone: string, ms = Date.now()): number {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    timeZoneName: "shortOffset",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(new Date(ms));
  const name = parts.find((p) => p.type === "timeZoneName")?.value ?? "GMT";
  const m = name.match(/GMT([+-])(\d{1,2})(?::?(\d{2}))?/);
  if (!m) {
    const a = new Date(new Date(ms).toLocaleString("en-US", { timeZone: "UTC" }));
    const b = new Date(new Date(ms).toLocaleString("en-US", { timeZone }));
    return Math.round((b.getTime() - a.getTime()) / 60_000);
  }
  const sign = m[1] === "-" ? -1 : 1;
  return sign * (Number(m[2]) * 60 + Number(m[3] ?? 0));
}

export function formatRelative(ms: number, ctx?: FormatContext, now = Date.now()) {
  const locale = bcp47(ctx?.locale);
  const diffSec = Math.round((ms - now) / 1000);
  const abs = Math.abs(diffSec);
  let value = diffSec;
  let unit: Intl.RelativeTimeFormatUnit = "second";
  if (abs >= 86_400 * 30) {
    value = Math.round(diffSec / (86_400 * 30));
    unit = "month";
  } else if (abs >= 86_400) {
    value = Math.round(diffSec / 86_400);
    unit = "day";
  } else if (abs >= 3600) {
    value = Math.round(diffSec / 3600);
    unit = "hour";
  } else if (abs >= 60) {
    value = Math.round(diffSec / 60);
    unit = "minute";
  }
  try {
    return new Intl.RelativeTimeFormat(locale, { numeric: "auto" }).format(value, unit);
  } catch {
    return String(ms);
  }
}

export function formatNumber(n: number, ctx?: FormatContext, opts?: Intl.NumberFormatOptions) {
  const locale = bcp47(ctx?.locale);
  try {
    return new Intl.NumberFormat(locale, {
      numberingSystem: numberingSystem(ctx),
      maximumFractionDigits: opts?.maximumFractionDigits ?? 3,
      ...opts,
    }).format(n);
  } catch {
    return String(n);
  }
}

export function formatPercent(n: number, ctx?: FormatContext) {
  return formatNumber(n, ctx, { style: "percent", maximumFractionDigits: 1 });
}

export function formatCurrency(amount: number, ctx?: FormatContext, currency?: string) {
  const iso = currency ?? getCountry(ctx?.country)?.currency ?? (parseLocale(ctx?.locale) === "fa" ? "IRR" : "USD");
  try {
    return new Intl.NumberFormat(bcp47(ctx?.locale), {
      style: "currency",
      currency: iso,
      numberingSystem: numberingSystem(ctx),
      maximumFractionDigits: iso === "IRR" || iso === "JPY" ? 0 : 2,
    }).format(amount);
  } catch {
    return `${iso} ${amount}`;
  }
}

function imperialPreferred(ctx?: FormatContext) {
  if (ctx?.measurement === "imperial") return true;
  if (ctx?.measurement === "metric") return false;
  const country = getCountry(ctx?.country);
  if (country) return country.measurement === "imperial";
  return languageMeta(ctx?.locale).measurement === "imperial";
}

export function formatBytes(bytes: number, ctx?: FormatContext) {
  const abs = Math.abs(bytes);
  if (abs < 1024) return `${formatNumber(bytes, ctx, { maximumFractionDigits: 0 })} B`;
  if (abs < 1024 * 1024) return `${formatNumber(bytes / 1024, ctx, { maximumFractionDigits: 1 })} KB`;
  if (abs < 1024 * 1024 * 1024) return `${formatNumber(bytes / (1024 * 1024), ctx, { maximumFractionDigits: 1 })} MB`;
  return `${formatNumber(bytes / (1024 * 1024 * 1024), ctx, { maximumFractionDigits: 1 })} GB`;
}

export function formatDistance(meters: number, ctx?: FormatContext) {
  if (imperialPreferred(ctx)) {
    const miles = meters / 1609.344;
    if (miles < 0.1) return `${formatNumber(meters * 3.28084, ctx, { maximumFractionDigits: 0 })} ft`;
    return `${formatNumber(miles, ctx, { maximumFractionDigits: 1 })} mi`;
  }
  if (meters < 1000) return `${formatNumber(meters, ctx, { maximumFractionDigits: 0 })} m`;
  return `${formatNumber(meters / 1000, ctx, { maximumFractionDigits: 1 })} km`;
}

export function formatPhoneDisplay(iso: string | null | undefined, national: string) {
  return formatPhone(iso, national);
}

export function localeLower(text: string, locale?: string | null) {
  const code = parseLocale(locale);
  return text.toLocaleLowerCase(code === "tr" ? "tr" : languageMeta(code).locale);
}

export function localeUpper(text: string, locale?: string | null) {
  const code = parseLocale(locale);
  return text.toLocaleUpperCase(code === "tr" ? "tr" : languageMeta(code).locale);
}

export function resolveDefaultTz(raw?: string | null): string {
  if (raw && raw !== "system") return raw;
  return "Asia/Tehran";
}

export type { NixoLocale };
