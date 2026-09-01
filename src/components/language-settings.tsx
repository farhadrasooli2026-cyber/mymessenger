"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { toast } from "sonner";
import { NixoMark } from "@/components/nixo-mark";
import { Button } from "@/components/ui/button";
import { NIXO_LOCALES, TIMEZONES, type UserPrefs } from "@/lib/prefs-types";

const LOCALE_FA: Record<string, string> = { fa: "فارسی", en: "English", tr: "Türkçe" };

export function LanguageSettings() {
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
      const res = await fetch("/api/account", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "prefs", ...patch }),
      });
      const data = await res.json();
      if (!res.ok) {
        toast.error(data.error ?? "ذخیره نشد.");
        return;
      }
      setPrefs(data.prefs);
      toast.success("تنظیمات زبان ذخیره شد.");
    } finally {
      setBusy(false);
    }
  }

  if (!prefs) {
    return <p className="p-8 text-sm text-emerald-100/70">در حال بارگذاری…</p>;
  }

  return (
    <div className="min-h-dvh bg-[#071614] px-4 py-8 text-emerald-50">
      <div className="mx-auto max-w-lg space-y-6">
        <header className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <NixoMark size={36} />
            <div>
              <p className="text-xs text-emerald-100/60">تنظیمات → زبان و منطقه</p>
              <h1 className="text-lg font-semibold">زبان، زمان و تاریخ</h1>
            </div>
          </div>
          <Link href="/app" className="text-sm text-amber-200">
            بازگشت
          </Link>
        </header>
        <section className="space-y-3 rounded-2xl bg-white/5 p-4 text-sm">
          <p className="text-[11px] opacity-70">Locale روی قالب تاریخ/ساعت حساب اثر می‌گذارد. ظاهر (تم) جدا در Appearance است.</p>
          <label className="block">
            زبان
            <select
              className="mt-1 h-10 w-full rounded-lg bg-black/30 px-2"
              value={prefs.locale}
              onChange={(e) => void save({ locale: e.target.value })}
            >
              {NIXO_LOCALES.map((l) => (
                <option key={l} value={l}>
                  {LOCALE_FA[l] ?? l}
                </option>
              ))}
            </select>
          </label>
          <label className="block">
            منطقهٔ زمانی
            <select
              className="mt-1 h-10 w-full rounded-lg bg-black/30 px-2"
              value={prefs.timezone}
              onChange={(e) => void save({ timezone: e.target.value })}
            >
              {TIMEZONES.map((t) => (
                <option key={t} value={t}>
                  {t}
                </option>
              ))}
            </select>
          </label>
          <label className="block">
            قالب تاریخ
            <select
              className="mt-1 h-10 w-full rounded-lg bg-black/30 px-2"
              value={prefs.dateFormat}
              onChange={(e) => void save({ dateFormat: e.target.value })}
            >
              <option value="jalali">جلالی</option>
              <option value="gregorian">میلادی</option>
              <option value="system">سیستم</option>
            </select>
          </label>
          <label className="block">
            قالب ساعت
            <select
              className="mt-1 h-10 w-full rounded-lg bg-black/30 px-2"
              value={prefs.timeFormat}
              onChange={(e) => void save({ timeFormat: e.target.value })}
            >
              <option value="24">۲۴ ساعته</option>
              <option value="12">۱۲ ساعته</option>
              <option value="system">سیستم</option>
            </select>
          </label>
          <Button type="button" variant="secondary" disabled={busy} onClick={() => void save({ locale: prefs.locale })}>
            ذخیره
          </Button>
        </section>
      </div>
    </div>
  );
}
