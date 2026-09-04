"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { toast } from "sonner";
import { NixoMark } from "@/components/nixo-mark";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { defaultNixoFeaturePrefs, INACTIVITY_MONTHS, mergeNixoPrefs, PUBLIC_WALLPAPERS, type NixoFeaturePrefs } from "@/lib/nixo-features";
import { searchIso6391 } from "@/lib/nixo-iso639";

export function NixoFeaturesDesk() {
  const [prefs, setPrefs] = useState<NixoFeaturePrefs>(defaultNixoFeaturePrefs());
  const [q, setQ] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    fetch("/api/account", { cache: "no-store" })
      .then((r) => r.json())
      .then((d) => {
        if (d.account?.prefs) setPrefs(mergeNixoPrefs(d.account.prefs));
      })
      .catch(() => undefined);
  }, []);

  const langs = useMemo(() => searchIso6391(q).slice(0, 40), [q]);

  async function save(patch: Partial<NixoFeaturePrefs>) {
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
      setPrefs(mergeNixoPrefs(data.prefs));
      toast.success("ذخیره شد.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="min-h-dvh bg-[#071614] px-4 py-8 text-emerald-50">
      <div className="mx-auto max-w-lg space-y-5">
        <header className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <NixoMark size={36} />
            <div>
              <p className="text-xs text-emerald-100/55">تنظیمات نیکسو</p>
              <h1 className="text-lg font-semibold">قابلیت‌های اختصاصی</h1>
            </div>
          </div>
          <Link href="/app" className="text-sm text-amber-200">
            بازگشت
          </Link>
        </header>

        <section className="nixo-glass-panel space-y-3 rounded-2xl p-4 text-sm">
          <h2 className="font-medium">شیشه و پس‌زمینه</h2>
          <label className="flex items-center justify-between gap-2">
            <span>Glassmorphism</span>
            <input type="checkbox" checked={prefs.glassEnabled} disabled={busy} onChange={(e) => void save({ glassEnabled: e.target.checked })} />
          </label>
          <label className="block text-xs">
            شفافیت {prefs.glassOpacity}%
            <input type="range" min={20} max={95} value={prefs.glassOpacity} className="mt-1 w-full" onChange={(e) => void save({ glassOpacity: Number(e.target.value) })} />
          </label>
          <label className="block text-xs">
            تاری {prefs.glassBlur}px
            <input type="range" min={0} max={40} value={prefs.glassBlur} className="mt-1 w-full" onChange={(e) => void save({ glassBlur: Number(e.target.value) })} />
          </label>
          <p className="text-xs text-emerald-100/55">پس‌زمینه گفتگو از پوشه public</p>
          <div className="grid grid-cols-2 gap-2">
            <button type="button" className={`rounded-xl border p-2 text-xs ${!prefs.chatWallpaperPublic ? "border-amber-300" : "border-white/10"}`} onClick={() => void save({ chatWallpaperPublic: "" })}>
              بدون تصویر public
            </button>
            {PUBLIC_WALLPAPERS.map((w) => (
              <button
                key={w.id}
                type="button"
                className={`overflow-hidden rounded-xl border ${prefs.chatWallpaperPublic === w.path ? "border-amber-300" : "border-white/10"}`}
                onClick={() => void save({ chatWallpaperPublic: w.path })}
              >
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={w.path} alt="" className="h-16 w-full object-cover" />
                <span className="block py-1 text-[11px]">{w.fa}</span>
              </button>
            ))}
          </div>
          <div
            className="nixo-glass-panel space-y-2 rounded-xl p-3"
            style={
              prefs.chatWallpaperPublic
                ? { backgroundImage: `url(${prefs.chatWallpaperPublic})`, backgroundSize: "cover" }
                : undefined
            }
          >
            <p className="text-[11px] opacity-70">پیش‌نمایش زنده</p>
            <p className="max-w-[80%] rounded-2xl bg-amber-300 px-3 py-1.5 text-xs text-[#102824]">سلام از نیکسو</p>
            <p className="ms-auto max-w-[80%] rounded-2xl bg-black/35 px-3 py-1.5 text-xs">شیشه، فونت و پس‌زمینه همین‌جا دیده می‌شود.</p>
          </div>
        </section>

        <section className="space-y-3 rounded-2xl bg-white/5 p-4 text-sm">
          <h2 className="font-medium">ترجمه پیام‌ها</h2>
          <label className="block text-xs">
            زبان مقصد دکمه ترجمه
            <select
              className="mt-1 h-9 w-full rounded-lg bg-black/30 px-2"
              value={prefs.translateTarget}
              onChange={(e) => void save({ translateTarget: e.target.value })}
            >
              <option value="fa">فارسی</option>
              <option value="en">English</option>
              <option value="tr">Türkçe</option>
            </select>
          </label>
          <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="جستجوی زبان (ISO 639-1)" className="h-9 bg-black/20" />
          <p className="text-[11px] text-emerald-100/50">زبان‌هایی که دکمه ترجمه برایشان نشان داده نشود:</p>
          <div className="max-h-40 space-y-1 overflow-auto text-xs">
            {langs.map((l) => {
              const on = prefs.translateSkip.includes(l.code);
              return (
                <button
                  key={l.code}
                  type="button"
                  className="flex w-full items-center justify-between rounded-lg px-2 py-1.5 hover:bg-white/5"
                  onClick={() => {
                    const next = on ? prefs.translateSkip.filter((c) => c !== l.code) : [...prefs.translateSkip, l.code];
                    void save({ translateSkip: next });
                  }}
                >
                  <span>
                    {l.native} · {l.name} · {l.code}
                  </span>
                  <span className={on ? "text-amber-200" : "text-emerald-100/35"}>{on ? "استثنا" : "فعال"}</span>
                </button>
              );
            })}
          </div>
        </section>

        <section className="space-y-3 rounded-2xl bg-white/5 p-4 text-sm">
          <h2 className="font-medium">پیام و گفتگو</h2>
          <label className="flex items-center justify-between gap-2">
            <span>حالت روح (بدون Typing و تیک دوم)</span>
            <input type="checkbox" checked={prefs.ghostMode} onChange={(e) => void save({ ghostMode: e.target.checked })} />
          </label>
          <label className="flex items-center justify-between gap-2">
            <span>ارسال بی‌صدا به‌صورت پیش‌فرض</span>
            <input type="checkbox" checked={prefs.silentDefault} onChange={(e) => void save({ silentDefault: e.target.checked })} />
          </label>
          <label className="flex items-center justify-between gap-2">
            <span>هدایت بدون نام فرستنده</span>
            <input type="checkbox" checked={prefs.hideForwardOriginDefault} onChange={(e) => void save({ hideForwardOriginDefault: e.target.checked })} />
          </label>
        </section>

        <section className="space-y-3 rounded-2xl bg-white/5 p-4 text-sm">
          <h2 className="font-medium">ذخیره انرژی</h2>
          <label className="flex items-center justify-between gap-2">
            <span>فعال</span>
            <input type="checkbox" checked={prefs.powerSaveEnabled} onChange={(e) => void save({ powerSaveEnabled: e.target.checked })} />
          </label>
          <label className="block text-xs">
            آستانه باتری {prefs.powerSaveBatteryPct}%
            <input type="range" min={5} max={40} value={prefs.powerSaveBatteryPct} className="mt-1 w-full" onChange={(e) => void save({ powerSaveBatteryPct: Number(e.target.value) })} />
          </label>
          {(
            [
              ["powerAutoplayVideo", "پخش خودکار ویدیو"],
              ["powerAutoplayGif", "پخش خودکار GIF"],
              ["powerStickerAnim", "انیمیشن استیکر"],
              ["powerUiAnim", "انیمیشن رابط"],
              ["powerPreload", "پیش‌بارگذاری رسانه"],
            ] as const
          ).map(([k, label]) => (
            <label key={k} className="flex items-center justify-between gap-2 text-xs">
              <span>{label}</span>
              <input type="checkbox" checked={Boolean(prefs[k])} onChange={(e) => void save({ [k]: e.target.checked })} />
            </label>
          ))}
        </section>

        <section className="space-y-3 rounded-2xl bg-white/5 p-4 text-sm">
          <h2 className="font-medium">ذخیره در گالری گوشی</h2>
          {(
            [
              ["autoSavePrivatePhotos", "عکس چت خصوصی"],
              ["autoSavePrivateVideos", "ویدیو چت خصوصی"],
              ["autoSaveGroupPhotos", "عکس گروه"],
              ["autoSaveGroupVideos", "ویدیو گروه"],
              ["autoSaveChannelPhotos", "عکس کانال"],
              ["autoSaveChannelVideos", "ویدیو کانال"],
            ] as const
          ).map(([k, label]) => (
            <label key={k} className="flex items-center justify-between gap-2 text-xs">
              <span>{label}</span>
              <input type="checkbox" checked={Boolean(prefs[k])} onChange={(e) => void save({ [k]: e.target.checked })} />
            </label>
          ))}
          <Link href="/app/settings/data" className="block text-amber-200">
            میزان مصرف حافظه
          </Link>
        </section>

        <section className="space-y-3 rounded-2xl border border-rose-300/20 bg-rose-500/5 p-4 text-sm">
          <h2 className="font-medium">پاک‌سازی حساب در صورت دوری</h2>
          <p className="text-[12px] leading-6 text-emerald-100/65">
            کاملاً اختیاری است و فقط روی همین حساب اعمال می‌شود. تا وقتی وارد شوی و فعال باشی هیچ پاک‌سازی انجام نمی‌شود. شرط، عدم ورود و عدم فعالیت متوالی برای بازهٔ انتخابی خودت است.
          </p>
          <label className="flex items-center justify-between gap-2">
            <span>فعال کردن برای این حساب</span>
            <input type="checkbox" checked={prefs.inactivityDeleteEnabled} onChange={(e) => void save({ inactivityDeleteEnabled: e.target.checked })} />
          </label>
          <select
            className="h-9 w-full rounded-lg bg-black/30 px-2 text-xs"
            value={prefs.inactivityDeleteMonths}
            onChange={(e) => void save({ inactivityDeleteMonths: Number(e.target.value) as (typeof INACTIVITY_MONTHS)[number] })}
          >
            {INACTIVITY_MONTHS.map((m) => (
              <option key={m} value={m}>
                اگر {m} ماه وارد نشوم
              </option>
            ))}
          </select>
        </section>

        <Button type="button" variant="secondary" className="w-full" disabled={busy} onClick={() => void save({})}>
          همگام با سرور
        </Button>
      </div>
    </div>
  );
}
