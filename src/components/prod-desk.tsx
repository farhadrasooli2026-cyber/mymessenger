"use client";

import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

type Dash = {
  ok: boolean;
  error?: string;
  score: number;
  ready: boolean;
  freeze: boolean;
  freezeReason: string;
  env: string;
  version: string;
  blocking: { id: string; detail: string }[];
  checklist: { id: string; title: string; ok: boolean }[];
  smoke: { id: string; title: string; ok: boolean; detail: string }[];
  audits: { id: string; title: string; items: { name: string; ok: boolean; note: string }[] }[];
  rtoRpo: Record<string, { rtoMin: number; rpoMin: number }>;
  access: { canManage: boolean };
  note: string;
  incidents: { id: string; title: string; open: boolean; severity: string }[];
};

export function ProdDesk() {
  const [dash, setDash] = useState<Dash | null>(null);
  const [confirm, setConfirm] = useState("");
  const [reason, setReason] = useState("");

  const load = useCallback(() => {
    fetch("/api/prod", { cache: "no-store" })
      .then((r) => r.json())
      .then((d) => setDash(d))
      .catch(() => undefined);
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  async function act(body: Record<string, unknown>) {
    const res = await fetch("/api/prod", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const data = await res.json();
    if (!data.ok) toast.error(data.error ?? "مجوز نیست");
    else toast.success("ثبت شد.");
    load();
  }

  if (!dash) return <p className="mt-4 text-sm text-amber-100/60">در حال بارگذاری آمادگی…</p>;
  if (!dash.ok) return <p className="mt-4 text-sm">{dash.error ?? "دسترسی نداری."}</p>;

  return (
    <div className="mt-4 space-y-4">
      <p className="text-xs text-amber-100/60">
        {dash.note} · env {dash.env} · app {dash.version}
      </p>
      <div className="grid gap-3 sm:grid-cols-3">
        <div className="rounded-2xl border border-white/10 bg-white/5 p-3">
          <p className="text-[11px] text-amber-100/60">امتیاز آمادگی</p>
          <p className="text-2xl font-semibold">{dash.score}</p>
          <p className="text-xs">{dash.ready ? "آستانهٔ انتشار داخلی پاس شد" : "برای Production کافی نیست"}</p>
        </div>
        <div className="rounded-2xl border border-white/10 bg-white/5 p-3">
          <p className="text-[11px] text-amber-100/60">یخ‌زدگی</p>
          <p className="text-lg">{dash.freeze ? "فعال" : "خاموش"}</p>
          {dash.freezeReason ? <p className="text-xs">{dash.freezeReason}</p> : null}
        </div>
        <div className="rounded-2xl border border-white/10 bg-white/5 p-3">
          <p className="text-[11px] text-amber-100/60">مسدودکننده</p>
          <p className="text-lg">{dash.blocking.length}</p>
        </div>
      </div>
      {dash.blocking.map((b) => (
        <p key={b.id} className="text-sm text-red-200">
          {b.detail}
        </p>
      ))}
      <div className="flex flex-wrap gap-2">
        <Button size="sm" onClick={() => void act({ action: "smoke" })}>
          اجرای Smoke داخلی
        </Button>
        {dash.access.canManage && (
          <>
            <Input className="max-w-xs" placeholder="PROD_FREEZE / PROD_THAW / PROD_APPROVE" value={confirm} onChange={(e) => setConfirm(e.target.value)} />
            <Input className="max-w-xs" placeholder="دلیل یخ‌زدگی" value={reason} onChange={(e) => setReason(e.target.value)} />
            <Button size="sm" variant="outline" onClick={() => void act({ action: "freeze", confirm, reason })}>
              یخ‌زدگی انتشار
            </Button>
            <Button size="sm" variant="ghost" onClick={() => void act({ action: "thaw", confirm })}>
              رفع یخ
            </Button>
            <Button size="sm" onClick={() => void act({ action: "approve", confirm })}>
              تأیید آمادگی
            </Button>
          </>
        )}
      </div>
      <section>
        <h3 className="text-sm font-medium">چک‌لیست Production</h3>
        <ul className="mt-2 grid gap-1 text-sm sm:grid-cols-2">
          {dash.checklist.map((c) => (
            <li key={c.id}>
              {c.ok ? "✓" : "○"} {c.title}
            </li>
          ))}
        </ul>
      </section>
      <section>
        <h3 className="text-sm font-medium">Smoke</h3>
        <ul className="mt-2 columns-2 text-xs">
          {dash.smoke.map((s) => (
            <li key={s.id} className="mb-1">
              {s.ok ? "✓" : "×"} {s.title}
            </li>
          ))}
        </ul>
      </section>
      {dash.audits.map((a) => (
        <section key={a.id}>
          <h3 className="text-sm font-medium">{a.title}</h3>
          <ul className="mt-1 text-xs text-amber-100/80">
            {a.items.map((i) => (
              <li key={i.name}>
                {i.ok ? "✓" : "×"} {i.name} — {i.note}
              </li>
            ))}
          </ul>
        </section>
      ))}
      <p className="text-xs text-amber-100/50">
        RTO هویت {dash.rtoRpo.identity?.rtoMin} دقیقه · RPO پیام {dash.rtoRpo.messaging?.rpoMin} دقیقه
      </p>
    </div>
  );
}
