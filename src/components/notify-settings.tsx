"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { toast } from "sonner";
import { NixoMark } from "@/components/nixo-mark";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { defaultNotifyPrefs, type NotifyPrefs, type NotifyTone } from "@/lib/notify-types";

const TONES: NotifyTone[] = ["nixo", "soft", "ping", "silent"];

export function NotifySettings() {
  const [prefs, setPrefs] = useState<NotifyPrefs | null>(null);
  const [allowId, setAllowId] = useState("");

  function load() {
    fetch("/api/notify?snapshot=1", { cache: "no-store" })
      .then((r) => r.json())
      .then((d) => setPrefs(d.prefs ?? defaultNotifyPrefs("")))
      .catch(() => undefined);
  }

  useEffect(() => {
    load();
  }, []);

  async function patch(next: Partial<NotifyPrefs>) {
    const res = await fetch("/api/notify", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(next),
    });
    const data = await res.json();
    if (!res.ok) toast.error("ذخیره نشد.");
    else {
      setPrefs(data.prefs);
      toast.success("تنظیمات اعلان ذخیره شد.");
    }
  }

  if (!prefs) return <main className="min-h-dvh bg-[#071614] p-6 text-emerald-50">در حال بارگذاری…</main>;

  const en = prefs.enabled;

  return (
    <main className="min-h-dvh bg-[#071614] p-5 text-emerald-50">
      <div className="mx-auto max-w-lg space-y-4 pb-16">
        <div className="flex items-center gap-2">
          <NixoMark size={36} />
          <div>
            <p className="text-xs text-amber-200">Settings → Notifications</p>
            <h1 className="text-xl font-semibold">اعلان‌های نیکسو</h1>
          </div>
        </div>
        <p className="text-xs leading-6 text-emerald-100/70">
          متن چت E2EE در Push یا Lock Screen نیست مگر خودت پیش‌نمایش را روشن کنی — و حتی آن‌وقت سرور فقط عبارت عمومی می‌فرستد نه ciphertext.
          اعلان امنیتی حتی اگر بقیه خاموش باشند طبق سیاست نیکسو می‌آید.
        </p>

        <section className="space-y-2 rounded-2xl bg-white/5 p-4 text-sm">
          <h2 className="font-medium">Show Message Preview</h2>
          <div className="flex gap-2">
            <Button type="button" size="sm" variant={prefs.showMessagePreview ? "default" : "secondary"} onClick={() => void patch({ showMessagePreview: true })}>
              On
            </Button>
            <Button type="button" size="sm" variant={!prefs.showMessagePreview ? "default" : "secondary"} onClick={() => void patch({ showMessagePreview: false })}>
              Off
            </Button>
          </div>
          <p className="text-xs text-emerald-100/60">Lock Screen</p>
          <div className="flex flex-wrap gap-2">
            {(
              [
                ["full", "Show Full Message"],
                ["sender", "Show Sender Only"],
                ["hidden", "Hide Preview"],
              ] as const
            ).map(([id, label]) => (
              <Button key={id} type="button" size="sm" variant={prefs.lockScreen === id ? "default" : "secondary"} onClick={() => void patch({ lockScreen: id })}>
                {label}
              </Button>
            ))}
          </div>
        </section>

        <section className="space-y-2 rounded-2xl bg-white/5 p-4 text-sm">
          <h2 className="font-medium">دسته‌ها</h2>
          {(
            [
              ["messages", "Messages"],
              ["groups", "Groups"],
              ["channels", "Channels"],
              ["calls", "Calls"],
              ["stories", "Stories"],
              ["bots", "Bots"],
              ["business", "Business"],
              ["ai", "AI"],
              ["payments", "Payments"],
              ["security", "Security"],
            ] as const
          ).map(([k, label]) => (
            <label key={k} className="flex items-center justify-between text-xs">
              {label}
              <input
                type="checkbox"
                checked={en[k]}
                onChange={(e) => void patch({ enabled: { ...en, [k]: e.target.checked } })}
              />
            </label>
          ))}
          <label className="flex items-center justify-between text-xs">
            Mention
            <input type="checkbox" checked={prefs.mentions} onChange={(e) => void patch({ mentions: e.target.checked })} />
          </label>
          <label className="flex items-center justify-between text-xs">
            Reply Notification
            <input type="checkbox" checked={prefs.replies} onChange={(e) => void patch({ replies: e.target.checked })} />
          </label>
          <label className="flex items-center justify-between text-xs">
            Group Admin Action
            <input type="checkbox" checked={prefs.groupAdmin} onChange={(e) => void patch({ groupAdmin: e.target.checked })} />
          </label>
          <Link href="/app/settings/stickers" className="block text-xs text-amber-200">Settings → Stickers & Emoji → Reactions</Link>
        </section>

        <section className="space-y-2 rounded-2xl bg-white/5 p-4 text-sm">
          <h2 className="font-medium">Sound / Vibration / Badge</h2>
          <label className="flex items-center justify-between text-xs">
            Vibration
            <input type="checkbox" checked={prefs.vibration} onChange={(e) => void patch({ vibration: e.target.checked })} />
          </label>
          <label className="flex items-center justify-between text-xs">
            Badge
            <input type="checkbox" checked={prefs.badge} onChange={(e) => void patch({ badge: e.target.checked })} />
          </label>
          {(["message", "call", "mention", "system"] as const).map((k) => (
            <label key={k} className="flex items-center justify-between text-xs">
              Tone {k}
              <select
                className="rounded bg-black/30 px-2 py-1"
                value={prefs.sounds[k]}
                onChange={(e) => void patch({ sounds: { ...prefs.sounds, [k]: e.target.value as NotifyTone } })}
              >
                {TONES.map((t) => (
                  <option key={t} value={t}>
                    {t}
                  </option>
                ))}
              </select>
            </label>
          ))}
        </section>

        <section className="space-y-2 rounded-2xl bg-white/5 p-4 text-sm">
          <h2 className="font-medium">Do Not Disturb</h2>
          <label className="flex items-center justify-between text-xs">
            DND
            <input type="checkbox" checked={prefs.dnd} onChange={(e) => void patch({ dnd: e.target.checked })} />
          </label>
          <div className="flex gap-2 text-xs">
            <label className="flex-1">
              از
              <Input type="time" value={prefs.dndStart} onChange={(e) => void patch({ dndStart: e.target.value })} className="mt-1 h-8 bg-black/20" />
            </label>
            <label className="flex-1">
              تا
              <Input type="time" value={prefs.dndEnd} onChange={(e) => void patch({ dndEnd: e.target.value })} className="mt-1 h-8 bg-black/20" />
            </label>
          </div>
          <p className="text-[11px] text-emerald-100/55">زمان به‌وقت UTC روی سرور اعمال می‌شود. مخاطب مهم را مستثنی کن.</p>
          <div className="flex gap-2">
            <Input value={allowId} onChange={(e) => setAllowId(e.target.value)} placeholder="شناسه مخاطب مهم" className="h-8 bg-black/20" />
            <Button
              type="button"
              size="sm"
              variant="secondary"
              onClick={() => {
                if (!allowId.trim()) return;
                void patch({ dndAllowIds: [...prefs.dndAllowIds, allowId.trim()].slice(0, 40) });
                setAllowId("");
              }}
            >
              Allow
            </Button>
          </div>
          <div className="flex flex-wrap gap-1">
            {prefs.dndAllowIds.map((id) => (
              <button
                key={id}
                type="button"
                className="rounded-full bg-white/10 px-2 py-0.5 text-[10px]"
                onClick={() => void patch({ dndAllowIds: prefs.dndAllowIds.filter((x) => x !== id) })}
              >
                {id} ×
              </button>
            ))}
          </div>
        </section>

        <p className="text-xs">
          <Link href="/app" className="text-amber-200">
            Notification Center در نوار گفتگو
          </Link>
          {" · "}
          <Link href="/app/settings/chats" className="text-amber-200">
            Chat Organization
          </Link>
        </p>
      </div>
    </main>
  );
}
