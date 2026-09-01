"use client";

import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";

type Dash = {
  shed: string;
  policy: { minInstances: number; maxInstances: number; workerConcurrency: number; cpuTargetPct: number; loadShed: boolean };
  metrics: { jobsDone: number; jobsFailed: number; jobsDead: number; cacheHits: number; cacheMisses: number; shedSoft: number; shedHard: number; circuitOpens: number; heapMb: number; leakSuspect: boolean };
  queues: { perf: number; search: number; push: number; media: number; vault: number; delayMs: number; dead: number };
  jobs: { id: string; kind: string; status: string; priority: number; retries: number; durationMs: number }[];
  bench: { samples: number; scanMs: number; indexMs: number; faster: boolean };
  pool: { writer: number; queryTimeoutMs: number; shardKey: string };
  http: { http2: boolean; compressSafe: boolean; apiCache: string };
  privacy: { cacheStoresCiphertext: boolean; cacheStoresSecrets: boolean };
};

export function PerfDesk() {
  const [dash, setDash] = useState<Dash | null>(null);
  const [denied, setDenied] = useState("");
  const [busy, setBusy] = useState(false);

  const load = useCallback(() => {
    fetch("/api/perf", { cache: "no-store" })
      .then((r) => r.json())
      .then((d) => {
        if (d.ok) {
          setDash(d);
          setDenied("");
        } else setDenied(d.error ?? "دسترسی عملکرد نداری.");
      })
      .catch(() => setDenied("بارگذاری نشد."));
  }, []);

  useEffect(() => {
    load();
    const t = setInterval(load, 10_000);
    return () => clearInterval(t);
  }, [load]);

  async function act(body: Record<string, unknown>) {
    setBusy(true);
    try {
      const res = await fetch("/api/perf", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = await res.json();
      if (!data.ok) toast.error(data.error ?? "خطا");
      else toast.success("ثبت شد.");
      load();
    } finally {
      setBusy(false);
    }
  }

  if (denied) return <p className="mt-4 text-sm text-amber-100/70">{denied}</p>;
  if (!dash) return <p className="mt-4 text-sm text-amber-100/70">در حال بارگذاری عملکرد…</p>;

  return (
    <div className="mt-4 space-y-4">
      <p className="text-xs text-amber-100/65">
        بهینه‌سازی صف، کش و Load Shed است. کش پیام رمزشده یا رمز را نگه نمی‌دارد. Login و پیام در اولویت می‌مانند.
      </p>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Card label="Shed" value={dash.shed} />
        <Card label="صف‌ها" value={String(dash.queues.perf + dash.queues.search + dash.queues.push)} />
        <Card label="Dead letter" value={String(dash.queues.dead)} />
        <Card label="Heap" value={`${dash.metrics.heapMb} MB`} />
        <Card label="Cache hit/miss" value={`${dash.metrics.cacheHits}/${dash.metrics.cacheMisses}`} />
        <Card label="Worker همزمان" value={String(dash.policy.workerConcurrency)} />
        <Card label="نمونه Index" value={`${dash.bench.indexMs} ms`} />
        <Card label="نمونه Scan" value={`${dash.bench.scanMs} ms`} />
      </div>
      <p className="text-xs">
        Pool نویسنده {dash.pool.writer} · Timeout کوئری {dash.pool.queryTimeoutMs}ms · Shard {dash.pool.shardKey} · HTTP/2{" "}
        {dash.http.http2 ? "بله" : "خیر"} · API Cache {dash.http.apiCache}
      </p>
      <p className="text-xs">
        حریم کش: ciphertext {dash.privacy.cacheStoresCiphertext ? "بله" : "خیر"} · secret {dash.privacy.cacheStoresSecrets ? "بله" : "خیر"} · نشت حافظه{" "}
        {dash.metrics.leakSuspect ? "مشکوک" : "خیر"}
      </p>
      <div className="flex flex-wrap gap-2">
        <Button size="sm" disabled={busy} onClick={() => void act({ action: "drain" })}>
          اجرای Worker
        </Button>
        <Button size="sm" variant="outline" disabled={busy} onClick={() => void act({ action: "enqueue", kind: "index", targetId: "manual" })}>
          صف Index
        </Button>
        <Button size="sm" variant="outline" disabled={busy} onClick={() => void act({ action: "policy", shed: "off" })}>
          Shed خاموش
        </Button>
        <Button size="sm" variant="outline" disabled={busy} onClick={() => void act({ action: "policy", shed: "soft" })}>
          Shed نرم
        </Button>
        <Button size="sm" variant="outline" disabled={busy} onClick={() => void act({ action: "policy", shed: "hard" })}>
          Shed سخت
        </Button>
      </div>
      <section className="rounded-2xl border border-white/10 bg-white/5 p-3 text-xs">
        <h3 className="text-sm font-medium">کارهای پس‌زمینه</h3>
        {dash.jobs.length === 0 && <p className="mt-2 text-amber-100/60">صف خالی است.</p>}
        {dash.jobs.map((j) => (
          <p key={j.id} className="mt-1">
            {j.kind} · {j.status} · p{j.priority} · retry {j.retries} · {j.durationMs}ms
          </p>
        ))}
      </section>
    </div>
  );
}

function Card({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-2xl border border-white/10 bg-white/5 p-3">
      <p className="text-[11px] text-amber-100/60">{label}</p>
      <p className="text-lg font-semibold">{value}</p>
    </div>
  );
}
