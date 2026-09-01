"use client";

import { useEffect, useId, useState } from "react";
import Link from "next/link";
import { toast } from "sonner";
import { NixoMark } from "@/components/nixo-mark";
import { Button } from "@/components/ui/button";
import { useA11y } from "@/components/a11y-provider";
import { FONT_SCALES, LIVE_ANNOUNCE, hydrateA11yPrefs, type A11yPrefs } from "@/lib/a11y/types";
import type { UserPrefs } from "@/lib/prefs-types";

export function AccessibilitySettings() {
  const { prefs: live, patch } = useA11y();
  const [prefs, setPrefs] = useState<UserPrefs | null>(null);
  const [busy, setBusy] = useState(false);
  const headingId = useId();

  useEffect(() => {
    fetch("/api/account", { cache: "no-store" })
      .then((r) => r.json())
      .then((d) => {
        if (d.account?.prefs) setPrefs(d.account.prefs);
      })
      .catch(() => undefined);
  }, []);

  async function save(next: Partial<A11yPrefs> & Record<string, unknown>) {
    setBusy(true);
    try {
      const res = await fetch("/api/account", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "prefs", ...next }),
      });
      const data = await res.json();
      if (!res.ok) {
        toast.error(data.error ?? "ذخیره نشد.", { icon: "!" });
        return;
      }
      setPrefs(data.prefs);
      patch(hydrateA11yPrefs({ ...live, ...next, followSystem: next.followSystemA11y ?? live.followSystem }));
      toast.success("تنظیمات دسترسی ذخیره شد.");
    } finally {
      setBusy(false);
    }
  }

  if (!prefs) {
    return (
      <p className="p-8 text-sm" role="status">
        در حال بارگذاری تنظیمات دسترسی…
      </p>
    );
  }

  const a11y = hydrateA11yPrefs({ ...live, ...prefs, followSystem: prefs.followSystemA11y });

  const toggles: { key: keyof A11yPrefs; accountKey: string; label: string; hint: string }[] = [
    { key: "followSystem", accountKey: "followSystemA11y", label: "پیروی از تنظیمات سیستم‌عامل", hint: "حرکت کمتر، کنتراست و شفافیت سیستم در صورت پشتیبانی" },
    { key: "reducedMotion", accountKey: "reducedMotion", label: "کاهش حرکت", hint: "انیمیشن و اسکرول نرم خاموش می‌شود" },
    { key: "highContrast", accountKey: "highContrast", label: "کنتراست بالا", hint: "متن و پس‌زمینه با تضاد بیشتر" },
    { key: "reduceTransparency", accountKey: "reduceTransparency", label: "کاهش شفافیت", hint: "شیشه و بلور پس‌زمینه کم می‌شود" },
    { key: "underlineLinks", accountKey: "underlineLinks", label: "زیرخط لینک‌ها", hint: "لینک فقط با رنگ مشخص نمی‌شود" },
    { key: "largeTargets", accountKey: "largeTargets", label: "اهداف لمسی بزرگ", hint: "حداقل ۴۴ پیکسل برای دکمه‌ها" },
    { key: "screenReaderHints", accountKey: "screenReaderHints", label: "راهنمای Screen Reader", hint: "اعلان وضعیت پیام و تماس" },
    { key: "keyboardShortcuts", accountKey: "keyboardShortcuts", label: "میانبر صفحه‌کلید", hint: "Alt+Shift+/ فهرست میانبرها" },
    { key: "timeoutWarnings", accountKey: "timeoutWarnings", label: "هشدار پایان نشست", hint: "قبل از قفل یا انقضای بی‌فعال بودن" },
  ];

  return (
    <main className="min-h-dvh bg-[#071614] px-4 py-8 text-emerald-50" id="nixo-main">
      <div className="mx-auto max-w-lg space-y-6">
        <header className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <NixoMark size={36} />
            <h1 id={headingId} className="text-lg font-semibold">
              دسترسی‌پذیری
            </h1>
          </div>
          <Link href="/app" className="text-sm text-amber-200 underline-offset-4 hover:underline">
            بازگشت
          </Link>
        </header>
        <p className="text-sm text-emerald-100/75">
          این تنظیمات با حساب همگام می‌شوند و Authentication را دور نمی‌زنند. هیچ اطلاعات مهمی فقط با رنگ نمایش داده نمی‌شود.
        </p>
        <form
          className="space-y-4 rounded-2xl bg-white/5 p-4 text-sm"
          onSubmit={(e) => {
            e.preventDefault();
          }}
          aria-labelledby={headingId}
        >
          {toggles.map((row) => (
            <label key={row.accountKey} className="flex min-h-11 items-start justify-between gap-3">
              <span>
                <span className="block font-medium">{row.label}</span>
                <span className="block text-xs text-emerald-100/60">{row.hint}</span>
              </span>
              <input
                type="checkbox"
                className="mt-1 size-5"
                checked={Boolean(a11y[row.key])}
                disabled={busy}
                onChange={(e) => void save({ [row.accountKey]: e.target.checked })}
              />
            </label>
          ))}
          <fieldset className="space-y-2">
            <legend className="font-medium">اندازه متن</legend>
            <p className="text-xs text-emerald-100/60">بزرگ‌نمایی مرورگر هم پشتیبانی می‌شود؛ محتوا حذف نمی‌شود.</p>
            <div className="flex flex-wrap gap-2">
              {FONT_SCALES.map((n) => (
                <button
                  key={n}
                  type="button"
                  aria-pressed={a11y.fontScale === n}
                  className={`min-h-11 rounded-lg px-3 ${a11y.fontScale === n ? "bg-amber-300 text-[#102824]" : "bg-black/30"}`}
                  onClick={() => void save({ fontScale: n })}
                >
                  {n}%
                </button>
              ))}
            </div>
          </fieldset>
          <fieldset className="space-y-2">
            <legend className="font-medium">اعلان Screen Reader</legend>
            <select
              className="h-11 w-full rounded-lg bg-black/30 px-2"
              aria-label="سطح اعلان زنده"
              value={a11y.liveAnnounce}
              onChange={(e) => void save({ liveAnnounce: e.target.value as A11yPrefs["liveAnnounce"] })}
            >
              {LIVE_ANNOUNCE.map((v) => (
                <option key={v} value={v}>
                  {v === "off" ? "خاموش" : v === "all" ? "همه (فوری و مؤدبانه)" : "مؤدبانه"}
                </option>
              ))}
            </select>
          </fieldset>
          <p className="text-xs text-emerald-100/55">
            کمک: میانبرها را با Alt+Shift+/ ببینید. پخش خودکار ویدیو در تنظیمات ظاهر جداست و پیش‌فرض خاموش است.
          </p>
          <Button type="button" variant="secondary" disabled={busy} onClick={() => void save({ reducedMotion: a11y.reducedMotion })}>
            ذخیره دوباره
          </Button>
        </form>
      </div>
    </main>
  );
}
