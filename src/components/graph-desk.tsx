"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { useI18n } from "@/components/i18n-provider";
import type { RecItem } from "@/lib/graph-types";

const REASON: Record<string, string> = {
  "mutual-friends": "دوستان مشترک",
  "mutual-groups": "گروه مشترک",
  "mutual-channels": "کانال مشترک",
  "public-discovery": "کشف عمومی",
  "new-public": "محتوای عمومی تازه",
  "new-creator": "سازندهٔ تازه",
};

export function GraphDesk() {
  const { t } = useI18n();
  const [items, setItems] = useState<RecItem[]>([]);
  const [note, setNote] = useState("");
  const [personalize, setPersonalize] = useState(true);
  const [notify, setNotify] = useState(false);
  const [busy, setBusy] = useState(false);

  async function load() {
    setBusy(true);
    try {
      const res = await fetch("/api/graph", { cache: "no-store" });
      const data = await res.json();
      if (!res.ok) {
        toast.error(data.error ?? "پیشنهاد بار نشد.");
        return;
      }
      setItems(data.items ?? []);
      setNote(data.note ?? "");
      setPersonalize(data.personalize !== false);
      setNotify(Boolean(data.recNotify));
    } catch {
      toast.error("Network Error");
    } finally {
      setBusy(false);
    }
  }

  useEffect(() => {
    void load();
  }, []);

  async function act(body: Record<string, unknown>) {
    const res = await fetch("/api/graph", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const data = await res.json().catch(() => null);
    if (!res.ok) toast.error(data?.error ?? "انجام نشد.");
    return res.ok;
  }

  return (
    <section className="mb-4 rounded-2xl bg-white/5 p-4 text-sm text-emerald-50" aria-labelledby="nixo-graph-title">
      <div className="flex items-center justify-between gap-2">
        <h2 id="nixo-graph-title" className="font-medium">
          پیشنهادهای نیکسو
        </h2>
        <Button type="button" variant="secondary" className="h-8" onClick={() => void load()} disabled={busy}>
          {busy ? "…" : "تازه‌سازی"}
        </Button>
      </div>
      <p className="mt-1 text-[11px] leading-5 text-emerald-100/55">{note || t("graph.hint")}</p>
      <div className="mt-2 flex flex-wrap gap-3 text-[11px]">
        <label className="flex min-h-11 items-center gap-2">
          <input
            type="checkbox"
            checked={personalize}
            onChange={async (e) => {
              const on = e.target.checked;
              setPersonalize(on);
              await act({ action: "prefs", personalize: on });
              void load();
            }}
          />
          شخصی‌سازی پیشنهاد
        </label>
        <label className="flex min-h-11 items-center gap-2">
          <input
            type="checkbox"
            checked={notify}
            onChange={async (e) => {
              const on = e.target.checked;
              setNotify(on);
              await act({ action: "prefs", notify: on });
            }}
          />
          اعلان پیشنهاد (خاموش پیش‌فرض)
        </label>
      </div>
      {items.length === 0 && !busy ? (
        <p className="mt-3 text-xs text-emerald-100/50" role="status">
          پیشنهادی نیست. کانال و گروه عمومی تازه برای شروع سرد نمایش داده می‌شوند.
        </p>
      ) : (
        <ul className="mt-3 space-y-2">
          {items.map((it) => (
            <li key={`${it.kind}:${it.id}`} className="flex items-start justify-between gap-2 rounded-xl bg-black/25 px-3 py-2">
              <Link href={it.href} className="min-w-0 text-right" onClick={() => void act({ action: "feedback", kind: it.kind, id: it.id, feedback: "click" })}>
                <p className="truncate text-sm font-medium">{it.title}</p>
                <p className="truncate text-[11px] text-emerald-100/60">{it.subtitle}</p>
                <p className="text-[10px] text-amber-100/70">{REASON[it.reason] ?? it.reason}</p>
              </Link>
              <span className="flex shrink-0 flex-col gap-1">
                <button
                  type="button"
                  className="min-h-11 text-[10px] text-emerald-100/70"
                  onClick={() => void act({ action: "feedback", kind: it.kind, id: it.id, feedback: "hide" }).then(() => setItems((cur) => cur.filter((x) => x.id !== it.id)))}
                >
                  پنهان
                </button>
                <button
                  type="button"
                  className="min-h-11 text-[10px] text-rose-200/80"
                  onClick={() => void act({ action: "feedback", kind: it.kind, id: it.id, feedback: "not-interested" }).then(() => setItems((cur) => cur.filter((x) => x.id !== it.id)))}
                >
                  مناسب نیست
                </button>
              </span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
