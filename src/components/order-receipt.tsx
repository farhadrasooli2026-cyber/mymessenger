"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

type Bundle = {
  order: {
    id: string;
    items: { name: string; qty: number; price: number; discount: number; variantKey: string }[];
    subtotal: number;
    discountTotal: number;
    deliveryFee: number;
    fee: number;
    total: number;
    currency: string;
    status: string;
    paymentStatus: string;
    addressSnapshot: string;
    delivery: string;
    createdAt: number;
    invoiceId: string | null;
  };
  payment: { id: string; status: string; method: string; amount: number; fee: number; last4: string | null } | null;
  invoice: {
    id: string;
    lines: { name: string; qty: number; price: number; discount: number }[];
    total: number;
    currency: string;
    paymentStatus: string;
    createdAt: number;
  } | null;
};

export function OrderReceipt({ orderId }: { orderId: string }) {
  const params = useSearchParams();
  const [row, setRow] = useState<Bundle | null>(null);
  const [missing, setMissing] = useState(false);
  const [state, setState] = useState("");
  const [reason, setReason] = useState("");
  const payQ = params.get("pay");

  function load() {
    fetch(`/api/shop?view=order&orderId=${encodeURIComponent(orderId)}`, { cache: "no-store" })
      .then((r) => r.json())
      .then((d) => {
        if (!d.ok) setMissing(true);
        else setRow(d as Bundle);
      })
      .catch(() => setMissing(true));
  }

  useEffect(() => {
    fetch(`/api/shop?view=order&orderId=${encodeURIComponent(orderId)}`, { cache: "no-store" })
      .then((r) => r.json())
      .then((d) => {
        if (!d.ok) setMissing(true);
        else setRow(d as Bundle);
      })
      .catch(() => setMissing(true));
  }, [orderId]);

  async function act(action: string, extra?: Record<string, unknown>) {
    const res = await fetch("/api/shop", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action, orderId, paymentId: row?.payment?.id ?? payQ, ...extra }),
    });
    const d = await res.json();
    if (!res.ok) toast.error(d.error);
    else {
      if (d.state) setState(d.state);
      toast.success(d.state ?? "ثبت شد.");
      load();
    }
  }

  if (missing) {
    return (
      <main className="min-h-dvh bg-[#071614] p-5 text-emerald-50">
        <p>سفارش در دسترس نیست.</p>
      </main>
    );
  }
  if (!row) {
    return (
      <main className="min-h-dvh bg-[#071614] p-5 text-emerald-50">
        <p>بارگذاری سفارش…</p>
      </main>
    );
  }
  const o = row.order;
  const banner =
    state ||
    (o.paymentStatus === "paid"
      ? "Payment Successful"
      : o.paymentStatus === "failed"
        ? "Payment Failed"
        : o.paymentStatus === "pending"
          ? "Payment Pending"
          : "");

  return (
    <main className="min-h-dvh bg-[#071614] p-5 text-emerald-50">
      <div className="mx-auto max-w-lg space-y-4">
        <h1 className="text-xl font-semibold" dir="ltr">{o.id}</h1>
        {banner && (
          <p className={`rounded-xl p-3 text-sm ${o.paymentStatus === "paid" || state === "Payment Successful" ? "bg-emerald-900/60 text-amber-100" : o.paymentStatus === "failed" ? "bg-red-950/70" : "bg-white/10"}`}>
            {banner}
          </p>
        )}
        <p className="text-xs">وضعیت سفارش: {o.status} · پرداخت: {o.paymentStatus}</p>
        <ul className="text-sm">
          {o.items.map((i) => (
            <li key={i.name + i.variantKey}>
              {i.name} {i.variantKey} × {i.qty} @ {i.price} (−{i.discount})
            </li>
          ))}
        </ul>
        <p className="text-sm">ارسال: {o.delivery} · {o.addressSnapshot}</p>
        <p>کارمزد: {o.fee} · جمع: {o.total} {o.currency}</p>
        {row.payment && row.payment.status !== "confirmed" && (
          <div className="flex flex-wrap gap-2">
            {row.payment.method === "wallet" ? (
              <Button type="button" className="bg-amber-300 text-[#102824]" onClick={() => void act("payWallet", { confirm: true })}>
                پرداخت از Wallet
              </Button>
            ) : (
              <>
                <Button type="button" className="bg-amber-300 text-[#102824]" onClick={() => void act("paySandbox", { outcome: "success" })}>
                  شبیه‌سازی پرداخت موفق
                </Button>
                <Button type="button" variant="outline" onClick={() => void act("paySandbox", { outcome: "fail" })}>
                  ناموفق
                </Button>
                <Button type="button" variant="outline" onClick={() => void act("paySandbox", { outcome: "pending" })}>
                  Pending
                </Button>
              </>
            )}
          </div>
        )}
        {row.invoice && (
          <section className="rounded-xl border border-white/10 p-3 text-xs">
            <h2 className="text-sm font-medium">Invoice {row.invoice.id}</h2>
            <p>Payment Status: {row.invoice.paymentStatus}</p>
            <p>{new Date(row.invoice.createdAt).toLocaleString("fa-IR")}</p>
          </section>
        )}
        <div className="flex flex-wrap gap-2">
          <Button type="button" variant="outline" onClick={() => void act("cancel")}>لغو سفارش</Button>
          <Button type="button" variant="outline" onClick={() => void act("refund")}>درخواست Refund</Button>
        </div>
        <Input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="شرح اختلاف پرداخت" />
        <Button type="button" variant="ghost" onClick={() => void act("dispute", { reason })}>
          Payment Dispute
        </Button>
        <p className="text-[11px] text-emerald-100/50">وضعیت Paid فقط بعد از تأیید درگاه روی سرور است؛ این دکمه‌ها سندباکس‌اند نه کارت واقعی.</p>
        <Link href="/app/orders" className="block text-xs text-amber-200">تاریخچه سفارش</Link>
      </div>
    </main>
  );
}
