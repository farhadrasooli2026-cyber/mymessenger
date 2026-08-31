"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

const STEPS = ["سبد", "آدرس", "ارسال", "پرداخت", "خلاصه", "تأیید"] as const;

type Quote = {
  items: { name: string; qty: number; price: number; discount: number; variantKey: string; line: number }[];
  subtotal: number;
  discountTotal: number;
  deliveryFee: number;
  fee: number;
  feeBps: number;
  total: number;
  currency: string;
  delivery: { id: string; name: string; fee: number; eta: string } | undefined;
  shop: { delivery: { id: string; name: string; fee: number; eta: string }[]; currency: string; name: string };
};

type Addr = { id: string; label: string; line: string; city: string; country: string; isDefault: boolean };

export function CheckoutFlow({ businessId }: { businessId: string }) {
  const router = useRouter();
  const [step, setStep] = useState(0);
  const [coupon, setCoupon] = useState("");
  const [deliveryId, setDeliveryId] = useState("standard");
  const [q, setQ] = useState<Quote | null>(null);
  const [addresses, setAddresses] = useState<Addr[]>([]);
  const [addressId, setAddressId] = useState("");
  const [line, setLine] = useState("");
  const [city, setCity] = useState("");
  const [method, setMethod] = useState<"card" | "bank" | "wallet" | "other">("card");
  const [busy, setBusy] = useState(false);

  function loadQuote() {
    fetch(`/api/shop?view=quote&businessId=${businessId}&coupon=${encodeURIComponent(coupon)}&delivery=${deliveryId}`, { cache: "no-store" })
      .then((r) => r.json())
      .then((d) => {
        if (d.ok) setQ(d.quote);
      })
      .catch(() => undefined);
  }

  useEffect(() => {
    fetch(`/api/shop?view=quote&businessId=${businessId}&coupon=${encodeURIComponent(coupon)}&delivery=${deliveryId}`, { cache: "no-store" })
      .then((r) => r.json())
      .then((d) => {
        if (d.ok) setQ(d.quote);
      })
      .catch(() => undefined);
    fetch("/api/shop?view=addresses", { cache: "no-store" })
      .then((r) => r.json())
      .then((d) => {
        if (d.ok) {
          setAddresses(d.addresses ?? []);
          const def = (d.addresses as Addr[]).find((a) => a.isDefault) ?? d.addresses[0];
          if (def) setAddressId(def.id);
        }
      })
      .catch(() => undefined);
  }, [businessId, coupon, deliveryId]);

  async function addAddress() {
    const res = await fetch("/api/shop", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "address", label: "خانه", line, city, country: "IR", isDefault: true }),
    });
    const d = await res.json();
    if (!res.ok) {
      toast.error(d.error);
      return;
    }
    setAddressId(d.address.id);
    setAddresses((prev) => [...prev.filter((a) => a.id !== d.address.id), d.address]);
    toast.success("آدرس ذخیره شد.");
  }

  async function confirm() {
    setBusy(true);
    try {
      const res = await fetch("/api/shop", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "checkout",
          businessId,
          addressId,
          deliveryId,
          couponCode: coupon,
          method,
          clientTotal: q?.total,
          idempotencyKey: `chk:${businessId}:${Date.now()}`,
        }),
      });
      const d = await res.json();
      if (!res.ok) {
        toast.error(d.error);
        return;
      }
      router.push(`/app/orders/${d.order.id}?pay=${d.payment.id}`);
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="min-h-dvh bg-[#071614] p-5 text-emerald-50">
      <div className="mx-auto max-w-lg space-y-4">
        <h1 className="text-xl font-semibold">Checkout</h1>
        <p className="text-[11px] leading-6 text-emerald-100/60">
          قیمت، تخفیف و کارمزد روی سرور محاسبه می‌شود. شماره کارت را اینجا وارد نکن — نیکسو PAN را نمی‌پذیرد.
        </p>
        <ol className="flex flex-wrap gap-1 text-[10px] text-emerald-100/50">
          {STEPS.map((s, i) => (
            <li key={s} className={i === step ? "text-amber-200" : ""}>
              {i + 1}. {s}
            </li>
          ))}
        </ol>
        {step === 0 && (
          <ul className="space-y-1 text-sm">
            {!q?.items.length && <li className="text-emerald-100/50">سبد خالی است.</li>}
            {q?.items.map((i) => (
              <li key={i.name + i.variantKey}>
                {i.name} {i.variantKey} × {i.qty} = {i.line} {q.currency}
              </li>
            ))}
          </ul>
        )}
        {step === 1 && (
          <div className="space-y-2">
            {addresses.map((a) => (
              <label key={a.id} className="flex gap-2 rounded-lg border border-white/10 p-2 text-sm">
                <input type="radio" checked={addressId === a.id} onChange={() => setAddressId(a.id)} />
                {a.label}: {a.line}, {a.city}
                <button
                  type="button"
                  className="ms-auto text-[11px] text-amber-200"
                  onClick={() => void fetch("/api/shop", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "addressDelete", id: a.id }) }).then(() => setAddresses(addresses.filter((x) => x.id !== a.id)))}
                >
                  حذف
                </button>
              </label>
            ))}
            <Input value={line} onChange={(e) => setLine(e.target.value)} placeholder="خیابان و پلاک" />
            <Input value={city} onChange={(e) => setCity(e.target.value)} placeholder="شهر" />
            <Button type="button" variant="outline" onClick={() => void addAddress()}>
              Add Address
            </Button>
          </div>
        )}
        {step === 2 && (
          <div className="space-y-2">
            {(q?.shop.delivery ?? []).map((d) => (
              <label key={d.id} className="flex gap-2 rounded-lg border border-white/10 p-2 text-sm">
                <input type="radio" checked={deliveryId === d.id} onChange={() => setDeliveryId(d.id)} />
                {d.name} · {d.fee} {q?.currency} · {d.eta}
              </label>
            ))}
          </div>
        )}
        {step === 3 && (
          <div className="space-y-2 text-sm">
            {(["card", "bank", "wallet", "other"] as const).map((m) => (
              <label key={m} className="flex gap-2">
                <input type="radio" checked={method === m} onChange={() => setMethod(m)} />
                {m === "card" ? "Card (توکن سندباکس)" : m === "bank" ? "Bank Transfer" : m === "wallet" ? "NIXO Wallet" : "Other"}
              </label>
            ))}
          </div>
        )}
        {(step === 4 || step === 5) && q && (
          <div className="space-y-1 rounded-xl border border-white/10 p-3 text-sm">
            <p>جمع کالا: {q.subtotal} {q.currency}</p>
            <p>تخفیف: −{q.discountTotal}</p>
            <p>ارسال: {q.deliveryFee}</p>
            <p>کارمزد نیکسو ({q.feeBps / 100}%): {q.fee}</p>
            <p className="font-medium text-amber-200">قابل پرداخت: {q.total} {q.currency}</p>
            <Input value={coupon} onChange={(e) => setCoupon(e.target.value)} placeholder="کد کوپن مثل NIXO20" />
            <Button type="button" variant="outline" onClick={() => loadQuote()}>اعمال کوپن</Button>
          </div>
        )}
        <div className="flex gap-2">
          {step > 0 && (
            <Button type="button" variant="outline" onClick={() => setStep(step - 1)}>
              قبلی
            </Button>
          )}
          {step < 5 ? (
            <Button type="button" className="bg-amber-300 text-[#102824]" onClick={() => setStep(step + 1)}>
              بعدی
            </Button>
          ) : (
            <Button type="button" disabled={busy} className="bg-amber-300 text-[#102824]" onClick={() => void confirm()}>
              Confirm
            </Button>
          )}
        </div>
        <Link href={`/app/business/b/${businessId}`} className="text-xs text-amber-200">بازگشت به فروشگاه</Link>
      </div>
    </main>
  );
}
