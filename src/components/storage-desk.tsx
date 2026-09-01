"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { toast } from "sonner";
import { NixoMark } from "@/components/nixo-mark";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { formatBytes } from "@/lib/media";

type Item = {
  id: string;
  originalName: string;
  mime: string;
  kind: string;
  size: number;
  status: string;
  privacy: string;
  scan: string;
  createdAt: number;
  mediaUrl: string;
  thumbUrl: string;
  owner: boolean;
};
type Dash = {
  used: number;
  quota: number;
  ratio: number;
  alert: boolean;
  counts: Record<string, number>;
  queue: number;
  metrics: Record<string, number>;
  sessions: { id: string; originalName: string; received: number; expectedChunks: number }[];
};

const CHUNK = 160 * 1024;

function when(ts: number) {
  return new Date(ts).toLocaleString("fa-IR");
}

export function StorageDesk() {
  const [dash, setDash] = useState<Dash | null>(null);
  const [items, setItems] = useState<Item[]>([]);
  const [kind, setKind] = useState("all");
  const [q, setQ] = useState("");
  const [trash, setTrash] = useState(false);
  const [progress, setProgress] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  const load = useCallback(async () => {
    const d = await fetch("/api/storage?view=dash", { cache: "no-store" }).then((r) => r.json());
    if (d.ok) setDash(d as Dash);
    const params = new URLSearchParams();
    if (kind !== "all") params.set("kind", kind);
    if (q.trim()) params.set("q", q.trim());
    if (trash) params.set("trash", "1");
    const list = await fetch(`/api/storage?${params}`, { cache: "no-store" }).then((r) => r.json());
    if (list.ok) setItems(list.items ?? []);
  }, [kind, q, trash]);

  useEffect(() => {
    const t = window.setTimeout(() => void load(), 0);
    return () => window.clearTimeout(t);
  }, [load]);

  async function act(body: Record<string, unknown>) {
    const res = await fetch("/api/storage", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const data = await res.json();
    if (!res.ok) toast.error(data.error ?? "انجام نشد.");
    await load();
    return data;
  }

  async function uploadFile(file: File) {
    setBusy(true);
    setProgress(0);
    try {
      const buf = new Uint8Array(await file.arrayBuffer());
      const chunks = Math.max(1, Math.ceil(buf.length / CHUNK));
      const begin = await act({
        action: "begin",
        name: file.name,
        size: buf.length,
        mime: file.type,
        chunks,
        clientNonce: `${file.name}:${file.size}:${file.lastModified}`,
      });
      if (!begin?.sessionId) return;
      for (let i = 0; i < chunks; i += 1) {
        const part = buf.subarray(i * CHUNK, Math.min(buf.length, (i + 1) * CHUNK));
        let binary = "";
        part.forEach((b) => {
          binary += String.fromCharCode(b);
        });
        const payload = btoa(binary);
        const put = await fetch("/api/storage", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action: "chunk", sessionId: begin.sessionId, index: i, payload }),
        });
        const data = await put.json();
        if (!put.ok) {
          toast.error(data.error ?? "تکه رد شد.");
          return;
        }
        setProgress(Math.round(((i + 1) / chunks) * 90));
      }
      const done = await act({ action: "complete", sessionId: begin.sessionId });
      if (done?.ok) toast.success("آپلود ذخیره شد. پردازش پس‌زمینه انجام شد.");
      setProgress(100);
    } finally {
      setBusy(false);
      window.setTimeout(() => setProgress(null), 800);
    }
  }

  return (
    <main className="min-h-dvh bg-[#071614] p-5 text-emerald-50">
      <div className="mx-auto max-w-lg space-y-4">
        <div className="flex items-center gap-2">
          <NixoMark size={36} />
          <div>
            <p className="text-xs text-amber-200">تنظیمات ← فضای رسانه</p>
            <h1 className="text-xl font-semibold">Media & File Storage</h1>
          </div>
        </div>
        <p className="text-xs leading-6 text-emerald-100/65">
          فایل با شناسه تصادفی در فضای خصوصی ذخیره می‌شود. تغییر File ID یا URL فایل کس دیگری را باز نمی‌کند. HTML، SVG و اجرایی رد می‌شوند. EXIF موقعیت از JPEG پاک می‌شود.
        </p>
        {dash && (
          <section className="rounded-2xl bg-white/5 p-4 text-sm">
            <h2 className="font-medium">سهمیه و سلامت</h2>
            <p className="mt-2">
              {formatBytes(dash.used)} از {formatBytes(dash.quota)} ({Math.round(dash.ratio * 100)}٪)
            </p>
            {dash.alert && <p className="mt-1 text-xs text-amber-200">ظرفیت نزدیک به سقف است.</p>}
            <p className="mt-1 text-[11px] opacity-70">
              صف پردازش {dash.queue} · آپلود {dash.metrics.uploads} · شکست آپلود {dash.metrics.uploadFail} · دانلود {dash.metrics.downloads}
            </p>
            <p className="mt-1 text-[11px] opacity-70">
              عکس {dash.counts.image} · ویدیو {dash.counts.video} · صوت {dash.counts.audio} · فایل {dash.counts.file} · سطل {dash.counts.trash}
            </p>
          </section>
        )}
        <section className="rounded-2xl bg-white/5 p-4 text-sm">
          <h2 className="font-medium">آپلود تکه‌ای</h2>
          <input
            ref={fileRef}
            type="file"
            className="hidden"
            onChange={(e) => {
              const f = e.target.files?.[0];
              e.target.value = "";
              if (f) void uploadFile(f);
            }}
          />
          <Button type="button" disabled={busy} onClick={() => fileRef.current?.click()}>
            انتخاب فایل
          </Button>
          {progress !== null && (
            <div className="mt-3 h-2 overflow-hidden rounded-full bg-black/40">
              <div className="h-full bg-amber-300" style={{ width: `${progress}%` }} />
            </div>
          )}
          {dash?.sessions[0] && (
            <p className="mt-2 text-[11px] opacity-70">
              نشست ناتمام: {dash.sessions[0].originalName} ({dash.sessions[0].received}/{dash.sessions[0].expectedChunks})
            </p>
          )}
        </section>
        <section className="rounded-2xl bg-white/5 p-4 text-sm">
          <div className="flex flex-wrap gap-2">
            <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="جستجو" className="h-9 bg-black/20" />
            <select className="rounded-md bg-black/30 px-2 text-xs" value={kind} onChange={(e) => setKind(e.target.value)}>
              <option value="all">همه</option>
              <option value="image">عکس</option>
              <option value="video">ویدیو</option>
              <option value="audio">صوت</option>
              <option value="document">سند</option>
              <option value="archive">آرشیو</option>
            </select>
            <label className="flex items-center gap-1 text-xs">
              <input type="checkbox" checked={trash} onChange={(e) => setTrash(e.target.checked)} />
              سطل
            </label>
          </div>
          <ul className="mt-3 space-y-2">
            {items.map((it) => (
              <li key={it.id} className="rounded-xl border border-white/10 p-3 text-xs">
                <p className="font-medium">{it.originalName}</p>
                <p className="opacity-70">
                  {it.kind} · {formatBytes(it.size)} · {it.status} · {it.privacy} · {when(it.createdAt)}
                </p>
                {it.mediaUrl && (
                  <a href={it.mediaUrl} className="mt-1 inline-block text-amber-200" download={it.originalName}>
                    دانلود
                  </a>
                )}
                {it.owner && !trash && (
                  <div className="mt-2 flex flex-wrap gap-2">
                    <button type="button" className="text-amber-200" onClick={() => void act({ action: "privacy", ids: [it.id], privacy: it.privacy === "public" ? "private" : "public" })}>
                      {it.privacy === "public" ? "خصوصی کن" : "عمومی (با نشست)"}
                    </button>
                    <button type="button" className="text-amber-200" onClick={() => void act({ action: "trash", ids: [it.id], permanent: false })}>
                      حذف نرم
                    </button>
                  </div>
                )}
                {trash && (
                  <div className="mt-2 flex gap-2">
                    <button type="button" className="text-amber-200" onClick={() => void act({ action: "restore", ids: [it.id] })}>
                      بازگردانی
                    </button>
                    <button type="button" className="text-amber-200" onClick={() => void act({ action: "trash", ids: [it.id], permanent: true })}>
                      حذف دائمی
                    </button>
                  </div>
                )}
              </li>
            ))}
          </ul>
          {items.length === 0 && <p className="mt-2 text-[11px] opacity-50">فایلی در این فیلتر نیست.</p>}
          <Button type="button" variant="secondary" className="mt-3" onClick={() => void act({ action: "sweep" })}>
            پاک‌سازی یتیم و نشست منقضی
          </Button>
        </section>
        <p className="text-[11px] leading-5 opacity-60">
          پشتیبان متادیتا همان پشتیبان رمزشدهٔ پایگاه است. بایت Vault روی دیسک جدا و خارج از مسیر Public است. CDN عمومی Authorization را دور نمی‌زند.
        </p>
        <Link href="/app/gallery" className="block text-sm text-amber-200">
          گالری نیکسو
        </Link>
        <Link href="/app/files" className="block text-sm text-amber-200">
          Files & Documents
        </Link>
        <Link href="/app/settings/files" className="block text-sm text-amber-200">
          Settings → Files & Storage
        </Link>
      </div>
    </main>
  );
}
