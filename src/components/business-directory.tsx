"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { NixoMark } from "@/components/nixo-mark";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { BUSINESS_CATEGORIES } from "@/lib/business-types";

type Row = {
  id: string;
  name: string;
  username: string;
  category: string;
  description: string;
  open: boolean;
  verified: boolean;
  logoUrl: string | null;
};

export function BusinessDirectory({ embedded }: { embedded?: boolean }) {
  const [q, setQ] = useState("");
  const [category, setCategory] = useState("");
  const [rows, setRows] = useState<Row[]>([]);
  const [mine, setMine] = useState<Row[]>([]);

  function load() {
    const cat = category ? `&category=${encodeURIComponent(category)}` : "";
    fetch(`/api/business?q=${encodeURIComponent(q)}${cat}`, { cache: "no-store" })
      .then((r) => r.json())
      .then((d) => {
        if (d.ok) setRows(d.businesses ?? []);
      })
      .catch(() => undefined);
  }

  useEffect(() => {
    fetch("/api/business?mine=1", { cache: "no-store" })
      .then((r) => r.json())
      .then((d) => {
        if (d.ok) setMine(d.businesses ?? []);
      })
      .catch(() => undefined);
    const cat = category ? `&category=${encodeURIComponent(category)}` : "";
    fetch(`/api/business?q=${encodeURIComponent(q)}${cat}`, { cache: "no-store" })
      .then((r) => r.json())
      .then((d) => {
        if (d.ok) setRows(d.businesses ?? []);
      })
      .catch(() => undefined);
  }, [category, q]);

  return (
    <main className={embedded ? "space-y-4 p-5" : "min-h-dvh bg-[#071614] p-5 text-emerald-50"}>
      <div className={embedded ? "space-y-4" : "mx-auto max-w-lg space-y-4"}>
        {!embedded && (
          <div className="flex items-center gap-2">
            <NixoMark size={36} />
            <div>
              <p className="text-xs text-amber-200">فروشگاه نیکسو</p>
              <h1 className="text-xl font-semibold">Business Directory</h1>
            </div>
          </div>
        )}
        {embedded && <h2 className="text-xl font-semibold">فروشگاه کسب‌وکار</h2>}
        <p className="text-xs leading-6 text-emerald-100/65">
          کاتالوگ، سبد و Checkout داخل نیکسو است. پرداخت سندباکس با تأیید سرور؛ شماره کارت ذخیره نمی‌شود.
        </p>
        <div className="flex gap-2">
          <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="جستجوی فروشگاه یا @username" />
          <Button type="button" onClick={() => load()}>
            جستجو
          </Button>
        </div>
        <div className="flex flex-wrap gap-1">
          <button type="button" className={`rounded-full px-2 py-1 text-[11px] ${!category ? "bg-amber-300 text-[#102824]" : "bg-white/10"}`} onClick={() => setCategory("")}>
            همه
          </button>
          {BUSINESS_CATEGORIES.map((c) => (
            <button
              key={c.id}
              type="button"
              className={`rounded-full px-2 py-1 text-[11px] ${category === c.id ? "bg-amber-300 text-[#102824]" : "bg-white/10"}`}
              onClick={() => setCategory(c.id)}
            >
              {c.label}
            </button>
          ))}
        </div>
        {mine.length === 0 ? (
          <Link href="/app/business/create" className="inline-flex h-9 items-center rounded-lg bg-amber-300 px-3 text-sm font-medium text-[#102824]">
            Create Business Account
          </Link>
        ) : (
          <Link href="/app/settings/business" className="text-sm text-amber-200">
            Settings → Business
          </Link>
        )}
        {rows.length === 0 && <p className="text-sm text-emerald-100/50">هنوز کسب‌وکاری با این فیلتر نیست.</p>}
        <ul className="space-y-2">
          {rows.map((b) => (
            <li key={b.id}>
              <Link href={`/app/business/b/${b.id}`} className="flex items-center gap-3 rounded-2xl border border-white/10 bg-white/5 p-3">
                <div className="size-12 overflow-hidden rounded-xl bg-white/10">
                  {b.logoUrl ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={b.logoUrl} alt="" className="size-12 object-cover" />
                  ) : null}
                </div>
                <div className="min-w-0 flex-1">
                  <p className="truncate font-medium">
                    {b.name} {b.verified ? <span className="text-amber-200">✓ NIXO</span> : null}
                  </p>
                  <p className="text-xs text-emerald-100/60" dir="ltr">
                    @{b.username} · {b.category}
                  </p>
                  <p className="text-[11px]">{b.open ? "🟢 Open" : "🔴 Closed"}</p>
                </div>
              </Link>
            </li>
          ))}
        </ul>
        {!embedded && (
          <Link href="/app" className="block text-xs text-amber-200">
            بازگشت به پیام‌رسان
          </Link>
        )}
      </div>
    </main>
  );
}
