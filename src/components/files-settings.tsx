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
  dataSaver?: boolean;
  autoFiles?: "wifi" | "mobile" | "never";
  previewFiles?: boolean;
};

export function FilesSettings() {
  const [prefs, setPrefs] = useState<Prefs | null>(null);
  const [stats, setStats] = useState<{ files?: number; cache?: number; total?: number } | null>(null);

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
    const res = await fetch("/api/gallery", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "prefs", ...patch }),
    });
    if (!res.ok) toast.error("ذخیره نشد.");
    else toast.success("تنظیمات فایل ذخیره شد.");
    await load();
  }

  if (!prefs) return <p className="p-6 text-sm">بارگذاری…</p>;

  return (
    <main className="min-h-dvh bg-[#071614] p-5 text-emerald-50">
      <div className="mx-auto max-w-lg space-y-4">
        <div className="flex items-center gap-2">
          <NixoMark size={36} />
          <div>
            <p className="text-xs text-amber-200">Settings → Files & Storage</p>
            <h1 className="text-xl font-semibold">فایل‌ها و فضای ذخیره‌سازی</h1>
          </div>
        </div>
        <section className="space-y-2 rounded-2xl bg-white/5 p-4 text-sm">
          <h2 className="font-medium">Auto Download فایل</h2>
          {(["wifi", "mobile", "never"] as const).map((mode) => (
            <label key={mode} className="flex items-center justify-between">
              <span>{mode === "wifi" ? "فقط Wi-Fi" : mode === "mobile" ? "Wi-Fi و Mobile Data" : "هرگز"}</span>
              <input type="radio" name="af" checked={(prefs.autoFiles ?? "wifi") === mode} onChange={() => void save({ autoFiles: mode })} />
            </label>
          ))}
          <label className="flex items-center justify-between">
            <span>Data Saver</span>
            <input type="checkbox" checked={Boolean(prefs.dataSaver)} onChange={(e) => void save({ dataSaver: e.target.checked, autoFiles: e.target.checked ? "never" : prefs.autoFiles })} />
          </label>
          <label className="flex items-center justify-between">
            <span>File Preview داخل نیکسو</span>
            <input type="checkbox" checked={prefs.previewFiles !== false} onChange={(e) => void save({ previewFiles: e.target.checked })} />
          </label>
        </section>
        {stats ? (
          <section className="rounded-2xl bg-white/5 p-4 text-sm">
            <h2 className="font-medium">Storage Usage</h2>
            <p>فایل‌ها {formatBytes(stats.files ?? 0)} · Cache {formatBytes(stats.cache ?? 0)} · جمع {formatBytes(stats.total ?? 0)}</p>
            <p className="mt-1 text-xs opacity-60">Clear Cache فایل اصلی سرور را پاک نمی‌کند. حذف از دستگاه ≠ حذف از سرور.</p>
            <Button
              type="button"
              size="sm"
              className="mt-2"
              variant="secondary"
              onClick={() => void fetch("/api/gallery", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "clear-cache" }) }).then(load)}
            >
              Storage Cleanup / Clear Cache
            </Button>
          </section>
        ) : null}
        <section className="rounded-2xl bg-white/5 p-4 text-sm">
          <h2 className="font-medium">Download Location</h2>
          <p className="text-xs opacity-70">محل ذخیرهٔ دانلود روی وب همان پوشهٔ Downloads مرورگر است و از سیستم‌عامل پیروی می‌کند. نیکسو مسیر دیسک سرور را به کلاینت لو نمی‌دهد.</p>
        </section>
        <section className="rounded-2xl bg-white/5 p-4 text-xs leading-6 opacity-70">
          <h2 className="text-sm font-medium text-emerald-50">Privacy</h2>
          فایل خصوصی E2EE است. URL موقت و نشست لازم است. Notification متن فایل را نشان نمی‌دهد. Metadata حساس در پیش‌نمایش محدود است.
          <Link href="/app/settings/privacy" className="mt-2 block text-amber-200">Settings → Privacy</Link>
          <Link href="/app/settings/notifications" className="block text-amber-200">Settings → Notifications</Link>
        </section>
          <Link href="/app/storage" className="text-sm text-amber-200">کتابخانه Media Storage</Link>
          <Link href="/app/files" className="text-sm text-amber-200">کتابخانه Files & Documents</Link>
        <Link href="/app/settings/media" className="block text-sm text-amber-200">Settings → Data & Storage → Media</Link>
      </div>
    </main>
  );
}
