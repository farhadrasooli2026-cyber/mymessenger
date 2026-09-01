"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { toast } from "sonner";
import { NixoMark } from "@/components/nixo-mark";
import { Button } from "@/components/ui/button";
import { formatBytes } from "@/lib/media";
import { clearVoicePlayCache, setVoiceAutoPlay, setVoiceSequential } from "@/lib/voice";

type Prefs = {
  autoWifi: boolean;
  autoMobile: boolean;
  autoRoaming: boolean;
  quality: string;
  speed: number;
  dataSaver: boolean;
  notifyPlayback: boolean;
  backgroundPlayback?: boolean;
  autoPlayVoice?: boolean;
  sequentialVoice?: boolean;
  autoDownloadVoice?: "wifi" | "mobile" | "never";
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
            <p className="text-xs text-amber-200">Settings → Voice & Audio</p>
            <h1 className="text-xl font-semibold">صوت، Voice و موسیقی</h1>
          </div>
        </div>
        <section className="space-y-2 rounded-2xl bg-white/5 p-4 text-sm">
          <h2 className="font-medium">Auto Download Voice</h2>
          {(["wifi", "mobile", "never"] as const).map((mode) => (
            <label key={mode} className="flex items-center justify-between">
              <span>{mode === "wifi" ? "فقط Wi-Fi" : mode === "mobile" ? "Wi-Fi و Mobile Data" : "هرگز"}</span>
              <input
                type="radio"
                name="adv"
                checked={(prefs.autoDownloadVoice ?? "wifi") === mode}
                onChange={() => void save({ autoDownloadVoice: mode })}
              />
            </label>
          ))}
          <label className="flex items-center justify-between">
            <span>Data Saver (دانلود خودکار Voice محدود می‌شود)</span>
            <input type="checkbox" checked={prefs.dataSaver} onChange={(e) => void save({ dataSaver: e.target.checked, autoDownloadVoice: e.target.checked ? "never" : prefs.autoDownloadVoice })} />
          </label>
          <h2 className="pt-2 font-medium">Auto Download موسیقی</h2>
          <label className="flex items-center justify-between"><span>Wi-Fi</span><input type="checkbox" checked={prefs.autoWifi} onChange={(e) => void save({ autoWifi: e.target.checked })} /></label>
          <label className="flex items-center justify-between"><span>Mobile Data</span><input type="checkbox" checked={prefs.autoMobile} onChange={(e) => void save({ autoMobile: e.target.checked })} /></label>
          <label className="flex items-center justify-between"><span>Roaming</span><input type="checkbox" checked={prefs.autoRoaming} onChange={(e) => void save({ autoRoaming: e.target.checked })} /></label>
        </section>
        <section className="space-y-2 rounded-2xl bg-white/5 p-4 text-sm">
          <h2 className="font-medium">پخش Voice</h2>
          <label className="flex items-center justify-between">
            <span>Auto Play</span>
            <input
              type="checkbox"
              checked={Boolean(prefs.autoPlayVoice)}
              onChange={(e) => {
                setVoiceAutoPlay(e.target.checked);
                void save({ autoPlayVoice: e.target.checked });
              }}
            />
          </label>
          <label className="flex items-center justify-between">
            <span>Sequential Playback</span>
            <input
              type="checkbox"
              checked={prefs.sequentialVoice !== false}
              onChange={(e) => {
                setVoiceSequential(e.target.checked);
                void save({ sequentialVoice: e.target.checked });
              }}
            />
          </label>
          <label className="flex items-center justify-between">
            <span>Background Playback</span>
            <input type="checkbox" checked={prefs.backgroundPlayback !== false} onChange={(e) => void save({ backgroundPlayback: e.target.checked })} />
          </label>
        </section>
        <section className="space-y-2 rounded-2xl bg-white/5 p-4 text-sm">
          <h2 className="font-medium">کیفیت و سرعت پخش</h2>
          {(["standard", "high", "original"] as const).map((q) => (
            <label key={q} className="flex items-center gap-2 text-xs">
              <input type="radio" checked={prefs.quality === q} onChange={() => void save({ quality: q })} />
              {q} {q === "original" ? "(بدون فشرده‌سازی غیرضروری)" : q === "standard" && prefs.dataSaver ? "(Data Saver)" : ""}
            </label>
          ))}
          <p className="mt-2 text-xs">Playback Speed پیش‌فرض</p>
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
            <p className="mt-1 text-xs opacity-60">Clear Cache فقط کش پخش محلی را پاک می‌کند؛ Voice اصلی چت و Backup حساب باقی می‌ماند. Restore از Backup حساب. Export از Saved Messages.</p>
            {cleanup && cleanup.large?.length ? <p className="mt-1 text-xs">پیشنهاد: فایل حجیم {cleanup.large[0]!.title} · {formatBytes(cleanup.large[0]!.size)}</p> : null}
            <Button
              type="button"
              size="sm"
              className="mt-2"
              variant="secondary"
              onClick={() => {
                clearVoicePlayCache();
                void fetch("/api/music", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "clear-cache" }) }).then(load);
              }}
            >
              پاک کردن Cache صوت
            </Button>
          </section>
        )}
        <section className="rounded-2xl bg-white/5 p-4 text-sm">
          <h2 className="font-medium">اعلان و حریم</h2>
          <label className="flex items-center justify-between">
            <span>اعلان پخش طبق Notification Settings</span>
            <input type="checkbox" checked={prefs.notifyPlayback} onChange={(e) => void save({ notifyPlayback: e.target.checked })} />
          </label>
          <p className="mt-2 text-[11px] opacity-60">متن Voice روی Lock Screen طبق Settings → Notifications → Preview (Hidden / Sender) نشان داده نمی‌شود. نیکسو بدون اجازهٔ سیستم‌عامل میکروفون را روشن نمی‌کند.</p>
          <Link href="/app/settings/notifications" className="mt-2 block text-xs text-amber-200">Settings → Notifications</Link>
          <Link href="/app/settings/privacy" className="mt-1 block text-xs text-amber-200">Settings → Privacy</Link>
        </section>
        <p className="text-[11px] opacity-45">Voice چت خصوصی و گروه E2EE است؛ سرور ciphertext می‌بیند نه صدا. پست صوت کانال برای مشترک‌ها روی سرور است و با امضای فایل (نه پسوند) اعتبارسنجی می‌شود. URL موقت و نشست برای فایل کتابخانه. حذف حساب طبق سیاست داده نیکسو صوت را مدیریت می‌کند.</p>
        <Link href="/app/music" className="text-sm text-amber-200">کتابخانه موسیقی</Link>
      </div>
    </main>
  );
}
