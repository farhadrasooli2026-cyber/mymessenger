"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { DEFAULT_LOCALE, localeDir, parseLocale, t as translate, type NixoLocale } from "@/lib/i18n";
import { DEFAULT_TZ } from "@/lib/i18n/cookies";
import type { TOptions } from "@/lib/i18n/t";

type I18nCtx = {
  locale: NixoLocale;
  dir: "rtl" | "ltr";
  timezone: string;
  t: (key: string, opts?: Omit<TOptions, "locale">) => string;
  setLocale: (locale: string, extra?: { timezone?: string; scope?: "account" | "device" }) => Promise<void>;
};

const Ctx = createContext<I18nCtx>({
  locale: DEFAULT_LOCALE,
  dir: "rtl",
  timezone: DEFAULT_TZ,
  t: (key, opts) => translate(key, { ...opts, locale: DEFAULT_LOCALE }),
  setLocale: async () => undefined,
});

export function I18nProvider({
  children,
  initialLocale,
  initialTz,
}: {
  children: ReactNode;
  initialLocale?: string;
  initialDir?: "rtl" | "ltr";
  initialTz?: string;
}) {
  const [locale, setLoc] = useState<NixoLocale>(parseLocale(initialLocale));
  const [timezone, setTz] = useState(initialTz || DEFAULT_TZ);

  useEffect(() => {
    let cancelled = false;
    fetch("/api/i18n", { cache: "no-store" })
      .then((r) => r.json())
      .then((d) => {
        if (cancelled || !d?.ok) return;
        if (!d.source || d.source === "default") {
          const nav = typeof navigator !== "undefined" ? navigator.language : "";
          const tz = typeof Intl !== "undefined" ? Intl.DateTimeFormat().resolvedOptions().timeZone : DEFAULT_TZ;
          return fetch("/api/i18n", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ action: "detect", locale: nav, timezone: tz, scope: "device" }),
          })
            .then((r) => r.json())
            .then((n) => {
              if (cancelled || !n?.ok) {
                setLoc(parseLocale(d.locale));
                setTz(typeof d.timezone === "string" ? d.timezone : DEFAULT_TZ);
                return;
              }
              setLoc(parseLocale(n.locale));
              setTz(typeof n.timezone === "string" ? n.timezone : DEFAULT_TZ);
            });
        }
        setLoc(parseLocale(d.locale));
        setTz(typeof d.timezone === "string" ? d.timezone : DEFAULT_TZ);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, []);

  const setLocale = useCallback(async (next: string, extra?: { timezone?: string; scope?: "account" | "device" }) => {
    const res = await fetch("/api/i18n", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "set", locale: next, timezone: extra?.timezone ?? timezone, scope: extra?.scope ?? "device" }),
    });
    const data = await res.json().catch(() => null);
    if (data?.ok) {
      setLoc(parseLocale(data.locale));
      if (typeof data.timezone === "string") setTz(data.timezone);
      if (typeof document !== "undefined") {
        document.documentElement.lang = data.locale;
        document.documentElement.dir = data.dir;
      }
    }
  }, [timezone]);

  const value = useMemo<I18nCtx>(
    () => ({
      locale,
      dir: localeDir(locale),
      timezone,
      t: (key, opts) => translate(key, { ...opts, locale }),
      setLocale,
    }),
    [locale, timezone, setLocale],
  );

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useI18n() {
  return useContext(Ctx);
}

export function I18nHtmlSync() {
  const { locale, dir } = useI18n();
  useEffect(() => {
    document.documentElement.lang = locale;
    document.documentElement.dir = dir;
  }, [locale, dir]);
  return null;
}
