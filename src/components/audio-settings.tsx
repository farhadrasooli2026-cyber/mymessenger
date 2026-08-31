"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { toast } from "sonner";
import { NixoMark } from "@/components/nixo-mark";
import { Button } from "@/components/ui/button";
import { formatBytes } from "@/lib/media";

type Prefs = {
  autoWifi: boolean;
  autoMobile: boolean;
  autoRoaming: boolean;
  quality: string;
  speed: number;
  dataSaver: boolean;
  notifyPlayback: boolean;
  backgroundPlayback?: boolean;
};

export function AudioSettings() {
  const [prefs, setPrefs] = useState<Prefs | null>(null);
  const [stats, setStats] = useState<{ audio: number; music?: number; voice?: number; files?: number; cache: number; count: number } | null>(null);
  const [cleanup, setCleanup] = useState<{ large: { title: string; size: number }[]; cacheBytes: number } | null>(null);

  async function load() {
    const res = await fetch("/api/music", { cache: "no-store" });
    const data = await res.json();
    setPrefs(data.prefs ?? null);
    setStats(data.stats ?? null);
    setCleanup(data.cleanup ?? null);
  }

  useEffect(() => {
    const t = window.setTimeout(() => void load(), 0);
    return () => window.clearTimeout(t);
  }, []);

  async function save(patch: Record<string, unknown>) {
    const res = await fetch("/api/music", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "prefs", ...patch }) });
    if (!res.ok) toast.error("ذخیره نشد.");
    else toast.success("تنظیمات صوت ذخیره شد.");
    await load();
  }

  if (!prefs) return <p className="p-6 text-sm">بارگذاری…</p>;

  return (
    <main className="min-h-dvh bg-[#071614] p-5 text-emerald-50">
      <div className="mx-auto max-w-lg space-y-4">
        <div className="flex items-center gap-2">
          <NixoMark size={36} />
          <div>
            <p className="text-xs text-amber-200">Settings → Data & Storage → Audio</p>
            <h1 className="text-xl font-semibold">صوت و موسیقی</h1>
          </div>
        </div>
        <section className="space-y-2 rounded-2xl bg-white/5 p-4 text-sm">
          <h2 className="font-medium">Auto Download</h2>
          <label className="flex items-center justify-between"><span>Wi-Fi</span><input type="checkbox" checked={prefs.autoWifi} onChange={(e) => void save({ autoWifi: e.target.checked })} /></label>
          <label className="flex items-center justify-between"><span>Mobile Data</span><input type="checkbox" checked={prefs.autoMobile} onChange={(e) => void save({ autoMobile: e.target.checked })} /></label>
          <label className="flex items-center justify-between"><span>Roaming</span><input type="checkbox" checked={prefs.autoRoaming} onChange={(e) => void save({ autoRoaming: e.target.checked })} /></label>
          <label className="flex items-center justify-between"><span>Data Saver</span><input type="checkbox" checked={prefs.dataSaver} onChange={(e) => void save({ dataSaver: e.target.checked })} /></label>
          <label className="flex items-center justify-between"><span>Background Playback</span><input type="checkbox" checked={prefs.backgroundPlayback !== false} onChange={(e) => void save({ backgroundPlayback: e.target.checked })} /></label>
        </section>
        <section className="space-y-2 rounded-2xl bg-white/5 p-4 text-sm">
          <h2 className="font-medium">کیفیت و سرعت پخش</h2>
          {(["standard", "high", "original"] as const).map((q) => (
            <label key={q} className="flex items-center gap-2 text-xs">
              <input type="radio" checked={prefs.quality === q} onChange={() => void save({ quality: q })} />
              {q} {q === "original" ? "(بدون فشرده‌سازی غیرضروری)" : q === "standard" && prefs.dataSaver ? "(Data Saver)" : ""}
            </label>
          ))}
          <p className="mt-2 text-xs">Playback Speed</p>
          {[0.5, 1, 1.5, 2].map((s) => (
            <label key={s} className="flex items-center gap-2 text-xs">
              <input type="radio" checked={prefs.speed === s} onChange={() => void save({ speed: s })} />
              {s}x
            </label>
          ))}
        </section>
        {stats && (
          <section className="rounded-2xl bg-white/5 p-4 text-sm">
            <h2 className="font-medium">Storage</h2>
            <p>Music {formatBytes(stats.music ?? 0)} · Voice {formatBytes(stats.voice ?? 0)} · Files {formatBytes(stats.files ?? 0)} · Cache {formatBytes(stats.cache)}</p>
            <p className="mt-1 text-xs opacity-60">جمع {formatBytes(stats.audio)}. Clear Cache فایل دائمی را پاک نمی‌کند. Backup صوت طبق Backup حساب. همگام پخش روی دستگاه‌های Login‌شده ازPrefs سرور است.</p>
            {cleanup && cleanup.large?.length ? <p className="mt-1 text-xs">پیشنهاد: فایل حجیم {cleanup.large[0]!.title} · {formatBytes(cleanup.large[0]!.size)}</p> : null}
            <Button type="button" size="sm" className="mt-2" variant="secondary" onClick={() => void fetch("/api/music", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "clear-cache" }) }).then(load)}>Clear Cache</Button>
          </section>
        )}
        <section className="rounded-2xl bg-white/5 p-4 text-sm">
          <h2 className="font-medium">اعلان پخش</h2>
          <label className="flex items-center justify-between">
            <span>اعلان پخش طبق Notification Settings</span>
            <input type="checkbox" checked={prefs.notifyPlayback} onChange={(e) => void save({ notifyPlayback: e.target.checked })} />
          </label>
          <Link href="/app/settings/notifications" className="mt-2 block text-xs text-amber-200">Settings → Notifications</Link>
        </section>
        <p className="text-[11px] opacity-45">Voice چت E2EE است. فایل کتابخانه با AES-GCM روی دیسک و مجوز سمت سرور. نیکسو کاتالوگ تجاری بدون مجوز نمی‌دهد. Offline یعنی فایل دانلودشده روی همین دستگاه.</p>
        <Link href="/app/music" className="text-sm text-amber-200">کتابخانه موسیقی</Link>
      </div>
    </main>
  );
}
