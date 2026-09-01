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

  async function patch(next: Partial<NotifyPrefs> & { securityDisableAck?: boolean }) {
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
          <h2 className="font-medium">عمومی</h2>
          <label className="flex items-center justify-between text-xs">
            همهٔ اعلان‌ها (به‌جز امنیت)
            <input type="checkbox" checked={prefs.globalEnabled !== false} onChange={(e) => void patch({ globalEnabled: e.target.checked })} />
          </label>
          <label className="flex items-center justify-between text-xs">
            زبان اعلان
            <select className="rounded bg-black/30 px-2 py-1" value={prefs.locale ?? "fa"} onChange={(e) => void patch({ locale: e.target.value as "fa" | "en" })}>
              <option value="fa">فارسی</option>
              <option value="en">English</option>
            </select>
          </label>
        </section>

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
              ["lives", "Live"],
              ["friends", "Friends / Follow"],
            ] as const
          ).map(([k, label]) => (
            <label key={k} className="flex items-center justify-between text-xs">
              {label}
              <input
                type="checkbox"
                checked={en[k]}
                onChange={(e) => {
                  if (k === "security" && !e.target.checked) {
                    const ok = window.confirm(
                      "خاموش کردن اعلان امنیتی فقط Push را کم می‌کند. رویدادهای حیاتی همچنان در مرکز اعلان ثبت می‌شوند. ادامه می‌دهی؟",
                    );
                    if (!ok) return;
                    void patch({ enabled: { ...en, security: false }, securityDisableAck: true });
                    return;
                  }
                  void patch({ enabled: { ...en, [k]: e.target.checked } });
                }}
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
            Reaction
            <input type="checkbox" checked={prefs.reactions !== false} onChange={(e) => void patch({ reactions: e.target.checked })} />
          </label>
          <label className="flex items-center justify-between text-xs">
            Friend Request / Follow
            <input type="checkbox" checked={prefs.friends !== false} onChange={(e) => void patch({ friends: e.target.checked, enabled: { ...en, friends: e.target.checked } })} />
          </label>
            <Link href="/app/settings/notifications" className="block text-sm text-amber-200">Settings → Notifications → Live</Link>
        </section>

        <section className="space-y-2 rounded-2xl bg-white/5 p-4 text-sm">
          <h2 className="font-medium">Sound / Vibration / Badge</h2>
          <label className="flex items-center justify-between text-xs">
            Sound
            <input type="checkbox" checked={prefs.soundEnabled !== false} onChange={(e) => void patch({ soundEnabled: e.target.checked })} />
          </label>
          <label className="flex items-center justify-between text-xs">
            Vibration
            <input type="checkbox" checked={prefs.vibration} onChange={(e) => void patch({ vibration: e.target.checked })} />
          </label>
          <label className="flex items-center justify-between text-xs">
            Vibration Pattern
            <select
              className="rounded bg-black/30 px-2 py-1"
              value={prefs.vibrationPattern ?? "nixo"}
              onChange={(e) => void patch({ vibrationPattern: e.target.value as NotifyPrefs["vibrationPattern"] })}
            >
              <option value="nixo">nixo</option>
              <option value="pulse">pulse</option>
              <option value="call">call</option>
              <option value="silent">silent</option>
            </select>
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
          <label className="flex items-center justify-between text-xs">
            تماس ورودی در Quiet Hours
            <input type="checkbox" checked={prefs.dndAllowCalls !== false} onChange={(e) => void patch({ dndAllowCalls: e.target.checked })} />
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
          <p className="text-[11px] text-emerald-100/55">ساعت سکوت با منطقهٔ زمانی حساب اعمال می‌شود.</p>
          <label className="flex items-center justify-between text-xs">
            Time Zone
            <select className="rounded bg-black/30 px-2 py-1" value={prefs.timeZone || "Asia/Tehran"} onChange={(e) => void patch({ timeZone: e.target.value })}>
              <option value="Asia/Tehran">Asia/Tehran</option>
              <option value="UTC">UTC</option>
              <option value="Europe/Istanbul">Europe/Istanbul</option>
              <option value="America/New_York">America/New_York</option>
            </select>
          </label>
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

        <PushDevices />

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

function PushDevices() {
  const [tokens, setTokens] = useState<
    {
      id: string;
      platform: string;
      permission: string;
      endpointTail: string;
      invalid: boolean;
      current?: boolean;
      devicePrefs?: { sound: boolean; vibration: boolean; badge: boolean; enabled: boolean };
    }[]
  >([]);
  const [metrics, setMetrics] = useState<{ successRate?: number; failed?: number; retries?: number; avgLatencyMs?: number; queued?: number } | null>(null);

  function load() {
    fetch("/api/notify/push", { cache: "no-store" })
      .then((r) => r.json())
      .then((d) => setTokens(d.tokens ?? []))
      .catch(() => undefined);
    fetch("/api/notify?snapshot=1", { cache: "no-store" })
      .then((r) => r.json())
      .then((d) => setMetrics(d.metrics ?? null))
      .catch(() => undefined);
  }

  useEffect(() => {
    load();
  }, []);

  return (
    <section className="space-y-2 rounded-2xl bg-white/5 p-4 text-sm">
      <h2 className="font-medium">دستگاه‌های Push</h2>
      <p className="text-[11px] text-emerald-100/55">توکن کامل نمایش داده نمی‌شود. لغو دستگاه، Push را قطع می‌کند نه نشست ورود را.</p>
      {tokens.length === 0 ? <p className="text-xs opacity-60">دستگاهی ثبت نشده. از زنگوله «اجازهٔ مرورگر» را بزن.</p> : null}
      {tokens.map((t) => (
        <div key={t.id} className="space-y-1 rounded-lg bg-black/20 p-2 text-xs">
          <div className="flex items-center justify-between">
          <span>
            {t.platform} · …{t.endpointTail} · {t.permission}
            {t.current ? " · این دستگاه" : ""}
            {t.invalid ? " · نامعتبر" : ""}
          </span>
          <Button
            type="button"
            size="sm"
            variant="ghost"
            className="text-rose-200"
            onClick={async () => {
              await fetch(`/api/notify/push?id=${t.id}`, { method: "DELETE" });
              load();
            }}
          >
            لغو
          </Button>
          </div>
          <label className="flex items-center gap-2 text-[11px]">
            اعلان این دستگاه
            <input
              type="checkbox"
              checked={t.devicePrefs?.enabled !== false}
              onChange={(e) => {
                void fetch("/api/notify/push", {
                  method: "PATCH",
                  headers: { "Content-Type": "application/json" },
                  body: JSON.stringify({ id: t.id, enabled: e.target.checked }),
                }).then(() => load());
              }}
            />
          </label>
        </div>
      ))}
      {metrics ? (
        <p className="text-[11px] text-emerald-100/55">
          صف {metrics.queued ?? 0} · موفقیت {Math.round((metrics.successRate ?? 1) * 100)}% · شکست {metrics.failed ?? 0} · Retry {metrics.retries ?? 0} · تأخیر {metrics.avgLatencyMs ?? 0}ms
        </p>
      ) : null}
    </section>
  );
}
