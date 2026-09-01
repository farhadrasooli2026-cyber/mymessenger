"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { toast } from "sonner";
import { NixoMark } from "@/components/nixo-mark";
import { Button } from "@/components/ui/button";

type Row = { id: string; name: string; username: string; notify: string; startedAt: number; status: string };

export function ConnectedBots() {
  const [bots, setBots] = useState<Row[]>([]);
  const [logs, setLogs] = useState<{ action: string; at: number; botId: string }[]>([]);
  const [err, setErr] = useState("");

  function load() {
    fetch("/api/bots?connected=1", { cache: "no-store" })
      .then((r) => r.json())
      .then((d) => {
        if (d.ok) {
          setBots(d.bots ?? []);
          setLogs(d.logs ?? []);
        } else setErr(d.error ?? "بارگذاری نشد.");
      })
      .catch(() => setErr("شبکه در دسترس نیست."));
  }

  useEffect(() => {
    load();
  }, []);

  async function stop(botId: string) {
    const res = await fetch("/api/bots/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "stop", botId }),
    });
    const data = await res.json();
    if (!res.ok) toast.error(data.error);
    else toast.success("اتصال ربات قطع شد.");
    load();
  }

  if (err && bots.length === 0) {
    return (
      <main className="min-h-dvh bg-[#071614] p-6 text-emerald-50">
        <p className="text-red-200">{err}</p>
      </main>
    );
  }

  return (
    <main className="min-h-dvh bg-[#071614] p-5 text-emerald-50">
      <div className="mx-auto max-w-lg space-y-4">
        <div className="flex items-center gap-2">
          <NixoMark size={36} />
          <div>
            <p className="text-xs text-amber-200">Settings → Privacy & Security → Connected Bots</p>
            <h1 className="text-xl font-semibold">ربات‌های متصل</h1>
          </div>
        </div>
        <p className="text-xs leading-6 text-emerald-100/65">
          قطع اتصال، Stop است؛ توکن توسعه‌دهنده باطل نمی‌شود. ربات به OTP، رمز عبور، نشست اصلی و چت E2EE دسترسی ندارد.
        </p>
        {bots.length === 0 && <p className="text-xs opacity-60">ربات متصل نیست.</p>}
        <ul className="space-y-3">
          {bots.map((b) => (
            <li key={b.id} className="rounded-2xl bg-white/5 p-4 text-sm">
              <p className="font-medium">{b.name}</p>
              <p className="text-[11px] text-amber-200" dir="ltr">@{b.username}</p>
              <p className="text-[11px] opacity-70">اعلان: {b.notify} · {b.status}</p>
              <div className="mt-2 flex gap-2">
                <Link href={`/app/bots/chat/${b.id}`} className="text-xs text-amber-200">گفتگو</Link>
                <Button type="button" size="xs" variant="secondary" onClick={() => void stop(b.id)}>قطع اتصال</Button>
              </div>
            </li>
          ))}
        </ul>
        <section className="rounded-2xl bg-white/5 p-4 text-sm">
          <h2 className="font-medium">تاریخچهٔ دسترسی</h2>
          <ul className="mt-2 max-h-40 space-y-1 overflow-auto text-[11px] opacity-80">
            {logs.map((l, i) => (
              <li key={`${l.at}-${i}`}>{new Date(l.at).toLocaleString("fa")} · {l.action}</li>
            ))}
          </ul>
        </section>
        <Link href="/app/settings/privacy" className="text-sm text-amber-200">بازگشت به حریم خصوصی</Link>
      </div>
    </main>
  );
}
