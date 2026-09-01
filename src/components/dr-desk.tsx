"use client";

import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

type Dash = {
  policy: { autoEnabled: boolean; rpoMs: number; rtoMs: number; fullEveryMs: number; incrEveryMs: number };
  mode: string;
  site: string;
  generation: number;
  rpoMet: boolean;
  rpoLagMs: number | null;
  isolated: boolean;
  credentialIsolated: boolean;
  downloadForbidden: boolean;
  priority: string[];
  runbook: { step: number; title: string; detail: string }[];
  points: {
    id: string;
    kind: string;
    class: string;
    tier: string;
    bytes: number;
    createdAt: number;
    verifiedAt: number | null;
    restoreTestAt: number | null;
    immutable: boolean;
    offsite: boolean;
  }[];
  jobs: { id: string; type: string; status: string; durationMs: number; checkpoint: string; error: string | null; createdAt: number }[];
  audits: { id: string; at: number; action: string; result: string }[];
  confirm: { restoreProduction: string; failover: string; failback: string; mode: string };
};

export function DrDesk() {
  const [dash, setDash] = useState<Dash | null>(null);
  const [denied, setDenied] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [busy, setBusy] = useState(false);
  const [picked, setPicked] = useState("");

  const load = useCallback(() => {
    fetch("/api/dr", { cache: "no-store" })
      .then((r) => r.json())
      .then((d) => {
        if (d.ok) {
          setDash(d);
          setDenied("");
        } else setDenied(d.error ?? "دسترسی بازیابی نداری.");
      })
      .catch(() => setDenied("بارگذاری نشد."));
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  async function act(body: Record<string, unknown>) {
    setBusy(true);
    try {
      const res = await fetch("/api/dr", {
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
  if (!dash) return <p className="mt-4 text-sm text-amber-100/70">در حال بارگذاری بازیابی…</p>;

  return (
    <div className="mt-4 space-y-4">
      <p className="text-xs text-amber-100/65">
        پشتیبان رمزنگاری‌شده، جدا از Production و Offsite است. دانلود عمومی خاموش است. Restore روی Production فقط با رمز و{" "}
        {dash.confirm.restoreProduction}.
      </p>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Card label="حالت" value={dash.mode} />
        <Card label="سایت" value={dash.site} />
        <Card label="نسل قفل" value={String(dash.generation)} />
        <Card label="RPO" value={dash.rpoMet ? "در هدف" : "خارج از هدف"} />
      </div>
      <p className="text-xs">
        ایزوله {dash.isolated ? "بله" : "خیر"} · کلید پشتیبان جدا {dash.credentialIsolated ? "بله" : "خیر"} · دانلود API{" "}
        {dash.downloadForbidden ? "ممنوع" : "باز"} · RTO {Math.round(dash.policy.rtoMs / 3600000)}ساعت
      </p>

      <section className="rounded-2xl border border-white/10 bg-white/5 p-3">
        <h2 className="text-sm font-medium">کارها</h2>
        <div className="mt-2 flex flex-wrap gap-2">
          <Button size="sm" disabled={busy} onClick={() => void act({ action: "backup", kind: "full" })}>
            Full Backup
          </Button>
          <Button size="sm" variant="outline" disabled={busy} onClick={() => void act({ action: "backup", kind: "incremental" })}>
            Incremental
          </Button>
          <Button size="sm" variant="outline" disabled={busy} onClick={() => void act({ action: "backup", kind: "differential" })}>
            Differential
          </Button>
          <Button size="sm" variant="ghost" disabled={busy} onClick={() => void act({ action: "validate" })}>
            اعتبارسنجی Recovery
          </Button>
        </div>
        <Input className="mt-3" type="password" placeholder="رمز ادمین برای عملیات مخرب" value={password} onChange={(e) => setPassword(e.target.value)} />
        <Input className="mt-2" placeholder="عبارت تأیید" value={confirm} onChange={(e) => setConfirm(e.target.value)} />
        <div className="mt-2 flex flex-wrap gap-2">
          <Button size="xs" variant="outline" disabled={busy} onClick={() => void act({ action: "mode", mode: "maintenance", password, confirm })}>
            Maintenance ({dash.confirm.mode})
          </Button>
          <Button size="xs" variant="outline" disabled={busy} onClick={() => void act({ action: "mode", mode: "read_only", password, confirm })}>
            Read-Only
          </Button>
          <Button size="xs" variant="outline" disabled={busy} onClick={() => void act({ action: "mode", mode: "normal", password, confirm })}>
            عادی
          </Button>
          <Button size="xs" variant="destructive" disabled={busy} onClick={() => void act({ action: "failover", password, confirm })}>
            Failover ({dash.confirm.failover})
          </Button>
          <Button size="xs" variant="outline" disabled={busy} onClick={() => void act({ action: "failback", password, confirm })}>
            Failback ({dash.confirm.failback})
          </Button>
        </div>
      </section>

      <section className="rounded-2xl border border-white/10 bg-white/5 p-3">
        <h2 className="text-sm font-medium">Restore Pointها</h2>
        {dash.points.length === 0 && <p className="mt-2 text-xs text-amber-100/60">هنوز پشتیبان DR ساخته نشده.</p>}
        {dash.points.map((p) => (
          <div key={p.id} className="mt-2 flex flex-wrap items-center justify-between gap-2 text-xs">
            <button type="button" className="text-start text-amber-200" onClick={() => setPicked(p.id)}>
              {p.kind} · {p.tier} · {p.class} · {Math.round(p.bytes / 1024)} KB · {p.offsite ? "offsite" : "local"} ·{" "}
              {p.immutable ? "immutable" : "قابل چرخش"}
            </button>
            <span className="flex gap-1">
              <Button size="xs" variant="outline" disabled={busy} onClick={() => void act({ action: "verify", id: p.id })}>
                Verify
              </Button>
              <Button size="xs" variant="outline" disabled={busy} onClick={() => void act({ action: "preview", id: p.id })}>
                Preview
              </Button>
              <Button size="xs" variant="outline" disabled={busy} onClick={() => void act({ action: "restore-test", id: p.id })}>
                Restore Test
              </Button>
            </span>
          </div>
        ))}
        {picked && (
          <div className="mt-3 rounded-xl border border-amber-400/30 p-2 text-xs">
            نقطه {picked.slice(0, 8)} انتخاب شد.
            <Button
              className="ms-2"
              size="xs"
              variant="destructive"
              disabled={busy}
              onClick={() => void act({ action: "restore", id: picked, password, confirm })}
            >
              Restore Production
            </Button>
            <Button className="ms-2" size="xs" variant="ghost" disabled={busy} onClick={() => void act({ action: "rollback", password, confirm })}>
              Rollback
            </Button>
          </div>
        )}
      </section>

      <section className="grid gap-3 lg:grid-cols-2">
        <div className="rounded-2xl border border-white/10 bg-white/5 p-3 text-xs">
          <h3 className="text-sm font-medium">صف کار</h3>
          {dash.jobs.map((j) => (
            <p key={j.id} className="mt-1">
              {j.type} · {j.status} · {j.checkpoint} · {j.durationMs}ms {j.error ? `· ${j.error}` : ""}
            </p>
          ))}
        </div>
        <div className="rounded-2xl border border-white/10 bg-white/5 p-3 text-xs">
          <h3 className="text-sm font-medium">اولویت و Runbook</h3>
          <p className="mt-1">{dash.priority.join(" → ")}</p>
          <ol className="mt-2 list-decimal pe-4">
            {dash.runbook.map((s) => (
              <li key={s.step} className="mt-1">
                <span className="font-medium">{s.title}:</span> {s.detail}
              </li>
            ))}
          </ol>
        </div>
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
