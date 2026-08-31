"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { NixoMark } from "@/components/nixo-mark";

type Order = {
  id: string;
  total: number;
  currency: string;
  status: string;
  paymentStatus: string;
  createdAt: number;
};

export function OrdersList() {
  const [orders, setOrders] = useState<Order[] | null>(null);

  useEffect(() => {
    fetch("/api/shop?view=orders", { cache: "no-store" })
      .then((r) => r.json())
      .then((d) => setOrders(d.orders ?? []))
      .catch(() => setOrders([]));
  }, []);

  return (
    <main className="min-h-dvh bg-[#071614] p-5 text-emerald-50">
      <div className="mx-auto max-w-lg space-y-4">
        <div className="flex items-center gap-2">
          <NixoMark size={36} />
          <div>
            <p className="text-xs text-amber-200">Profile → Orders</p>
            <h1 className="text-xl font-semibold">سفارش‌های من</h1>
          </div>
        </div>
        {orders === null && <p className="text-sm text-emerald-100/50">بارگذاری…</p>}
        {orders?.length === 0 && <p className="text-sm text-emerald-100/50">هنوز سفارشی نداری.</p>}
        <ul className="space-y-2">
          {orders?.map((o) => (
            <li key={o.id}>
              <Link href={`/app/orders/${o.id}`} className="block rounded-xl border border-white/10 p-3">
                <p className="font-medium" dir="ltr">{o.id}</p>
                <p className="text-xs">
                  {o.total} {o.currency} · {o.status} · پرداخت {o.paymentStatus}
                </p>
              </Link>
            </li>
          ))}
        </ul>
        <Link href="/app/wallet" className="block text-sm text-amber-200">NIXO Wallet</Link>
        <Link href="/app" className="block text-xs text-amber-200">بازگشت</Link>
      </div>
    </main>
  );
}
