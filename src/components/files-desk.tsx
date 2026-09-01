"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { NixoMark } from "@/components/nixo-mark";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { formatBytes } from "@/lib/media";
import { previewMode, type FileSort } from "@/lib/files";

type Item = {
  id: string;
  name: string;
  mime: string;
  size: number;
  kind: string;
  createdAt: number;
  sourceChat: string;
  mediaUrl: string;
  caption: string;
};

export function FilesDesk() {
  const [items, setItems] = useState<Item[]>([]);
  const [recent, setRecent] = useState<Item[]>([]);
  const [total, setTotal] = useState(0);
  const [stats, setStats] = useState<{ files?: number; cache?: number; total?: number } | null>(null);
  const [q, setQ] = useState("");
  const [type, setType] = useState("all");
  const [sort, setSort] = useState<FileSort>("newest");
  const [chat, setChat] = useState("");
  const [minSize, setMinSize] = useState("");
  const [maxSize, setMaxSize] = useState("");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [offset, setOffset] = useState(0);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState("");
  const [preview, setPreview] = useState<Item | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setErr("");
    const params = new URLSearchParams();
    if (q.trim()) params.set("q", q.trim());
    if (type !== "all") params.set("type", type);
    if (chat.trim()) params.set("chat", chat.trim());
    if (minSize) params.set("minSize", String(Number(minSize) * 1024));
    if (maxSize) params.set("maxSize", String(Number(maxSize) * 1024));
    if (from) params.set("from", String(new Date(from).getTime()));
    if (to) params.set("to", String(new Date(to).getTime() + 86_399_000));
    params.set("sort", sort);
    params.set("offset", String(offset));
    const res = await fetch(`/api/files?${params}`, { cache: "no-store" });
    const data = await res.json();
    if (!res.ok) {
      setErr(data.error ?? "جستجو انجام نشد.");
      setItems([]);
    } else {
      setItems(data.items ?? []);
      setRecent(data.recent ?? []);
      setTotal(data.total ?? 0);
      setStats(data.stats ?? null);
    }
    setLoading(false);
  }, [q, type, sort, chat, minSize, maxSize, from, to, offset]);

  useEffect(() => {
    const t = window.setTimeout(() => void load(), 0);
    return () => window.clearTimeout(t);
  }, [load]);

  const mode = preview ? previewMode(preview.mime, preview.name) : "none";

  return (
    <main className="min-h-dvh bg-[#071614] p-5 text-emerald-50">
      <div className="mx-auto max-w-3xl space-y-4">
        <div className="flex items-center gap-2">
          <NixoMark size={36} />
          <div>
            <p className="text-xs text-amber-200">Files & Documents</p>
            <h1 className="text-xl font-semibold">فایل‌ها و اسناد</h1>
          </div>
        </div>
        <div className="flex flex-wrap gap-2 text-xs">
          <Input value={q} onChange={(e) => { setOffset(0); setQ(e.target.value); }} placeholder="جستجو بر اساس نام" className="h-9 max-w-xs bg-black/20" />
          <select value={type} onChange={(e) => { setOffset(0); setType(e.target.value); }} className="h-9 rounded-md bg-black/30 px-2" aria-label="نوع فایل">
            {["all", "document", "file", "audio", "pdf", "zip"].map((t) => (
              <option key={t} value={t}>{t}</option>
            ))}
          </select>
          <select value={sort} onChange={(e) => setSort(e.target.value as FileSort)} className="h-9 rounded-md bg-black/30 px-2" aria-label="مرتب‌سازی">
            <option value="newest">Newest</option>
            <option value="oldest">Oldest</option>
            <option value="name">Name</option>
            <option value="size">Size</option>
            <option value="type">Type</option>
          </select>
          <Input value={chat} onChange={(e) => { setOffset(0); setChat(e.target.value); }} placeholder="Chat" className="h-9 w-32 bg-black/20" />
          <Input value={minSize} onChange={(e) => setMinSize(e.target.value)} placeholder="حداقل KB" className="h-9 w-24 bg-black/20" />
          <Input value={maxSize} onChange={(e) => setMaxSize(e.target.value)} placeholder="حداکثر KB" className="h-9 w-24 bg-black/20" />
          <Input type="date" value={from} onChange={(e) => setFrom(e.target.value)} className="h-9 bg-black/20" aria-label="از تاریخ" />
          <Input type="date" value={to} onChange={(e) => setTo(e.target.value)} className="h-9 bg-black/20" aria-label="تا تاریخ" />
        </div>
        {stats ? <p className="text-[11px] opacity-60">حجم فایل‌ها {formatBytes(stats.files ?? 0)} · Cache {formatBytes(stats.cache ?? 0)}</p> : null}
        {recent.length > 0 && offset === 0 ? (
          <section>
            <h2 className="text-sm font-medium">Recent Files</h2>
            <p className="text-[11px] opacity-50">{recent.length} مورد اخیر</p>
          </section>
        ) : null}
        {loading ? <p className="text-sm">بارگذاری…</p> : null}
        {err ? <p className="text-sm text-rose-200">{err}</p> : null}
        {!loading && !err && items.length === 0 ? <p className="rounded-2xl bg-white/5 p-6 text-sm">No files found</p> : null}
        <ul className="space-y-2">
          {items.map((it) => (
            <li key={it.id} className="flex items-center justify-between gap-2 rounded-2xl bg-white/5 px-3 py-2 text-sm">
              <button type="button" className="min-w-0 flex-1 text-right" onClick={() => setPreview(it)}>
                <p className="truncate font-medium">{it.name}</p>
                <p className="text-[11px] opacity-55">
                  {it.mime} · {formatBytes(it.size)} · {new Date(it.createdAt).toLocaleDateString("fa-IR")}
                  {it.sourceChat ? ` · ${it.sourceChat}` : ""}
                </p>
              </button>
              <a href={it.mediaUrl} download={it.name} className="text-xs text-amber-200">دانلود</a>
            </li>
          ))}
        </ul>
        {total > items.length + offset ? (
          <Button type="button" variant="secondary" onClick={() => setOffset((o) => o + 40)}>موارد بیشتر</Button>
        ) : null}
        <Link href="/app/settings/files" className="block text-sm text-amber-200">Settings → Files & Storage</Link>
        <Link href="/app/saved" className="block text-xs text-amber-200">Saved Files در Saved Messages</Link>
      </div>
      {preview ? (
        <div className="fixed inset-0 z-40 grid place-items-center bg-black/80 p-4" onClick={() => setPreview(null)}>
          <div className="max-h-[90dvh] w-full max-w-lg overflow-auto rounded-3xl bg-[#102824] p-4" onClick={(e) => e.stopPropagation()}>
            <p className="font-medium">{preview.name}</p>
            <p className="text-[11px] opacity-60">{preview.mime} · {formatBytes(preview.size)}</p>
            {mode === "pdf" ? <iframe title={preview.name} src={preview.mediaUrl} className="mt-2 h-80 w-full rounded bg-white" /> : null}
            {mode === "image" ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={preview.mediaUrl} alt="" className="mt-2 max-h-80 w-full rounded object-contain" />
            ) : null}
            {mode === "video" ? <video src={preview.mediaUrl} controls className="mt-2 w-full rounded" /> : null}
            {mode === "audio" ? <audio src={preview.mediaUrl} controls className="mt-2 w-full" /> : null}
            {mode === "text" ? <p className="mt-2 text-xs opacity-70">پیش‌نمایش متن فقط برای فایل‌های متنی مجاز است؛ فایل اجرایی باز نمی‌شود.</p> : null}
            {mode === "none" ? <p className="mt-2 text-xs opacity-70">این نوع فایل پیش‌نمایش امن ندارد. دانلود فقط در صورت مجوز.</p> : null}
            <Button type="button" className="mt-3" variant="secondary" onClick={() => setPreview(null)}>بستن</Button>
          </div>
        </div>
      ) : null}
    </main>
  );
}
