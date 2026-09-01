"use client";

import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { CLOUD_CONFIRM, CLOUD_SERVICES } from "@/lib/cloud-types";

type Inst = {
  id: string;
  service: string;
  region: string;
  zone: string;
  state: string;
  cpuPct: number;
  memPct: number;
  inflight: number;
  ws: number;
};

type Dash = {
  ok: boolean;
  error?: string;
  env?: string;
  note?: string;
  policy?: {
    autoscaling: boolean;
    cooldownSec: number;
    budgetUsd: number;
    primaryRegion: string;
    secondaryRegion: string;
    services: Record<string, { min: number; max: number }>;
  };
  instances?: Inst[];
  events?: { id: string; at: number; action: string; service: string; reason: string; from: number; to: number }[];
  alerts?: { id: string; kind: string; detail: string }[];
  cost?: { hourly: number; month: number; budget: number };
  dataPlane?: { database: { poolMax: number; public: boolean; replicas: number }; objectStorage: boolean; cdn: boolean };
  access?: { canManage: boolean };
};

export function CloudDesk() {
  const [dash, setDash] = useState<Dash | null>(null);

  const load = useCallback(() => {
    fetch("/api/cloud", { cache: "no-store" })
      .then((r) => r.json())
      .then((d) => setDash(d))
      .catch(() => undefined);
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  async function act(body: Record<string, unknown>) {
    const res = await fetch("/api/cloud", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const data = await res.json();
    if (!data.ok) toast.error(data.error ?? "مجوز نیست");
    else toast.success("ثبت شد.");
    load();
  }

  if (!dash) return <p className="mt-4 text-sm text-amber-100/60">در حال بارگذاری ابر…</p>;
  if (!dash.ok) return <p className="mt-4 text-sm">{dash.error ?? "دسترسی نداری."}</p>;
  const p = dash.policy!;

  return (
    <div className="mt-4 space-y-4">
      <p className="text-xs text-amber-100/60">
        {dash.note} · env {dash.env} · {p.primaryRegion} / failover {p.secondaryRegion}
      </p>
      <div className="grid gap-3 sm:grid-cols-3">
        <div className="rounded-2xl border border-white/10 bg-white/5 p-3">
          <p className="text-[11px] text-amber-100/60">Auto Scaling</p>
          <p className="text-lg">{p.autoscaling ? "روشن" : "خاموش"}</p>
          <p className="text-xs">Cooldown {p.cooldownSec}s · بودجه {p.budgetUsd} USD</p>
        </div>
        <div className="rounded-2xl border border-white/10 bg-white/5 p-3">
          <p className="text-[11px] text-amber-100/60">هزینهٔ برآوردی</p>
          <p className="text-lg">{dash.cost?.month ?? 0} / {dash.cost?.budget} USD</p>
          <p className="text-xs">{dash.cost?.hourly} USD/ساعت</p>
        </div>
        <div className="rounded-2xl border border-white/10 bg-white/5 p-3">
          <p className="text-[11px] text-amber-100/60">Data plane</p>
          <p className="text-xs">DB pool {dash.dataPlane?.database.poolMax} · عمومی نیست</p>
          <p className="text-xs">Object storage {dash.dataPlane?.objectStorage ? "بله" : "خیر"} · CDN {dash.dataPlane?.cdn ? "بله" : "خیر"}</p>
        </div>
      </div>
      {dash.access?.canManage && (
        <div className="flex flex-wrap gap-2">
          <Button type="button" size="sm" variant="secondary" onClick={() => void act({ action: "tick" })}>
            ارزیابی Scale
          </Button>
          <Button type="button" size="sm" variant="secondary" onClick={() => void act({ action: "policy", autoscaling: !p.autoscaling })}>
            {p.autoscaling ? "خاموش کردن Auto Scale" : "روشن کردن Auto Scale"}
          </Button>
          <Button type="button" size="sm" variant="secondary" onClick={() => void act({ action: "scale-up", service: "api" })}>
            + API
          </Button>
          <Button type="button" size="sm" variant="secondary" onClick={() => void act({ action: "scale-in", service: "api" })}>
            Drain API
          </Button>
          <Button type="button" size="sm" variant="secondary" onClick={() => void act({ action: "failover", confirm: CLOUD_CONFIRM.failover })}>
            Failover منطقه
          </Button>
          <Button type="button" size="sm" variant="secondary" onClick={() => void act({ action: "loadtest", confirm: CLOUD_CONFIRM.loadtest })}>
            Load test
          </Button>
          <Button type="button" size="sm" variant="secondary" onClick={() => void act({ action: "chaos", confirm: CLOUD_CONFIRM.chaos, service: "api" })}>
            Chaos (غیر Production)
          </Button>
          <Button type="button" size="sm" variant="secondary" onClick={() => void act({ action: "restore-drill" })}>
            تمرین Restore
          </Button>
        </div>
      )}
      <section>
        <h3 className="text-sm font-medium">سقف سرویس</h3>
        <ul className="mt-2 grid gap-2 sm:grid-cols-2 text-xs">
          {CLOUD_SERVICES.map((s) => (
            <li key={s} className="rounded-xl border border-white/10 px-3 py-2">
              {s}: min {p.services[s]?.min} / max {p.services[s]?.max}
            </li>
          ))}
        </ul>
      </section>
      <section>
        <h3 className="text-sm font-medium">Instanceها</h3>
        <ul className="mt-2 max-h-64 space-y-1 overflow-auto text-xs">
          {(dash.instances ?? []).map((i) => (
            <li key={i.id} className="flex justify-between gap-2 rounded-lg bg-white/5 px-2 py-1">
              <span>
                {i.service} · {i.zone} · {i.state}
              </span>
              <span>
                CPU {i.cpuPct}% · RAM {i.memPct}% · in {i.inflight} · ws {i.ws}
              </span>
            </li>
          ))}
        </ul>
      </section>
      {(dash.alerts ?? []).length > 0 && (
        <section className="text-xs text-amber-200">
          {(dash.alerts ?? []).map((a) => (
            <p key={a.id}>{a.kind}: {a.detail}</p>
          ))}
        </section>
      )}
      <ul className="text-[11px] opacity-70">
        {(dash.events ?? []).slice(0, 8).map((e) => (
          <li key={e.id}>
            {e.action} {e.service} {e.from}→{e.to} — {e.reason}
          </li>
        ))}
      </ul>
    </div>
  );
}
