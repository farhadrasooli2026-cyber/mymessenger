"use client";

import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { formatCurrency } from "@/lib/i18n/format";

type Dash = {
  ok: boolean;
  error?: string;
  revenueUsd: number;
  paymentOk: number;
  paymentFail: number;
  refunds: number;
  refundAmountUsd: number;
  counts: Record<string, number>;
  review: { id: string; amount: number; currency: string; riskScore?: number }[];
  chargebacks: { id: string; status: string; amount: number }[];
  invoices: { number: string; status: string; total: number; currency: string; userHint: string }[];
  audit: { at: number; action: string; detail: string; actorHint: string }[];
  access: { canRefund: boolean; canManage: boolean; export: boolean };
  note: string;
};

export function FinanceDesk() {
  const [dash, setDash] = useState<Dash | null>(null);
  const [code, setCode] = useState("SAVE15");
  const [percent, setPercent] = useState("15");

  const load = useCallback(() => {
    fetch("/api/billing?view=finance", { cache: "no-store" })
      .then((r) => r.json())
      .then((d) => setDash(d))
      .catch(() => undefined);
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  async function act(body: Record<string, unknown>) {
    const res = await fetch("/api/billing", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const data = await res.json();
    if (!data.ok) toast.error(data.error ?? "مجوز نیست");
    else toast.success("ثبت شد.");
    load();
    return data;
  }

  if (!dash) return <p className="mt-4 text-sm text-amber-100/60">در حال بارگذاری مالی…</p>;
  if (!dash.ok) {
    return <p className="mt-4 text-sm text-amber-100/70">{dash.error ?? "دسترسی مالی نداری."}</p>;
  }

  return (
    <div className="mt-4 space-y-4">
      <p className="text-xs text-amber-100/60">{dash.note}</p>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Metric label="درآمد USD" value={formatCurrency(dash.revenueUsd, { locale: "fa", country: "US" }, "USD")} />
        <Metric label="پرداخت موفق" value={String(dash.paymentOk)} />
        <Metric label="ناموفق" value={String(dash.paymentFail)} />
        <Metric label="استرداد" value={`${dash.refunds} / ${formatCurrency(dash.refundAmountUsd, { locale: "fa" }, "USD")}`} />
      </div>
      <div className="grid gap-2 sm:grid-cols-3 text-sm">
        {Object.entries(dash.counts).map(([k, v]) => (
          <p key={k} className="rounded-xl border border-white/10 bg-white/5 p-2">
            {k}: {v}
          </p>
        ))}
      </div>
      {dash.review.length > 0 && (
        <section>
          <h3 className="text-sm font-medium">بررسی دستی</h3>
          {dash.review.map((r) => (
            <div key={r.id} className="mt-2 flex items-center justify-between text-xs">
              <span>
                {r.id.slice(0, 8)} · {r.amount} {r.currency}
              </span>
              {dash.access.canManage && (
                <Button size="xs" variant="outline" onClick={() => void act({ action: "finance", op: "review.clear", id: r.id })}>
                  تأیید بررسی
                </Button>
              )}
            </div>
          ))}
        </section>
      )}
      {dash.access.canManage && (
        <div className="flex flex-wrap gap-2">
          <Input className="max-w-32" value={code} onChange={(e) => setCode(e.target.value)} />
          <Input className="max-w-20" value={percent} onChange={(e) => setPercent(e.target.value)} />
          <Button size="sm" onClick={() => void act({ action: "finance", op: "coupon.upsert", code, percent: Number(percent), days: 30 })}>
            ثبت کوپن
          </Button>
        </div>
      )}
      {dash.access.export && (
        <Button
          size="sm"
          variant="outline"
          onClick={() =>
            void fetch("/api/billing", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ action: "finance_export" }),
            })
              .then((r) => r.json())
              .then((d) => {
                if (!d.ok) toast.error(d.error);
                else toast.message(d.csv);
              })
          }
        >
          خروجی CSV تجمیعی
        </Button>
      )}
      <section>
        <h3 className="text-sm font-medium">حسابرسی مالی (فقط‌خواندنی)</h3>
        {dash.audit.slice(0, 12).map((a) => (
          <p key={`${a.at}-${a.action}`} className="mt-1 text-xs text-amber-100/70">
            {a.action} · {a.detail} · {a.actorHint}
          </p>
        ))}
      </section>
    </div>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-2xl border border-white/10 bg-white/5 p-3">
      <p className="text-[11px] text-amber-100/60">{label}</p>
      <p className="text-lg font-semibold">{value}</p>
    </div>
  );
}
