"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { toast } from "sonner";
import { NixoMark } from "@/components/nixo-mark";
import { Input } from "@/components/ui/input";

type Prefs = { notifyLive: boolean; hideLiveOnLockScreen: boolean; adultConfirmed: boolean; region: string };

export function LiveSettings() {
  const [prefs, setPrefs] = useState<Prefs | null>(null);
  const [exportItems, setExportItems] = useState<{ id: string; title: string; status: string; createdAt: number }[]>([]);

  async function load() {
    const [a, b] = await Promise.all([
      fetch("/api/live?mode=mine", { cache: "no-store" }).then((r) => r.json()),
      fetch("/api/live?mode=export", { cache: "no-store" }).then((r) => r.json()),
    ]);
    setPrefs(a.prefs ?? b.prefs ?? null);
    setExportItems(b.items ?? []);
  }

  useEffect(() => {
    const t = window.setTimeout(() => void load(), 0);
    return () => window.clearTimeout(t);
  }, []);

  async function save(patch: Partial<Prefs>) {
    const res = await fetch("/api/live", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(patch) });
    const data = await res.json();
    if (!res.ok) toast.error("ذخیره نشد.");
    else {
      setPrefs(data.prefs);
      toast.success("تنظیمات Live ذخیره شد.");
    }
  }

  if (!prefs) return <p className="p-6 text-sm">بارگذاری…</p>;

  return (
    <main className="min-h-dvh bg-[#071614] p-5 text-emerald-50">
      <div className="mx-auto max-w-lg space-y-4">
        <div className="flex items-center gap-2">
          <NixoMark size={36} />
          <div>
            <p className="text-xs text-amber-200">Settings → Live</p>
            <h1 className="text-xl font-semibold">پخش زنده</h1>
          </div>
        </div>
        <section className="space-y-2 rounded-2xl bg-white/5 p-4 text-sm">
          <label className="flex items-center justify-between">
            <span>اعلان شروع Live</span>
            <input type="checkbox" checked={prefs.notifyLive} onChange={(e) => void save({ notifyLive: e.target.checked })} />
          </label>
          <label className="flex items-center justify-between">
            <span>عنوان Live خصوصی روی Lock Screen نباشد</span>
            <input type="checkbox" checked={prefs.hideLiveOnLockScreen} onChange={(e) => void save({ hideLiveOnLockScreen: e.target.checked })} />
          </label>
          <label className="flex items-center justify-between">
            <span>تأیید سن برای Liveهای محدود</span>
            <input type="checkbox" checked={prefs.adultConfirmed} onChange={(e) => void save({ adultConfirmed: e.target.checked })} />
          </label>
          <label className="block text-xs">
            برچسب منطقه (محدودیت جغرافیایی این نسخه IP نیست)
            <Input value={prefs.region} onChange={(e) => setPrefs({ ...prefs, region: e.target.value })} onBlur={() => void save({ region: prefs.region })} className="mt-1 bg-black/20" />
          </label>
        </section>
        <section className="rounded-2xl bg-white/5 p-4 text-sm">
          <h2 className="font-medium">Data Export</h2>
          <p className="text-xs opacity-60">فهرست Liveهای خودت. Recording جدا و با همان Permission Replay است.</p>
          <ul className="mt-2 space-y-1 text-xs">
            {exportItems.map((it) => (
              <li key={it.id}>
                <Link href={`/app/live/${it.id}`}>{it.title} · {it.status}</Link>
              </li>
            ))}
          </ul>
        </section>
        <Link href="/app/live" className="text-sm text-amber-200">Discovery Live</Link>
        <Link href="/app/settings/notifications" className="block text-sm text-amber-200">Settings → Notifications</Link>
      </div>
    </main>
  );
}
