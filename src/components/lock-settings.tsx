"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { toast } from "sonner";
import { NixoMark } from "@/components/nixo-mark";
import type { UserPrefs } from "@/lib/prefs-types";

export function LockSettings() {
  const [prefs, setPrefs] = useState<UserPrefs | null>(null);

  useEffect(() => {
    fetch("/api/account", { cache: "no-store" })
      .then((r) => r.json())
      .then((d) => {
        if (d.account?.prefs) setPrefs(d.account.prefs);
      })
      .catch(() => undefined);
  }, []);

  async function save(patch: Record<string, unknown>) {
    const res = await fetch("/api/account", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "prefs", ...patch }),
    });
    const data = await res.json();
    if (!res.ok) toast.error(data.error ?? "ذخیره نشد.");
    else {
      setPrefs(data.prefs);
      toast.success("قفل برنامه به‌روز شد.");
    }
  }

  if (!prefs) return <p className="p-8 text-sm">در حال بارگذاری…</p>;

  return (
    <div className="min-h-dvh bg-[#071614] px-4 py-8 text-emerald-50">
      <div className="mx-auto max-w-lg space-y-6">
        <header className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <NixoMark size={36} />
            <h1 className="text-lg font-semibold">قفل برنامه</h1>
          </div>
          <Link href="/app/settings/security" className="text-sm text-amber-200">
            امنیت
          </Link>
        </header>
        <section className="space-y-3 rounded-2xl bg-white/5 p-4 text-sm">
          <p className="text-[11px] opacity-70">PIN روی دستگاه است. رمز حساب و ۲FA در Security Center جداگانه مدیریت می‌شود.</p>
          <label className="flex items-center justify-between">
            قفل برنامه
            <input type="checkbox" checked={prefs.appLockEnabled} onChange={(e) => void save({ appLockEnabled: e.target.checked })} />
          </label>
          <label className="flex items-center justify-between">
            زیست‌سنجه (در صورت پشتیبانی دستگاه)
            <input type="checkbox" checked={prefs.appLockBiometric} onChange={(e) => void save({ appLockBiometric: e.target.checked })} />
          </label>
          <label className="block">
            قفل خودکار
            <select
              className="mt-1 h-10 w-full rounded-lg bg-black/30 px-2"
              value={prefs.autoLockSec}
              onChange={(e) => void save({ autoLockSec: Number(e.target.value) })}
            >
              <option value={0}>خاموش</option>
              <option value={30}>۳۰ ثانیه</option>
              <option value={60}>۱ دقیقه</option>
              <option value={300}>۵ دقیقه</option>
              <option value={600}>۱۰ دقیقه</option>
            </select>
          </label>
        </section>
      </div>
    </div>
  );
}
