"use client";

import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { BI_DESKS, BI_RANGES, type BiDesk, type BiRange } from "@/lib/bi-types";

type Dash = Record<string, unknown> & {
  ok?: boolean;
  error?: string;
  access?: { canManage?: boolean; canReliability?: boolean; canSecurity?: boolean };
  growth?: { current?: Record<string, number | null>; previous?: Record<string, number | null> | null };
  privacy?: { note?: string };
  pipeline?: { healthy?: boolean; flushed?: number; lastError?: string | null; failures?: number };
  definitions?: { id: string; title: string; formula: string }[];
  experiments?: { key: string; status: string; percent: number; metric: string }[];
};

function MetricCard({ label, value, prev }: { label: string; value: unknown; prev?: unknown }) {
  return (
    <div className="rounded-2xl border border-white/10 bg-white/5 p-3">
      <p className="text-[11px] text-amber-100/60">{label}</p>
      <p className="text-lg font-semibold">{value == null ? "—" : String(value)}</p>
      {prev != null && prev !== undefined && <p className="text-[11px] text-amber-100/50">بازهٔ قبل: {String(prev)}</p>}
    </div>
  );
}

export function BiDesk() {
  const [dash, setDash] = useState<Dash | null>(null);
  const [range, setRange] = useState<BiRange>("7d");
  const [compare, setCompare] = useState(true);
  const [desk, setDesk] = useState<BiDesk | "all">("admin");
  const [country, setCountry] = useState("");
  const [locale, setLocale] = useState("");
  const [expKey, setExpKey] = useState("new_composer");
  const [busy, setBusy] = useState(false);

  const load = useCallback(() => {
    const q = new URLSearchParams({ range, compare: compare ? "1" : "0", desk });
    if (country) q.set("country", country);
    if (locale) q.set("locale", locale);
    fetch(`/api/bi?${q.toString()}`, { cache: "no-store" })
      .then((r) => r.json())
      .then((d: Dash) => setDash(d))
      .catch(() => undefined);
  }, [range, compare, desk, country, locale]);

  useEffect(() => {
    const t = window.setTimeout(() => load(), 0);
    return () => window.clearTimeout(t);
  }, [load]);

  async function act(body: Record<string, unknown>) {
    setBusy(true);
    try {
      const res = await fetch("/api/bi", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      const data = await res.json();
      if (!data.ok) {
        toast.error(data.error ?? "خطا");
        return;
      }
      toast.success("انجام شد.");
      load();
    } finally {
      setBusy(false);
    }
  }

  if (!dash) return <p className="mt-4 text-sm text-amber-100/70">در حال بارگذاری تحلیل…</p>;
  if (dash.ok === false) return <p className="mt-4 text-sm">{dash.error}</p>;

  const g = dash.growth?.current ?? {};
  const p = dash.growth?.previous ?? {};
  const product = (dash.product ?? {}) as Record<string, unknown>;
  const messaging = (product.messaging ?? {}) as Record<string, unknown>;
  const reliability = dash.reliability as Record<string, unknown> | undefined;
  const security = dash.security as Record<string, unknown> | undefined;
  const storage = (dash.storage ?? {}) as Record<string, unknown>;
  const calls = (dash.calls ?? {}) as Record<string, unknown>;
  const search = (dash.search ?? {}) as Record<string, unknown>;
  const business = (dash.business ?? {}) as Record<string, unknown>;
  const cost = (dash.cost ?? {}) as Record<string, unknown>;
  const quality = (dash.quality ?? {}) as Record<string, unknown>;
  const segments = (dash.segments ?? {}) as Record<string, Record<string, number>>;
  const funnel = ((product.funnel ?? {}) as Record<string, number>) || {};

  return (
    <div className="mt-4 space-y-4 text-sm">
      <h2 className="text-lg font-semibold">تحلیل محصول و کسب‌وکار</h2>
      <p className="text-xs text-amber-100/70">{String(dash.privacy?.note ?? "")} این لایه ابزار نظارت مخفی نیست.</p>
      <div className="flex flex-wrap gap-2">
        {BI_RANGES.map((r) => (
          <Button key={r} size="sm" variant={range === r ? "default" : "ghost"} onClick={() => setRange(r)}>
            {r}
          </Button>
        ))}
        <Button size="sm" variant={compare ? "default" : "outline"} onClick={() => setCompare((v) => !v)}>
          مقایسه با بازهٔ قبل
        </Button>
      </div>
      <div className="flex flex-wrap gap-1" role="tablist" aria-label="میزهای تحلیل">
        {([...BI_DESKS, "all"] as const).map((d) => (
          <Button key={d} size="sm" variant={desk === d ? "default" : "ghost"} onClick={() => setDesk(d)}>
            {d}
          </Button>
        ))}
      </div>
      <div className="flex flex-wrap gap-2">
        <Input className="max-w-[8rem]" placeholder="کشور ISO" value={country} onChange={(e) => setCountry(e.target.value)} />
        <Input className="max-w-[8rem]" placeholder="زبان" value={locale} onChange={(e) => setLocale(e.target.value)} />
        <Button size="sm" variant="outline" onClick={() => load()}>
          فیلتر
        </Button>
      </div>

      {(desk === "admin" || desk === "growth" || desk === "all") && (
        <section>
          <h3 className="mb-2 font-medium">رشد</h3>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <MetricCard label="DAU" value={g.dau} prev={p.dau} />
            <MetricCard label="WAU" value={g.wau} prev={p.wau} />
            <MetricCard label="MAU" value={g.mau} prev={p.mau} />
            <MetricCard label="کاربر جدید" value={g.newUsers} prev={p.newUsers} />
            <MetricCard label="Retention ۷روز %" value={g.retention7d} prev={p.retention7d} />
            <MetricCard label="Churn %" value={g.churnRate} prev={p.churnRate} />
            <MetricCard label="بازگشته" value={g.returning} prev={p.returning} />
            <MetricCard label="نشست‌ها" value={g.sessions} prev={p.sessions} />
          </div>
        </section>
      )}

      {(desk === "engagement" || desk === "all") && (
        <section>
          <h3 className="mb-2 font-medium">تعامل</h3>
          <p className="text-xs text-amber-100/60">فرکانس نشست: {String((dash.engagement as { sessionFreq?: number } | undefined)?.sessionFreq ?? "—")}</p>
        </section>
      )}

      {(desk === "product" || desk === "all") && (
        <section>
          <h3 className="mb-2 font-medium">محصول</h3>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <MetricCard label="پاکت پیام" value={messaging.envelopes} />
            <MetricCard label="Delivery %" value={messaging.deliveryRate} />
            <MetricCard label="Read %" value={messaging.readRate} />
            <MetricCard label="P95 تحویل ms" value={messaging.p95DeliveryMs} />
          </div>
          <p className="mt-2 text-xs text-amber-100/60">
            قیف ثبت‌نام: شروع {funnel.registerStart ?? 0} → تأیید {funnel.registerVerify ?? 0} → پروفایل {funnel.onboarding ?? 0} · ورود موفق {funnel.loginOk ?? 0} / ناموفق {funnel.loginFail ?? 0}
          </p>
        </section>
      )}

      {(desk === "reliability" || desk === "all") && (
        <section>
          <h3 className="mb-2 font-medium">پایداری</h3>
          {reliability?.withheld ? (
            <p className="text-xs">{String(reliability.reason)}</p>
          ) : (
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              <MetricCard label="Error %" value={reliability?.errorRate} />
              <MetricCard label="میانگین تأخیر" value={reliability?.avgLatencyMs} />
              <MetricCard label="P99 تأخیر" value={reliability?.p99LatencyMs} />
              <MetricCard label="Availability" value={reliability?.availability} />
              <MetricCard label="Rate limit" value={reliability?.rateLimitHits} />
              <MetricCard label="Crash کلاینت" value={reliability?.crashes} />
              <MetricCard label="حادثه" value={reliability?.incidents} />
              <MetricCard label="هشدار" value={reliability?.alerts} />
            </div>
          )}
        </section>
      )}

      {(desk === "security" || desk === "all") && (
        <section>
          <h3 className="mb-2 font-medium">امنیت (تجمیعی)</h3>
          {security?.withheld ? (
            <p className="text-xs">{String(security.reason)}</p>
          ) : (
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              <MetricCard label="ورود ناموفق" value={security?.loginFails} />
              <MetricCard label="نرخ ناموفق %" value={security?.loginFailRate} />
              <MetricCard label="رد مجوز" value={security?.permissionDenies} />
              <MetricCard label="حادثه امنیتی" value={security?.incidents} />
            </div>
          )}
        </section>
      )}

      {(desk === "storage" || desk === "all") && (
        <section>
          <h3 className="mb-2 font-medium">ذخیره‌سازی</h3>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <MetricCard label="شیء" value={storage.objects} />
            <MetricCard label="بایت" value={storage.bytes} />
            <MetricCard label="آپلود" value={storage.uploads} />
            <MetricCard label="دانلود" value={storage.downloads} />
          </div>
        </section>
      )}

      {(desk === "call" || desk === "all") && (
        <section>
          <h3 className="mb-2 font-medium">تماس</h3>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <MetricCard label="تماس" value={calls.total} />
            <MetricCard label="ویدیو" value={calls.video} />
            <MetricCard label="Drop %" value={calls.dropRate} />
            <MetricCard label="P95 RTT" value={calls.p95RttMs} />
          </div>
        </section>
      )}

      {(desk === "search" || desk === "all") && (
        <section>
          <h3 className="mb-2 font-medium">جستجو</h3>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <MetricCard label="Query" value={search.queries} />
            <MetricCard label="موفقیت %" value={search.successRate} />
            <MetricCard label="تأخیر" value={search.latencyMs} />
            <MetricCard label="خطا" value={search.errors} />
          </div>
        </section>
      )}

      {(desk === "business" || desk === "all") && (
        <section>
          <h3 className="mb-2 font-medium">کسب‌وکار</h3>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <MetricCard label="پرداخت موفق" value={business.paymentOk} />
            <MetricCard label="نرخ موفقیت %" value={business.paymentSuccessRate} />
            <MetricCard label="درآمد تجمیعی" value={business.revenueAggregate} />
            <MetricCard label="Refund %" value={business.refundRate} />
            <MetricCard label="ARPU" value={business.arpu} />
            <MetricCard label="برآورد Storage $" value={cost.storageUsdMonth} />
            <MetricCard label="برآورد پهنای باند $" value={cost.bandwidthUsd} />
          </div>
        </section>
      )}

      <section>
        <h3 className="mb-2 font-medium">بخش‌بندی مجاز (تجمیعی)</h3>
        <p className="text-xs text-amber-100/60">کشور {JSON.stringify(segments.country ?? {})} · زبان {JSON.stringify(segments.language ?? {})}</p>
        <p className="text-xs text-amber-100/60">دستگاه {JSON.stringify(segments.device ?? {})} · OS {JSON.stringify(segments.os ?? {})}</p>
      </section>

      <section>
        <h3 className="mb-2 font-medium">کیفیت داده و لوله</h3>
        <p className="text-xs">
          Raw {String(quality.rawEvents)} · Daily {String(quality.dailyRows)} · Completeness {String(quality.completeness)}% · لوله{" "}
          {dash.pipeline?.healthy ? "سالم" : "خطا"} · flush {dash.pipeline?.flushed ?? 0}
          {dash.pipeline?.lastError ? ` · ${dash.pipeline.lastError}` : ""}
        </p>
      </section>

      <section>
        <h3 className="mb-2 font-medium">تعریف متریک</h3>
        <ul className="list-disc ps-5 text-xs text-amber-100/70">
          {(dash.definitions ?? []).map((d) => (
            <li key={d.id}>
              <strong>{d.title}:</strong> {d.formula}
            </li>
          ))}
        </ul>
      </section>

      {dash.access?.canManage && (
        <section className="rounded-2xl border border-white/10 bg-white/5 p-4">
          <h3 className="font-medium">آزمایش A/B</h3>
          <p className="mt-1 text-xs text-amber-100/60">گروه‌ها روی شناسهٔ هش‌شده‌اند. آزمایش مجوز امنیتی نمی‌دهد. Rollback فوری است.</p>
          <div className="mt-2 flex flex-wrap gap-2">
            <Input className="max-w-[12rem]" value={expKey} onChange={(e) => setExpKey(e.target.value)} />
            <Button size="sm" disabled={busy} onClick={() => void act({ action: "experiment.upsert", key: expKey, percent: 50, metric: "engagement.dau" })}>
              شروع/به‌روز
            </Button>
            <Button size="sm" variant="outline" disabled={busy} onClick={() => void act({ action: "experiment.rollback", key: expKey })}>
              Rollback
            </Button>
            <Button size="sm" variant="ghost" disabled={busy} onClick={() => void act({ action: "purge" })}>
              حذف دادهٔ تحلیل
            </Button>
          </div>
          <ul className="mt-2 text-xs">
            {(dash.experiments ?? []).map((e) => (
              <li key={e.key}>
                {e.key} · {e.status} · {e.percent}% · {e.metric}
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
