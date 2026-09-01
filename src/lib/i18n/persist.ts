import { DEFAULT_ENABLED_LOCALES, type NixoLocale } from "./languages";
import type { TranslateProviderId } from "./provider";

export type I18nMissingRow = { key: string; locale: string; at: number };
export type I18nAuditRow = { id: string; actorUserId: string; action: string; at: number; detail: string };

export type I18nPersist = {
  enabledLocales: NixoLocale[];
  overlays: Partial<Record<NixoLocale, Record<string, string>>>;
  missing: I18nMissingRow[];
  audit: I18nAuditRow[];
  provider: TranslateProviderId;
};

export function emptyI18nPersist(): I18nPersist {
  return {
    enabledLocales: [...DEFAULT_ENABLED_LOCALES],
    overlays: {},
    missing: [],
    audit: [],
    provider: "none",
  };
}

export function hydrateI18nPersist(raw: unknown): I18nPersist {
  const base = emptyI18nPersist();
  if (!raw || typeof raw !== "object") return base;
  const rec = raw as Record<string, unknown>;
  const enabled = Array.isArray(rec.enabledLocales)
    ? rec.enabledLocales.filter((c): c is NixoLocale => typeof c === "string" && ["fa", "en", "tr", "ar", "ru"].includes(c))
    : base.enabledLocales;
  const overlays: I18nPersist["overlays"] = {};
  if (rec.overlays && typeof rec.overlays === "object") {
    for (const [k, v] of Object.entries(rec.overlays as Record<string, unknown>)) {
      if (!["fa", "en", "tr", "ar", "ru"].includes(k) || !v || typeof v !== "object") continue;
      const map: Record<string, string> = {};
      for (const [key, val] of Object.entries(v as Record<string, unknown>)) {
        if (typeof val === "string" && val.length <= 2000 && !/(password|secret|token|nixo_reg)/i.test(key + val)) {
          map[key.slice(0, 120)] = val;
        }
      }
      overlays[k as NixoLocale] = map;
    }
  }
  return {
    enabledLocales: enabled.length ? enabled : base.enabledLocales,
    overlays,
    missing: Array.isArray(rec.missing)
      ? rec.missing
          .filter((m): m is I18nMissingRow => !!m && typeof m === "object" && typeof (m as I18nMissingRow).key === "string")
          .slice(-400)
      : [],
    audit: Array.isArray(rec.audit)
      ? rec.audit
          .filter((a): a is I18nAuditRow => !!a && typeof a === "object" && typeof (a as I18nAuditRow).action === "string")
          .slice(-200)
      : [],
    provider: rec.provider === "mock" ? "mock" : "none",
  };
}
