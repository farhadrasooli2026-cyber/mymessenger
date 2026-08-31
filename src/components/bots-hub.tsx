"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { NixoMark } from "@/components/nixo-mark";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { MINI_CATEGORIES } from "@/lib/bot-types";

type Bot = { id: string; name: string; username: string; description: string; verified: boolean; status?: string };
type Mini = { id: string; title: string; category: string; description: string; paymentHint: boolean; bot: Bot };

export function BotsHub() {
  const router = useRouter();
  const [q, setQ] = useState("");
  const [bots, setBots] = useState<Bot[]>([]);
  const [mini, setMini] = useState<Mini[]>([]);
  const [category, setCategory] = useState("");
  const [mine, setMine] = useState<Bot[]>([]);

  function load() {
    const cat = category ? `&category=${encodeURIComponent(category)}` : "";
    fetch(`/api/bots?q=${encodeURIComponent(q)}${cat}`, { cache: "no-store" })
      .then((r) => r.json())
      .then((d) => {
        if (d.ok) {
          setBots(d.bots ?? []);
          setMini(d.miniApps ?? []);
        }
      })
      .catch(() => undefined);
    fetch("/api/bots?mine=1", { cache: "no-store" })
      .then((r) => r.json())
      .then((d) => {
        if (d.ok) setMine(d.bots ?? []);
      })
      .catch(() => undefined);
  }

  useEffect(() => {
    load();
  }, [category]);

  return (
    <main className="min-h-dvh bg-[#071614] p-5 text-emerald-50">
      <div className="mx-auto max-w-lg space-y-4">
        <div className="flex items-center gap-2">
          <NixoMark size={36} />
          <div>
            <p className="text-xs text-amber-200">ربات‌ها و مینی‌اپ</p>
            <h1 className="text-xl font-semibold">Bot Directory</h1>
          </div>
        </div>
        <p className="text-xs leading-6 text-emerald-100/65">
          ربات‌ها سندباکس‌اند: بدون Start به شما پیام نمی‌دهند، به چت خصوصی E2EE و حسگرهای گوشی دسترسی پیش‌فرض ندارند. توکن API فقط روی سرور توسعه‌دهنده است.
        </p>
        <div className="flex gap-2">
          <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="جستجوی @username" />
          <Button type="button" onClick={() => load()}>جستجو</Button>
        </div>
        <p className="text-xs">
          <Link href="/app/settings/bots" className="text-amber-200">Developer Dashboard — ساخت ربات</Link>
          {" · "}
          <Link href="/app" className="text-amber-200">بازگشت</Link>
        </p>

        {mine.length > 0 && (
          <section className="rounded-2xl bg-white/5 p-4 text-sm">
            <h2 className="font-medium">ربات‌های من</h2>
            <ul className="mt-2 space-y-2 text-xs">
              {mine.map((b) => (
                <li key={b.id}>
                  <Link href={`/app/bots/${b.id}`} className="text-amber-200">@{b.username}</Link> — {b.name} ({b.status})
                </li>
              ))}
            </ul>
          </section>
        )}

        <section className="rounded-2xl bg-white/5 p-4 text-sm">
          <h2 className="font-medium">Verified & Marketplace</h2>
          <ul className="mt-2 space-y-3">
            {bots.map((b) => (
              <li key={b.id} className="rounded-xl border border-white/10 p-3 text-xs">
                <p className="font-medium">
                  {b.name} {b.verified ? "· Verified Bot" : ""}
                </p>
                <p className="text-amber-200" dir="ltr">@{b.username}</p>
                <p className="mt-1 opacity-70">{b.description}</p>
                <Button type="button" size="sm" className="mt-2 bg-amber-300 text-[#102824]" onClick={() => router.push(`/app/bots/chat/${b.id}`)}>
                  باز کردن ربات
                </Button>
              </li>
            ))}
          </ul>
          {bots.length === 0 && <p className="mt-2 text-xs opacity-60">رباتی مطابق جستجو نیست.</p>}
        </section>

        <section className="rounded-2xl bg-white/5 p-4 text-sm">
          <h2 className="font-medium">Mini App Directory</h2>
          <div className="mt-2 flex flex-wrap gap-1">
            <Button type="button" size="xs" variant={category === "" ? "default" : "secondary"} onClick={() => setCategory("")}>همه</Button>
            {MINI_CATEGORIES.map((c) => (
              <Button key={c.id} type="button" size="xs" variant={category === c.id ? "default" : "secondary"} onClick={() => setCategory(c.id)}>
                {c.emoji} {c.label}
              </Button>
            ))}
          </div>
          <ul className="mt-3 space-y-2 text-xs">
            {mini.map((m) => (
              <li key={m.id} className="rounded-xl border border-white/10 p-3">
                <p className="font-medium">{m.title}</p>
                <p className="opacity-70">{m.description}</p>
                <p className="mt-1 text-amber-200">از @{m.bot.username}</p>
                <Button type="button" size="sm" className="mt-2" onClick={() => router.push(`/app/mini/${m.id}`)}>
                  Open Mini App
                </Button>
              </li>
            ))}
          </ul>
        </section>
      </div>
    </main>
  );
}
