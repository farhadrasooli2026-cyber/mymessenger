"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { toast } from "sonner";
import { NixoMark } from "@/components/nixo-mark";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { AI_MODELS } from "@/lib/ai-types";

type Prefs = {
  saveHistory: boolean;
  memoryEnabled: boolean;
  composerOnDevice: boolean;
  allowCloudE2ee: boolean;
  groupAssist: boolean;
  channelAssist: boolean;
  model: string;
  voiceOut: boolean;
  personalization: boolean;
  notifyAi: boolean;
  useMemoryInContext: boolean;
};
type Mem = { id: string; fact: string };

export function AiSettings() {
  const [prefs, setPrefs] = useState<Prefs | null>(null);
  const [memory, setMemory] = useState<Mem[]>([]);
  const [trans, setTrans] = useState<Record<string, string | boolean> | null>(null);
  const [adminText, setAdminText] = useState("");
  const [confirm, setConfirm] = useState(false);

  function load() {
    fetch("/api/ai", { cache: "no-store" })
      .then((r) => r.json())
      .then((d) => {
        if (d.ok) {
          setPrefs(d.prefs);
          setMemory(d.memory ?? []);
          setTrans(d.transparency);
        }
      })
      .catch(() => undefined);
  }

  useEffect(() => {
    load();
  }, []);

  async function patch(next: Partial<Prefs>) {
    const res = await fetch("/api/ai", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "prefs", ...next }),
    });
    const data = await res.json();
    if (!res.ok) toast.error("ذخیره نشد.");
    else {
      setPrefs(data.prefs);
      toast.success("Data Controls ذخیره شد.");
    }
  }

  if (!prefs) return <main className="min-h-dvh bg-[#071614] p-6 text-emerald-50">در حال بارگذاری…</main>;

  return (
    <main className="min-h-dvh bg-[#071614] p-5 text-emerald-50">
      <div className="mx-auto max-w-lg space-y-4">
        <div className="flex items-center gap-2">
          <NixoMark size={36} />
          <div>
            <p className="text-xs text-amber-200">Settings → AI</p>
            <h1 className="text-xl font-semibold">Data Controls</h1>
          </div>
        </div>
        <p className="text-xs">
          <Link href="/app/ai" className="text-amber-200">NIXO AI Chat</Link>
        </p>
        {trans && (
          <section className="rounded-2xl bg-white/5 p-4 text-xs leading-6">
            <p><b>چه می‌کند:</b> {String(trans.does)}</p>
            <p><b>چه داده می‌گیرد:</b> {String(trans.receives)}</p>
            <p><b>کجا:</b> {String(trans.where)}</p>
            <p><b>آموزش مدل:</b> {trans.training ? "بله" : "خیر — از گفتگوی تو برای train استفاده نمی‌شود."}</p>
            <p><b>حذف:</b> {String(trans.delete)}</p>
          </section>
        )}
        <section className="space-y-2 rounded-2xl bg-white/5 p-4 text-sm">
          <label className="flex items-center justify-between gap-2 text-xs">
            ذخیره History
            <input type="checkbox" checked={prefs.saveHistory} onChange={(e) => void patch({ saveHistory: e.target.checked })} />
          </label>
          <label className="flex items-center justify-between gap-2 text-xs">
            Memory
            <input type="checkbox" checked={prefs.memoryEnabled} onChange={(e) => void patch({ memoryEnabled: e.target.checked })} />
          </label>
          <label className="flex items-center justify-between gap-2 text-xs">
            ابزار چت روی دستگاه (پیشنهاد پیش‌فرض)
            <input type="checkbox" checked={prefs.composerOnDevice} onChange={(e) => void patch({ composerOnDevice: e.target.checked })} />
          </label>
          <label className="flex items-center justify-between gap-2 text-xs">
            اجازهٔ ابری برای متن E2EE (پیش‌فرض خاموش)
            <input type="checkbox" checked={prefs.allowCloudE2ee} onChange={(e) => void patch({ allowCloudE2ee: e.target.checked })} />
          </label>
          <label className="flex items-center justify-between gap-2 text-xs">
            کمک AI برای Admin گروه (متن را خودت می‌چسبانی)
            <input type="checkbox" checked={prefs.groupAssist} onChange={(e) => void patch({ groupAssist: e.target.checked })} />
          </label>
          <label className="flex items-center justify-between gap-2 text-xs">
            کمک AI برای پیش‌نویس کانال
            <input type="checkbox" checked={prefs.channelAssist} onChange={(e) => void patch({ channelAssist: e.target.checked })} />
          </label>
          <label className="flex items-center justify-between gap-2 text-xs">
            Personalization (پیشنهاد از دادهٔ مجاز خودت)
            <input type="checkbox" checked={Boolean(prefs.personalization)} onChange={(e) => void patch({ personalization: e.target.checked })} />
          </label>
          <label className="flex items-center justify-between gap-2 text-xs">
            استفاده از Memory در Context
            <input type="checkbox" checked={prefs.useMemoryInContext !== false} onChange={(e) => void patch({ useMemoryInContext: e.target.checked })} />
          </label>
          <label className="flex items-center justify-between gap-2 text-xs">
            اعلان مربوط به AI
            <input type="checkbox" checked={Boolean(prefs.notifyAi)} onChange={(e) => void patch({ notifyAi: e.target.checked })} />
          </label>
          <p className="text-[11px] opacity-70">مدل</p>
          <div className="flex flex-wrap gap-1">
            {AI_MODELS.map((m) => (
              <Button key={m.id} type="button" size="xs" variant={prefs.model === m.id ? "default" : "secondary"} onClick={() => void patch({ model: m.id })}>
                {m.name}
              </Button>
            ))}
          </div>
        </section>
        <section className="rounded-2xl bg-white/5 p-4 text-sm">
          <h2 className="font-medium">Memory</h2>
          <ul className="mt-2 space-y-1 text-xs">
            {memory.map((m) => (
              <li key={m.id} className="flex justify-between gap-2">
                {m.fact}
                <button type="button" className="text-amber-200" onClick={() => void fetch("/api/ai", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "delete-memory", id: m.id }) }).then(() => load())}>Delete</button>
              </li>
            ))}
            {memory.length === 0 && <p className="opacity-50">حافظه‌ای نیست یا خاموش است.</p>}
          </ul>
          <Button type="button" size="sm" className="mt-2" variant="secondary" onClick={() => void fetch("/api/ai", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "delete-memory" }) }).then(() => load())}>
            Delete Memory
          </Button>
        </section>
        <section className="rounded-2xl bg-white/5 p-4 text-sm">
          <h2 className="font-medium">Admin assist</h2>
          <p className="text-[11px] opacity-70">متن گفتگو را خودت بچسبان. AI پیش‌فرض پیام‌های گروه را نمی‌خواند.</p>
          <Input className="mt-2" value={adminText} onChange={(e) => setAdminText(e.target.value)} placeholder="متن برای خلاصه / هرزنامه / اعلامیه" />
          <div className="mt-2 flex gap-1">
            {(["summary", "spam", "announce"] as const).map((kind) => (
              <Button
                key={kind}
                type="button"
                size="xs"
                onClick={() =>
                  void fetch("/api/ai", {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ action: "admin", kind, text: adminText }),
                  })
                    .then((r) => r.json())
                    .then((d) => toast.message(d.text ?? d.error))
                }
              >
                {kind}
              </Button>
            ))}
          </div>
        </section>
        <section className="rounded-2xl border border-red-300/30 p-4 text-sm">
          <label className="flex items-center gap-2 text-xs">
            <input type="checkbox" checked={confirm} onChange={(e) => setConfirm(e.target.checked)} />
            تأیید حذف تمام History هوش مصنوعی
          </label>
          <Button
            type="button"
            variant="destructive"
            className="mt-2"
            disabled={!confirm}
            onClick={() =>
              void fetch("/api/ai", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ action: "delete-history", confirm: true }),
              }).then(() => toast.success("Delete AI History انجام شد."))
            }
          >
            Delete AI History
          </Button>
        </section>
      </div>
    </main>
  );
}
