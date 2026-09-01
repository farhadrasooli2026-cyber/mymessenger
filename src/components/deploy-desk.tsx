"use client";

import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

type Dash = {
  env: string;
  runtimeEnv: string;
  version: string;
  gitSha: string;
  lock: { kind: string; until: number } | null;
  metrics: { releases: number; failures: number; rollbacks: number; autoRollbacks: number; lastDurationMs: number };
  deployments: {
    id: string;
    version: string;
    env: string;
    status: string;
    strategy: string;
    emergency: boolean;
    notes: string;
    checks: Record<string, boolean>;
  }[];
  flags: { key: string; enabled: boolean; percent: number; segment: string; kill: boolean }[];
  config: { name: string; set: boolean; usesDevFallback: boolean }[];
  health: { ok: boolean; ready: boolean };
  owners: { service: string; owner: string }[];
  runbook: { id: string; title: string; steps: string }[];
};

export function DeployDesk() {
  const [dash, setDash] = useState<Dash | null>(null);
  const [denied, setDenied] = useState("");
  const [busy, setBusy] = useState(false);
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");

  const load = useCallback(() => {
    fetch("/api/deploy", { cache: "no-store" })
      .then((r) => r.json())
      .then((d) => {
        if (d.ok) {
          setDash(d);
          setDenied("");
        } else setDenied(d.error ?? "دسترسی انتشار نداری.");
      })
      .catch(() => setDenied("بارگذاری نشد."));
  }, []);

  useEffect(() => {
    load();
    const t = setInterval(load, 12_000);
    return () => clearInterval(t);
  }, [load]);

  async function act(body: Record<string, unknown>) {
    setBusy(true);
    try {
      const res = await fetch("/api/deploy", {
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
  if (!dash) return <p className="mt-4 text-sm text-amber-100/70">در حال بارگذاری انتشار…</p>;

  return (
    <div className="mt-4 space-y-4">
      <p className="text-xs text-amber-100/65">
        Staging قبل از Production. Secret در این صفحه نیست. پرچم جایگزین مجوز نیست. Rollback نشست و صف را پاک نمی‌کند.
      </p>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Card label="نسخه" value={dash.version} />
        <Card label="کاتالوگ" value={dash.env} />
        <Card label="Runtime" value={dash.runtimeEnv} />
        <Card label="Health" value={dash.health.ready ? "آماده" : "ناسالم"} />
        <Card label="انتشارها" value={String(dash.metrics.releases)} />
        <Card label="شکست" value={String(dash.metrics.failures)} />
        <Card label="Rollback" value={String(dash.metrics.rollbacks)} />
        <Card label="قفل" value={dash.lock ? dash.lock.kind : "آزاد"} />
      </div>
      <div className="flex flex-wrap gap-2">
        <Input className="max-w-xs" type="password" placeholder="رمز ادمین" value={password} onChange={(e) => setPassword(e.target.value)} />
        <Input className="max-w-xs" placeholder="DEPLOY_PRODUCTION / ROLLBACK / EMERGENCY_DEPLOY" value={confirm} onChange={(e) => setConfirm(e.target.value)} />
      </div>
      <div className="flex flex-wrap gap-2">
        <Button size="sm" disabled={busy} onClick={() => void act({ action: "staging", notes: "staging from desk", strategy: "rolling" })}>
          انتشار Staging
        </Button>
        <Button size="sm" variant="outline" disabled={busy} onClick={() => void act({ action: "production", password, confirm, strategy: "rolling" })}>
          Production
        </Button>
        <Button size="sm" variant="outline" disabled={busy} onClick={() => void act({ action: "production", password, confirm, strategy: "canary", canaryPct: 10 })}>
          Canary ۱۰٪
        </Button>
        <Button size="sm" variant="outline" disabled={busy} onClick={() => void act({ action: "emergency", password, confirm })}>
          اضطراری
        </Button>
        <Button size="sm" variant="outline" disabled={busy} onClick={() => void act({ action: "rollback", password, confirm })}>
          Rollback
        </Button>
      </div>
      <section className="rounded-2xl border border-white/10 bg-white/5 p-3 text-xs">
        <h3 className="text-sm font-medium">پرچم‌ها</h3>
        {dash.flags.map((f) => (
          <div key={f.key} className="mt-2 flex flex-wrap items-center justify-between gap-2">
            <span>
              {f.key} · {f.segment} {f.percent}% · {f.kill ? "کشته" : f.enabled ? "روشن" : "خاموش"}
            </span>
            <div className="flex gap-1">
              <Button size="xs" variant="outline" disabled={busy} onClick={() => void act({ action: "flag", key: f.key, enabled: true, kill: false, percent: 10, segment: "percent" })}>
                ۱۰٪
              </Button>
              <Button size="xs" variant="outline" disabled={busy} onClick={() => void act({ action: "flag", key: f.key, kill: true })}>
                قطع اضطراری
              </Button>
              <Button size="xs" variant="outline" disabled={busy} onClick={() => void act({ action: "flag", key: f.key, enabled: true, kill: false, percent: 100, segment: "all" })}>
                همه
              </Button>
            </div>
          </div>
        ))}
      </section>
      <section className="rounded-2xl border border-white/10 bg-white/5 p-3 text-xs">
        <h3 className="text-sm font-medium">تاریخچه</h3>
        {dash.deployments.length === 0 && <p className="mt-2 text-amber-100/60">انتشاری نیست.</p>}
        {dash.deployments.map((d) => (
          <p key={d.id} className="mt-1">
            {d.version} · {d.env} · {d.status} · {d.strategy}
            {d.emergency ? " · اضطراری" : ""} · {d.notes}
          </p>
        ))}
      </section>
      <section className="rounded-2xl border border-white/10 bg-white/5 p-3 text-xs">
        <h3 className="text-sm font-medium">پیکربندی (فقط نام)</h3>
        {dash.config.map((c) => (
          <p key={c.name}>
            {c.name}: {c.set ? "ست شده" : "خالی"}
            {c.usesDevFallback ? " · fallback توسعه" : ""}
          </p>
        ))}
      </section>
      <section className="rounded-2xl border border-white/10 bg-white/5 p-3 text-xs">
        <h3 className="text-sm font-medium">Runbook و مالکیت</h3>
        {dash.owners.map((o) => (
          <p key={o.service}>
            {o.service} → {o.owner}
          </p>
        ))}
        {dash.runbook.map((r) => (
          <p key={r.id} className="mt-2">
            <strong>{r.title}</strong> — {r.steps}
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
