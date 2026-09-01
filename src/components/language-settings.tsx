"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { toast } from "sonner";
import { NixoMark } from "@/components/nixo-mark";
import { Button } from "@/components/ui/button";
import { NIXO_LOCALES, TIMEZONES, type UserPrefs } from "@/lib/prefs-types";
import { LANGUAGE_CATALOG } from "@/lib/i18n/languages";
import { COUNTRIES } from "@/lib/i18n/countries";
import { useI18n } from "@/components/i18n-provider";

export function LanguageSettings() {
  const { t, setLocale, locale } = useI18n();
  const [prefs, setPrefs] = useState<UserPrefs | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    fetch("/api/account", { cache: "no-store" })
      .then((r) => r.json())
      .then((d) => {
        if (d.account?.prefs) setPrefs(d.account.prefs);
      })
      .catch(() => undefined);
  }, []);

  async function save(patch: Record<string, unknown>) {
    setBusy(true);
    try {
      const next = { ...prefs, ...patch } as UserPrefs;
      const res = await fetch("/api/account", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "prefs", ...patch }),
      });
      const data = await res.json();
      if (!res.ok) {
        toast.error(data.error ?? t("lang.failed"));
        return;
      }
      setPrefs(data.prefs);
      await setLocale(String(patch.locale ?? next.locale ?? locale), {
        timezone: String(patch.timezone ?? next.timezone ?? ""),
        scope: (patch.languageScope as "account" | "device") ?? next.languageScope ?? "account",
      });
      toast.success(t("lang.saved"));
    } finally {
      setBusy(false);
    }
  }

  if (!prefs) {
    return <p className="p-8 text-sm text-emerald-100/70">{t("lang.loading")}</p>;
  }

  return (
    <div className="min-h-dvh bg-[#071614] px-4 py-8 text-emerald-50">
      <div className="mx-auto max-w-lg space-y-6">
        <header className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <NixoMark size={36} />
            <div>
              <p className="text-xs text-emerald-100/60">{t("lang.crumb")}</p>
              <h1 className="text-lg font-semibold">{t("lang.title")}</h1>
            </div>
          </div>
          <Link href="/app" className="text-sm text-amber-200">
            {t("lang.back")}
          </Link>
        </header>
        <section className="space-y-3 rounded-2xl bg-white/5 p-4 text-sm">
          <p className="text-[11px] opacity-70">{t("lang.hint")}</p>
          <label className="block">
            {t("lang.language")}
            <select
              className="mt-1 h-10 w-full rounded-lg bg-black/30 px-2"
              value={prefs.locale}
              onChange={(e) => void save({ locale: e.target.value })}
            >
              {NIXO_LOCALES.map((l) => {
                const meta = LANGUAGE_CATALOG.find((m) => m.code === l);
                return (
                  <option key={l} value={l}>
                    {meta?.nativeName ?? l}
                  </option>
                );
              })}
            </select>
          </label>
          <label className="block">
            {t("lang.timezone")}
            <select
              className="mt-1 h-10 w-full rounded-lg bg-black/30 px-2"
              value={prefs.timezone}
              onChange={(e) => void save({ timezone: e.target.value })}
            >
              {TIMEZONES.map((tz) => (
                <option key={tz} value={tz}>
                  {tz}
                </option>
              ))}
            </select>
          </label>
          <label className="block">
            {t("lang.date_format")}
            <select
              className="mt-1 h-10 w-full rounded-lg bg-black/30 px-2"
              value={prefs.dateFormat}
              onChange={(e) => void save({ dateFormat: e.target.value })}
            >
              <option value="jalali">{t("lang.jalali")}</option>
              <option value="gregorian">{t("lang.gregorian")}</option>
              <option value="system">{t("lang.system")}</option>
            </select>
          </label>
          <label className="block">
            {t("lang.time_format")}
            <select
              className="mt-1 h-10 w-full rounded-lg bg-black/30 px-2"
              value={prefs.timeFormat}
              onChange={(e) => void save({ timeFormat: e.target.value })}
            >
              <option value="24">{t("lang.24h")}</option>
              <option value="12">{t("lang.12h")}</option>
              <option value="system">{t("lang.system")}</option>
            </select>
          </label>
          <label className="block">
            {t("lang.numbering")}
            <select
              className="mt-1 h-10 w-full rounded-lg bg-black/30 px-2"
              value={prefs.numbering ?? "arabext"}
              onChange={(e) => void save({ numbering: e.target.value })}
            >
              <option value="arabext">arabext</option>
              <option value="arab">arab</option>
              <option value="latn">latn</option>
              <option value="system">{t("lang.system")}</option>
            </select>
          </label>
          <label className="block">
            {t("lang.measurement")}
            <select
              className="mt-1 h-10 w-full rounded-lg bg-black/30 px-2"
              value={prefs.measurement ?? "metric"}
              onChange={(e) => void save({ measurement: e.target.value })}
            >
              <option value="metric">{t("lang.metric")}</option>
              <option value="imperial">{t("lang.imperial")}</option>
              <option value="system">{t("lang.system")}</option>
            </select>
          </label>
          <label className="block">
            {t("lang.country")}
            <select
              className="mt-1 h-10 w-full rounded-lg bg-black/30 px-2"
              value={prefs.country ?? "IR"}
              onChange={(e) => void save({ country: e.target.value })}
            >
              {COUNTRIES.map((c) => (
                <option key={c.iso} value={c.iso}>
                  {c.nativeName}
                </option>
              ))}
            </select>
          </label>
          <label className="block">
            {t("lang.scope")}
            <select
              className="mt-1 h-10 w-full rounded-lg bg-black/30 px-2"
              value={prefs.languageScope ?? "account"}
              onChange={(e) => void save({ languageScope: e.target.value })}
            >
              <option value="account">{t("lang.scope_account")}</option>
              <option value="device">{t("lang.scope_device")}</option>
            </select>
          </label>
          <Button type="button" variant="secondary" disabled={busy} onClick={() => void save({ locale: prefs.locale })}>
            {t("lang.save")}
          </Button>
        </section>
      </div>
    </div>
  );
}
