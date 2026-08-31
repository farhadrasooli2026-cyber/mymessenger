"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { toast } from "sonner";
import { NixoMark } from "@/components/nixo-mark";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";

type Dash = {
  sales: number;
  orders: number;
  revenue: number;
  payments: { id: string; orderId: string; status: string; amount: number; currency: string }[];
  refunds: { id: string; orderId: string; status: string; amount: number }[];
  settlements: { id: string; orderId: string; amount: number; fee: number; status: string; currency: string }[];
  feeNote: string;
};

export function ShopPayDesk() {
  const [bizId, setBizId] = useState("");
  const [dash, setDash] = useState<Dash | null>(null);
  const [name, setName] = useState("");
  const [currency, setCurrency] = useState("USD");
  const [code, setCode] = useState("NIXO20");
  const [value, setValue] = useState("10");
  const [desc, setDesc] = useState("");

  useEffect(() => {
    fetch("/api/business?mine=1", { cache: "no-store" })
      .then((r) => r.json())
      .then((d) => {
        const id = d.businesses?.[0]?.id as string | undefined;
        if (!id) return;
        setBizId(id);
        fetch(`/api/shop?view=shop&businessId=${id}`, { cache: "no-store" })
          .then((r) => r.json())
          .then((s) => {
            if (s.ok) {
              setName(s.shop.name);
              setCurrency(s.shop.currency);
              setDesc(s.shop.description);
            }
          });
        fetch(`/api/shop?view=dashboard&businessId=${id}`, { cache: "no-store" })
          .then((r) => r.json())
          .then((x) => {
            if (x.ok) setDash(x as Dash);
          });
      })
      .catch(() => undefined);
  }, []);

  if (!bizId) {
    return (
      <main className="min-h-dvh bg-[#071614] p-5 text-emerald-50">
        <p>ابتدا Business بساز.</p>
        <Link href="/app/business/create" className="text-amber-200">Create Business</Link>
      </main>
    );
  }

  return (
    <main className="min-h-dvh bg-[#071614] p-5 text-emerald-50">
      <div className="mx-auto max-w-lg space-y-4">
        <div className="flex items-center gap-2">
          <NixoMark size={36} />
          <div>
            <p className="text-xs text-amber-200">Settings → Business → Payments</p>
            <h1 className="text-xl font-semibold">فروشگاه و تسویه</h1>
          </div>
        </div>
        <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Shop Name" />
        <Textarea value={desc} onChange={(e) => setDesc(e.target.value)} />
        <select className="rounded-lg bg-white/10 p-2" value={currency} onChange={(e) => setCurrency(e.target.value)}>
          <option>USD</option>
          <option>EUR</option>
          <option>TRY</option>
        </select>
        <Button
          type="button"
          onClick={() => {
            void fetch("/api/shop", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ action: "shop", businessId: bizId, name, description: desc, currency }),
            }).then((r) => r.json()).then((d) => (d.ok ? toast.success("فروشگاه ذخیره شد.") : toast.error(d.error)));
          }}
        >
          ذخیره Shop
        </Button>
        <p className="text-xs">روش ارسال پیش‌فرض: Standard / Express / Pickup. کارمزد ۲٫۵٪ قبل از پرداخت روی Checkout دیده می‌شود.</p>
        <div className="flex gap-2">
          <Input value={code} onChange={(e) => setCode(e.target.value)} placeholder="NIXO20" />
          <Input value={value} onChange={(e) => setValue(e.target.value)} placeholder="۱۰٪" />
          <Button
            type="button"
            onClick={() => {
              void fetch("/api/shop", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                  action: "coupon",
                  businessId: bizId,
                  code,
                  kind: "percent",
                  value: Number(value),
                  days: 30,
                  usageLimit: 50,
                  minOrder: 10,
                  maxDiscount: 40,
                }),
              }).then((r) => r.json()).then((d) => (d.ok ? toast.success("کوپن ساخته شد.") : toast.error(d.error)));
            }}
          >
            Coupon
          </Button>
        </div>
        {dash && (
          <section className="space-y-2 rounded-xl border border-white/10 p-3 text-sm">
            <p>Sales: {dash.sales}</p>
            <p>Orders: {dash.orders}</p>
            <p>Revenue (پس از کارمزد، تأییدشده): {dash.revenue}</p>
            <p className="text-[11px] text-emerald-100/50">{dash.feeNote}</p>
            <h2 className="pt-2 text-xs text-amber-200">Payments</h2>
            <ul className="text-xs">
              {dash.payments.slice(0, 8).map((p) => (
                <li key={p.id}>{p.orderId} · {p.status} · {p.amount} {p.currency}</li>
              ))}
            </ul>
            <h2 className="text-xs text-amber-200">Refunds</h2>
            <ul className="text-xs">
              {dash.refunds.slice(0, 6).map((r) => (
                <li key={r.id} className="flex items-center gap-2">
                  {r.orderId} · {r.status} · {r.amount}
                  {r.status === "requested" && (
                    <button
                      type="button"
                      className="text-amber-200"
                      onClick={() => {
                        void fetch("/api/shop", {
                          method: "POST",
                          headers: { "Content-Type": "application/json" },
                          body: JSON.stringify({ action: "refundProcess", refundId: r.id, outcome: "completed" }),
                        }).then(() => toast.success("Refund انجام شد."));
                      }}
                    >
                      Complete
                    </button>
                  )}
                </li>
              ))}
            </ul>
            <h2 className="text-xs text-amber-200">Settlement</h2>
            <ul className="text-xs">
              {dash.settlements.slice(0, 6).map((s) => (
                <li key={s.id}>
                  {s.orderId} · {s.amount} {s.currency} − fee {s.fee} · {s.status}
                </li>
              ))}
            </ul>
          </section>
        )}
        <Link href="/app/settings/business" className="text-xs text-amber-200">Settings → Business</Link>
      </div>
    </main>
  );
}
