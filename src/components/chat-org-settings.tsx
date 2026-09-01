"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { toast } from "sonner";
import { NixoMark } from "@/components/nixo-mark";
import { Button } from "@/components/ui/button";
import { INBOX_PIN_MAX } from "@/lib/inbox-types";

type Prefs = {
  sort: string;
  archiveUnarchiveOnNew: boolean;
  listShowPreview: boolean;
  pinMax: number;
};

export function ChatOrgSettings() {
  const [prefs, setPrefs] = useState<Prefs | null>(null);
  const [folders, setFolders] = useState<{ id: string; name: string; builtin: string | null }[]>([]);
  const [error, setError] = useState<string | null>(null);

  function load() {
    fetch("/api/inbox?folder=all", { cache: "no-store" })
      .then((r) => r.json())
      .then((d) => {
        if (!d.ok && d.error) setError(d.error);
        setPrefs(d.prefs ?? null);
        setFolders(d.folders ?? []);
      })
      .catch(() => setError("Network Error"));
  }

  useEffect(() => {
    load();
  }, []);

  async function patch(next: Record<string, unknown>) {
    const res = await fetch("/api/inbox", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "prefs", ...next }),
    });
    const data = await res.json();
    if (!res.ok) toast.error(data.error ?? "ذخیره نشد.");
    else {
      setPrefs(data.prefs);
      toast.success("تنظیمات سازمان‌دهی ذخیره شد.");
    }
  }

  if (error && !prefs) {
    return (
      <main className="min-h-dvh bg-[#071614] p-6 text-emerald-50">
        {error}
        <button type="button" className="mr-2 text-amber-200" onClick={load}>
          Retry
        </button>
      </main>
    );
  }

  if (!prefs) return <main className="min-h-dvh bg-[#071614] p-6 text-emerald-50">Loading…</main>;

  return (
    <main className="min-h-dvh bg-[#071614] p-5 text-emerald-50">
      <div className="mx-auto max-w-lg space-y-4 pb-16">
        <div className="flex items-center gap-2">
          <NixoMark size={36} />
          <div>
            <p className="text-xs text-amber-200">Settings → Chats → Chat Organization</p>
            <h1 className="text-xl font-semibold">سازمان‌دهی گفتگوها</h1>
          </div>
        </div>
        <p className="text-xs leading-6 text-emerald-100/70">
          پوشه‌ها، پین، آرشیو، بی‌صدا، پیش‌نویس و علاقه‌مندی‌ها فقط برای همین نشست و حساب تو ذخیره می‌شوند. تغییر شناسه در درخواست، پوشه یا چت شخص دیگر را باز نمی‌کند.
          سقف پین {prefs.pinMax ?? INBOX_PIN_MAX} گفتگو است. همگام‌سازی بین دستگاه‌های مجاز از طریق سرور است؛ اگر دو دستگاه همزمان پوشه را عوض کنند، نسخهٔ تازه‌تر می‌ماند مگر با Force ذخیره کنی.
        </p>

        <section className="space-y-2 rounded-2xl bg-white/5 p-4 text-sm">
          <h2 className="font-medium">Sorting</h2>
          <div className="flex flex-wrap gap-2">
            {(
              [
                ["recent", "Recent Activity"],
                ["unread", "Unread"],
                ["name", "Name"],
                ["favorites", "Favorites"],
              ] as const
            ).map(([id, label]) => (
              <Button key={id} type="button" size="sm" variant={prefs.sort === id ? "default" : "secondary"} onClick={() => void patch({ sort: id })}>
                {label}
              </Button>
            ))}
          </div>
        </section>

        <section className="space-y-2 rounded-2xl bg-white/5 p-4 text-sm">
          <h2 className="font-medium">Archive</h2>
          <p className="text-xs text-emerald-100/60">اگر پیام جدید به چت آرشیوشده برسد، به لیست اصلی برگردد؟</p>
          <div className="flex gap-2">
            <Button type="button" size="sm" variant={prefs.archiveUnarchiveOnNew ? "default" : "secondary"} onClick={() => void patch({ archiveUnarchiveOnNew: true })}>
              برگرداندن
            </Button>
            <Button type="button" size="sm" variant={!prefs.archiveUnarchiveOnNew ? "default" : "secondary"} onClick={() => void patch({ archiveUnarchiveOnNew: false })}>
              در آرشیو بماند
            </Button>
          </div>
        </section>

        <section className="space-y-2 rounded-2xl bg-white/5 p-4 text-sm">
          <h2 className="font-medium">Message Preview Privacy</h2>
          <p className="text-xs text-emerald-100/60">نمایش نوع آخرین پیام در فهرست. متن E2EE هرگز به‌صورت خام در لیست سرور نیست.</p>
          <div className="flex gap-2">
            <Button type="button" size="sm" variant={prefs.listShowPreview ? "default" : "secondary"} onClick={() => void patch({ listShowPreview: true })}>
              نوع پیام
            </Button>
            <Button type="button" size="sm" variant={!prefs.listShowPreview ? "default" : "secondary"} onClick={() => void patch({ listShowPreview: false })}>
              فقط «پیام جدید»
            </Button>
          </div>
          <Link href="/app/settings/notifications" className="block text-xs text-amber-200">
            پیش‌نمایش اعلان و Lock Screen → Settings → Notifications
          </Link>
        </section>

        <section className="space-y-2 rounded-2xl bg-white/5 p-4 text-sm">
          <h2 className="font-medium">Folders · Pin · Mute · Drafts · Favorites</h2>
          <p className="text-xs leading-5 text-emerald-100/60">
            پوشه‌های آماده: All Chats، Unread، Personal، Groups، Channels، Bots، Business، Favorites، Archived Chats.
            پوشهٔ سفارشی از فهرست گفتگو با نام، آیکون، Include/Exclude ساخته می‌شود. حذف پوشه چت را پاک نمی‌کند.
            Mute: ۱ ساعت / ۸ ساعت / ۱ روز / ۱ هفته / تا روشن کردن. Draft فقط برای صاحب حساب رمز می‌شود و بین دستگاه‌های مجاز همگام است.
            پس‌زمینهٔ هر چت از داخل گفتگو با بخش ۷۰ (Chat Backgrounds) یکی است.
          </p>
          <ul className="list-disc pr-4 text-xs text-emerald-100/70">
            {folders.map((f) => (
              <li key={f.id}>
                {f.name}
                {f.builtin ? " (آماده)" : " (سفارشی)"}
              </li>
            ))}
          </ul>
        </section>
      </div>
    </main>
  );
}
