"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { toast } from "sonner";
import { NixoMark } from "@/components/nixo-mark";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { formatCallClock, formatCallWhen, CALL_RINGTONES } from "@/lib/call-copy";

type Row = {
  id: string;
  peerName: string;
  kind: string;
  direction: string;
  status: string;
  createdAt: number;
  endedAt: number | null;
  durationMs: number;
  group?: boolean;
  participantCount?: number;
};

type Dash = {
  ice: { stunConfigured: boolean; turnConfigured: boolean; turnRest: boolean; region: string; failover: string };
  quality: { samples: number; avgRttMs: number; avgLoss: number; avgJitterMs: number; ended: number; failed: number; video: number };
  counts: { total: number; missed: number; failed: number; group: number; live: number };
  durationMs: number;
  failureRate: number;
  signaling: { samples: number; region: string };
  recording: string;
  events: { kind: string; at: number; callId: string }[];
};

const FILTERS = [
  { id: "all", label: "همه" },
  { id: "incoming", label: "ورودی" },
  { id: "outgoing", label: "خروجی" },
  { id: "missed", label: "بی‌پاسخ" },
  { id: "voice", label: "صوتی" },
  { id: "video", label: "تصویری" },
  { id: "group", label: "گروهی" },
];

export function CallCenterDesk() {
  const [dash, setDash] = useState<Dash | null>(null);
  const [calls, setCalls] = useState<Row[]>([]);
  const [filter, setFilter] = useState("all");
  const [q, setQ] = useState("");
  const [cursor, setCursor] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const loadDash = useCallback(async () => {
    const d = await fetch("/api/calls?view=center", { cache: "no-store" }).then((r) => r.json());
    if (d.ok) setDash(d as Dash);
  }, []);

  const loadPage = useCallback(
    async (next?: string | null, append = false) => {
      const params = new URLSearchParams({ page: "1", limit: "20", filter });
      if (q.trim()) params.set("q", q.trim());
      if (next) params.set("cursor", next);
      const list = await fetch(`/api/calls?${params}`, { cache: "no-store" }).then((r) => r.json());
      if (list.ok) {
        setCalls((prev) => (append ? [...prev, ...(list.calls ?? [])] : (list.calls ?? [])));
        setCursor(list.nextCursor ?? null);
      }
    },
    [filter, q],
  );

  useEffect(() => {
    const t = window.setTimeout(() => {
      void loadDash();
      void loadPage(null, false);
    }, 0);
    return () => window.clearTimeout(t);
  }, [loadDash, loadPage]);

  async function clearMine() {
    setBusy(true);
    const res = await fetch("/api/calls", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "clear-history" }),
    });
    const data = await res.json();
    setBusy(false);
    if (!res.ok) toast.error(data.error ?? "پاک نشد.");
    else {
      toast.success("سابقهٔ این حساب پاک شد.");
      void loadPage(null, false);
      void loadDash();
    }
  }

  return (
    <main className="min-h-dvh bg-[#071614] p-5 text-emerald-50">
      <div className="mx-auto max-w-lg space-y-4">
        <div className="flex items-center gap-2">
          <NixoMark size={36} />
          <div>
            <p className="text-xs text-amber-200">تنظیمات ← تماس</p>
            <h1 className="text-xl font-semibold">مرکز تماس نیکسو</h1>
          </div>
        </div>
        <p className="text-xs leading-6 text-emerald-100/65">
          تماس صوتی و تصویری یک‌به‌یک و گروهی با شناسهٔ تصادفی. Signaling و ICE فقط برای شرکت‌کنندهٔ مجاز است. تغییر Call ID یا User ID ورود به تماس دیگری نمی‌دهد. ضبط تماس خاموش است.
        </p>
        {dash && (
          <section className="rounded-2xl bg-white/5 p-4 text-sm">
            <h2 className="font-medium">سلامت و کیفیت</h2>
            <p className="mt-2 text-xs leading-6 opacity-80">
              تماس‌ها {dash.counts.total} · زنده {dash.counts.live} · بی‌پاسخ {dash.counts.missed} · گروهی {dash.counts.group} · شکست {dash.failureRate}٪ · مدت {formatCallClock(dash.durationMs)}
            </p>
            <p className="mt-1 text-[11px] opacity-70">
              STUN {dash.ice.stunConfigured ? "فعال" : "خاموش"} · TURN {dash.ice.turnConfigured ? "پیکربندی‌شده" : "اختیاری"} · منطقه {dash.signaling.region} · RTT میانگین {dash.quality.avgRttMs}ms · Loss {dash.quality.avgLoss}%
            </p>
            <p className="mt-2 text-[11px] leading-5 text-amber-100/80">{dash.ice.failover}</p>
            <p className="mt-2 text-[11px] leading-5 opacity-70">{dash.recording}</p>
          </section>
        )}
        <section className="rounded-2xl bg-white/5 p-4 text-sm">
          <h2 className="font-medium">سابقهٔ خصوصی</h2>
          <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="جستجوی نام یا نوع" className="mt-2 h-9 bg-black/20" />
          <div className="mt-2 flex flex-wrap gap-1">
            {FILTERS.map((f) => (
              <button
                key={f.id}
                type="button"
                className={`rounded-full px-3 py-1 text-[11px] ${filter === f.id ? "bg-amber-300 text-[#102824]" : "bg-white/10"}`}
                onClick={() => setFilter(f.id)}
              >
                {f.label}
              </button>
            ))}
          </div>
          <ul className="mt-3 space-y-2">
            {calls.length === 0 && <li className="text-xs opacity-50">تماسی در این فیلتر نیست.</li>}
            {calls.map((c) => (
              <li key={c.id} className="rounded-xl border border-white/10 p-3 text-xs">
                <p className="font-medium">
                  {c.peerName} · {c.kind === "video" ? "تصویری" : "صوتی"}
                  {c.group ? ` · گروه (${c.participantCount ?? 0})` : ""}
                </p>
                <p className="mt-1 opacity-70">
                  {c.direction === "in" ? "ورودی" : "خروجی"} · {c.status} · {formatCallWhen(c.createdAt)} · {formatCallClock(c.durationMs)}
                </p>
              </li>
            ))}
          </ul>
          {cursor && (
            <Button type="button" variant="secondary" className="mt-3" onClick={() => void loadPage(cursor, true)}>
              صفحه بعد
            </Button>
          )}
          <div className="mt-3 flex flex-wrap gap-2">
            <Button type="button" variant="secondary" disabled={busy} onClick={() => void clearMine()}>
              پاک‌کردن سابقهٔ من
            </Button>
            <Button
              type="button"
              variant="secondary"
              onClick={() =>
                void fetch("/api/calls", {
                  method: "POST",
                  headers: { "Content-Type": "application/json" },
                  body: JSON.stringify({ action: "sweep" }),
                }).then(() => {
                  toast.success("اتاق خالی و سیگنال کهنه پاک شد.");
                  void loadDash();
                })
              }
            >
              پاک‌سازی اتاق و سیگنال
            </Button>
          </div>
        </section>
        {dash && dash.events.length > 0 && (
          <section className="rounded-2xl bg-white/5 p-4 text-sm">
            <h2 className="font-medium">رویدادهای اخیر این حساب</h2>
            <ul className="mt-2 space-y-1 text-[11px] opacity-75">
              {dash.events.map((e, i) => (
                <li key={`${e.at}-${i}`}>
                  {e.kind} · {formatCallWhen(e.at)}
                </li>
              ))}
            </ul>
          </section>
        )}
        <p className="text-[11px] leading-5 opacity-60">
          Mute اعلان را قطع می‌کند نه تماس. Block روی ساخت و Signaling اعمال می‌شود. رسانه با DTLS/SRTP مرورگر رمز می‌شود؛ ارتباط Signaling روی HTTPS است.
        </p>
        <Link href="/app" className="block text-sm text-amber-200">
          بازگشت به پیام‌رسان
        </Link>
        <Link href="/app/settings/privacy" className="block text-sm text-amber-200">
          تنظیمات → حریم خصوصی تماس
        </Link>
        <section className="rounded-2xl bg-white/5 p-4 text-sm">
          <h2 className="font-medium">زنگ، لرزش و اعلان</h2>
          <p className="mt-1 text-[11px] opacity-70">اعلان ورودی می‌تواند بی‌صدا باشد. مجوز میکروفون را مرورگر می‌پرسد؛ بدون اجازه تماس ناقص شروع نمی‌شود.</p>
          <div className="mt-2 flex flex-wrap gap-2">
            {CALL_RINGTONES.map((r) => (
              <Button
                key={r.id}
                type="button"
                size="sm"
                variant="secondary"
                onClick={() => {
                  void fetch("/api/calls/settings", {
                    method: "PATCH",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ callRingtone: r.id }),
                  }).then((res) => {
                    if (res.ok) toast.success(`زنگ: ${r.label}`);
                  });
                }}
              >
                {r.label}
              </Button>
            ))}
            <Button
              type="button"
              size="sm"
              variant="secondary"
              onClick={() => {
                void fetch("/api/calls/settings", {
                  method: "PATCH",
                  headers: { "Content-Type": "application/json" },
                  body: JSON.stringify({ callVibration: true, silentCallNotify: true }),
                }).then((res) => {
                  if (res.ok) toast.success("اعلان تماس بی‌صدا شد.");
                });
              }}
            >
              اعلان بی‌صدا
            </Button>
            <Button
              type="button"
              size="sm"
              variant="secondary"
              onClick={() => {
                void fetch("/api/calls/settings", {
                  method: "PATCH",
                  headers: { "Content-Type": "application/json" },
                  body: JSON.stringify({ callNotify: false }),
                }).then((res) => {
                  if (res.ok) toast.success("اعلان تماس خاموش شد.");
                });
              }}
            >
              قطع اعلان تماس
            </Button>
          </div>
        </section>
      </div>
    </main>
  );
}
