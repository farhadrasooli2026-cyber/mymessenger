"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { toast } from "sonner";
import { NixoMark } from "@/components/nixo-mark";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { formatCurrency } from "@/lib/i18n/format";

type Plan = {
  id: string;
  name: string;
  description: string;
  family: boolean;
  trialDays: number;
  prices: { month: number; year: number };
  entitlements: string[];
};

type Me = {
  subscription: {
    planId: string;
    status: string;
    interval: string;
    currency: string;
    price: number;
    autoRenew: boolean;
    cancelAtPeriodEnd: boolean;
    periodEnd: number;
    seats: number;
  } | null;
  entitlements: string[];
  status: string;
  intents: { id: string; status: string; amount: number; currency: string; createdAt: number }[];
  invoices: { number: string; status: string; total: number; currency: string; tax: number; taxLabel: string; createdAt: number }[];
  refunds: { id: string; status: string; amount: number; currency: string }[];
  methods: { id: string; brand: string; last4: string }[];
  credits: Record<string, number>;
  history: { at: number; from: string; to: string; note: string }[];
  note: string;
};

export function BillingDesk() {
  const [plans, setPlans] = useState<Plan[]>([]);
  const [currency, setCurrency] = useState("USD");
  const [me, setMe] = useState<Me | null>(null);
  const [coupon, setCoupon] = useState("");
  const [busy, setBusy] = useState(false);
  const [display, setDisplay] = useState("");
  const [country, setCountry] = useState("IR");
  const [nudge, setNudge] = useState(0);
  const [tokenRef, setTokenRef] = useState("tok_sandbox_4242");

  const load = useCallback(() => {
    fetch("/api/billing?view=plans", { cache: "no-store" })
      .then((r) => r.json())
      .then((d) => {
        if (d.ok) {
          setPlans(d.plans ?? []);
          setCurrency(d.currency ?? "USD");
        }
      })
      .catch(() => undefined);
    fetch("/api/billing?view=me", { cache: "no-store" })
      .then((r) => r.json())
      .then((d) => {
        if (d.ok) {
          setMe(d as Me);
          if (d.customer?.display) setDisplay(d.customer.display);
          if (d.customer?.country) setCountry(d.customer.country);
        }
      })
      .catch(() => undefined);
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  async function post(body: Record<string, unknown>) {
    setBusy(true);
    try {
      const res = await fetch("/api/billing", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = await res.json();
      if (!data.ok) {
        toast.error(data.error ?? "خطا");
        return data;
      }
      return data;
    } finally {
      setBusy(false);
    }
  }

  async function subscribe(planId: string, interval: "month" | "year", trial?: boolean) {
    setNudge((n) => n + 1);
    const key = `idem_${planId}_${interval}_${nudge}`;
    const started = await post({
      action: "checkout",
      planId,
      interval,
      coupon: coupon || undefined,
      trial: Boolean(trial),
      idempotencyKey: key,
    });
    if (!started?.ok || !started.intent?.id) return;
    if (started.review) {
      toast.message("پرداخت برای بررسی دستی صف شد.");
      load();
      return;
    }
    const done = await post({ action: "confirm", intentId: started.intent.id, outcome: "success" });
    if (done?.ok) toast.success("اشتراک فعال شد.");
    load();
  }

  return (
    <main className="min-h-dvh bg-[#071614] p-5 text-emerald-50">
      <div className="mx-auto max-w-lg space-y-5 pb-16">
        <div className="flex items-center gap-2">
          <NixoMark size={36} />
          <div>
            <p className="text-xs text-amber-200">Settings → اشتراک</p>
            <h1 className="text-xl font-semibold">اشتراک و صورتحساب نیکسو</h1>
          </div>
        </div>
        <p className="text-sm text-amber-100/70">
          Entitlement در سرور اعمال می‌شود. شماره کارت و CVV اینجا پذیرفته نمی‌شود. کیف پول فروشگاه جدا از اعتبار اشتراک است.
        </p>
        {me && (
          <section className="rounded-2xl border border-white/10 bg-white/5 p-4 text-sm">
            <p>
              وضعیت: <strong>{me.status}</strong>
              {me.subscription ? ` · ${me.subscription.planId} · ${me.subscription.status}` : " · پلن رایگان"}
            </p>
            {me.subscription && (
              <p className="mt-1 text-xs text-amber-100/60">
                {formatCurrency(me.subscription.price, { locale: "fa", country }, me.subscription.currency)} /{" "}
                {me.subscription.interval}
                {me.subscription.cancelAtPeriodEnd ? " · لغو در پایان دوره" : ""}
              </p>
            )}
            <p className="mt-2 text-xs">ویژگی‌ها: {me.entitlements.join("، ") || "core.messaging"}</p>
            <p className="mt-1 text-xs">اعتبار: USD {me.credits.USD ?? 0}</p>
            <div className="mt-3 flex flex-wrap gap-2">
              {me.subscription && me.subscription.status !== "cancelled" && (
                <>
                  <Button size="sm" variant="outline" disabled={busy} onClick={() => void post({ action: "cancel", mode: "period_end" }).then(load)}>
                    لغو در پایان دوره
                  </Button>
                  <Button size="sm" variant="ghost" disabled={busy} onClick={() => void post({ action: "cancel", mode: "immediate" }).then(load)}>
                    لغو فوری
                  </Button>
                </>
              )}
              {me.subscription && (me.subscription.status === "cancelled" || me.subscription.status === "expired") && (
                <Button size="sm" disabled={busy} onClick={() => void post({ action: "reactivate" }).then(load)}>
                  فعال‌سازی دوباره
                </Button>
              )}
            </div>
          </section>
        )}
        <Input placeholder="کد تخفیف (مثلاً WELCOME10)" value={coupon} onChange={(e) => setCoupon(e.target.value)} />
        <div className="grid gap-3">
          {plans.map((p) => (
            <article key={p.id} className="rounded-2xl border border-white/10 bg-white/5 p-4">
              <h2 className="font-semibold">{p.name}</h2>
              <p className="mt-1 text-xs text-amber-100/70">{p.description}</p>
              <p className="mt-2 text-sm">
                ماهانه {formatCurrency(p.prices.month, { locale: "fa", country }, currency)} · سالانه{" "}
                {formatCurrency(p.prices.year, { locale: "fa", country }, currency)}
              </p>
              {p.id !== "free" && (
                <div className="mt-3 flex flex-wrap gap-2">
                  <Button size="sm" disabled={busy} onClick={() => void subscribe(p.id, "month")}>
                    ماهانه
                  </Button>
                  <Button size="sm" variant="outline" disabled={busy} onClick={() => void subscribe(p.id, "year")}>
                    سالانه
                  </Button>
                  {p.trialDays > 0 && (
                    <Button size="sm" variant="ghost" disabled={busy} onClick={() => void subscribe(p.id, "month", true)}>
                      آزمایش {p.trialDays} روزه
                    </Button>
                  )}
                </div>
              )}
            </article>
          ))}
        </div>
        <section className="space-y-2 rounded-2xl border border-white/10 bg-white/5 p-4">
          <h2 className="text-sm font-medium">پروفایل صورتحساب (جدا از پروفایل کاربری)</h2>
          <Input placeholder="نام روی فاکتور" value={display} onChange={(e) => setDisplay(e.target.value)} />
          <Input placeholder="کشور (IR)" value={country} onChange={(e) => setCountry(e.target.value)} />
          <Button
            size="sm"
            disabled={busy}
            onClick={() => void post({ action: "profile", display, country }).then(() => toast.success("ذخیره شد."))}
          >
            ذخیره آدرس صورتحساب
          </Button>
          <Input placeholder="توکن درگاه tok_…" value={tokenRef} onChange={(e) => setTokenRef(e.target.value)} />
          <Button
            size="sm"
            variant="outline"
            disabled={busy}
            onClick={() => void post({ action: "method", tokenRef, last4: "4242", brand: "sandbox" }).then(load)}
          >
            ثبت روش پرداخت توکن‌شده
          </Button>
        </section>
        <section className="rounded-2xl border border-white/10 bg-white/5 p-4 text-sm">
          <h2 className="font-medium">فاکتور و رسید</h2>
          {!me?.invoices.length && <p className="mt-2 text-xs text-amber-100/60">فاکتوری نیست.</p>}
          {me?.invoices.map((inv) => (
            <p key={inv.number} className="mt-2 text-xs">
              {inv.number} · {inv.status} · {formatCurrency(inv.total, { locale: "fa", country }, inv.currency)} · مالیات {inv.taxLabel}
            </p>
          ))}
        </section>
        <section className="rounded-2xl border border-white/10 bg-white/5 p-4 text-sm">
          <h2 className="font-medium">تاریخچه پرداخت</h2>
          {!me?.intents.length && <p className="mt-2 text-xs text-amber-100/60">پرداختی نیست.</p>}
          {me?.intents.map((i) => (
            <div key={i.id} className="mt-2 flex items-center justify-between text-xs">
              <span>
                {i.status} · {formatCurrency(i.amount, { locale: "fa", country }, i.currency)}
              </span>
              {i.status === "succeeded" && (
                <Button size="xs" variant="ghost" onClick={() => void post({ action: "refund_request", intentId: i.id }).then(load)}>
                  درخواست استرداد
                </Button>
              )}
            </div>
          ))}
        </section>
        <p className="text-xs text-amber-100/50">{me?.note}</p>
        <Link href="/app/settings/shop" className="block text-sm text-amber-200">
          کیف پول و فروشگاه کسب‌وکار →
        </Link>
      </div>
    </main>
  );
}
