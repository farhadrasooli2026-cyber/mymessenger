"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { toast } from "sonner";
import { NixoMark } from "@/components/nixo-mark";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { CameraCapture } from "@/components/camera-capture";
import { formatBytes } from "@/lib/media";
import { GALLERY_KIND_FA, type GalleryKind } from "@/lib/gallery-types";

type Item = {
  id: string;
  kind: GalleryKind;
  name: string;
  mime: string;
  size: number;
  caption: string;
  privacy: string;
  sourceChat: string;
  createdAt: number;
  deletedAt: number | null;
  thumb: string;
  mediaUrl: string;
  duplicateOf: string | null;
};

const TABS: (GalleryKind | "all")[] = ["all", "photo", "video", "gif", "voice", "audio", "document", "file", "link"];

export function GalleryPane() {
  const [kind, setKind] = useState<GalleryKind | "all">("all");
  const [q, setQ] = useState("");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [chat, setChat] = useState("");
  const [sender, setSender] = useState("");
  const [cursor, setCursor] = useState<string | null>(null);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [items, setItems] = useState<Item[]>([]);
  const [albums, setAlbums] = useState<{ id: string; name: string; itemIds: string[] }[]>([]);
  const [stats, setStats] = useState<{ photos: number; videos: number; files: number; documents: number; cache: number; total: number; count: number } | null>(null);
  const [chats, setChats] = useState<string[]>([]);
  const [chatIndex, setChatIndex] = useState<{ id: string; kind: string; peerName: string; createdAt: number; size: number }[]>([]);
  const [selected, setSelected] = useState<string[]>([]);
  const [locked, setLocked] = useState(false);
  const [pin, setPin] = useState("");
  const [albumName, setAlbumName] = useState("");
  const [albumId, setAlbumId] = useState("");
  const [dl, setDl] = useState<number | null>(null);
  const [camera, setCamera] = useState(false);
  const [view, setView] = useState<Item | null>(null);
  const [trash, setTrash] = useState(false);
  const [progress, setProgress] = useState<number | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const abort = useRef(false);

  const load = useCallback(async () => {
    const params = new URLSearchParams({ kind });
    if (q) params.set("q", q);
    if (from) params.set("from", String(new Date(from).getTime()));
    if (to) params.set("to", String(new Date(to).getTime() + 86_399_000));
    if (chat) params.set("chat", chat);
    if (trash) params.set("trash", "1");
    if (albumId) params.set("album", albumId);
    if (sender) params.set("sender", sender);
    if (cursor) params.set("cursor", cursor);
    const res = await fetch(`/api/gallery?${params}`, { cache: "no-store" });
    const data = await res.json();
    setLocked(Boolean(data.locked));
    setItems((prev) => (cursor ? [...prev, ...(data.items ?? [])] : (data.items ?? [])));
    setNextCursor(data.nextCursor ?? null);
    setAlbums(data.albums ?? []);
    setStats(data.stats ?? null);
    setChats(data.chats ?? []);
  }, [kind, q, from, to, chat, trash, albumId, sender, cursor]);

  useEffect(() => {
    const t = window.setTimeout(() => void load(), 0);
    fetch("/api/gallery?chats=1", { cache: "no-store" })
      .then((r) => r.json())
      .then((d) => setChatIndex(d.chats ?? []))
      .catch(() => undefined);
    return () => window.clearTimeout(t);
  }, [load]);

  async function uploadFiles(files: FileList | File[]) {
    abort.current = false;
    setProgress(0);
    const list = Array.from(files);
    let i = 0;
    try {
      for (const file of list) {
        if (abort.current) break;
        const dataUrl = await new Promise<string>((resolve, reject) => {
          const r = new FileReader();
          r.onload = () => resolve(String(r.result));
          r.onerror = () => reject(new Error("read"));
          r.readAsDataURL(file);
        });
        const res = await fetch("/api/gallery", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ name: file.name, mime: file.type, dataUrl, privacy: "private" }),
        });
        const data = await res.json();
        if (!res.ok) toast.error(data.error ?? "آپلود نشد.");
        else if (data.duplicate) toast.message("فایل تکراری شناسایی شد؛ ذخیره شد با ارجاع تکراری.");
        i += 1;
        setProgress(Math.round((i / list.length) * 100));
      }
      await load();
    } catch {
      toast.error("آپلود شکست. Retry بزن.");
    } finally {
      setProgress(null);
    }
  }

  async function act(body: Record<string, unknown>) {
    const res = await fetch("/api/gallery", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    const data = await res.json();
    if (!res.ok) toast.error(data.error ?? "انجام نشد.");
    await load();
    setSelected([]);
  }

  async function downloadSelected() {
    const targets = items.filter((i) => selected.includes(i.id) && i.mediaUrl);
    if (!targets.length) {
      toast.error("چیزی انتخاب نشده.");
      return;
    }
    abort.current = false;
    setDl(0);
    let i = 0;
    try {
      for (const it of targets) {
        if (abort.current) break;
        const res = await fetch(it.mediaUrl, { cache: "no-store" });
        if (!res.ok) {
          toast.error("دانلود مجاز نیست.");
          break;
        }
        const blob = await res.blob();
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = it.name;
        a.click();
        URL.revokeObjectURL(url);
        i += 1;
        setDl(Math.round((i / targets.length) * 100));
      }
    } catch {
      toast.error("دانلود شکست. Retry بزن.");
    } finally {
      setDl(null);
    }
  }

  if (locked) {
    return (
      <main className="min-h-dvh bg-[#071614] p-6 text-emerald-50">
        <div className="mx-auto max-w-md space-y-3">
          <NixoMark size={40} />
          <h1 className="text-xl font-semibold">گالری قفل است</h1>
          <Input type="password" value={pin} onChange={(e) => setPin(e.target.value)} placeholder="پین" className="bg-black/20" />
          <Button className="bg-amber-300 text-[#102824]" onClick={() => void fetch("/api/gallery", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "unlock", pin }) }).then(load)}>
            باز کردن
          </Button>
        </div>
      </main>
    );
  }

  return (
    <main className="min-h-dvh bg-[#071614] p-4 text-emerald-50">
      <div className="mx-auto max-w-3xl space-y-4">
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <NixoMark size={36} />
            <div>
              <p className="text-xs text-amber-200">NIXO Gallery</p>
              <h1 className="text-xl font-semibold">رسانه حساب تو</h1>
            </div>
          </div>
          <Link href="/app/settings/media" className="text-xs text-amber-200">Settings → Data & Storage → Media</Link>
        </div>
        <div className="flex flex-wrap gap-1 text-[11px]">
          {TABS.map((t) => (
            <button key={t} type="button" className={`rounded-full px-2 py-1 ${kind === t ? "bg-amber-300 text-[#102824]" : "bg-white/10"}`} onClick={() => { setCursor(null); setKind(t); }}>
              {t === "all" ? "همه" : GALLERY_KIND_FA[t]}
            </button>
          ))}
          <button type="button" className={`rounded-full px-2 py-1 ${trash ? "bg-rose-400 text-black" : "bg-white/10"}`} onClick={() => setTrash((v) => !v)}>Recently Deleted</button>
        </div>
        <div className="flex flex-wrap gap-2">
          <Input value={q} onChange={(e) => { setCursor(null); setQ(e.target.value); }} placeholder="جستجو نام، چت، نوع" className="h-9 max-w-xs bg-black/20" />
          <Input value={sender} onChange={(e) => { setCursor(null); setSender(e.target.value); }} placeholder="فرستنده" className="h-9 w-28 bg-black/20" />
          <input type="date" className="rounded bg-black/30 px-1 text-xs" value={from} onChange={(e) => setFrom(e.target.value)} />
          <input type="date" className="rounded bg-black/30 px-1 text-xs" value={to} onChange={(e) => setTo(e.target.value)} />
          <select className="rounded bg-black/30 px-2 text-xs" value={chat} onChange={(e) => setChat(e.target.value)}>
            <option value="">همهٔ چت‌ها</option>
            {chats.map((c) => (
              <option key={c} value={c}>{c}</option>
            ))}
          </select>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button type="button" size="sm" className="bg-amber-300 text-[#102824]" onClick={() => fileRef.current?.click()}>گالری دستگاه</Button>
          <Button type="button" size="sm" variant="secondary" onClick={() => setCamera(true)}>دوربین نیکسو</Button>
          <input ref={fileRef} type="file" accept="image/*,video/*,audio/*,.pdf,.zip,.docx" multiple className="hidden" onChange={(e) => e.target.files && void uploadFiles(e.target.files)} />
        </div>
        {progress !== null && (
          <div>
            <p className="text-xs">Uploading... {progress}%</p>
            <Button type="button" size="sm" variant="ghost" className="text-rose-200" onClick={() => { abort.current = true; }}>Cancel</Button>
            <Button type="button" size="sm" variant="secondary" onClick={() => fileRef.current?.click()}>Retry</Button>
          </div>
        )}
        {stats && (
          <p className="text-xs text-emerald-100/60">
            Storage: {stats.count} مورد · عکس {formatBytes(stats.photos)} · ویدیو {formatBytes(stats.videos)} · فایل {formatBytes(stats.files)} · سند {formatBytes(stats.documents)} · Cache {formatBytes(stats.cache)} · جمع {formatBytes(stats.total)}
          </p>
        )}
        <div className="flex flex-wrap gap-2 text-xs">
          <Input value={albumName} onChange={(e) => setAlbumName(e.target.value)} placeholder="نام آلبوم (Trip / Family)" className="h-8 max-w-40 bg-black/20" />
          <Button type="button" size="sm" variant="secondary" onClick={() => void act({ action: "album", name: albumName, itemIds: selected })}>Create Album</Button>
          <Button type="button" size="sm" variant="secondary" disabled={!selected.length} onClick={() => void act({ action: "trash", ids: selected })}>حذف ({selected.length})</Button>
          <Button type="button" size="sm" variant="secondary" disabled={!selected.length} onClick={() => void downloadSelected()}>Download</Button>
          <Button type="button" size="sm" variant="ghost" disabled={!selected.length} onClick={() => { toast.message("اشتراک محلی. Forward در چت با محدودیت صاحب محتوا اعمال می‌شود؛ اسکرین‌شات تضمین نمی‌شود."); }}>Share</Button>
          <Button type="button" size="sm" variant="ghost" disabled={!selected.length} onClick={() => void act({ action: "privacy", ids: selected, privacy: "private" })}>Private</Button>
          <Button type="button" size="sm" variant="ghost" disabled={!selected.length} onClick={() => void act({ action: "privacy", ids: selected, privacy: "shared" })}>Shared</Button>
          {trash && <Button type="button" size="sm" variant="secondary" onClick={() => void act({ action: "restore", ids: selected })}>بازگردانی</Button>}
          {trash && <Button type="button" size="sm" className="bg-rose-500 text-white" onClick={() => void act({ action: "trash", ids: selected, permanent: true })}>Permanent Delete</Button>}
          <Button type="button" size="sm" variant="ghost" onClick={() => void act({ action: "clear-cache" })}>Clear Cache</Button>
        </div>
        {dl !== null && (
          <p className="text-xs">Downloading... {dl}% <button type="button" className="text-rose-200" onClick={() => { abort.current = true; }}>Cancel</button></p>
        )}
        <div className="flex flex-wrap gap-2">
          <button type="button" className={`rounded-full px-3 py-1 text-xs ${albumId === "" ? "bg-amber-300 text-[#102824]" : "bg-white/10"}`} onClick={() => setAlbumId("")}>همه آلبوم‌ها</button>
          {albums.map((a) => (
            <span key={a.id} className="inline-flex items-center gap-1 rounded-full bg-white/10 px-2 py-1 text-xs">
              <button type="button" className={albumId === a.id ? "text-amber-200" : ""} onClick={() => setAlbumId(a.id)}>
                {a.name} ({a.itemIds.length})
              </button>
              <button type="button" title="افزودن انتخاب‌شده" onClick={() => void act({ action: "album", id: a.id, name: a.name, itemIds: [...new Set([...a.itemIds, ...selected])] })}>+</button>
              <button type="button" title="حذف از آلبوم" onClick={() => void act({ action: "album", id: a.id, name: a.name, itemIds: a.itemIds.filter((id) => !selected.includes(id)) })}>−</button>
              <button type="button" title="تغییر نام" onClick={() => albumName && void act({ action: "album", id: a.id, name: albumName, itemIds: a.itemIds })}>نام</button>
              <button type="button" title="حذف آلبوم" className="text-rose-200" onClick={() => void act({ action: "album", id: a.id, name: a.name, delete: true })}>×</button>
            </span>
          ))}
        </div>
        <div className="grid grid-cols-3 gap-2 sm:grid-cols-4">
          {items.map((it) => (
            <button
              key={it.id}
              type="button"
              className={`overflow-hidden rounded-2xl bg-white/5 text-left text-[10px] ${selected.includes(it.id) ? "ring-2 ring-amber-300" : ""}`}
              onClick={() => setSelected((s) => (s.includes(it.id) ? s.filter((x) => x !== it.id) : [...s, it.id]))}
              onDoubleClick={() => setView(it)}
            >
              {it.thumb || it.kind === "photo" || it.kind === "gif" ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={it.thumb || it.mediaUrl} alt="" className="aspect-square w-full object-cover" />
              ) : (
                <div className="grid aspect-square place-items-center">{GALLERY_KIND_FA[it.kind]}</div>
              )}
              <p className="truncate px-1 py-1">{it.name}</p>
            </button>
          ))}
        </div>
        {items.length === 0 && <p className="text-sm opacity-50">رسانه‌ای در این فیلتر نیست.</p>}
        {nextCursor ? (
          <Button type="button" variant="secondary" onClick={() => setCursor(nextCursor)}>موارد بیشتر</Button>
        ) : null}
        <section className="rounded-2xl bg-white/5 p-3 text-xs">
          <h2 className="font-medium">رسانهٔ چت E2EE</h2>
          <p className="opacity-60">متادیتا روی سرور است؛ فایل رمزشده فقط در گفتگو با کلید دستگاه باز می‌شود.</p>
          {chatIndex.map((c) => (
            <p key={c.id}>{c.peerName} · {c.kind} · {formatBytes(c.size)} · {new Date(c.createdAt).toLocaleDateString("fa-IR")}</p>
          ))}
        </section>
        <p className="text-[11px] opacity-50">دسترسی فایل با نشست و توکن منقضی است. لینک مستقیم برای دیگری کار نمی‌کند. نیکسو اسکرین‌شات همهٔ دستگاه‌ها را تضمین نمی‌کند. مجوز دوربین/گالری از سیستم‌عامل است.</p>
        <Link href="/app" className="text-sm text-amber-200">بازگشت</Link>
      </div>
      {camera && (
        <div className="fixed inset-0 z-50 grid place-items-center bg-black/80 p-4">
          <div className="w-full max-w-md rounded-3xl bg-[#102824] p-4">
            <CameraCapture
              onCancel={() => setCamera(false)}
              onCapture={(dataUrl, captured) => {
                void fetch("/api/gallery", {
                  method: "POST",
                  headers: { "Content-Type": "application/json" },
                  body: JSON.stringify({ name: captured === "video" ? "camera.webm" : "camera.jpg", dataUrl }),
                }).then(() => { setCamera(false); void load(); });
              }}
            />
          </div>
        </div>
      )}
      {view && (
        <div className="fixed inset-0 z-50 grid place-items-center bg-black/85 p-4" onClick={() => setView(null)}>
          <div className="max-h-[90dvh] w-full max-w-lg overflow-auto rounded-3xl bg-[#102824] p-4" onClick={(e) => e.stopPropagation()}>
            <p className="font-medium">{view.name}</p>
            <p className="text-[11px] opacity-60">{view.mime} · {formatBytes(view.size)} · {new Date(view.createdAt).toLocaleString("fa-IR")} · {view.sourceChat || "بدون چت"} · {view.privacy}</p>
            {(view.kind === "photo" || view.kind === "gif") && (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={view.mediaUrl} alt="" className="mt-2 max-h-80 w-full object-contain" />
            )}
            {view.kind === "video" && <video src={view.mediaUrl} controls className="mt-2 w-full" />}
            <div className="mt-3 flex flex-wrap gap-2">
              <a className="text-xs text-amber-200" href={view.mediaUrl} download={view.name}>Download</a>
              <Button type="button" size="sm" variant="secondary" onClick={() => { void navigator.clipboard.writeText(view.name); toast.message("اشتراک محلی. محدودیت هدایت تضمین اسکرین‌شات نیست."); }}>Share</Button>
              <Button type="button" size="sm" variant="ghost" className="text-rose-200" onClick={() => { void act({ action: "trash", ids: [view.id] }); setView(null); }}>حذف</Button>
            </div>
          </div>
        </div>
      )}
    </main>
  );
}
