"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { NixoMark } from "@/components/nixo-mark";
import { Input } from "@/components/ui/input";

type Dash = {
  groups: { mine: number; owned: number; public: number; pending: number };
  channels: { mine: number; owned: number; public: number; pending: number };
  note: string;
};

type Row = {
  id: string;
  kind: "group" | "channel";
  name: string;
  username: string | null;
  visibility: string;
  count: number;
  mine: boolean;
};

export function SpacesDesk() {
  const [dash, setDash] = useState<Dash | null>(null);
  const [items, setItems] = useState<Row[]>([]);
  const [q, setQ] = useState("");
  const [kind, setKind] = useState("all");

  const load = useCallback(async () => {
    const d = await fetch("/api/spaces?view=center", { cache: "no-store" }).then((r) => r.json());
    if (d.ok) setDash(d as Dash);
    const params = new URLSearchParams({ kind });
    if (q.trim()) params.set("q", q.trim());
    const list = await fetch(`/api/spaces?${params}`, { cache: "no-store" }).then((r) => r.json());
    if (list.ok) setItems(list.items ?? []);
  }, [kind, q]);

  useEffect(() => {
    const t = window.setTimeout(() => void load(), 0);
    return () => window.clearTimeout(t);
  }, [load]);

  return (
    <main className="min-h-dvh bg-[#071614] p-5 text-emerald-50">
      <div className="mx-auto max-w-lg space-y-4">
        <div className="flex items-center gap-2">
          <NixoMark size={36} />
          <div>
            <p className="text-xs text-amber-200">تنظیمات ← گروه و کانال</p>
            <h1 className="text-xl font-semibold">گروه و کانال نیکسو</h1>
          </div>
        </div>
        <p className="text-xs leading-6 text-emerald-100/65">
          ساخت عمومی/خصوصی، دعوت با توکن و انقضا، Join Request، Owner/Admin/Moderator، مجوز سمت سرور. تغییر Group ID یا Invite Token ورود به فضای دیگری نمی‌دهد.
        </p>
        {dash && (
          <section className="rounded-2xl bg-white/5 p-4 text-sm">
            <h2 className="font-medium">آمار حساب تو</h2>
            <p className="mt-2 text-xs leading-6 opacity-80">
              گروه: مال تو {dash.groups.mine} · مالک {dash.groups.owned} · عمومی قابل کشف {dash.groups.public} · درخواست {dash.groups.pending}
            </p>
            <p className="mt-1 text-xs leading-6 opacity-80">
              کانال: مال تو {dash.channels.mine} · مالک {dash.channels.owned} · عمومی {dash.channels.public} · درخواست {dash.channels.pending}
            </p>
            <p className="mt-2 text-[11px] leading-5 opacity-70">{dash.note}</p>
          </section>
        )}
        <section className="rounded-2xl bg-white/5 p-4 text-sm">
          <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="جستجوی عمومی و فضاهای خودت" className="h-9 bg-black/20" />
          <div className="mt-2 flex gap-1">
            {[
              ["all", "همه"],
              ["group", "گروه"],
              ["channel", "کانال"],
            ].map(([id, label]) => (
              <button
                key={id}
                type="button"
                className={`rounded-full px-3 py-1 text-[11px] ${kind === id ? "bg-amber-300 text-[#102824]" : "bg-white/10"}`}
                onClick={() => setKind(id)}
              >
                {label}
              </button>
            ))}
          </div>
          <ul className="mt-3 space-y-2">
            {items.length === 0 && <li className="text-xs opacity-50">نتیجه‌ای نیست. گروه خصوصی در Discovery نمی‌آید.</li>}
            {items.map((it) => (
              <li key={`${it.kind}-${it.id}`} className="rounded-xl border border-white/10 p-3 text-xs">
                <p className="font-medium">
                  {it.name} · {it.kind === "group" ? "گروه" : "کانال"}
                </p>
                <p className="mt-1 opacity-70">
                  {it.username ? `@${it.username}` : "بدون نام کاربری"} · {it.visibility === "public" ? "عمومی" : "خصوصی"} · {it.count} نفر
                  {it.mine ? " · عضو هستی" : ""}
                </p>
              </li>
            ))}
          </ul>
        </section>
        <Link href="/app" className="block text-sm text-amber-200">
          بازگشت به پیام‌رسان برای ساخت و مدیریت
        </Link>
        <Link href="/app/settings/privacy" className="block text-sm text-amber-200">
          حریم افزودن به گروه
        </Link>
      </div>
    </main>
  );
}
