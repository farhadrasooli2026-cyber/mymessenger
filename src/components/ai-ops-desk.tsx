"use client";

import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { AI_FEATURE_KEYS } from "@/lib/ai-types";

type Dash = {
  ok: boolean;
  error?: string;
  policy?: {
    enabled: boolean;
    primaryProvider: string;
    fallbackProvider: string;
    promptVersion: string;
    requireCredits: boolean;
    creditCost: number;
    costCapUsd: number;
    estimatedUsdSpent: number;
    features: Record<string, boolean>;
    experimentName: string;
    experimentPercent: number;
    rollout: string;
  };
  analytics?: {
    requests: number;
    errors: number;
    isolation: number;
    fallbacks: number;
    jobs: number;
    evals: { id: string; score: number; promptVersion: string; notes: string }[];
  };
  access?: { canManage: boolean };
};

export function AiOpsDesk() {
  const [dash, setDash] = useState<Dash | null>(null);

  const load = useCallback(() => {
    fetch("/api/ai/ops", { cache: "no-store" })
      .then((r) => r.json())
      .then((d) => setDash(d))
      .catch(() => undefined);
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  async function act(body: Record<string, unknown>) {
    const res = await fetch("/api/ai/ops", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const data = await res.json();
    if (!data.ok) toast.error(data.error ?? "مجوز نیست");
    else toast.success("ثبت شد.");
    load();
  }

  if (!dash) return <p className="mt-4 text-sm text-amber-100/60">در حال بارگذاری کنترل AI…</p>;
  if (!dash.ok) return <p className="mt-4 text-sm">{dash.error ?? "دسترسی نداری."}</p>;
  const p = dash.policy!;

  return (
    <div className="mt-4 space-y-4">
      <p className="text-xs text-amber-100/60">
        لایهٔ AI جدا از پیام‌رسانی است. خاموش کردن دستیار، ورود و چت را قطع نمی‌کند. کلید Provider به کلاینت نمی‌آید.
      </p>
      <div className="grid gap-3 sm:grid-cols-3">
        <div className="rounded-2xl border border-white/10 bg-white/5 p-3">
          <p className="text-[11px] text-amber-100/60">وضعیت</p>
          <p className="text-lg">{p.enabled ? "فعال" : "خاموش (Kill)"}</p>
          <p className="text-xs">Provider {p.primaryProvider} → {p.fallbackProvider}</p>
        </div>
        <div className="rounded-2xl border border-white/10 bg-white/5 p-3">
          <p className="text-[11px] text-amber-100/60">هزینهٔ برآوردی</p>
          <p className="text-lg">{p.estimatedUsdSpent.toFixed(3)} / {p.costCapUsd} USD</p>
          <p className="text-xs">پرامپت {p.promptVersion} · {p.rollout}</p>
        </div>
        <div className="rounded-2xl border border-white/10 bg-white/5 p-3">
          <p className="text-[11px] text-amber-100/60">تجمیع</p>
          <p className="text-xs">درخواست {dash.analytics?.requests ?? 0}</p>
          <p className="text-xs">ایزوله {dash.analytics?.isolation ?? 0} · fallback {dash.analytics?.fallbacks ?? 0}</p>
        </div>
      </div>
      {dash.access?.canManage && (
        <div className="flex flex-wrap gap-2">
          <Button type="button" size="sm" variant="secondary" onClick={() => void act({ action: "enable", enabled: true })}>
            روشن
          </Button>
          <Button type="button" size="sm" variant="destructive" onClick={() => void act({ action: "kill" })}>
            Kill AI
          </Button>
          <Button type="button" size="sm" variant="secondary" onClick={() => void act({ action: "rollback" })}>
            Rollback پرامپت
          </Button>
          <Button type="button" size="sm" variant="secondary" onClick={() => void act({ action: "eval" })}>
            Evaluation
          </Button>
          <Button type="button" size="sm" variant="secondary" onClick={() => void act({ action: "set", primaryProvider: "local", fallbackProvider: "local" })}>
            Provider محلی
          </Button>
          <Button type="button" size="sm" variant="secondary" onClick={() => void act({ action: "set", primaryProvider: "mock", fallbackProvider: "local" })}>
            Mock + Fallback
          </Button>
        </div>
      )}
      <section>
        <h3 className="text-sm font-medium">قابلیت‌ها</h3>
        <div className="mt-2 flex flex-wrap gap-1">
          {AI_FEATURE_KEYS.map((k) => (
            <Button
              key={k}
              type="button"
              size="xs"
              variant={p.features[k] ? "default" : "secondary"}
              onClick={() => void act({ action: "set", feature: k, featureOn: !p.features[k] })}
            >
              {k}
            </Button>
          ))}
        </div>
      </section>
      <section className="rounded-2xl border border-white/10 p-3 text-xs">
        <p>آزمایش A/B</p>
        <form
          className="mt-2 flex flex-wrap gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            const fd = new FormData(e.currentTarget);
            void act({
              action: "set",
              experimentName: String(fd.get("name") ?? ""),
              experimentPercent: Number(fd.get("pct") ?? 0),
            });
          }}
        >
          <Input name="name" placeholder="نام آزمایش" className="max-w-40" defaultValue={p.experimentName} />
          <Input name="pct" type="number" placeholder="%" className="w-20" defaultValue={p.experimentPercent ?? 0} />
          <Button type="submit" size="sm">ثبت</Button>
        </form>
      </section>
      <ul className="text-xs opacity-80">
        {(dash.analytics?.evals ?? []).map((e) => (
          <li key={e.id}>
            eval {e.promptVersion}: {e.score} — {e.notes}
          </li>
        ))}
      </ul>
    </div>
  );
}
