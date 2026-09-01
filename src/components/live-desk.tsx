"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Radio } from "lucide-react";
import { toast } from "sonner";
import { NixoMark } from "@/components/nixo-mark";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { LIVE_CATEGORIES } from "@/lib/live-types";

type Card = {
  id: string;
  title: string;
  hostName: string;
  status: string;
  viewerCount: number;
  category: string;
  visibility: string;
  scheduledAt: number | null;
  thumbDataUrl: string;
};

export function LiveDesk() {
  const router = useRouter();
  const [items, setItems] = useState<Card[]>([]);
  const [mode, setMode] = useState<"discovery" | "trending" | "mine">("discovery");
  const [busy, setBusy] = useState(true);
  const [create, setCreate] = useState(false);
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [visibility, setVisibility] = useState("public");
  const [category, setCategory] = useState("talk");
  const [tags, setTags] = useState("");
  const [audioOnly, setAudioOnly] = useState(false);
  const [recordEnabled, setRecordEnabled] = useState(false);
  const [ageRestricted, setAgeRestricted] = useState(false);
  const [maxViewers, setMaxViewers] = useState("64");
  const [scheduled, setScheduled] = useState("");
  const [thumb, setThumb] = useState("");

  async function load(m = mode) {
    setBusy(true);
    const res = await fetch(`/api/live?mode=${m}`, { cache: "no-store" });
    const data = await res.json();
    setItems(data.items ?? []);
    setBusy(false);
  }

  useEffect(() => {
    const t = window.setTimeout(() => void load(), 0);
    return () => window.clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode]);

  async function startCreate() {
    const scheduledAt = scheduled ? new Date(scheduled).getTime() : undefined;
    const res = await fetch("/api/live", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        title,
        description,
        visibility,
        category,
        tags: tags.split(/[,\s]+/).filter(Boolean),
        audioOnly,
        recordEnabled,
        ageRestricted,
        maxViewers: Number(maxViewers) || 64,
        scheduledAt: scheduledAt && scheduledAt > Date.now() ? scheduledAt : undefined,
        thumbDataUrl: thumb || undefined,
        guestRequestsEnabled: true,
      }),
    });
    const data = await res.json();
    if (!res.ok) {
      toast.error(data.error ?? "ساخته نشد.");
      return;
    }
    toast.success("Live آماده است.");
    router.push(`/app/live/${data.live.id}`);
  }

  return (
    <main className="min-h-dvh bg-[#071614] p-5 text-emerald-50">
      <div className="mx-auto max-w-lg space-y-4">
        <div className="flex items-center gap-2">
          <NixoMark size={36} />
          <div className="min-w-0 flex-1">
            <p className="text-xs text-amber-200">Live Streaming</p>
            <h1 className="text-xl font-semibold">پخش زنده نیکسو</h1>
          </div>
          <Button type="button" size="sm" className="bg-amber-300 text-[#102824]" onClick={() => setCreate((v) => !v)}>
            <Radio className="ml-1 size-3.5" />
            Live جدید
          </Button>
        </div>
        <p className="text-[11px] leading-5 text-emerald-100/60">
          سیگنال، حضور و مجوز روی سرور است. تصویر/صدا روی دستگاه میزبان حلقه می‌شود — این نسخه CDN عمومی یا SFU چندبیننده ندارد.
          Live خصوصی فقط با نشست و Permission دیده می‌شود؛ داشتن URL کافی نیست.
        </p>
        <div className="flex gap-1 text-xs">
          {(["discovery", "trending", "mine"] as const).map((m) => (
            <button
              key={m}
              type="button"
              className={`rounded-full px-3 py-1 ${mode === m ? "bg-amber-300 text-[#102824]" : "bg-white/10"}`}
              onClick={() => setMode(m)}
            >
              {m === "discovery" ? "Discovery" : m === "trending" ? "Trending" : "مال من"}
            </button>
          ))}
        </div>
        {create && (
          <section className="space-y-2 rounded-2xl bg-white/5 p-4 text-sm">
            <h2 className="font-medium">تنظیمات قبل از شروع</h2>
            <Input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="عنوان Live" className="bg-black/20" />
            <Textarea value={description} onChange={(e) => setDescription(e.target.value)} placeholder="توضیحات" className="min-h-16 bg-black/20" />
            <select className="w-full rounded bg-black/30 p-2" value={visibility} onChange={(e) => setVisibility(e.target.value)}>
              <option value="public">Public</option>
              <option value="private">Private</option>
              <option value="members">Members Only</option>
              <option value="invite">Invite Only</option>
            </select>
            <select className="w-full rounded bg-black/30 p-2" value={category} onChange={(e) => setCategory(e.target.value)}>
              {LIVE_CATEGORIES.map((c) => (
                <option key={c} value={c}>{c}</option>
              ))}
            </select>
            <Input value={tags} onChange={(e) => setTags(e.target.value)} placeholder="تگ‌ها با فاصله" className="bg-black/20" />
            <Input type="datetime-local" value={scheduled} onChange={(e) => setScheduled(e.target.value)} className="bg-black/20" />
            <Input value={maxViewers} onChange={(e) => setMaxViewers(e.target.value)} placeholder="سقف بیننده" className="bg-black/20" />
            <label className="flex items-center gap-2 text-xs"><input type="checkbox" checked={audioOnly} onChange={(e) => setAudioOnly(e.target.checked)} /> Audio Only</label>
            <label className="flex items-center gap-2 text-xs"><input type="checkbox" checked={recordEnabled} onChange={(e) => setRecordEnabled(e.target.checked)} /> Recording / Replay</label>
            <label className="flex items-center gap-2 text-xs"><input type="checkbox" checked={ageRestricted} onChange={(e) => setAgeRestricted(e.target.checked)} /> محدودیت سنی</label>
            <label className="block text-xs">
              تصویر پیش‌نمایش
              <input
                type="file"
                accept="image/*"
                className="mt-1 block"
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  if (!f) return;
                  const reader = new FileReader();
                  reader.onload = () => setThumb(String(reader.result ?? "").slice(0, 100_000));
                  reader.readAsDataURL(f);
                }}
              />
            </label>
            <Button type="button" className="w-full bg-amber-300 text-[#102824]" onClick={() => void startCreate()}>ساخت Live</Button>
          </section>
        )}
        {busy && <p className="text-sm">بارگذاری…</p>}
        {!busy && items.length === 0 && <p className="rounded-2xl bg-white/5 p-6 text-center text-sm">No live streams available</p>}
        <ul className="space-y-2">
          {items.map((it) => (
            <li key={it.id}>
              <Link href={`/app/live/${it.id}`} className="flex gap-3 rounded-2xl bg-white/5 p-3">
                <div className="grid size-16 place-items-center overflow-hidden rounded-xl bg-black/40">
                  {it.thumbDataUrl ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={it.thumbDataUrl} alt="" className="size-full object-cover" />
                  ) : (
                    <Radio className="size-5 text-rose-300" />
                  )}
                </div>
                <div className="min-w-0 flex-1">
                  <p className="truncate font-medium">{it.title}</p>
                  <p className="text-xs opacity-70">{it.hostName} · {it.category} · {it.visibility}</p>
                  <p className="text-[11px] text-rose-200">
                    {it.status === "live" ? "🔴 Live" : it.status} · {it.viewerCount} بیننده
                    {it.scheduledAt ? ` · ${new Date(it.scheduledAt).toLocaleString("fa-IR")}` : ""}
                  </p>
                </div>
              </Link>
            </li>
          ))}
        </ul>
        <Link href="/app/settings/live" className="block text-sm text-amber-200">Settings → Live</Link>
      </div>
    </main>
  );
}
