"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { toast } from "sonner";
import { NixoMark } from "@/components/nixo-mark";
import { Button } from "@/components/ui/button";

type Collection = { name: string; pk: string; service: string; owner: string; lifecycle: string; notes: string };
type Mine = { messages: number; threads: number; contacts: number; notifications: number; gallery: number; devices: number; schemaVersion: number };
type Snap = { id: string; createdAt: number; bytes: number; schemaVersion: number; verifiedAt: number | null };

export function DataDesk() {
  const [mine, setMine] = useState<Mine | null>(null);
  const [collections, setCollections] = useState<Collection[]>([]);
  const [ops, setOps] = useState(false);
  const [health, setHealth] = useState<{ ready?: boolean; schemaVersion?: number; env?: string } | null>(null);
  const [snapshots, setSnapshots] = useState<Snap[]>([]);
  const [err, setErr] = useState("");

  const load = useCallback(async () => {
    const res = await fetch("/api/db", { cache: "no-store" });
    const data = await res.json();
    if (!res.ok) {
      setErr(data.error ?? "بارگذاری نشد.");
      return;
    }
    setErr("");
    setMine(data.mine);
    setCollections(data.collections ?? []);
    setOps(Boolean(data.ops));
    setHealth(data.health);
    setSnapshots(data.snapshots ?? []);
  }, []);

  useEffect(() => {
    const t = window.setTimeout(() => void load(), 0);
    return () => window.clearTimeout(t);
  }, [load]);

  async function act(action: string, id?: string) {
    const res = await fetch("/api/db", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action, id }),
    });
    const data = await res.json();
    if (!res.ok) toast.error(data.error ?? "انجام نشد.");
    else toast.success("ثبت شد.");
    await load();
  }

  return (
    <main className="min-h-dvh bg-[#071614] p-5 text-emerald-50">
      <div className="mx-auto max-w-3xl space-y-4">
        <div className="flex items-center gap-2">
          <NixoMark size={36} />
          <div>
            <p className="text-xs text-amber-200">Database & Data Architecture</p>
            <h1 className="text-xl font-semibold">داده و پایگاه نیکسو</h1>
          </div>
        </div>
        {err ? <p className="text-sm text-rose-200">{err}</p> : null}
        <section className="rounded-2xl bg-white/5 p-4 text-sm leading-7">
          <p>دادهٔ هر حساب فقط با نشست همان کاربر خوانده می‌شود. عوض کردن User ID یا Record ID در درخواست، به دادهٔ دیگری دسترسی نمی‌دهد. فایل رسانه جدا از متادیتا روی دیسک خصوصی است. رمز پایگاه در سورس نیست.</p>
          <p className="text-[11px] opacity-60">Schema {health?.schemaVersion ?? "—"} · محیط {health?.env ?? "—"} · آماده {health?.ready ? "بله" : "خیر"}</p>
        </section>
        {mine ? (
          <section className="rounded-2xl bg-white/5 p-4 text-sm">
            <h2 className="font-medium">دادهٔ همین حساب</h2>
            <p className="mt-1 text-[11px] opacity-60">پیام {mine.messages} · گفتگو {mine.threads} · مخاطب {mine.contacts} · اعلان {mine.notifications} · گالری {mine.gallery} · دستگاه {mine.devices}</p>
          </section>
        ) : (
          <p className="text-sm">بارگذاری…</p>
        )}
        <section className="rounded-2xl bg-white/5 p-4 text-sm">
          <h2 className="font-medium">مالکیت مجموعه‌ها</h2>
          <ul className="mt-2 max-h-64 space-y-2 overflow-auto text-[11px] opacity-80">
            {collections.map((c) => (
              <li key={c.name}>
                <span className="text-amber-100">{c.name}</span> · {c.service} · PK {c.pk} · {c.owner} · {c.notes}
              </li>
            ))}
          </ul>
        </section>
        {ops ? (
          <section className="space-y-2 rounded-2xl bg-white/5 p-4 text-sm">
            <h2 className="font-medium">عملیات ایمنی نیکسو</h2>
            <p className="text-[11px] opacity-60">پشتیبان سیستم رمزشده است و در پوشهٔ جدا نگهداری می‌شود. Restore پیش‌فرض isolated است و Production را بازنویسی نمی‌کند.</p>
            <div className="flex flex-wrap gap-2">
              <Button type="button" size="sm" className="bg-amber-300 text-[#102824]" onClick={() => void act("backup")}>پشتیبان رمزشده</Button>
              <Button type="button" size="sm" variant="secondary" onClick={() => void act("integrity")}>بررسی Integrity</Button>
            </div>
            <ul className="text-[11px]">
              {snapshots.map((s) => (
                <li key={s.id} className="mt-1 flex flex-wrap items-center gap-2">
                  <span>{new Date(s.createdAt).toLocaleString("fa-IR")} · {s.bytes} B · v{s.schemaVersion}</span>
                  <Button type="button" size="sm" variant="ghost" onClick={() => void act("verify", s.id)}>Verify</Button>
                  <Button type="button" size="sm" variant="ghost" onClick={() => void act("restore-preview", s.id)}>Restore Preview</Button>
                </li>
              ))}
            </ul>
          </section>
        ) : null}
        <Link href="/app/settings/security" className="block text-sm text-amber-200">Settings → Security</Link>
        <Link href="/app/settings/account" className="block text-xs text-amber-200">پشتیبان E2EE حساب در Account</Link>
      </div>
    </main>
  );
}
