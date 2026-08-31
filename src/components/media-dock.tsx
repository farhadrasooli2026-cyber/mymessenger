"use client";

import { useMemo, useRef, useState } from "react";
import { Camera, Image as ImageIcon, Paperclip, Send, Trash2, X } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import { encryptBytes, encryptText, loadOrCreateThreadKey } from "@/lib/e2ee";
import { compressImage, fileToBytes } from "@/lib/media-encode";
import {
  MEDIA_CHUNK,
  QUALITY_LABELS,
  STICKERS,
  formatBytes,
  kindFromClass,
  scanAttachment,
  type MediaMeta,
  type Quality,
} from "@/lib/media";
import { DisappearPicker, msFromChoice, type TimerChoice } from "@/components/disappear-picker";

type Draft = {
  id: string;
  file: File;
  url: string;
  kind: "photo" | "video" | "file";
  warning?: string;
};

function newId() {
  return crypto.randomUUID?.() ?? Math.random().toString(16).slice(2);
}

export function MediaDock({
  threadId,
  disabled,
  onSent,
}: {
  threadId: string;
  disabled?: boolean;
  onSent: () => void;
}) {
  const galleryRef = useRef<HTMLInputElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const camPhotoRef = useRef<HTMLInputElement>(null);
  const camVideoRef = useRef<HTMLInputElement>(null);
  const [open, setOpen] = useState(false);
  const [drafts, setDrafts] = useState<Draft[]>([]);
  const [active, setActive] = useState(0);
  const [quality, setQuality] = useState<Quality>("standard");
  const [caption, setCaption] = useState("");
  const [viewOnce, setViewOnce] = useState(false);
  const [disappear, setDisappear] = useState<TimerChoice>("inherit");
  const [customMs, setCustomMs] = useState(120_000);
  const [mute, setMute] = useState(false);
  const [trimStart, setTrimStart] = useState(0);
  const [trimEnd, setTrimEnd] = useState(0);
  const [rotation, setRotation] = useState(0);
  const [textOverlay, setTextOverlay] = useState("");
  const [drawOn, setDrawOn] = useState(false);
  const [progress, setProgress] = useState<number | null>(null);
  const [paused, setPaused] = useState(false);
  const pauseRef = useRef(false);
  const abortRef = useRef(false);
  const [nixoOpen, setNixoOpen] = useState(false);
  const [nixoItems, setNixoItems] = useState<{ id: string; name: string; mediaUrl: string }[]>([]);
  const [audioOpen, setAudioOpen] = useState(false);
  const [audioItems, setAudioItems] = useState<{ id: string; title: string; artist: string; streamUrl: string; catalog: boolean }[]>([]);
  const [videoTone, setVideoTone] = useState("");
  const canvasRef = useRef<HTMLCanvasElement>(null);

  function addFiles(list: FileList | File[]) {
    const next: Draft[] = [];
    Array.from(list).forEach((file) => {
      const scan = scanAttachment(file.name, file.type || "application/octet-stream", file.size);
      if (!scan.ok) {
        toast.error(scan.warning ?? "فایل مجاز نیست.");
        return;
      }
      next.push({
        id: newId(),
        file,
        url: URL.createObjectURL(file),
        kind: kindFromClass(scan.mimeClass),
        warning: scan.warning,
      });
    });
    if (!next.length) return;
    setDrafts((d) => [...d, ...next].slice(0, 12));
    setOpen(true);
    setActive(0);
  }

  const current = drafts[active];

  async function paintPhoto(): Promise<Blob | null> {
    if (!current || current.kind !== "photo") return current?.file ?? null;
    const img = new Image();
    img.src = current.url;
    await img.decode();
    const canvas = document.createElement("canvas");
    canvas.width = img.width;
    canvas.height = img.height;
    const ctx = canvas.getContext("2d");
    if (!ctx) return current.file;
    ctx.translate(canvas.width / 2, canvas.height / 2);
    ctx.rotate((rotation * Math.PI) / 180);
    ctx.drawImage(img, -img.width / 2, -img.height / 2);
    if (textOverlay) {
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.fillStyle = "#fbbf24";
      ctx.font = "bold 42px Vazirmatn, sans-serif";
      ctx.fillText(textOverlay, 24, canvas.height - 36);
    }
    const overlay = canvasRef.current;
    if (overlay) {
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.drawImage(overlay, 0, 0, canvas.width, canvas.height);
    }
    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/jpeg", 0.92));
    return blob;
  }

  async function uploadOne(draft: Draft) {
    abortRef.current = false;
    pauseRef.current = false;
    setPaused(false);
    let working: Blob = draft.file;
    if (draft.kind === "photo") {
      const painted = await paintPhoto();
      working = await compressImage(painted ?? draft.file, quality);
    }
    const bytes = await fileToBytes(working);
    const key = await loadOrCreateThreadKey(threadId);
    const blobId = newId().replace(/-/g, "").slice(0, 24);
    const chunks = Math.ceil(bytes.length / MEDIA_CHUNK);
    const resumeKey = `nixo.media.chunks.${blobId}`;
    let done: number[] = [];
    try {
      done = JSON.parse(localStorage.getItem(resumeKey) ?? "[]") as number[];
    } catch {
      done = [];
    }
    for (let i = 0; i < chunks; i += 1) {
      while (pauseRef.current && !abortRef.current) {
        await new Promise((r) => setTimeout(r, 180));
      }
      if (abortRef.current) throw new Error("cancel");
      if (done.includes(i)) {
        setProgress(Math.round(((i + 1) / chunks) * 100));
        continue;
      }
      const slice = bytes.slice(i * MEDIA_CHUNK, (i + 1) * MEDIA_CHUNK);
      const envelope = await encryptBytes(key, slice);
      const res = await fetch(`/api/chats/${threadId}/blobs/${blobId}/chunks/${i}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(envelope),
      });
      if (!res.ok) throw new Error("chunk");
      done.push(i);
      localStorage.setItem(resumeKey, JSON.stringify(done));
      setProgress(Math.round(((i + 1) / chunks) * 100));
    }
    const meta: MediaMeta = {
      name: draft.file.name,
      mime: working.type || draft.file.type || "application/octet-stream",
      caption,
      quality,
      mute: draft.kind === "video" ? mute : undefined,
      trimStartMs: draft.kind === "video" ? trimStart * 1000 : undefined,
      trimEndMs: draft.kind === "video" && trimEnd > 0 ? trimEnd * 1000 : undefined,
      rotation,
    };
    const envelope = await encryptText(key, JSON.stringify(meta));
    const disappearAfterMs = msFromChoice(disappear, customMs);
    const body: Record<string, unknown> = {
      ...envelope,
      kind: draft.kind,
      blobId,
      chunkCount: chunks,
      byteLength: bytes.length,
      mimeClass: draft.kind === "photo" ? "image" : draft.kind === "video" ? "video" : "file",
      viewOnce: viewOnce && draft.kind !== "file",
      durationMs: draft.kind === "video" ? Math.max(0, (trimEnd || 0) * 1000) : undefined,
    };
    if (disappearAfterMs !== undefined) body.disappearAfterMs = disappearAfterMs;
    const sent = await fetch(`/api/chats/${threadId}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    if (!sent.ok) throw new Error("send");
    localStorage.removeItem(resumeKey);
  }

  async function sendAll() {
    if (!drafts.length) return;
    setProgress(0);
    try {
      for (let i = 0; i < drafts.length; i += 1) {
        setActive(i);
        await uploadOne(drafts[i]!);
      }
      toast.success("رسانه ارسال شد. سرور فایل را نمی‌بیند.");
      drafts.forEach((d) => URL.revokeObjectURL(d.url));
      setDrafts([]);
      setOpen(false);
      setProgress(null);
      setCaption("");
      onSent();
    } catch (err) {
      if (String(err) === "Error: cancel") {
        toast.message("ارسال لغو شد. می‌توانی ادامه بدهی.");
        return;
      }
      toast.error("ارسال ناقص ماند. تلاش دوباره را بزن تا از تکهٔ آخر ادامه شود.");
    }
  }

  const sizeLabel = useMemo(() => {
    if (!current) return "";
    const factor = quality === "original" ? 1 : quality === "high" ? 0.7 : quality === "standard" ? 0.45 : 0.22;
    const est = current.kind === "file" || quality === "original" ? current.file.size : Math.round(current.file.size * factor);
    return `حجم تقریبی: ${formatBytes(est)} · فایل: ${formatBytes(current.file.size)}`;
  }, [current, quality]);

  return (
    <>
      <div className="mb-2 flex gap-1">
        <Button type="button" size="sm" variant="ghost" className="text-amber-200" disabled={disabled} onClick={() => galleryRef.current?.click()} aria-label="گالری">
          <ImageIcon className="size-4" />
        </Button>
        <Button type="button" size="sm" variant="ghost" className="text-amber-200" disabled={disabled} onClick={() => camPhotoRef.current?.click()} aria-label="دوربین عکس">
          <Camera className="size-4" />
        </Button>
        <Button type="button" size="sm" variant="ghost" className="text-xs text-amber-200" disabled={disabled} onClick={() => camVideoRef.current?.click()}>
          ویدیو
        </Button>
        <Button type="button" size="sm" variant="ghost" className="text-xs text-amber-200" disabled={disabled} onClick={async () => {
          const res = await fetch("/api/gallery?kind=all", { cache: "no-store" });
          const data = await res.json();
          setNixoItems(data.items ?? []);
          setNixoOpen(true);
        }}>
          نیکسو
        </Button>
        <Button type="button" size="sm" variant="ghost" className="text-xs text-amber-200" disabled={disabled} onClick={async () => {
          const res = await fetch("/api/music", { cache: "no-store" });
          const data = await res.json();
          setAudioItems([...(data.catalog ?? []), ...(data.items ?? [])].map((t: { id: string; title: string; artist: string; streamUrl: string; catalog?: boolean }) => ({
            id: t.id,
            title: t.title,
            artist: t.artist,
            streamUrl: t.streamUrl,
            catalog: Boolean(t.catalog),
          })));
          setAudioOpen(true);
        }}>
          صوت
        </Button>
        <Button type="button" size="sm" variant="ghost" className="text-amber-200" disabled={disabled} onClick={() => fileRef.current?.click()} aria-label="فایل">
          <Paperclip className="size-4" />
        </Button>
        <input ref={galleryRef} type="file" accept="image/*,video/*" multiple className="hidden" onChange={(e) => e.target.files && addFiles(e.target.files)} />
        <input ref={fileRef} type="file" multiple className="hidden" onChange={(e) => e.target.files && addFiles(e.target.files)} />
        <input ref={camPhotoRef} type="file" accept="image/*" capture="environment" className="hidden" onChange={(e) => e.target.files && addFiles(e.target.files)} />
        <input ref={camVideoRef} type="file" accept="video/*" capture="environment" className="hidden" onChange={(e) => e.target.files && addFiles(e.target.files)} />
      </div>
      {nixoOpen && (
        <div className="fixed inset-0 z-50 grid place-items-center bg-black/70 p-4">
          <div className="max-h-[80dvh] w-full max-w-sm overflow-auto rounded-3xl bg-[#102824] p-4">
            <p className="font-medium">گالری نیکسو</p>
            <div className="mt-2 grid grid-cols-3 gap-2">
              {nixoItems.map((it) => (
                <button
                  key={it.id}
                  type="button"
                  className="rounded-xl bg-white/10 p-1 text-[10px]"
                  onClick={async () => {
                    const res = await fetch(it.mediaUrl);
                    if (!res.ok) {
                      toast.error("دسترسی گالری رد شد.");
                      return;
                    }
                    const blob = await res.blob();
                    addFiles([new File([blob], it.name, { type: blob.type || "application/octet-stream" })]);
                    setNixoOpen(false);
                  }}
                >
                  {it.name}
                </button>
              ))}
            </div>
            <Button type="button" variant="ghost" className="mt-3 w-full text-white" onClick={() => setNixoOpen(false)}>بستن</Button>
          </div>
        </div>
      )}
      {audioOpen && (
        <div className="fixed inset-0 z-50 grid place-items-center bg-black/70 p-4">
          <div className="max-h-[80dvh] w-full max-w-sm overflow-auto rounded-3xl bg-[#102824] p-4">
            <p className="font-medium">صوت نیکسو</p>
            <p className="text-[11px] opacity-60">فایل مجاز خودت یا تن اصل نیکسو. کپی‌رایت تجاری اینجا نیست.</p>
            <div className="mt-2 space-y-1">
              {audioItems.map((it) => (
                <button
                  key={`${it.catalog}-${it.id}`}
                  type="button"
                  className="block w-full rounded-xl bg-white/10 px-3 py-2 text-right text-xs"
                  onClick={async () => {
                    const res = await fetch(it.streamUrl);
                    if (!res.ok) {
                      toast.error("دسترسی صوت رد شد.");
                      return;
                    }
                    const blob = await res.blob();
                    addFiles([new File([blob], `${it.title}.wav`, { type: blob.type || "audio/wav" })]);
                    setAudioOpen(false);
                  }}
                >
                  {it.title} · {it.artist}
                </button>
              ))}
            </div>
            <Button type="button" variant="ghost" className="mt-3 w-full text-white" onClick={() => setAudioOpen(false)}>بستن</Button>
          </div>
        </div>
      )}
      {open && current && (
        <div className="fixed inset-0 z-50 grid place-items-center bg-black/75 p-3">
          <div className="max-h-[94dvh] w-full max-w-lg overflow-auto rounded-3xl bg-[#102824] p-4">
            <div className="flex items-center justify-between">
              <p className="font-medium">ارسال رسانه</p>
              <button type="button" onClick={() => setOpen(false)} aria-label="بستن">
                <X className="size-5" />
              </button>
            </div>
            <div className="mt-3 flex gap-2 overflow-auto">
              {drafts.map((d, i) => (
                <button
                  key={d.id}
                  type="button"
                  className={cn("relative h-16 w-16 shrink-0 overflow-hidden rounded-xl border", i === active ? "border-amber-300" : "border-white/10")}
                  onClick={() => setActive(i)}
                >
                  {d.kind === "photo" ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={d.url} alt="" className="size-full object-cover" />
                  ) : (
                    <span className="grid size-full place-items-center text-[10px]">{d.kind === "video" ? "ویدیو" : "فایل"}</span>
                  )}
                </button>
              ))}
            </div>
            <div className="mt-2 flex gap-2">
              <Button type="button" size="sm" variant="secondary" disabled={active === 0} onClick={() => setDrafts((d) => {
                if (active === 0) return d;
                const copy = [...d];
                const [item] = copy.splice(active, 1);
                copy.splice(active - 1, 0, item!);
                setActive(active - 1);
                return copy;
              })}>
                جلو
              </Button>
              <Button type="button" size="sm" variant="secondary" disabled={active >= drafts.length - 1} onClick={() => setDrafts((d) => {
                if (active >= d.length - 1) return d;
                const copy = [...d];
                const [item] = copy.splice(active, 1);
                copy.splice(active + 1, 0, item!);
                setActive(active + 1);
                return copy;
              })}>
                عقب
              </Button>
              <Button type="button" size="sm" variant="ghost" className="text-rose-200" onClick={() => {
                setDrafts((d) => {
                  const copy = d.filter((_, i) => i !== active);
                  URL.revokeObjectURL(current.url);
                  setActive(Math.max(0, active - 1));
                  if (!copy.length) setOpen(false);
                  return copy;
                });
              }}>
                <Trash2 className="size-3.5" />
                حذف از انتخاب
              </Button>
            </div>
            <div className="mt-3 overflow-hidden rounded-2xl bg-black/30">
              {current.kind === "photo" && (
                <div className="relative">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={current.url} alt="" className="max-h-64 w-full object-contain" style={{ transform: `rotate(${rotation}deg)` }} />
                  <canvas
                    ref={canvasRef}
                    width={640}
                    height={360}
                    className="absolute inset-0 h-full w-full"
                    onPointerDown={(e) => {
                      if (!drawOn) return;
                      const ctx = e.currentTarget.getContext("2d");
                      if (!ctx) return;
                      ctx.strokeStyle = "#fbbf24";
                      ctx.lineWidth = 4;
                      ctx.beginPath();
                      const r = e.currentTarget.getBoundingClientRect();
                      ctx.moveTo(((e.clientX - r.left) / r.width) * 640, ((e.clientY - r.top) / r.height) * 360);
                      e.currentTarget.setPointerCapture(e.pointerId);
                    }}
                    onPointerMove={(e) => {
                      if (!drawOn || e.buttons === 0) return;
                      const ctx = e.currentTarget.getContext("2d");
                      if (!ctx) return;
                      const r = e.currentTarget.getBoundingClientRect();
                      ctx.lineTo(((e.clientX - r.left) / r.width) * 640, ((e.clientY - r.top) / r.height) * 360);
                      ctx.stroke();
                    }}
                  />
                </div>
              )}
              {current.kind === "video" && <video src={current.url} controls className="max-h-64 w-full" muted={mute} />}
              {current.kind === "file" && (
                <div className="p-4 text-sm">
                  <p>{current.file.name}</p>
                  <p className="text-xs text-emerald-100/60">{current.file.type || "file"} · {formatBytes(current.file.size)}</p>
                  {current.file.type.startsWith("audio/") && <audio src={current.url} controls className="mt-2 w-full" />}
                  {current.file.type === "application/pdf" && <iframe title="preview" src={current.url} className="mt-2 h-48 w-full rounded bg-white" />}
                  {current.file.type.startsWith("text/") && <p className="mt-2 text-xs">پیش‌نمایش متن پس از ارسال در حباب فایل.</p>}
                </div>
              )}
            </div>
            {current.kind === "photo" && (
              <div className="mt-2 flex flex-wrap gap-2 text-[11px]">
                <Button type="button" size="sm" variant="secondary" onClick={() => setRotation((r) => r + 90)}>چرخش</Button>
                <Button type="button" size="sm" variant="secondary" onClick={() => setDrawOn((v) => !v)}>{drawOn ? "پایان طراحی" : "طراحی"}</Button>
                <Input value={textOverlay} onChange={(e) => setTextOverlay(e.target.value)} placeholder="متن روی عکس" className="h-8 max-w-40 bg-black/20 text-xs" />
                {STICKERS.map((s) => (
                  <button key={s} type="button" className="text-lg" onClick={() => setTextOverlay((t) => t + s)}>
                    {s}
                  </button>
                ))}
              </div>
            )}
            {current.kind === "video" && (
              <div className="mt-2 grid grid-cols-2 gap-2 text-[11px]">
                <label className="flex items-center gap-2">
                  <input type="checkbox" checked={mute} onChange={(e) => setMute(e.target.checked)} />
                  بی‌صدا
                </label>
                <label>
                  شروع ثانیه
                  <Input type="number" min={0} value={trimStart} onChange={(e) => setTrimStart(Number(e.target.value) || 0)} className="mt-1 h-8 bg-black/20" />
                </label>
                <label>
                  پایان ثانیه
                  <Input type="number" min={0} value={trimEnd} onChange={(e) => setTrimEnd(Number(e.target.value) || 0)} className="mt-1 h-8 bg-black/20" />
                </label>
                <Button type="button" size="sm" variant="secondary" onClick={() => setRotation((r) => r + 90)}>چرخش پخش</Button>
                <label className="col-span-2">
                  صدای مجاز نیکسو روی ویدیو (برچسب مجوز؛ میکس حرفه‌ای جدا است)
                  <select className="mt-1 w-full rounded bg-black/30 p-1" value={videoTone} onChange={(e) => { setVideoTone(e.target.value); if (e.target.value) setCaption((c) => c.includes("♪") ? c : `${c} ♪ ${e.target.value}`.trim()); }}>
                    <option value="">بدون تن اصل</option>
                    <option value="نبض کهربا">نبض کهربا</option>
                    <option value="نسیم سبز">نسیم سبز</option>
                    <option value="شب آرام">شب آرام</option>
                  </select>
                </label>
              </div>
            )}
            <p className="mt-2 text-[11px] text-emerald-100/60">{sizeLabel}</p>
            <div className="mt-2 flex flex-wrap gap-1 text-[11px]">
              {QUALITY_LABELS.map((q) => (
                <button key={q.id} type="button" className={cn("rounded-full px-2 py-1", quality === q.id ? "bg-amber-300 text-[#102824]" : "bg-white/10")} onClick={() => setQuality(q.id)}>
                  {q.fa}
                </button>
              ))}
              {current.kind !== "file" && (
                <button type="button" className={cn("rounded-full px-2 py-1", viewOnce ? "bg-amber-300 text-[#102824]" : "bg-white/10")} onClick={() => setViewOnce((v) => !v)}>
                  View Once
                </button>
              )}
            </div>
            <div className="mt-2">
              <DisappearPicker value={disappear} onChange={setDisappear} customMs={customMs} onCustomMs={setCustomMs} allowInherit />
            </div>
            <Textarea value={caption} onChange={(e) => setCaption(e.target.value)} placeholder="کپشن" className="mt-2 min-h-16 bg-black/20" maxLength={400} />
            {progress !== null && (
              <div className="mt-3 space-y-2">
                <div className="h-2 overflow-hidden rounded-full bg-white/10">
                  <div className="h-full bg-amber-300" style={{ width: `${progress}%` }} />
                </div>
                <p className="text-xs">{progress}%</p>
                <div className="flex gap-2">
                  <Button type="button" size="sm" variant="secondary" onClick={() => { pauseRef.current = !pauseRef.current; setPaused(pauseRef.current); }}>
                    {paused ? "ادامه" : "مکث"}
                  </Button>
                  <Button type="button" size="sm" variant="ghost" className="text-rose-200" onClick={() => { abortRef.current = true; pauseRef.current = false; }}>
                    لغو
                  </Button>
                  <Button type="button" size="sm" variant="secondary" onClick={() => void sendAll()}>تلاش دوباره</Button>
                </div>
              </div>
            )}
            <div className="mt-4 flex gap-2">
              <Button type="button" variant="ghost" className="flex-1 text-white" onClick={() => setOpen(false)}>انصراف</Button>
              <Button type="button" className="flex-1 bg-amber-300 text-[#102824]" onClick={() => void sendAll()} disabled={progress !== null && !paused}>
                <Send className="size-4" />
                ارسال {drafts.length > 1 ? `(${drafts.length})` : ""}
              </Button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
