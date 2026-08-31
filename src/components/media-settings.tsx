"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { toast } from "sonner";
import { NixoMark } from "@/components/nixo-mark";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { formatBytes } from "@/lib/media";

type Prefs = {
  autoWifi: boolean;
  autoMobile: boolean;
  autoRoaming: boolean;
  autoSave: boolean;
  uploadQuality: string;
  downloadQuality: string;
  lockEnabled: boolean;
};

export function MediaSettings() {
  const [prefs, setPrefs] = useState<Prefs | null>(null);
  const [stats, setStats] = useState<{ photos: number; videos: number; files: number; cache: number; total: number } | null>(null);
  const [pin, setPin] = useState("");

  async function load() {
    const res = await fetch("/api/gallery", { cache: "no-store" });
    const data = await res.json();
    setPrefs(data.prefs ?? null);
    setStats(data.stats ?? null);
  }

  useEffect(() => {
    const t = window.setTimeout(() => void load(), 0);
    return () => window.clearTimeout(t);
  }, []);

  async function save(patch: Record<string, unknown>) {
    const res = await fetch("/api/gallery", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "prefs", ...patch }) });
    if (!res.ok) toast.error("ذخیره نشد.");
    else toast.success("تنظیمات رسانه ذخیره شد.");
    await load();
  }

  if (!prefs) return <p className="p-6 text-sm">بارگذاری…</p>;

  return (
    <main className="min-h-dvh bg-[#071614] p-5 text-emerald-50">
      <div className="mx-auto max-w-lg space-y-4">
        <div className="flex items-center gap-2">
          <NixoMark size={36} />
          <div>
            <p className="text-xs text-amber-200">Settings → Data & Storage → Media</p>
            <h1 className="text-xl font-semibold">رسانه و فضای ذخیره‌سازی</h1>
          </div>
        </div>
        <section className="space-y-2 rounded-2xl bg-white/5 p-4 text-sm">
          <h2 className="font-medium">Auto Download</h2>
          <label className="flex items-center justify-between"><span>Wi-Fi</span><input type="checkbox" checked={prefs.autoWifi} onChange={(e) => void save({ autoWifi: e.target.checked })} /></label>
          <label className="flex items-center justify-between"><span>Mobile Data</span><input type="checkbox" checked={prefs.autoMobile} onChange={(e) => void save({ autoMobile: e.target.checked })} /></label>
          <label className="flex items-center justify-between"><span>Roaming</span><input type="checkbox" checked={prefs.autoRoaming} onChange={(e) => void save({ autoRoaming: e.target.checked })} /></label>
          <label className="flex items-center justify-between"><span>Auto Save در گالری نیکسو</span><input type="checkbox" checked={prefs.autoSave} onChange={(e) => void save({ autoSave: e.target.checked })} /></label>
        </section>
        <section className="space-y-2 rounded-2xl bg-white/5 p-4 text-sm">
          <h2 className="font-medium">کیفیت</h2>
          <p className="text-xs">Upload</p>
          {(["standard", "high", "original"] as const).map((q) => (
            <label key={q} className="flex items-center gap-2 text-xs">
              <input type="radio" checked={prefs.uploadQuality === q} onChange={() => void save({ uploadQuality: q })} />
              {q}
            </label>
          ))}
          <p className="mt-2 text-xs">Download</p>
          {(["standard", "high", "original"] as const).map((q) => (
            <label key={`d-${q}`} className="flex items-center gap-2 text-xs">
              <input type="radio" checked={prefs.downloadQuality === q} onChange={() => void save({ downloadQuality: q })} />
              {q}
            </label>
          ))}
        </section>
        {stats && (
          <section className="rounded-2xl bg-white/5 p-4 text-sm">
            <h2 className="font-medium">Storage Manager</h2>
            <p>عکس {formatBytes(stats.photos)} · ویدیو {formatBytes(stats.videos)} · فایل {formatBytes(stats.files)} · Cache {formatBytes(stats.cache)}</p>
            <p className="mt-1 text-xs opacity-60">جمع {formatBytes(stats.total)}. Clear Cache فایل‌های ذخیره‌شدهٔ دائمی را پاک نمی‌کند.</p>
            <Button type="button" size="sm" className="mt-2" variant="secondary" onClick={() => void fetch("/api/gallery", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "clear-cache" }) }).then(load)}>Clear Cache</Button>
            <Link href="/app/gallery" className="mt-2 block text-xs text-amber-200">پیشنهاد پاک‌سازی در گالری (فایل‌های حجیم / قدیمی / Cache)</Link>
          </section>
        )}
        <section className="space-y-2 rounded-2xl bg-white/5 p-4 text-sm">
          <h2 className="font-medium">Gallery Lock</h2>
          <Input type="password" value={pin} onChange={(e) => setPin(e.target.value)} placeholder="پین حداقل ۴ رقم" className="bg-black/20" />
          <div className="flex gap-2">
            <Button type="button" size="sm" className="bg-amber-300 text-[#102824]" onClick={() => void save({ lockPin: pin })}>قفل</Button>
            <Button type="button" size="sm" variant="ghost" className="text-white" onClick={() => void save({ lockPin: "" })}>برداشتن قفل</Button>
          </div>
          <p className="text-[11px] opacity-50">{prefs.lockEnabled ? "قفل فعال است." : "قفل خاموش است."} مجوز دوربین، میکروفون و فایل از سیستم‌عامل است.</p>
        </section>
        <p className="text-[11px] opacity-45">رسانهٔ چت خصوصی E2EE است. پشتیبان رسانه طبق Backup حساب. نیکسو اسکرین‌شات را ۱۰۰٪ متوقف نمی‌کند.</p>
        <Link href="/app/gallery" className="text-sm text-amber-200">گالری نیکسو</Link>
        <Link href="/app/settings/audio" className="block text-sm text-amber-200">Settings → Data & Storage → Audio</Link>
      </div>
    </main>
  );
}
