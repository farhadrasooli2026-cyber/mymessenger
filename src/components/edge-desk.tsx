"use client";

import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { EDGE_CONFIRM } from "@/lib/edge-types";

type Dash = {
  ok: boolean;
  error?: string;
  env?: string;
  note?: string;
  config?: {
    version: number;
    cacheGeneration: number;
    originHost: string;
    originShield: boolean;
    waf: boolean;
    http3: boolean;
    signedTtlSec: number;
    canaryPct: number;
    residencyLock: string;
  };
  pops?: { id: string; region: string; healthy: boolean; rttMs: number; capacityPct: number; turn: boolean }[];
  route?: { id: string; region: string };
  cache?: { hitRatio: number; hits: number; misses: number; api: string; media: string };
  latency?: { p50: number; p95: number; p99: number };
  budget?: { apiP95Ms: number; lcpMs: number };
  cost?: { bandwidthGb: number; usdMonth: number };
  access?: { canManage: boolean };
};

export function EdgeDesk() {
  const [dash, setDash] = useState<Dash | null>(null);

  const load = useCallback(() => {
    fetch("/api/edge", { cache: "no-store" })
      .then((r) => r.json())
      .then(setDash)
      .catch(() => undefined);
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  async function act(body: Record<string, unknown>) {
    const res = await fetch("/api/edge", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const data = await res.json();
    if (!data.ok) toast.error(data.error ?? "مجوز نیست");
    else toast.success("ثبت شد.");
    load();
  }

  if (!dash) return <p className="mt-4 text-sm text-amber-100/60">در حال بارگذاری لبه…</p>;
  if (!dash.ok) return <p className="mt-4 text-sm">{dash.error ?? "دسترسی نداری."}</p>;
  const c = dash.config!;

  return (
    <div className="mt-4 space-y-4">
      <p className="text-xs text-amber-100/60">{dash.note} · env {dash.env} · origin {c.originHost}</p>
      <div className="grid gap-3 sm:grid-cols-3">
        <div className="rounded-2xl border border-white/10 bg-white/5 p-3">
          <p className="text-[11px] text-amber-100/60">Cache hit</p>
          <p className="text-2xl font-semibold">{dash.cache?.hitRatio ?? 0}%</p>
          <p className="text-xs">gen {c.cacheGeneration} · v{c.version}</p>
        </div>
        <div className="rounded-2xl border border-white/10 bg-white/5 p-3">
          <p className="text-[11px] text-amber-100/60">Latency</p>
          <p className="text-xs">P50 {dash.latency?.p50}ms · P95 {dash.latency?.p95}ms · P99 {dash.latency?.p99}ms</p>
          <p className="text-xs">بودجه API P95 {dash.budget?.apiP95Ms}ms</p>
        </div>
        <div className="rounded-2xl border border-white/10 bg-white/5 p-3">
          <p className="text-[11px] text-amber-100/60">هزینه CDN</p>
          <p className="text-lg">{dash.cost?.usdMonth} USD</p>
          <p className="text-xs">{dash.cost?.bandwidthGb} GB · HTTP/3 {c.http3 ? "بله" : "خیر"}</p>
        </div>
      </div>
      {dash.access?.canManage && (
        <div className="flex flex-wrap gap-2">
          <Button type="button" size="sm" variant="secondary" onClick={() => void act({ action: "purge", confirm: EDGE_CONFIRM.purge, prefix: "/_next/static" })}>
            Purge استاتیک
          </Button>
          <Button type="button" size="sm" variant="secondary" onClick={() => void act({ action: "synthetic" })}>
            Synthetic
          </Button>
          <Button type="button" size="sm" variant="secondary" onClick={() => void act({ action: "canary", confirm: EDGE_CONFIRM.canary, canaryPct: 10 })}>
            Canary ۱۰٪
          </Button>
          <Button type="button" size="sm" variant="secondary" onClick={() => void act({ action: "rollback", confirm: EDGE_CONFIRM.rollback })}>
            Rollback لبه
          </Button>
          <Button type="button" size="sm" variant="secondary" onClick={() => void act({ action: "auto-rollback" })}>
            بررسی Auto-Rollback
          </Button>
        </div>
      )}
      <ul className="grid gap-2 sm:grid-cols-2 text-xs">
        {(dash.pops ?? []).map((p) => (
          <li key={p.id} className="flex justify-between rounded-xl border border-white/10 px-3 py-2">
            <span>
              {p.id} · {p.region} · {p.healthy ? "سالم" : "خارج"} · {p.rttMs}ms
            </span>
            {dash.access?.canManage && (
              <button type="button" className="text-amber-200" onClick={() => void act({ action: "pop", pop: p.id, healthy: !p.healthy })}>
                {p.healthy ? "خارج کردن" : "سالم"}
              </button>
            )}
          </li>
        ))}
      </ul>
      <p className="text-xs opacity-70">
        مسیر فعلی: {dash.route?.id} · API cache: {dash.cache?.api} · رسانه: {dash.cache?.media} · Signed TTL {c.signedTtlSec}s
      </p>
    </div>
  );
}
