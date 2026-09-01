"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { toast } from "sonner";
import { NixoMark } from "@/components/nixo-mark";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

type Prefs = {
  emojiRecent: string[];
  emojiFavorites: string[];
  stickerRecent: string[];
  stickerFavorites: string[];
  installedPackIds: string[];
  reactionPrivacy: "everyone" | "contacts" | "nobody";
  reactionNotify: boolean;
  suggestions: boolean;
  customEmoji: boolean;
};

type Pack = {
  id: string;
  name: string;
  official: boolean;
  owner: boolean;
  privacy: string;
  shareToken: string | null;
  groupId?: string | null;
  channelId?: string | null;
};

export function StickerSettings() {
  const [prefs, setPrefs] = useState<Prefs | null>(null);
  const [packs, setPacks] = useState<Pack[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [packName, setPackName] = useState("");
  const [token, setToken] = useState("");
  const [uploadPack, setUploadPack] = useState("");
  const [uploadName, setUploadName] = useState("استیکر");

  function load() {
    fetch("/api/stickers", { cache: "no-store" })
      .then((r) => r.json())
      .then((d) => {
        if (!d.ok && d.error) setError(d.error);
        setPrefs(d.prefs);
        setPacks(d.packs ?? []);
      })
      .catch(() => setError("Network Error"));
  }

  useEffect(() => {
    load();
  }, []);

  async function act(body: Record<string, unknown>) {
    const res = await fetch("/api/stickers", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const data = await res.json();
    if (!res.ok) toast.error(data.error ?? "ذخیره نشد.");
    else {
      toast.success("ذخیره شد.");
      load();
    }
  }

  if (error) {
    return (
      <main className="min-h-dvh bg-[#071614] p-6 text-emerald-50">
        <p>{error}</p>
        <Button type="button" className="mt-3" onClick={() => { setError(null); load(); }}>
          Retry
        </Button>
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
            <p className="text-xs text-amber-200">Settings → Stickers & Emoji</p>
            <h1 className="text-xl font-semibold">ایموجی، واکنش و استیکر</h1>
          </div>
        </div>
        <p className="text-xs leading-6 text-emerald-100/70">
          فونت ایموجی هر سیستم‌عامل فرق دارد. استیکر پویا فقط با فرمت محدود نیکسو است، نه فایل اجرایی.
          نام کسانی که واکنش داده‌اند طبق حریم خودشان دیده می‌شود. مجوزها روی سرور چک می‌شوند.
        </p>

        <section className="space-y-2 rounded-2xl bg-white/5 p-4 text-sm">
          <h2 className="font-medium">Emoji</h2>
          <p className="text-xs text-emerald-100/60">اخیر: {prefs.emojiRecent.join(" ") || "—"}</p>
          <p className="text-xs text-emerald-100/60">علاقه‌مندی: {prefs.emojiFavorites.join(" ") || "—"}</p>
          <Button type="button" size="sm" variant="secondary" onClick={() => void act({ action: "prefs", emojiRecent: [] })}>
            Clear recent emoji
          </Button>
        </section>

        <section className="space-y-2 rounded-2xl bg-white/5 p-4 text-sm">
          <h2 className="font-medium">Reactions</h2>
          <p className="text-xs">چه کسانی نام تو را روی واکنش ببینند</p>
          <div className="flex flex-wrap gap-2">
            {(["everyone", "contacts", "nobody"] as const).map((id) => (
              <Button key={id} type="button" size="sm" variant={prefs.reactionPrivacy === id ? "default" : "secondary"} onClick={() => void act({ action: "prefs", reactionPrivacy: id })}>
                {id}
              </Button>
            ))}
          </div>
          <label className="flex items-center justify-between text-xs">
            اعلان واکنش
            <input type="checkbox" checked={prefs.reactionNotify} onChange={(e) => void act({ action: "prefs", reactionNotify: e.target.checked })} />
          </label>
          <p className="text-[11px] text-emerald-100/55">اگر Lock Screen روی Hide باشد، متن واکنش روی صفحه قفل نیست.</p>
        </section>

        <section className="space-y-2 rounded-2xl bg-white/5 p-4 text-sm">
          <h2 className="font-medium">Stickers</h2>
          <label className="flex items-center justify-between text-xs">
            پیشنهاد هنگام تایپ
            <input type="checkbox" checked={prefs.suggestions} onChange={(e) => void act({ action: "prefs", suggestions: e.target.checked })} />
          </label>
          <label className="flex items-center justify-between text-xs">
            Custom emoji
            <input type="checkbox" checked={prefs.customEmoji} onChange={(e) => void act({ action: "prefs", customEmoji: e.target.checked })} />
          </label>
        </section>

        <section className="space-y-2 rounded-2xl bg-white/5 p-4 text-sm">
          <h2 className="font-medium">Sticker Packs</h2>
          {packs.map((p) => (
            <div key={p.id} className="flex items-center justify-between gap-2 text-xs">
              <span>
                {p.name} {p.official ? "· رسمی" : ""} {p.owner ? "· مالک" : ""}
              </span>
              <span className="flex gap-1">
                {!p.official && !p.owner && (
                  <Button type="button" size="sm" variant="ghost" onClick={() => void act({ action: "uninstall", packId: p.id })}>
                    Remove
                  </Button>
                )}
                {p.owner && !p.official && (
                  <Button type="button" size="sm" variant="ghost" className="text-rose-200" onClick={() => void act({ action: "deletePack", packId: p.id })}>
                    Delete pack
                  </Button>
                )}
                {p.owner && p.shareToken && (
                  <Button
                    type="button"
                    size="sm"
                    variant="secondary"
                    onClick={() => {
                      void navigator.clipboard.writeText(p.shareToken ?? "");
                      toast.message("لینک/توکن بسته کپی شد.");
                    }}
                  >
                    Share
                  </Button>
                )}
                <Button
                  type="button"
                  size="sm"
                  variant="ghost"
                  className="text-rose-200"
                  onClick={() => void act({ action: "report", packId: p.id, reason: "copyright" })}
                >
                  Report
                </Button>
              </span>
            </div>
          ))}
          <div className="flex gap-2">
            <Input value={packName} onChange={(e) => setPackName(e.target.value)} placeholder="نام بستهٔ جدید" className="h-9 bg-black/20" />
            <Button type="button" size="sm" onClick={() => void act({ action: "createPack", name: packName, privacy: "private" })}>
              Create
            </Button>
          </div>
          <div className="flex gap-2">
            <Input value={token} onChange={(e) => setToken(e.target.value)} placeholder="توکن بسته" className="h-9 bg-black/20" />
            <Button type="button" size="sm" variant="secondary" onClick={() => void act({ action: "install", token })}>
              Add pack
            </Button>
          </div>
        </section>

        <section className="space-y-2 rounded-2xl bg-white/5 p-4 text-sm">
          <h2 className="font-medium">آپلود استیکر (PNG/WEBP)</h2>
          <select
            className="h-9 w-full rounded-lg bg-black/30 px-2 text-xs"
            value={uploadPack}
            onChange={(e) => setUploadPack(e.target.value)}
          >
            <option value="">بستهٔ مالکیت تو</option>
            {packs.filter((p) => p.owner && !p.official).map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
          <Input value={uploadName} onChange={(e) => setUploadName(e.target.value)} placeholder="نام استیکر" className="h-9 bg-black/20" />
          <input
            type="file"
            accept="image/png,image/webp"
            className="text-xs"
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (!file || !uploadPack) return;
              const reader = new FileReader();
              reader.onload = () => {
                void act({
                  action: "upload",
                  packId: uploadPack,
                  name: uploadName,
                  dataUrl: String(reader.result ?? ""),
                  kind: file.type.includes("webp") ? "animated" : "static",
                });
              };
              reader.readAsDataURL(file);
            }}
          />
          <p className="text-[11px] text-emerald-100/55">سقف ۳۲ تا ۵۱۲ پیکسل. SVG و اجرایی رد می‌شوند. نوع واقعی فایل روی سرور چک می‌شود.</p>
        </section>

        <section className="space-y-2 rounded-2xl bg-white/5 p-4 text-sm">
          <h2 className="font-medium">Notifications / Privacy</h2>
          <Link href="/app/settings/notifications" className="block text-xs text-amber-200">
            Settings → Notifications
          </Link>
          <Link href="/app/settings/privacy" className="block text-xs text-amber-200">
            Settings → Privacy
          </Link>
          <Button
            type="button"
            size="sm"
            variant="secondary"
            onClick={async () => {
              const res = await fetch("/api/stickers?export=1");
              const data = await res.json();
              const blob = new Blob([JSON.stringify(data.export, null, 2)], { type: "application/json" });
              const url = URL.createObjectURL(blob);
              const a = document.createElement("a");
              a.href = url;
              a.download = "nixo-stickers-export.json";
              a.click();
              URL.revokeObjectURL(url);
            }}
          >
            Data Export
          </Button>
        </section>
      </div>
    </main>
  );
}
