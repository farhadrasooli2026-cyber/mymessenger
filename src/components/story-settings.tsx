"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { toast } from "sonner";
import { NixoMark } from "@/components/nixo-mark";
import { Input } from "@/components/ui/input";
import { STATUS_PRESETS } from "@/lib/story-types";
import { StoryViewer, type StoryItem } from "@/components/story-viewer";

type Settings = {
  closeFriendIds: string[];
  mutedStoryUserIds: string[];
  storyNotifyOffIds: string[];
  statusPreset: string;
  statusText: string;
  statusPrivacy: string;
  statusAllowIds: string[];
  defaultStoryPrivacy: string;
  people: { id: string; name: string; username: string | null }[];
};

export function StorySettings() {
  const [settings, setSettings] = useState<Settings | null>(null);
  const [archive, setArchive] = useState<StoryItem[]>([]);
  const [view, setView] = useState<StoryItem[] | null>(null);

  async function load() {
    const res = await fetch("/api/stories?settings=1", { cache: "no-store" });
    const data = await res.json();
    setSettings(data.settings ?? null);
    const arch = await fetch("/api/stories?archive=1", { cache: "no-store" });
    const a = await arch.json();
    setArchive(a.archive ?? []);
  }

  useEffect(() => {
    fetch("/api/stories?settings=1", { cache: "no-store" })
      .then((r) => r.json())
      .then((d) => setSettings(d.settings ?? null))
      .catch(() => undefined);
    fetch("/api/stories?archive=1", { cache: "no-store" })
      .then((r) => r.json())
      .then((d) => setArchive(d.archive ?? []))
      .catch(() => undefined);
  }, []);

  async function save(patch: Record<string, unknown>) {
    const res = await fetch("/api/stories", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "settings", ...patch }),
    });
    if (!res.ok) toast.error("ذخیره نشد.");
    else toast.success("تنظیمات استوری ذخیره شد.");
    await load();
  }

  if (!settings) return <p className="p-6 text-sm">بارگذاری…</p>;

  function toggle(list: string[], id: string) {
    return list.includes(id) ? list.filter((x) => x !== id) : [...list, id];
  }

  return (
    <main className="min-h-dvh bg-[#071614] p-5 text-emerald-50">
      <div className="mx-auto max-w-lg space-y-5">
        <div className="flex items-center gap-2">
          <NixoMark size={36} />
          <div>
            <p className="text-xs text-amber-200">تنظیمات ← حریم خصوصی ← استوری</p>
            <h1 className="text-xl font-semibold">استوری و وضعیت</h1>
          </div>
        </div>
        <section className="rounded-2xl bg-white/5 p-4 text-sm">
          <h2 className="font-medium">وضعیت (Status)</h2>
          <div className="mt-2 flex flex-wrap gap-1">
            {STATUS_PRESETS.map((p) => (
              <button key={p.id} type="button" className={`rounded px-2 py-1 text-xs ${settings.statusPreset === p.id ? "bg-amber-300 text-[#102824]" : "bg-black/30"}`} onClick={() => void save({ statusPreset: p.id })}>
                {p.label}
              </button>
            ))}
          </div>
          <Input value={settings.statusText} onChange={(e) => setSettings({ ...settings, statusText: e.target.value })} placeholder="مثلاً 🎮 Gaming" className="mt-2 bg-black/20" onBlur={() => void save({ statusText: settings.statusText, statusPreset: "custom" })} />
          <p className="mt-2 text-xs">چه کسانی وضعیت را ببینند</p>
          {(["everyone", "contacts", "nobody", "selected"] as const).map((id) => (
            <label key={id} className="mt-1 flex items-center gap-2 text-xs">
              <input type="radio" checked={settings.statusPrivacy === id} onChange={() => void save({ statusPrivacy: id })} />
              {id === "everyone" ? "همه" : id === "contacts" ? "مخاطبین" : id === "nobody" ? "هیچ‌کس" : "انتخاب‌شده"}
            </label>
          ))}
          {settings.statusPrivacy === "selected" && settings.people.map((p) => (
            <label key={`st-${p.id}`} className="mt-1 flex items-center gap-2 text-xs">
              <input
                type="checkbox"
                checked={settings.statusAllowIds.includes(p.id)}
                onChange={() => void save({ statusAllowIds: toggle(settings.statusAllowIds, p.id) })}
              />
              {p.name}
            </label>
          ))}
        </section>
        <section className="rounded-2xl bg-white/5 p-4 text-sm">
          <h2 className="font-medium">حریم پیش‌فرض استوری</h2>
          {(["everyone", "contacts", "closeFriends", "selected"] as const).map((id) => (
            <label key={id} className="mt-1 flex items-center gap-2 text-xs">
              <input type="radio" checked={settings.defaultStoryPrivacy === id} onChange={() => void save({ defaultStoryPrivacy: id })} />
              {id === "everyone" ? "همه" : id === "contacts" ? "مخاطبین" : id === "closeFriends" ? "دوستان نزدیک" : "افراد انتخاب‌شده"}
            </label>
          ))}
          <p className="mt-3 text-xs">دوستان نزدیک</p>
          {settings.people.map((p) => (
            <label key={p.id} className="mt-1 flex items-center gap-2 text-xs">
              <input type="checkbox" checked={settings.closeFriendIds.includes(p.id)} onChange={() => void save({ closeFriendIds: toggle(settings.closeFriendIds, p.id) })} />
              {p.name} {p.username ? `@${p.username}` : ""}
            </label>
          ))}
          {settings.people.length === 0 && <p className="text-xs opacity-50">هنوز کاربر دیگری در این محیط نیست.</p>}
        </section>
        <section className="rounded-2xl bg-white/5 p-4 text-sm">
          <h2 className="font-medium">اعلان استوری</h2>
          <p className="text-xs text-emerald-100/60">برای حساب‌های انتخابی اعلان خاموش می‌شود (ذخیره روی حساب؛ تحویل پوش در این نسخه محلی است).</p>
          {settings.people.map((p) => (
            <label key={`n-${p.id}`} className="mt-1 flex items-center gap-2 text-xs">
              <input
                type="checkbox"
                checked={settings.storyNotifyOffIds.includes(p.id)}
                onChange={() => void save({ storyNotifyOffIds: toggle(settings.storyNotifyOffIds, p.id) })}
              />
              بدون اعلان از {p.name}
            </label>
          ))}
        </section>
        <section className="rounded-2xl bg-white/5 p-4 text-sm">
          <h2 className="font-medium">بی‌صدا شده‌ها</h2>
          {settings.people
            .filter((p) => settings.mutedStoryUserIds.includes(p.id))
            .map((p) => (
              <button
                key={`m-${p.id}`}
                type="button"
                className="mt-1 block text-xs text-amber-200"
                onClick={() =>
                  void fetch("/api/stories", {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ action: "mute", authorId: p.id, muted: false }),
                  }).then(() => load())
                }
              >
                خروج از بی‌صدا: {p.name}
              </button>
            ))}
          {settings.mutedStoryUserIds.length === 0 && <p className="text-xs opacity-50">کسی بی‌صدا نیست.</p>}
        </section>
        <section className="rounded-2xl bg-white/5 p-4 text-sm">
          <h2 className="font-medium">بایگانی استوری</h2>
          <p className="text-xs text-emerald-100/60">فقط برای تو. پس از ۲۴ ساعت از فید عمومی خارج می‌شود.</p>
          <div className="mt-2 space-y-1">
            {archive.map((s) => (
              <button key={s.id} type="button" className="block w-full rounded-xl bg-black/20 px-3 py-2 text-right text-xs" onClick={() => setView([s])}>
                {s.kind} · {new Date(s.createdAt).toLocaleString("fa-IR")} {s.expired ? "· بایگانی" : ""}
              </button>
            ))}
          </div>
        </section>
        <Link href="/app" className="inline-block text-sm text-amber-200">بازگشت به نیکسو</Link>
      </div>
      {view && <StoryViewer items={view} ownerName="آرشیو من" isOwner startIndex={0} onClose={() => setView(null)} />}
    </main>
  );
}
