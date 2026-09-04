"use client";

import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { CameraCapture } from "@/components/camera-capture";
import { STORY_FILTERS, STORY_MUSIC, STORY_PURPOSE_FA, STORY_STICKERS, type StoryKind, type StoryPurpose } from "@/lib/story-types";
import { cn } from "@/lib/utils";

const BGS = ["#102824", "#7c2d12", "#1e3a5f", "#3f3c2e", "#4c1d95", "#134e4a"];

async function compressImage(file: File): Promise<string> {
  const bmp = await createImageBitmap(file);
  const canvas = document.createElement("canvas");
  const scale = Math.min(1, 540 / Math.max(bmp.width, bmp.height));
  canvas.width = Math.round(bmp.width * scale);
  canvas.height = Math.round(bmp.height * scale);
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("canvas");
  ctx.drawImage(bmp, 0, 0, canvas.width, canvas.height);
  return canvas.toDataURL("image/jpeg", 0.62);
}

async function compressDataUrl(dataUrl: string): Promise<string> {
  const blob = await (await fetch(dataUrl)).blob();
  return compressImage(new File([blob], "shot.jpg", { type: blob.type || "image/jpeg" }));
}

export function StoryComposer({
  onClose,
  onPublished,
  initialKind,
}: {
  onClose: () => void;
  onPublished: () => void;
  initialKind?: StoryKind;
}) {
  const [step, setStep] = useState(initialKind === "text" || initialKind === "sticker" || initialKind === "location" ? 2 : initialKind === "photo" || initialKind === "video" || initialKind === "gif" ? 1 : 0);
  const [mode, setMode] = useState<"pick" | "camera" | "edit">(
    initialKind === "photo" || initialKind === "video" || initialKind === "gif"
      ? "camera"
      : initialKind === "text" || initialKind === "sticker" || initialKind === "location"
        ? "edit"
        : "pick",
  );
  const [kind, setKind] = useState<StoryKind>(initialKind ?? "text");
  const [body, setBody] = useState("");
  const [caption, setCaption] = useState("");
  const [bg, setBg] = useState(BGS[0]!);
  const [font, setFont] = useState("vazir");
  const [align, setAlign] = useState<"right" | "center" | "left">("right");
  const [filter, setFilter] = useState("none");
  const [rotate, setRotate] = useState(0);
  const [zoom, setZoom] = useState(1);
  const [overlay, setOverlay] = useState("");
  const [textSize, setTextSize] = useState(22);
  const [textX, setTextX] = useState(50);
  const [textY, setTextY] = useState(50);
  const [blur, setBlur] = useState(0);
  const [drawData, setDrawData] = useState("");
  const [drawing, setDrawing] = useState(false);
  const [media, setMedia] = useState("");
  const [musicId, setMusicId] = useState<string | null>(null);
  const [linkUrl, setLinkUrl] = useState("");
  const [location, setLocation] = useState("");
  const [visibility, setVisibility] = useState("everyone");
  const [allowShare, setAllowShare] = useState(true);
  const [allowReplies, setAllowReplies] = useState(true);
  const [allowReactions, setAllowReactions] = useState(true);
  const [purpose, setPurpose] = useState<StoryPurpose>("general");
  const [busy, setBusy] = useState(false);
  const [uploadState, setUploadState] = useState<"idle" | "uploading" | "fail">("idle");
  const [people, setPeople] = useState<{ id: string; name: string; username: string | null }[]>([]);
  const [allowIds, setAllowIds] = useState<string[]>([]);
  const [hideFromIds, setHideFromIds] = useState<string[]>([]);
  const [stickers, setStickers] = useState<{ emoji: string; x: number; y: number }[]>([]);
  const [videoDurationMs, setVideoDurationMs] = useState(0);
  const [lastPayload, setLastPayload] = useState<Record<string, unknown> | null>(null);
  const videoRef = useRef<HTMLInputElement>(null);
  const audioRef = useRef<HTMLInputElement>(null);
  const galleryRef = useRef<HTMLInputElement>(null);
  const previewRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!initialKind) return;
    if (initialKind === "photo" || initialKind === "video" || initialKind === "gif") {
      setKind(initialKind);
      setMode("camera");
      setStep(1);
    } else if (initialKind === "text" || initialKind === "sticker" || initialKind === "location") {
      setKind(initialKind);
      setMode("edit");
      setStep(2);
    }
  }, [initialKind]);

  useEffect(() => {
    fetch("/api/stories?settings=1", { cache: "no-store" })
      .then((r) => r.json())
      .then((d) => {
        if (d.settings?.people) setPeople(d.settings.people);
        if (d.settings?.defaultStoryPrivacy) setVisibility(d.settings.defaultStoryPrivacy);
        if (typeof d.settings?.storyAllowShare === "boolean") setAllowShare(d.settings.storyAllowShare);
        if (typeof d.settings?.storyAllowReplies === "boolean") setAllowReplies(d.settings.storyAllowReplies);
        if (Array.isArray(d.settings?.defaultHideFromIds)) setHideFromIds(d.settings.defaultHideFromIds);
      })
      .catch(() => undefined);
  }, []);

  const filterCss = STORY_FILTERS.find((f) => f.id === filter)?.css ?? "none";

  function payload(draft = false) {
    const mentions = [...`${body} ${caption}`.matchAll(/@([a-zA-Z0-9_]+)/g)].map((m) => m[1]!);
    return {
      kind,
      body,
      caption,
      bg,
      font,
      align,
      filter,
      rotate,
      zoom,
      overlay,
      textSize,
      textX,
      textY,
      blur,
      drawData,
      stickers,
      location,
      media,
      musicId,
      linkUrl,
      mentions,
      allowShare,
      allowReplies,
      allowReactions,
      visibility,
      allowIds,
      hideFromIds,
      purpose,
      draft,
      videoDurationMs,
      cropX: 50,
      cropY: 50,
    };
  }

  async function send(next: Record<string, unknown>) {
    setBusy(true);
    setUploadState("uploading");
    setLastPayload(next);
    try {
      const res = await fetch("/api/stories", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(next),
      });
      const data = await res.json();
      if (!res.ok) {
        setUploadState("fail");
        toast.error(data.error ?? "استوری منتشر نشد.");
        return false;
      }
      setUploadState("idle");
      toast.success(next.draft ? "پیش‌نویس ذخیره شد." : "استوری تا ۲۴ ساعت دیده می‌شود.");
      onPublished();
      return true;
    } catch {
      setUploadState("fail");
      toast.error("آپلود شکست. Retry بزن.");
      return false;
    } finally {
      setBusy(false);
    }
  }

  function startKind(next: StoryKind) {
    setKind(next);
    if (next === "photo" || next === "video" || next === "gif") setMode("camera");
    else if (next === "audio") {
      audioRef.current?.click();
    } else {
      setMode("edit");
      setStep(2);
    }
  }

  return (
    <div className="fixed inset-0 z-50 overflow-auto bg-black/85 p-4" onClick={onClose}>
      <div className="mx-auto max-w-md rounded-3xl bg-[#102824] p-4" onClick={(e) => e.stopPropagation()}>
        <p className="text-xs text-amber-200">Create Story · {["نوع", "رسانه", "ویرایش", "حریم", "انتشار"][step]}</p>
        {step === 0 && mode === "pick" && (
          <>
            <h2 className="mt-1 text-lg font-semibold">Create Story</h2>
            <div className="mt-3 grid grid-cols-3 gap-2">
              {(["text", "photo", "video", "audio", "gif", "sticker", "location"] as StoryKind[]).map((k) => (
                <Button key={k} type="button" variant="secondary" className="h-16 capitalize" onClick={() => { startKind(k); if (k === "text" || k === "sticker" || k === "location") setStep(2); }}>
                  {k === "text" ? "متن" : k === "photo" ? "عکس" : k === "video" ? "ویدیو" : k === "audio" ? "صوت" : k === "gif" ? "GIF" : k === "sticker" ? "استیکر" : "موقعیت"}
                </Button>
              ))}
            </div>
            <Button type="button" variant="secondary" className="mt-2 w-full" onClick={() => galleryRef.current?.click()}>Gallery</Button>
            <Button type="button" variant="ghost" className="mt-1 w-full text-white" onClick={() => videoRef.current?.click()}>ویدیو از گالری</Button>
            <input ref={galleryRef} type="file" accept="image/*,image/gif" className="hidden" onChange={async (e) => {
              const file = e.target.files?.[0];
              if (!file) return;
              setMedia(await compressImage(file));
              setKind(file.type.includes("gif") ? "gif" : "photo");
              setMode("edit");
              setStep(2);
            }} />
            <input ref={videoRef} type="file" accept="video/mp4,video/webm" className="hidden" onChange={async (e) => {
              const file = e.target.files?.[0];
              if (!file) return;
              if (file.size > 280_000) {
                toast.error("ویدیو را کوتاه و کم‌حجم انتخاب کن.");
                return;
              }
              const url = await new Promise<string>((resolve, reject) => {
                const r = new FileReader();
                r.onload = () => resolve(String(r.result));
                r.onerror = () => reject(new Error("read"));
                r.readAsDataURL(file);
              });
              const el = document.createElement("video");
              el.src = url;
              el.onloadedmetadata = () => setVideoDurationMs(Math.round((el.duration || 0) * 1000));
              setMedia(url);
              setKind("video");
              setMode("edit");
              setStep(2);
            }} />
            <input ref={audioRef} type="file" accept="audio/webm,audio/mpeg,audio/mp4,audio/ogg,audio/aac,audio/wav" className="hidden" onChange={async (e) => {
              const file = e.target.files?.[0];
              if (!file) return;
              if (file.size > 280_000) {
                toast.error("فایل صوتی را کوتاه و کم‌حجم انتخاب کن.");
                return;
              }
              const url = await new Promise<string>((resolve, reject) => {
                const r = new FileReader();
                r.onload = () => resolve(String(r.result));
                r.onerror = () => reject(new Error("read"));
                r.readAsDataURL(file);
              });
              setMedia(url);
              setKind("audio");
              setMode("edit");
              setStep(2);
            }} />
            <Button type="button" variant="ghost" className="mt-2 w-full text-white" onClick={onClose}>انصراف</Button>
          </>
        )}
        {mode === "camera" && (
          <CameraCapture
            onCancel={() => { setMode("pick"); setStep(0); }}
            onCapture={(dataUrl, captured) => {
              if (captured === "video") {
                setMedia(dataUrl);
                setKind("video");
                setMode("edit");
                setStep(2);
                return;
              }
              void compressDataUrl(dataUrl).then((url) => {
                setMedia(url);
                setKind(kind === "gif" ? "gif" : "photo");
                setMode("edit");
                setStep(2);
              });
            }}
          />
        )}
        {mode === "edit" && step === 2 && (
          <>
            <p className="text-xs text-amber-200">Edit · برش، چرخش، متن، نقاشی، استیکر، فیلتر، موسیقی، محو</p>
            <div
              ref={previewRef}
              className="relative mt-2 flex min-h-64 items-center justify-center overflow-hidden rounded-3xl p-4"
              style={{ background: bg, textAlign: align, fontFamily: font === "serif" ? "Georgia, serif" : font === "mono" ? "ui-monospace, monospace" : "inherit" }}
              onPointerDown={(e) => {
                if (!drawing || !previewRef.current) return;
                const r = previewRef.current.getBoundingClientRect();
                const x = (((e.clientX - r.left) / r.width) * 100).toFixed(1);
                const y = (((e.clientY - r.top) / r.height) * 100).toFixed(1);
                setDrawData((d) => `${d}|${x},${y}`);
              }}
              onPointerMove={(e) => {
                if (!drawing || e.buttons !== 1 || !previewRef.current) return;
                const r = previewRef.current.getBoundingClientRect();
                const x = (((e.clientX - r.left) / r.width) * 100).toFixed(1);
                const y = (((e.clientY - r.top) / r.height) * 100).toFixed(1);
                setDrawData((d) => `${d} ${x},${y}`);
              }}
            >
              {(kind === "photo" || kind === "gif") && media && (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={media} alt="" className="absolute inset-0 h-full w-full object-cover" style={{ filter: `${filterCss} blur(${blur}px)`, transform: `rotate(${rotate}deg) scale(${zoom})` }} />
              )}
              {kind === "video" && media && (
                <video src={media} className="absolute inset-0 h-full w-full object-cover" muted autoPlay loop playsInline style={{ filter: filterCss }} />
              )}
              {kind === "audio" && media && (
                <div className="relative z-10 w-full px-4">
                  <p className="mb-2 text-center text-amber-200">پیش‌نمایش صوت</p>
                  <audio src={media} controls className="w-full" />
                </div>
              )}
              {drawData.split("|").filter(Boolean).map((stroke, i) => (
                <svg key={i} viewBox="0 0 100 100" preserveAspectRatio="none" className="pointer-events-none absolute inset-0 h-full w-full">
                  <polyline fill="none" stroke="#fbbf24" strokeWidth="1.2" points={stroke.trim()} />
                </svg>
              ))}
              {stickers.map((s, i) => (
                <span key={i} className="absolute text-3xl" style={{ left: `${s.x}%`, top: `${s.y}%` }}>{s.emoji}</span>
              ))}
              {(overlay || kind === "text" || kind === "sticker") && (
                <p className="relative z-10 leading-8" style={{ fontSize: textSize, left: `${textX - 50}%`, top: `${textY - 50}%` }}>
                  {overlay || body || "متن استوری"}
                </p>
              )}
              {kind === "location" && <p className="relative z-10 text-xl">📍 {location || "موقعیت"}</p>}
            </div>
            {(kind === "text" || kind === "sticker") && <Textarea value={body} onChange={(e) => setBody(e.target.value)} placeholder="متن + @username + اموجی" className="mt-2 min-h-20 bg-black/20" maxLength={400} />}
            {kind === "location" && <Input value={location} onChange={(e) => setLocation(e.target.value)} placeholder="مثلاً تهران" className="mt-2 bg-black/20" />}
            {kind !== "text" && kind !== "sticker" && kind !== "location" && <Input value={caption} onChange={(e) => setCaption(e.target.value)} placeholder="کپشن" className="mt-2 bg-black/20" />}
            <Input value={overlay} onChange={(e) => setOverlay(e.target.value)} placeholder="متن روی استوری" className="mt-2 bg-black/20" />
            <div className="mt-2 flex flex-wrap gap-1 text-[11px]">
              <button type="button" className="rounded bg-white/10 px-2 py-1" onClick={() => setTextSize((s) => (s >= 36 ? 16 : s + 4))}>Size {textSize}</button>
              <button type="button" className="rounded bg-white/10 px-2 py-1" onClick={() => setAlign(align === "right" ? "center" : align === "center" ? "left" : "right")}>چینش</button>
              <button
                type="button"
                className="rounded bg-white/10 px-2 py-1"
                onClick={() => setFont(font === "vazir" ? "serif" : font === "serif" ? "mono" : "vazir")}
              >
                قلم {font === "serif" ? "Serif" : font === "mono" ? "Mono" : "Vazir"}
              </button>
              <button type="button" className="rounded bg-white/10 px-2 py-1" onClick={() => setTextX((x) => (x + 10) % 100)}>جای افقی</button>
              <button type="button" className="rounded bg-white/10 px-2 py-1" onClick={() => setTextY((y) => (y + 10) % 100)}>جای عمودی</button>
            </div>
            <div className="mt-2 flex gap-1">
              {BGS.map((c) => (
                <button key={c} type="button" className={cn("size-7 rounded-full", bg === c && "ring-2 ring-white")} style={{ background: c }} onClick={() => setBg(c)} />
              ))}
            </div>
            <div className="mt-2 flex flex-wrap gap-1 text-[11px]">
              {STORY_FILTERS.map((f) => (
                <button key={f.id} type="button" className={cn("rounded px-2 py-1", filter === f.id ? "bg-amber-300 text-[#102824]" : "bg-white/10")} onClick={() => setFilter(f.id)}>{f.label}</button>
              ))}
              <button type="button" className="rounded bg-white/10 px-2" onClick={() => setRotate((r) => r + 90)}>چرخش</button>
              <button type="button" className="rounded bg-white/10 px-2" onClick={() => setZoom((z) => (z >= 1.6 ? 1 : +(z + 0.2).toFixed(1)))}>برش/زوم {zoom}</button>
              <button type="button" className="rounded bg-white/10 px-2" onClick={() => setBlur((b) => (b ? 0 : 6))}>Blur</button>
              <button type="button" className={cn("rounded px-2", drawing ? "bg-amber-300 text-[#102824]" : "bg-white/10")} onClick={() => setDrawing((d) => !d)}>Draw</button>
            </div>
            <p className="mt-2 text-[11px]">استیکر داخلی نیکسو</p>
            <div className="flex flex-wrap gap-1 text-lg">
              {STORY_STICKERS.map((e) => (
                <button key={e} type="button" onClick={() => setStickers((s) => [...s, { emoji: e, x: 20 + s.length * 8, y: 30 }].slice(0, 8))}>{e}</button>
              ))}
            </div>
            <p className="mt-2 text-[11px]">موسیقی مجاز نیکسو (مجوز داخلی — نه کاتالوگ تجاری)</p>
            <div className="flex flex-wrap gap-1 text-[11px]">
              <button type="button" className={cn("rounded px-2 py-1", !musicId ? "bg-amber-300 text-[#102824]" : "bg-white/10")} onClick={() => setMusicId(null)}>بدون موسیقی</button>
              {STORY_MUSIC.map((m) => (
                <button key={m.id} type="button" className={cn("rounded px-2 py-1", musicId === m.id ? "bg-amber-300 text-[#102824]" : "bg-white/10")} onClick={() => setMusicId(m.id)}>{m.label}</button>
              ))}
            </div>
            <a href="/app/music" className="mt-1 block text-[11px] text-amber-200">کتابخانه موسیقی نیکسو</a>
            <Input value={linkUrl} onChange={(e) => setLinkUrl(e.target.value)} placeholder="لینک (https://)" dir="ltr" className="mt-2 bg-black/20 text-left text-xs" />
            <p className="mt-2 text-[11px]">موضوع کسب‌وکار</p>
            <div className="flex flex-wrap gap-1 text-[11px]">
              {(Object.keys(STORY_PURPOSE_FA) as StoryPurpose[]).map((p) => (
                <button key={p} type="button" className={cn("rounded px-2 py-1", purpose === p ? "bg-amber-300 text-[#102824]" : "bg-white/10")} onClick={() => setPurpose(p)}>{STORY_PURPOSE_FA[p]}</button>
              ))}
            </div>
            <div className="mt-3 flex gap-2">
              <Button type="button" variant="ghost" className="flex-1 text-white" onClick={() => { setMode("pick"); setStep(0); }}>قبلی</Button>
              <Button type="button" className="flex-1 bg-amber-300 text-[#102824]" onClick={() => setStep(3)}>Privacy</Button>
            </div>
          </>
        )}
        {step === 3 && (
          <>
            <h2 className="text-lg font-semibold">Privacy</h2>
            <select className="mt-2 w-full rounded-lg bg-black/30 p-2 text-xs" value={visibility} onChange={(e) => setVisibility(e.target.value)}>
              <option value="everyone">Everyone</option>
              <option value="contacts">My Contacts</option>
              <option value="friends">Friends</option>
              <option value="closeFriends">Close Friends</option>
              <option value="selected">Selected Users</option>
              <option value="nobody">Nobody (only me)</option>
            </select>
            {visibility === "selected" && (
              <div className="mt-2 max-h-24 overflow-auto text-[11px]">
                {people.map((p) => (
                  <label key={p.id} className="flex items-center gap-2">
                    <input type="checkbox" checked={allowIds.includes(p.id)} onChange={() => setAllowIds((ids) => (ids.includes(p.id) ? ids.filter((x) => x !== p.id) : [...ids, p.id]))} />
                    {p.name} {p.username ? `@${p.username}` : ""}
                  </label>
                ))}
              </div>
            )}
            <p className="mt-2 text-[11px]">Hide From Selected Users</p>
            <div className="max-h-24 overflow-auto text-[11px]">
              {people.map((p) => (
                <label key={`h-${p.id}`} className="flex items-center gap-2">
                  <input type="checkbox" checked={hideFromIds.includes(p.id)} onChange={() => setHideFromIds((ids) => (ids.includes(p.id) ? ids.filter((x) => x !== p.id) : [...ids, p.id]))} />
                  {p.name}
                </label>
              ))}
            </div>
            <label className="mt-2 flex items-center gap-2 text-xs">
              <input type="checkbox" checked={allowShare} onChange={(e) => setAllowShare(e.target.checked)} />
              اجازهٔ Share
            </label>
            <label className="mt-1 flex items-center gap-2 text-xs">
              <input type="checkbox" checked={allowReplies} onChange={(e) => setAllowReplies(e.target.checked)} />
              اجازهٔ Reply
            </label>
            <label className="mt-1 flex items-center gap-2 text-xs">
              <input type="checkbox" checked={allowReactions} onChange={(e) => setAllowReactions(e.target.checked)} />
              اجازهٔ Reaction
            </label>
            <div className="mt-3 flex gap-2">
              <Button type="button" variant="ghost" className="flex-1 text-white" onClick={() => setStep(2)}>قبلی</Button>
              <Button type="button" className="flex-1 bg-amber-300 text-[#102824]" onClick={() => setStep(4)}>Post</Button>
            </div>
          </>
        )}
        {step === 4 && (
          <>
            <h2 className="text-lg font-semibold">Post</h2>
            <p className="mt-2 text-sm text-emerald-100/70">انتشار ۲۴ساعته روی سرور با حریم انتخاب‌شده. رسانه با دسترسی امضاشده و منقضی سرو می‌شود.</p>
            {uploadState === "uploading" && <p className="mt-2 text-amber-200">Uploading...</p>}
            {uploadState === "fail" && (
              <Button type="button" className="mt-2 w-full bg-amber-300 text-[#102824]" onClick={() => lastPayload && void send(lastPayload)}>Retry</Button>
            )}
            <div className="mt-3 flex gap-2">
              <Button type="button" variant="secondary" className="flex-1" disabled={busy} onClick={() => void send(payload(true))}>Draft</Button>
              <Button type="button" className="flex-1 bg-amber-300 text-[#102824]" disabled={busy} onClick={() => void send(payload(false))}>Post</Button>
            </div>
            <Button type="button" variant="ghost" className="mt-2 w-full text-white" onClick={() => setStep(3)}>قبلی</Button>
          </>
        )}
      </div>
    </div>
  );
}
