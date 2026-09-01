"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { toast } from "sonner";
import { NixoMark } from "@/components/nixo-mark";
import { Button } from "@/components/ui/button";
import { MINI_SCOPE_FA, type MiniScope } from "@/lib/bot-types";

type AppRow = {
  id: string;
  title: string;
  scopes: MiniScope[];
  favorite: boolean;
  lastUsedAt: number;
  tokenExp: number | null;
};

type Pack = {
  apps: AppRow[];
  logs: { action: string; at: number; miniAppId: string }[];
  export: { miniAppId: string; scopes: MiniScope[]; connectedAt: number }[];
};

export function ConnectedApps() {
  const [pack, setPack] = useState<Pack | null>(null);
  const [err, setErr] = useState("");

  function load() {
    fetch("/api/mini?connected=1", { cache: "no-store" })
      .then((r) => r.json())
      .then((d) => {
        if (d.ok) setPack(d as Pack);
        else setErr(d.error ?? "بارگذاری نشد.");
      })
      .catch(() => setErr("شبکه در دسترس نیست."));
  }

  useEffect(() => {
    load();
  }, []);

  async function act(action: string, miniId: string, extra: Record<string, unknown> = {}) {
    const res = await fetch("/api/mini", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action, miniId, ...extra }),
    });
    const data = await res.json();
    if (!res.ok) toast.error(data.error ?? "انجام نشد.");
    else toast.success("به‌روز شد.");
    load();
  }

  function exportJson() {
    const blob = new Blob([JSON.stringify(pack?.export ?? [], null, 2)], { type: "application/json" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = "nixo-connected-apps.json";
    a.click();
  }

  if (err && !pack) {
    return (
      <main className="min-h-dvh bg-[#071614] p-6 text-emerald-50">
        <p className="text-sm text-red-200">{err}</p>
        <Link href="/app/settings/privacy" className="mt-3 inline-block text-amber-200">بازگشت</Link>
      </main>
    );
  }

  if (!pack) return <main className="min-h-dvh bg-[#071614] p-6 text-sm text-emerald-50">بارگذاری Connected Apps…</main>;

  return (
    <main className="min-h-dvh bg-[#071614] p-5 text-emerald-50">
      <div className="mx-auto max-w-lg space-y-4">
        <div className="flex items-center gap-2">
          <NixoMark size={36} />
          <div>
            <p className="text-xs text-amber-200">Settings → Privacy & Security → Connected Apps</p>
            <h1 className="text-xl font-semibold">برنامه‌های متصل</h1>
          </div>
        </div>
        <p className="text-xs leading-6 text-emerald-100/65">
          لغو مجوز، توکن Mini App را باطل می‌کند. پاک کردن دادهٔ محلی حساب نیکسو را حذف نمی‌کند. با خروج از همهٔ دستگاه‌ها نشست Mini App هم بسته می‌شود.
        </p>
        <div className="flex gap-2">
          <Button type="button" size="sm" variant="secondary" onClick={exportJson}>
            خروجی دادهٔ اتصال
          </Button>
          <Link href="/app/apps" className="inline-flex h-7 items-center text-xs text-amber-200">
            Directory
          </Link>
        </div>
        {pack.apps.length === 0 && <p className="text-xs opacity-60">هنوز Mini App متصل نیست.</p>}
        <ul className="space-y-3">
          {pack.apps.map((app) => (
            <li key={app.id} className="rounded-2xl bg-white/5 p-4 text-sm">
              <p className="font-medium">{app.title}</p>
              <p className="mt-1 text-[11px] opacity-70">
                مجوزها: {app.scopes.map((s) => MINI_SCOPE_FA[s] ?? s).join("، ") || "هیچ"}
              </p>
              <div className="mt-2 flex flex-wrap gap-2">
                <Link href={`/app/mini/${app.id}`} className="text-xs text-amber-200">
                  باز کردن / مدیریت مجوز
                </Link>
                <Button type="button" size="xs" variant="secondary" onClick={() => void act("disconnect", app.id)}>
                  قطع اتصال
                </Button>
                <Button type="button" size="xs" variant="secondary" onClick={() => void act("clear-data", app.id)}>
                  پاک کردن دادهٔ محلی
                </Button>
              </div>
            </li>
          ))}
        </ul>
        <section className="rounded-2xl bg-white/5 p-4 text-sm">
          <h2 className="font-medium">تاریخچهٔ دسترسی</h2>
          <ul className="mt-2 max-h-48 space-y-1 overflow-auto text-[11px] opacity-80">
            {pack.logs.length === 0 && <li>رویدادی نیست.</li>}
            {pack.logs.map((l, i) => (
              <li key={`${l.at}-${i}`}>
                {new Date(l.at).toLocaleString("fa")} · {l.action}
              </li>
            ))}
          </ul>
        </section>
        <Link href="/app/settings/privacy" className="inline-block text-sm text-amber-200">
          بازگشت به حریم خصوصی
        </Link>
      </div>
    </main>
  );
}
