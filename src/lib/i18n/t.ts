import { DEFAULT_LOCALE, FALLBACK_LOCALE, TRANSLATION_VERSION, languageMeta, parseLocale, type NixoLocale } from "./languages";
import { fa } from "./messages/fa";
import { en } from "./messages/en";
import { tr } from "./messages/tr";
import { ar } from "./messages/ar";
import { ru } from "./messages/ru";
import type { MessageCatalog } from "./messages/fa";

export { TRANSLATION_VERSION };

const PACKS: Record<NixoLocale, MessageCatalog> = { fa, en, tr, ar, ru };

export type OverlayMap = Partial<Record<NixoLocale, Record<string, string>>>;

let overlays: OverlayMap = {};

export function setTranslationOverlays(next: OverlayMap) {
  overlays = next ?? {};
}

export function getPack(locale: string | null | undefined): MessageCatalog {
  const code = parseLocale(locale);
  return PACKS[code] ?? PACKS[FALLBACK_LOCALE];
}

export type MissingHit = { key: string; locale: string; at: number };

const missingHits: MissingHit[] = [];
const missingSeen = new Set<string>();

export function peekMissingKeys(): MissingHit[] {
  return [...missingHits];
}

export function drainMissingKeys(): MissingHit[] {
  const out = [...missingHits];
  missingHits.length = 0;
  missingSeen.clear();
  return out;
}

function trackMissing(key: string, locale: string) {
  const id = `${locale}:${key}`;
  if (missingSeen.has(id)) return;
  missingSeen.add(id);
  missingHits.push({ key, locale, at: Date.now() });
  if (missingHits.length > 400) missingHits.shift();
}

function interpolate(template: string, vars?: Record<string, string | number>) {
  if (!vars) return template;
  return template.replace(/\{([a-zA-Z0-9_]+)\}/g, (_, name: string) => {
    const v = vars[name];
    return v === undefined || v === null ? `{${name}}` : String(v);
  });
}

function pluralCategory(locale: NixoLocale, count: number): string {
  try {
    return new Intl.PluralRules(languageMeta(locale).locale).select(count);
  } catch {
    return count === 1 ? "one" : "other";
  }
}

export type TOptions = {
  locale?: string | null;
  count?: number;
  gender?: "male" | "female" | "other";
  context?: string;
  vars?: Record<string, string | number>;
};

function lookup(pack: MessageCatalog, key: string): string | undefined {
  const v = pack[key];
  return typeof v === "string" ? v : undefined;
}

function resolveKey(locale: NixoLocale, key: string, opts?: TOptions): string | undefined {
  const overlay = overlays[locale];
  const pack = getPack(locale);
  const candidates: string[] = [];
  if (opts?.gender && opts.context) candidates.push(`${key}_${opts.gender}_${opts.context}`);
  if (opts?.gender) candidates.push(`${key}_${opts.gender}`);
  if (opts?.context) candidates.push(`${key}_${opts.context}`);
  if (typeof opts?.count === "number") {
    const cat = pluralCategory(locale, opts.count);
    candidates.push(`${key}_${cat}`, `${key}_other`);
  }
  candidates.push(key);
  for (const c of candidates) {
    const fromOverlay = overlay?.[c];
    if (typeof fromOverlay === "string") return fromOverlay;
    const hit = lookup(pack, c);
    if (hit !== undefined) return hit;
  }
  return undefined;
}

/** UI strings only. Never pass UGC as the key. */
export function t(key: string, opts?: TOptions): string {
  const locale = parseLocale(opts?.locale);
  const vars = { ...(opts?.vars ?? {}), ...(typeof opts?.count === "number" ? { count: opts.count } : {}) };
  const hit = resolveKey(locale, key, opts);
  if (hit !== undefined) return interpolate(hit, vars);
  trackMissing(key, locale);
  if (locale !== FALLBACK_LOCALE) {
    const fb = resolveKey(FALLBACK_LOCALE, key, opts);
    if (fb !== undefined) return interpolate(fb, vars);
  }
  return key;
}

export function hasMessage(key: string, locale?: string | null) {
  const code = parseLocale(locale ?? DEFAULT_LOCALE);
  return Boolean(resolveKey(code, key) || resolveKey(FALLBACK_LOCALE, key));
}

export function catalogSnapshot(locale?: string | null) {
  return { ...getPack(locale), ...(overlays[parseLocale(locale)] ?? {}) };
}
