"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { NixoMark } from "@/components/nixo-mark";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { MINI_CATEGORIES } from "@/lib/bot-types";

type Card = {
  id: string;
  title: string;
  category: string;
  description: string;
  version: string;
  status: string;
  verified: boolean;
  developer: { name: string; username: string; verified: boolean };
  rating: number;
  reviewCount: number;
  installed: boolean;
  favorite: boolean;
  scopeLabels: string[];
  iconDataUrl: string | null;
};

type Dir = {
  items: Card[];
  recent: Card[];
  favorites: Card[];
  categories: { id: string; label: string; emoji: string }[];
};

export function AppsDesk() {
  const router = useRouter();
  const [q, setQ] = useState("");
  const [category, setCategory] = useState("");
  const [dir, setDir] = useState<Dir | null>(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    setErr("");
    const params = new URLSearchParams({ dir: "1" });
    if (q.trim()) params.set("q", q.trim());
    if (category) params.set("category", category);
    const res = await fetch(`/api/mini?${params}`, { cache: "no-store" });
    const data = await res.json();
    if (!res.ok) {
      setErr(data.error ?? "Directory در دسترس نیست.");
      setDir(null);
    } else {
      setDir(data as Dir);
    }
    setLoading(false);
  }, [q, category]);

  useEffect(() => {
    const t = window.setTimeout(() => void load(), 80);
    return () => window.clearTimeout(t);
  }, [load]);

  function CardRow({ m }: { m: Card }) {
    return (
      <li className="flex gap-3 rounded-xl border border-white/10 p-3">
        <div className="flex size-12 shrink-0 items-center justify-center overflow-hidden rounded-xl bg-black/30 text-lg">
          {m.iconDataUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={m.iconDataUrl} alt="" className="size-12 object-cover" />
          ) : (
            "📦"
          )}
        </div>
        <div className="min-w-0 flex-1">
          <p className="font-medium">
            {m.title} {m.verified ? <span className="text-[11px] text-amber-200">· تأییدشده نیکسو</span> : null}
          </p>
          <p className="text-[11px] text-amber-200" dir="ltr">
            @{m.developer.username || "unknown"} · v{m.version}
          </p>
          <p className="mt-1 text-[11px] opacity-70">{m.description}</p>
          <p className="mt-1 text-[11px] opacity-60">
            {m.status === "maintenance" ? "تعمیرات" : "فعال"} · امتیاز {m.rating || "—"} ({m.reviewCount})
          </p>
          <Button type="button" size="sm" className="mt-2 bg-amber-300 text-[#102824]" onClick={() => router.push(`/app/mini/${m.id}`)}>
            باز کردن
          </Button>
        </div>
      </li>
    );
  }

  return (
    <main className="min-h-dvh bg-[#071614] p-5 text-emerald-50">
      <div className="mx-auto max-w-lg space-y-4">
        <div className="flex items-center gap-2">
          <NixoMark size={36} />
          <div>
            <p className="text-xs text-amber-200">Mini Apps & Web Apps</p>
            <h1 className="text-xl font-semibold">App Directory</h1>
          </div>
        </div>
        <p className="text-xs leading-6 text-emerald-100/65">
          Mini App داخل سندباکس نیکسو اجرا می‌شود: بدون دسترسی مستقیم به پایگاه داده، چت E2EE، OTP یا کارت. مجوز حساس فقط بعد از تأیید تو و فقط از طریق API والد. نشان تأیید فقط از سرور است.
        </p>
        <div className="flex gap-2">
          <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="جستجوی Mini App" aria-label="جستجوی Mini App" />
          <Button type="button" onClick={() => void load()}>جستجو</Button>
        </div>
        <p className="text-xs">
          <Link href="/app/settings/apps" className="text-amber-200">
            Settings → Privacy & Security → Connected Apps
          </Link>
          {" · "}
          <Link href="/app/bots" className="text-amber-200">ربات‌ها</Link>
          {" · "}
          <Link href="/app" className="text-amber-200">بازگشت</Link>
        </p>
        <div className="flex flex-wrap gap-1">
          <Button type="button" size="xs" variant={category === "" ? "default" : "secondary"} onClick={() => setCategory("")}>
            همه
          </Button>
          {(dir?.categories ?? MINI_CATEGORIES).map((c) => (
            <Button key={c.id} type="button" size="xs" variant={category === c.id ? "default" : "secondary"} onClick={() => setCategory(c.id)}>
              {c.emoji} {c.label}
            </Button>
          ))}
        </div>
        {loading && <p className="text-xs opacity-70">در حال بارگذاری Directory…</p>}
        {err && <p className="text-xs text-red-200">{err}</p>}
        {dir && dir.favorites.length > 0 && (
          <section className="rounded-2xl bg-white/5 p-4 text-sm">
            <h2 className="font-medium">علاقه‌مندی‌ها</h2>
            <ul className="mt-2 space-y-2 text-xs">
              {dir.favorites.map((m) => (
                <CardRow key={m.id} m={m} />
              ))}
            </ul>
          </section>
        )}
        {dir && dir.recent.length > 0 && (
          <section className="rounded-2xl bg-white/5 p-4 text-sm">
            <h2 className="font-medium">اخیراً استفاده‌شده</h2>
            <ul className="mt-2 space-y-2 text-xs">
              {dir.recent.map((m) => (
                <CardRow key={`r-${m.id}`} m={m} />
              ))}
            </ul>
          </section>
        )}
        <section className="rounded-2xl bg-white/5 p-4 text-sm">
          <h2 className="font-medium">فهرست</h2>
          {!loading && dir && dir.items.length === 0 && <p className="mt-2 text-xs opacity-60">Mini App مطابق جستجو نیست.</p>}
          <ul className="mt-2 space-y-2 text-xs">
            {dir?.items.map((m) => (
              <CardRow key={m.id} m={m} />
            ))}
          </ul>
        </section>
      </div>
    </main>
  );
}
