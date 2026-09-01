"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { toast } from "sonner";
import { NixoMark } from "@/components/nixo-mark";
import type { UserPrefs } from "@/lib/prefs-types";

export function AccessibilitySettings() {
  const [prefs, setPrefs] = useState<UserPrefs | null>(null);

  useEffect(() => {
    fetch("/api/account", { cache: "no-store" })
      .then((r) => r.json())
      .then((d) => {
        if (d.account?.prefs) setPrefs(d.account.prefs);
      })
      .catch(() => undefined);
  }, []);

  async function toggle(key: keyof UserPrefs, value: boolean) {
    const res = await fetch("/api/account", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "prefs", [key]: value }),
    });
    const data = await res.json();
    if (!res.ok) toast.error(data.error ?? "ذخیره نشد.");
    else setPrefs(data.prefs);
  }

  if (!prefs) return <p className="p-8 text-sm">در حال بارگذاری…</p>;

  const rows: { key: "reducedMotion" | "highContrast" | "screenReaderHints"; label: string }[] = [
    { key: "reducedMotion", label: "حرکت کمتر" },
    { key: "highContrast", label: "کنتراست بالا" },
    { key: "screenReaderHints", label: "راهنمای Screen Reader" },
  ];

  return (
    <div className="min-h-dvh bg-[#071614] px-4 py-8 text-emerald-50">
      <div className="mx-auto max-w-lg space-y-6">
        <header className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <NixoMark size={36} />
            <h1 className="text-lg font-semibold">دسترسی‌پذیری</h1>
          </div>
          <Link href="/app" className="text-sm text-amber-200">
            بازگشت
          </Link>
        </header>
        <section className="space-y-3 rounded-2xl bg-white/5 p-4 text-sm">
          {rows.map((r) => (
            <label key={r.key} className="flex items-center justify-between">
              {r.label}
              <input type="checkbox" checked={Boolean(prefs[r.key])} onChange={(e) => void toggle(r.key, e.target.checked)} />
            </label>
          ))}
        </section>
      </div>
    </div>
  );
}
