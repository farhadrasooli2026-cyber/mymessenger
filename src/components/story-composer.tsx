"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import {
  AlignCenter,
  AlignLeft,
  AlignRight,
  Aperture,
  ArrowRight,
  AudioLines,
  Droplets,
  ImageIcon,
  MapPin,
  Music2,
  Pencil,
  RotateCw,
  Smile,
  Type,
  Video,
  X,
  ZoomIn,
} from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { CameraCapture } from "@/components/camera-capture";
import {
  STORY_FILTERS,
  STORY_MUSIC,
  STORY_PURPOSE_FA,
  STORY_STICKER_GROUPS,
  type StoryKind,
  type StoryPurpose,
} from "@/lib/story-types";
import { cn } from "@/lib/utils";

const BGS = ["#102824", "#7c2d12", "#1e3a5f", "#3f3c2e", "#4c1d95", "#134e4a"];
const STEPS = ["نوع", "رسانه", "ویرایش", "حریم", "انتشار"] as const;
const KINDS: { id: StoryKind; label: string; icon: typeof Type }[] = [
  { id: "text", label: "متن", icon: Type },
  { id: "photo", label: "عکس", icon: ImageIcon },
  { id: "video", label: "ویدیو", icon: Video },
  { id: "audio", label: "صوت", icon: AudioLines },
  { id: "gif", label: "GIF", icon: Aperture },
  { id: "sticker", label: "استیکر", icon: Smile },
  { id: "location", label: "موقعیت", icon: MapPin },
];

type StudioTab = "text" | "look" | "stickers" | "music";

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

function fontFamily(font: string) {
  if (font === "serif") return "Georgia, serif";
  if (font === "mono") return "ui-monospace, monospace";
  return "inherit";
}

function ToolTile({
  active,
  label,
  onClick,
  children,
}: {
  active?: boolean;
  label: string;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "flex min-h-14 flex-col items-center justify-center gap-1 rounded-2xl px-2 py-2.5 text-[11px] leading-tight transition",
        active ? "bg-amber-300 text-[#102824]" : "bg-white/8 text-white/85 hover:bg-white/12",
      )}
    >
      {children}
      <span>{label}</span>
    </button>
  );
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
  const [studio, setStudio] = useState<StudioTab>("text");
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

  const AlignIcon = align === "left" ? AlignLeft : align === "center" ? AlignCenter : AlignRight;

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/80 p-0 sm:items-center sm:p-4">
      <div
        className="flex h-[100dvh] w-full max-w-md flex-col overflow-hidden bg-[#0b1412] text-white sm:h-[min(92dvh,860px)] sm:rounded-[28px] sm:border sm:border-white/10"
        onClick={(e) => e.stopPropagation()}
      >
        <header className="flex items-center gap-3 px-4 pb-2 pt-[max(0.75rem,env(safe-area-inset-top))]">
          <button type="button" className="grid size-10 place-items-center rounded-full bg-white/8" onClick={onClose} aria-label="بستن">
            <X className="size-4" />
          </button>
          <div className="min-w-0 flex-1">
            <p className="text-[11px] tracking-wide text-amber-200/80">ایجاد استوری</p>
            <h2 className="truncate text-base font-semibold">{STEPS[step]}</h2>
          </div>
          <div className="flex gap-1">
            {STEPS.map((_, i) => (
              <span key={i} className={cn("h-1 w-5 rounded-full", i <= step ? "bg-amber-300" : "bg-white/15")} />
            ))}
          </div>
        </header>

        <div className="min-h-0 flex-1 overflow-y-auto px-4 pb-[max(1rem,env(safe-area-inset-bottom))]">
          {step === 0 && mode === "pick" && (
            <div className="pb-4">
              <p className="mb-4 text-sm text-white/55">نوع استوری را انتخاب کن. بعد می‌توانی متن، فیلتر و موسیقی را تنظیم کنی.</p>
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
                {KINDS.map((k) => {
                  const Icon = k.icon;
                  return (
                    <button
                      key={k.id}
                      type="button"
                      className="flex min-h-[5.5rem] flex-col items-center justify-center gap-2 rounded-2xl bg-white/8 px-3 py-4 text-sm hover:bg-white/12"
                      onClick={() => {
                        startKind(k.id);
                        if (k.id === "text" || k.id === "sticker" || k.id === "location") setStep(2);
                      }}
                    >
                      <Icon className="size-5 text-amber-200" />
                      {k.label}
                    </button>
                  );
                })}
              </div>
              <div className="mt-4 grid gap-2">
                <Button type="button" variant="secondary" className="h-11 w-full" onClick={() => galleryRef.current?.click()}>
                  از گالری
                </Button>
                <Button type="button" variant="ghost" className="h-11 w-full text-white" onClick={() => videoRef.current?.click()}>
                  ویدیو از گالری
                </Button>
              </div>
              <input
                ref={galleryRef}
                type="file"
                accept="image/*,image/gif"
                className="hidden"
                onChange={async (e) => {
                  const file = e.target.files?.[0];
                  if (!file) return;
                  setMedia(await compressImage(file));
                  setKind(file.type.includes("gif") ? "gif" : "photo");
                  setMode("edit");
                  setStep(2);
                }}
              />
              <input
                ref={videoRef}
                type="file"
                accept="video/mp4,video/webm"
                className="hidden"
                onChange={async (e) => {
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
                }}
              />
              <input
                ref={audioRef}
                type="file"
                accept="audio/webm,audio/mpeg,audio/mp4,audio/ogg,audio/aac,audio/wav"
                className="hidden"
                onChange={async (e) => {
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
                }}
              />
            </div>
          )}

          {mode === "camera" && (
            <CameraCapture
              onCancel={() => {
                setMode("pick");
                setStep(0);
              }}
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
            <div className="space-y-4">
              <div
                ref={previewRef}
                className="relative mx-auto h-[min(46vh,420px)] w-[min(100%,calc(min(46vh,420px)*9/16))] overflow-hidden rounded-[22px] border border-white/10 shadow-inner"
                style={{ background: bg, textAlign: align, fontFamily: fontFamily(font) }}
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
                  <div className="relative z-10 grid h-full place-items-center px-6">
                    <audio src={media} controls className="w-full" />
                  </div>
                )}
                {drawData.split("|").filter(Boolean).map((stroke, i) => (
                  <svg key={i} viewBox="0 0 100 100" preserveAspectRatio="none" className="pointer-events-none absolute inset-0 h-full w-full">
                    <polyline fill="none" stroke="#fbbf24" strokeWidth="1.2" points={stroke.trim()} />
                  </svg>
                ))}
                {stickers.map((s, i) => (
                  <span key={i} className="absolute text-3xl" style={{ left: `${s.x}%`, top: `${s.y}%` }}>
                    {s.emoji}
                  </span>
                ))}
                {(overlay || kind === "text" || kind === "sticker") && (
                  <p
                    className="absolute z-10 max-w-[86%] px-3 leading-relaxed drop-shadow-md"
                    style={{
                      fontSize: textSize,
                      left: `${textX}%`,
                      top: `${textY}%`,
                      transform: "translate(-50%, -50%)",
                    }}
                  >
                    {overlay || body || "متن استوری"}
                  </p>
                )}
                {kind === "location" && <p className="relative z-10 grid h-full place-items-center text-xl">📍 {location || "موقعیت"}</p>}
              </div>

              {(kind === "text" || kind === "sticker") && (
                <Textarea value={body} onChange={(e) => setBody(e.target.value)} placeholder="متن استوری + @username" className="min-h-20 rounded-2xl border-white/10 bg-white/6" maxLength={400} />
              )}
              {kind === "location" && <Input value={location} onChange={(e) => setLocation(e.target.value)} placeholder="مثلاً تهران" className="h-11 rounded-2xl border-white/10 bg-white/6" />}
              {kind !== "text" && kind !== "sticker" && kind !== "location" && (
                <Input value={caption} onChange={(e) => setCaption(e.target.value)} placeholder="کپشن" className="h-11 rounded-2xl border-white/10 bg-white/6" />
              )}

              <div className="grid grid-cols-4 gap-1 rounded-2xl bg-white/6 p-1">
                {(
                  [
                    ["text", "متن"],
                    ["look", "ظاهر"],
                    ["stickers", "استیکر"],
                    ["music", "موسیقی"],
                  ] as const
                ).map(([id, label]) => (
                  <button
                    key={id}
                    type="button"
                    className={cn("h-9 rounded-xl text-xs", studio === id ? "bg-amber-300 text-[#102824]" : "text-white/70")}
                    onClick={() => setStudio(id)}
                  >
                    {label}
                  </button>
                ))}
              </div>

              {studio === "text" && (
                <section className="space-y-3">
                  <Input value={overlay} onChange={(e) => setOverlay(e.target.value)} placeholder="متن روی تصویر" className="h-11 rounded-2xl border-white/10 bg-white/6" />
                  <div className="-mx-1 overflow-x-auto pb-1">
                    <div className="flex min-w-max items-stretch gap-2 px-1">
                      <label className="flex min-w-[9.5rem] flex-col justify-center gap-1 rounded-2xl bg-white/8 px-3 py-2">
                        <span className="text-[10px] text-white/50">اندازه {textSize}</span>
                        <input type="range" min={16} max={40} value={textSize} onChange={(e) => setTextSize(Number(e.target.value))} className="accent-amber-300" />
                      </label>
                      <button type="button" className="flex min-w-[5.5rem] flex-col items-center justify-center gap-1 rounded-2xl bg-white/8 px-3 py-2 text-[11px]" onClick={() => setFont(font === "vazir" ? "serif" : font === "serif" ? "mono" : "vazir")}>
                        <Type className="size-4" />
                        {font === "serif" ? "Serif" : font === "mono" ? "Mono" : "وزیر"}
                      </button>
                      <button type="button" className="flex min-w-[5.5rem] flex-col items-center justify-center gap-1 rounded-2xl bg-white/8 px-3 py-2 text-[11px]" onClick={() => setAlign(align === "right" ? "center" : align === "center" ? "left" : "right")}>
                        <AlignIcon className="size-4" />
                        چینش
                      </button>
                      <label className="flex min-w-[8.5rem] flex-col justify-center gap-1 rounded-2xl bg-white/8 px-3 py-2">
                        <span className="text-[10px] text-white/50">جای افقی {textX}٪</span>
                        <input type="range" min={8} max={92} value={textX} onChange={(e) => setTextX(Number(e.target.value))} className="accent-amber-300" />
                      </label>
                      <label className="flex min-w-[8.5rem] flex-col justify-center gap-1 rounded-2xl bg-white/8 px-3 py-2">
                        <span className="text-[10px] text-white/50">جای عمودی {textY}٪</span>
                        <input type="range" min={8} max={92} value={textY} onChange={(e) => setTextY(Number(e.target.value))} className="accent-amber-300" />
                      </label>
                    </div>
                  </div>
                </section>
              )}

              {studio === "look" && (
                <section className="space-y-4">
                  <div>
                    <p className="mb-2 text-[11px] text-white/50">رنگ پس‌زمینه</p>
                    <div className="grid grid-cols-6 gap-2">
                      {BGS.map((c) => (
                        <button
                          key={c}
                          type="button"
                          aria-label={`رنگ ${c}`}
                          className={cn("aspect-square min-h-11 rounded-2xl", bg === c && "ring-2 ring-amber-300 ring-offset-2 ring-offset-[#0b1412]")}
                          style={{ background: c }}
                          onClick={() => setBg(c)}
                        />
                      ))}
                    </div>
                  </div>
                  <div>
                    <p className="mb-2 text-[11px] text-white/50">فیلتر</p>
                    <div className="grid grid-cols-3 gap-2">
                      {STORY_FILTERS.map((f) => (
                        <button
                          key={f.id}
                          type="button"
                          className={cn("min-h-11 rounded-2xl px-2 text-xs", filter === f.id ? "bg-amber-300 text-[#102824]" : "bg-white/8")}
                          onClick={() => setFilter(f.id)}
                        >
                          {f.label}
                        </button>
                      ))}
                    </div>
                  </div>
                  <div>
                    <p className="mb-2 text-[11px] text-white/50">ابزار</p>
                    <div className="grid grid-cols-4 gap-2">
                      <ToolTile active={blur > 0} label={blur ? "محو روشن" : "محو"} onClick={() => setBlur((b) => (b ? 0 : 6))}>
                        <Droplets className="size-4" />
                      </ToolTile>
                      <ToolTile active={drawing} label="نقاشی" onClick={() => setDrawing((d) => !d)}>
                        <Pencil className="size-4" />
                      </ToolTile>
                      <ToolTile label="چرخش" onClick={() => setRotate((r) => r + 90)}>
                        <RotateCw className="size-4" />
                      </ToolTile>
                      <ToolTile label={`زوم ${zoom}`} onClick={() => setZoom((z) => (z >= 1.6 ? 1 : +(z + 0.2).toFixed(1)))}>
                        <ZoomIn className="size-4" />
                      </ToolTile>
                    </div>
                  </div>
                </section>
              )}

              {studio === "stickers" && (
                <section className="space-y-4">
                  {STORY_STICKER_GROUPS.map((group) => (
                    <div key={group.id}>
                      <p className="mb-2 text-[11px] text-white/50">{group.label}</p>
                      <div className="grid grid-cols-6 gap-2">
                        {group.items.map((e) => (
                          <button
                            key={`${group.id}-${e}`}
                            type="button"
                            className="grid min-h-12 place-items-center rounded-2xl bg-white/8 text-2xl hover:bg-white/12"
                            onClick={() => setStickers((s) => [...s, { emoji: e, x: 22 + (s.length % 4) * 14, y: 28 + Math.floor(s.length / 4) * 12 }].slice(0, 8))}
                          >
                            {e}
                          </button>
                        ))}
                      </div>
                    </div>
                  ))}
                </section>
              )}

              {studio === "music" && (
                <section className="space-y-3">
                  <p className="text-[11px] text-white/50">موسیقی مجاز نیکسو — نه کاتالوگ تجاری</p>
                  <button
                    type="button"
                    className={cn("flex min-h-14 w-full items-center gap-3 rounded-2xl px-3 text-start text-sm", !musicId ? "bg-amber-300 text-[#102824]" : "bg-white/8")}
                    onClick={() => setMusicId(null)}
                  >
                    بدون موسیقی
                  </button>
                  {STORY_MUSIC.map((m) => (
                    <button
                      key={m.id}
                      type="button"
                      className={cn("flex min-h-14 w-full items-center gap-3 rounded-2xl px-3 text-start", musicId === m.id ? "bg-amber-300 text-[#102824]" : "bg-white/8")}
                      onClick={() => setMusicId(m.id)}
                    >
                      <span className="grid size-10 place-items-center rounded-xl bg-black/20">
                        <Music2 className="size-4" />
                      </span>
                      <span>
                        <span className="block text-sm">{m.label}</span>
                        <span className="block text-[11px] opacity-70">منبع داخلی نیکسو</span>
                      </span>
                    </button>
                  ))}
                  <a href="/app/music" className="block pt-1 text-xs text-amber-200">
                    کتابخانه موسیقی نیکسو
                  </a>
                  <Input value={linkUrl} onChange={(e) => setLinkUrl(e.target.value)} placeholder="لینک (https://)" dir="ltr" className="h-11 rounded-2xl border-white/10 bg-white/6 text-left text-xs" />
                  <p className="text-[11px] text-white/50">موضوع</p>
                  <div className="grid grid-cols-3 gap-2">
                    {(Object.keys(STORY_PURPOSE_FA) as StoryPurpose[]).map((p) => (
                      <button key={p} type="button" className={cn("min-h-11 rounded-2xl px-2 text-xs", purpose === p ? "bg-amber-300 text-[#102824]" : "bg-white/8")} onClick={() => setPurpose(p)}>
                        {STORY_PURPOSE_FA[p]}
                      </button>
                    ))}
                  </div>
                </section>
              )}

              <div className="flex gap-2 pt-2">
                <Button
                  type="button"
                  variant="ghost"
                  className="h-11 flex-1 text-white"
                  onClick={() => {
                    setMode("pick");
                    setStep(0);
                  }}
                >
                  قبلی
                </Button>
                <Button type="button" className="h-11 flex-1 bg-amber-300 text-[#102824]" onClick={() => setStep(3)}>
                  حریم خصوصی
                  <ArrowRight className="size-4" />
                </Button>
              </div>
            </div>
          )}

          {step === 3 && (
            <div className="space-y-4 pb-4">
              <select className="h-11 w-full rounded-2xl bg-white/8 px-3 text-sm" value={visibility} onChange={(e) => setVisibility(e.target.value)}>
                <option value="everyone">همه</option>
                <option value="contacts">مخاطبین</option>
                <option value="friends">دوستان</option>
                <option value="closeFriends">دوستان نزدیک</option>
                <option value="selected">کاربران انتخابی</option>
                <option value="nobody">فقط خودم</option>
              </select>
              {visibility === "selected" && (
                <div className="max-h-28 space-y-2 overflow-auto rounded-2xl bg-white/6 p-3 text-sm">
                  {people.map((p) => (
                    <label key={p.id} className="flex items-center gap-2">
                      <input type="checkbox" checked={allowIds.includes(p.id)} onChange={() => setAllowIds((ids) => (ids.includes(p.id) ? ids.filter((x) => x !== p.id) : [...ids, p.id]))} />
                      {p.name} {p.username ? `@${p.username}` : ""}
                    </label>
                  ))}
                </div>
              )}
              <p className="text-[11px] text-white/50">مخفی از این کاربران</p>
              <div className="max-h-28 space-y-2 overflow-auto rounded-2xl bg-white/6 p-3 text-sm">
                {people.map((p) => (
                  <label key={`h-${p.id}`} className="flex items-center gap-2">
                    <input type="checkbox" checked={hideFromIds.includes(p.id)} onChange={() => setHideFromIds((ids) => (ids.includes(p.id) ? ids.filter((x) => x !== p.id) : [...ids, p.id]))} />
                    {p.name}
                  </label>
                ))}
              </div>
              <div className="space-y-3 rounded-2xl bg-white/6 p-3 text-sm">
                <label className="flex items-center gap-2">
                  <input type="checkbox" checked={allowShare} onChange={(e) => setAllowShare(e.target.checked)} />
                  اجازهٔ اشتراک
                </label>
                <label className="flex items-center gap-2">
                  <input type="checkbox" checked={allowReplies} onChange={(e) => setAllowReplies(e.target.checked)} />
                  اجازهٔ پاسخ
                </label>
                <label className="flex items-center gap-2">
                  <input type="checkbox" checked={allowReactions} onChange={(e) => setAllowReactions(e.target.checked)} />
                  اجازهٔ واکنش
                </label>
              </div>
              <div className="flex gap-2">
                <Button type="button" variant="ghost" className="h-11 flex-1 text-white" onClick={() => setStep(2)}>
                  قبلی
                </Button>
                <Button type="button" className="h-11 flex-1 bg-amber-300 text-[#102824]" onClick={() => setStep(4)}>
                  ادامه
                </Button>
              </div>
            </div>
          )}

          {step === 4 && (
            <div className="space-y-4 pb-4">
              <p className="text-sm leading-6 text-white/65">استوری تا ۲۴ ساعت با حریم انتخاب‌شده منتشر می‌شود. رسانه با لینک امضاشده سرو می‌شود.</p>
              {uploadState === "uploading" && <p className="text-amber-200">در حال آپلود…</p>}
              {uploadState === "fail" && (
                <Button type="button" className="h-11 w-full bg-amber-300 text-[#102824]" onClick={() => lastPayload && void send(lastPayload)}>
                  تلاش دوباره
                </Button>
              )}
              <div className="flex gap-2">
                <Button type="button" variant="secondary" className="h-11 flex-1" disabled={busy} onClick={() => void send(payload(true))}>
                  پیش‌نویس
                </Button>
                <Button type="button" className="h-11 flex-1 bg-amber-300 text-[#102824]" disabled={busy} onClick={() => void send(payload(false))}>
                  انتشار
                </Button>
              </div>
              <Button type="button" variant="ghost" className="h-11 w-full text-white" onClick={() => setStep(3)}>
                قبلی
              </Button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
