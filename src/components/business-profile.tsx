"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { toast } from "sonner";
import { NixoMark } from "@/components/nixo-mark";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { BIZ_REPORTS, WEEKDAYS } from "@/lib/business-types";

type Product = {
  id: string;
  kind: string;
  name: string;
  description: string;
  price: number;
  currency: string;
  stock: number | null;
  available: boolean;
  category: string;
  photoUrl: string | null;
};

type Biz = {
  id: string;
  name: string;
  username: string;
  category: string;
  description: string;
  website: string;
  phone: string;
  email: string;
  address: string;
  hours: { day: number; closed: boolean; open: string; close: string }[];
  open: boolean;
  logoUrl: string | null;
  verified: boolean;
  mapUrl: string | null;
  botId: string | null;
  channelId: string | null;
};

export function BusinessProfile({ id }: { id: string }) {
  const [biz, setBiz] = useState<Biz | null>(null);
  const [products, setProducts] = useState<Product[]>([]);
  const [q, setQ] = useState("");
  const [kind, setKind] = useState("");
  const [missing, setMissing] = useState(false);
  const [report, setReport] = useState("");

  useEffect(() => {
    fetch(`/api/business?id=${encodeURIComponent(id)}`, { cache: "no-store" })
      .then((r) => r.json())
      .then((d) => {
        if (!d.ok) {
          setMissing(true);
          return;
        }
        setBiz(d.business);
        setProducts(d.products ?? []);
      })
      .catch(() => setMissing(true));
  }, [id]);

  useEffect(() => {
    if (!biz) return;
    fetch(`/api/business?view=products&businessId=${biz.id}&q=${encodeURIComponent(q)}&kind=${encodeURIComponent(kind)}`, { cache: "no-store" })
      .then((r) => r.json())
      .then((d) => {
        if (d.ok) setProducts(d.products ?? []);
      })
      .catch(() => undefined);
  }, [biz, q, kind]);

  if (missing) {
    return (
      <main className="min-h-dvh bg-[#071614] p-5 text-emerald-50">
        <p>کسب‌وکار پیدا نشد.</p>
        <Link href="/app/business" className="text-amber-200">Directory</Link>
      </main>
    );
  }
  if (!biz) {
    return (
      <main className="min-h-dvh bg-[#071614] p-5 text-emerald-50">
        <p className="text-sm text-emerald-100/60">در حال بارگذاری پروفایل…</p>
      </main>
    );
  }

  const goods = products.filter((p) => p.kind === "product");
  const services = products.filter((p) => p.kind === "service");

  return (
    <main className="min-h-dvh bg-[#071614] p-5 text-emerald-50">
      <div className="mx-auto max-w-lg space-y-4">
        <div className="flex items-start gap-3">
          <div className="size-16 overflow-hidden rounded-2xl bg-white/10">
            {biz.logoUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={biz.logoUrl} alt="" className="size-16 object-cover" />
            ) : (
              <NixoMark size={40} />
            )}
          </div>
          <div>
            <h1 className="text-xl font-semibold">
              {biz.name} {biz.verified ? <span className="text-sm text-amber-200">✓ Verified Business</span> : null}
            </h1>
            <p className="text-xs text-amber-200" dir="ltr">@{biz.username}</p>
            <p className="text-xs">{biz.category} · {biz.open ? "🟢 Open" : "🔴 Closed"}</p>
          </div>
        </div>
        <p className="text-sm leading-7">{biz.description}</p>
        <div className="flex flex-wrap gap-2 text-xs">
          <Link href={`/app/business/b/${biz.id}/chat`} className="rounded-lg bg-amber-300 px-3 py-2 font-medium text-[#102824]">
            Message
          </Link>
          {biz.phone ? (
            <a href={`tel:${biz.phone}`} className="rounded-lg border border-white/15 px-3 py-2">
              Call
            </a>
          ) : null}
          {biz.website ? (
            <a href={biz.website} target="_blank" rel="noreferrer" className="rounded-lg border border-white/15 px-3 py-2">
              Website
            </a>
          ) : null}
          {biz.email ? (
            <a href={`mailto:${biz.email}`} className="rounded-lg border border-white/15 px-3 py-2">
              Email
            </a>
          ) : null}
        </div>
        <section>
          <h2 className="text-sm font-medium">ساعات کاری</h2>
          <ul className="mt-1 space-y-1 text-xs text-emerald-100/70">
            {WEEKDAYS.map((w) => {
              const h = biz.hours.find((x) => x.day === w.d);
              return (
                <li key={w.d}>
                  {w.en} {h?.closed ? "Closed" : `${h?.open} — ${h?.close}`}
                </li>
              );
            })}
          </ul>
        </section>
        {biz.mapUrl && (
          <p className="text-sm">
            <a href={biz.mapUrl} target="_blank" rel="noreferrer" className="text-amber-200">
              مشاهده روی نقشه (OpenStreetMap)
            </a>
            {biz.address ? <span className="block text-xs text-emerald-100/60">{biz.address}</span> : null}
          </p>
        )}
        {biz.botId && <p className="text-xs">ربات کسب‌وکار متصل است — FAQ و وضعیت سفارش از Bot.</p>}
        {biz.channelId && <p className="text-xs">کانال رسمی برای اخبار و محصول متصل است.</p>}
        <div className="flex gap-2">
          <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="جستجوی محصول یا خدمت" />
          <Button type="button" variant="outline" onClick={() => setKind(kind === "product" ? "" : "product")}>
            کالا
          </Button>
          <Button type="button" variant="outline" onClick={() => setKind(kind === "service" ? "" : "service")}>
            خدمت
          </Button>
        </div>
        <h2 className="text-sm font-medium">Products</h2>
        {goods.length === 0 && <p className="text-xs text-emerald-100/50">کالایی در کاتالوگ نیست.</p>}
        <ul className="grid grid-cols-2 gap-2">
          {goods.map((p) => (
            <li key={p.id}>
              <Link href={`/app/business/b/${biz.id}/p/${p.id}`} className="block rounded-xl border border-white/10 p-2">
                <p className="truncate text-sm">{p.name}</p>
                <p className="text-[11px] text-amber-200">
                  {p.price} {p.currency} · {p.available ? "موجود" : "ناموجود"}
                </p>
              </Link>
            </li>
          ))}
        </ul>
        <h2 className="text-sm font-medium">Services</h2>
        {services.length === 0 && <p className="text-xs text-emerald-100/50">خدمتی ثبت نشده.</p>}
        <ul className="space-y-2">
          {services.map((p) => (
            <li key={p.id}>
              <Link href={`/app/business/b/${biz.id}/p/${p.id}`} className="block rounded-xl border border-white/10 p-3">
                <p>{p.name}</p>
                <p className="text-xs text-emerald-100/60">{p.description}</p>
                <p className="text-xs text-amber-200">{p.price} {p.currency}</p>
              </Link>
            </li>
          ))}
        </ul>
        <p className="text-xs text-emerald-100/50">Reviews هنوز برای این نسخه فعال نیست.</p>
        <Link href={`/app/business/b/${biz.id}/chat`} className="block text-sm text-amber-200">
          پشتیبانی مشتری → Business Chat
        </Link>
        <div className="space-y-2 rounded-xl border border-white/10 p-3">
          <p className="text-xs">گزارش کلاهبرداری / فروشگاه جعلی</p>
          <select className="w-full rounded-lg bg-white/10 p-2 text-sm" value={report} onChange={(e) => setReport(e.target.value)}>
            <option value="">دسته گزارش</option>
            {BIZ_REPORTS.map((r) => (
              <option key={r.id} value={r.id}>
                {r.label}
              </option>
            ))}
          </select>
          <Button
            type="button"
            variant="destructive"
            onClick={() => {
              if (!report) return;
              void fetch("/api/business", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ action: "report", businessId: biz.id, category: report, details: "ui" }),
              }).then((r) => r.json()).then((d) => (d.ok ? toast.success("گزارش ثبت شد.") : toast.error(d.error)));
            }}
          >
            Report
          </Button>
        </div>
        <Link href="/app/business" className="text-xs text-amber-200">بازگشت</Link>
      </div>
    </main>
  );
}
