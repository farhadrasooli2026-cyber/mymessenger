"use client";

import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { CameraCapture } from "@/components/camera-capture";
import { STORY_FILTERS, STORY_MUSIC } from "@/lib/story-types";
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

export function StoryComposer({ onClose, onPublished }: { onClose: () => void; onPublished: () => void }) {
  const [mode, setMode] = useState<"pick" | "camera" | "edit">("pick");
  const [kind, setKind] = useState<"text" | "photo" | "video">("text");
  const [body, setBody] = useState("");
  const [caption, setCaption] = useState("");
  const [bg, setBg] = useState(BGS[0]!);
  const [font, setFont] = useState("vazir");
  const [align, setAlign] = useState<"right" | "center" | "left">("right");
  const [filter, setFilter] = useState("none");
  const [rotate, setRotate] = useState(0);
  const [zoom, setZoom] = useState(1);
  const [overlay, setOverlay] = useState("");
  const [media, setMedia] = useState("");
  const [musicId, setMusicId] = useState<string | null>(null);
  const [linkUrl, setLinkUrl] = useState("");
  const [visibility, setVisibility] = useState("everyone");
  const [allowShare, setAllowShare] = useState(true);
  const [muted, setMuted] = useState(false);
  const [busy, setBusy] = useState(false);
  const [people, setPeople] = useState<{ id: string; name: string; username: string | null }[]>([]);
  const [allowIds, setAllowIds] = useState<string[]>([]);
  const [hideFromIds, setHideFromIds] = useState<string[]>([]);
  const videoRef = useRef<HTMLInputElement>(null);
  const galleryRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    fetch("/api/stories?settings=1", { cache: "no-store" })
      .then((r) => r.json())
      .then((d) => {
        if (d.settings?.people) setPeople(d.settings.people);
        if (d.settings?.defaultStoryPrivacy) setVisibility(d.settings.defaultStoryPrivacy);
      })
      .catch(() => undefined);
  }, []);

  const filterCss = STORY_FILTERS.find((f) => f.id === filter)?.css ?? "none";

  async function publish() {
    setBusy(true);
    try {
      const mentions = [...body.matchAll(/@([a-zA-Z0-9_]+)/g)].map((m) => m[1]!);
      const res = await fetch("/api/stories", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
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
          media,
          musicId,
          linkUrl,
          mentions,
          allowShare,
          visibility,
          allowIds,
          hideFromIds,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        toast.error(data.error ?? "استوری منتشر نشد.");
        return;
      }
      toast.success("استوری تا ۲۴ ساعت دیده می‌شود.");
      onPublished();
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 overflow-auto bg-black/85 p-4" onClick={onClose}>
      <div className="mx-auto max-w-md rounded-3xl bg-[#102824] p-4" onClick={(e) => e.stopPropagation()}>
        {mode === "pick" && (
          <>
            <h2 className="text-lg font-semibold">افزودن استوری</h2>
            <div className="mt-3 grid grid-cols-3 gap-2">
              <Button type="button" className="h-20 bg-amber-300 text-[#102824]" onClick={() => { setKind("text"); setMode("edit"); }}>
                متن
              </Button>
              <Button type="button" variant="secondary" className="h-20" onClick={() => setMode("camera")}>
                دوربین
              </Button>
              <Button type="button" variant="secondary" className="h-20" onClick={() => galleryRef.current?.click()}>
                گالری
              </Button>
            </div>
            <Button type="button" variant="ghost" className="mt-3 w-full text-white" onClick={() => videoRef.current?.click()}>
              ویدیو از گالری
            </Button>
            <input ref={galleryRef} type="file" accept="image/*" className="hidden" onChange={async (e) => {
              const file = e.target.files?.[0];
              if (!file) return;
              setMedia(await compressImage(file));
              setKind("photo");
              setMode("edit");
            }} />
            <input ref={videoRef} type="file" accept="video/*" className="hidden" onChange={async (e) => {
              const file = e.target.files?.[0];
              if (!file) return;
              if (file.size > 280_000) {
                toast.error("ویدیو را کوتاه و کم‌حجم انتخاب کن (فشرده‌سازی برای اینترنت ضعیف).");
                return;
              }
              const url = await new Promise<string>((resolve, reject) => {
                const r = new FileReader();
                r.onload = () => resolve(String(r.result));
                r.onerror = () => reject(new Error("read"));
                r.readAsDataURL(file);
              });
              setMedia(url);
              setKind("video");
              setMode("edit");
            }} />
            <Button type="button" variant="ghost" className="mt-2 w-full text-white" onClick={onClose}>انصراف</Button>
          </>
        )}
        {mode === "camera" && (
          <CameraCapture
            onCancel={() => setMode("pick")}
            onCapture={(dataUrl) => {
              void compressDataUrl(dataUrl).then((url) => {
                setMedia(url);
                setKind("photo");
                setMode("edit");
              });
            }}
          />
        )}
        {mode === "edit" && (
          <>
            <p className="text-xs text-amber-200">ویرایش قبل از انتشار</p>
            <div
              className="relative mt-2 flex min-h-64 items-center justify-center overflow-hidden rounded-3xl p-4"
              style={{ background: bg, textAlign: align, fontFamily: font === "serif" ? "Georgia, serif" : "inherit" }}
            >
              {kind === "photo" && media && (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={media} alt="" className="absolute inset-0 h-full w-full object-cover" style={{ filter: filterCss, transform: `rotate(${rotate}deg) scale(${zoom})` }} />
              )}
              {kind === "video" && media && (
                <video src={media} className="absolute inset-0 h-full w-full object-cover" muted={muted} autoPlay loop playsInline style={{ filter: filterCss }} />
              )}
              {overlay && <p className="relative z-10 text-4xl">{overlay}</p>}
              {kind === "text" && <p className="relative z-10 text-xl leading-8">{body || "متن استوری"}</p>}
            </div>
            {kind === "text" && <Textarea value={body} onChange={(e) => setBody(e.target.value)} placeholder="متن + @username + اموجی" className="mt-2 min-h-20 bg-black/20" maxLength={400} />}
            {kind !== "text" && <Input value={caption} onChange={(e) => setCaption(e.target.value)} placeholder="کپشن" className="mt-2 bg-black/20" />}
            <Input value={overlay} onChange={(e) => setOverlay(e.target.value)} placeholder="استیکر / اموجی روی تصویر" className="mt-2 bg-black/20" />
            {kind === "text" && (
              <div className="mt-2 flex gap-1">
                {BGS.map((c) => (
                  <button key={c} type="button" className={cn("size-7 rounded-full", bg === c && "ring-2 ring-white")} style={{ background: c }} onClick={() => setBg(c)} />
                ))}
                <button type="button" className="rounded bg-white/10 px-2 text-xs" onClick={() => setFont(font === "vazir" ? "serif" : "vazir")}>قلم</button>
                <button type="button" className="rounded bg-white/10 px-2 text-xs" onClick={() => setAlign(align === "right" ? "center" : align === "center" ? "left" : "right")}>چینش</button>
              </div>
            )}
            {kind !== "text" && (
              <div className="mt-2 flex flex-wrap gap-1 text-[11px]">
                {STORY_FILTERS.map((f) => (
                  <button key={f.id} type="button" className={cn("rounded px-2 py-1", filter === f.id ? "bg-amber-300 text-[#102824]" : "bg-white/10")} onClick={() => setFilter(f.id)}>{f.label}</button>
                ))}
                <button type="button" className="rounded bg-white/10 px-2" onClick={() => setRotate((r) => r + 90)}>چرخش</button>
                <button type="button" className="rounded bg-white/10 px-2" onClick={() => setZoom((z) => (z >= 1.4 ? 1 : z + 0.2))}>زوم</button>
                {kind === "video" && <button type="button" className="rounded bg-white/10 px-2" onClick={() => setMuted((m) => !m)}>{muted ? "بی‌صدا" : "باصدا"}</button>}
              </div>
            )}
            <p className="mt-2 text-[11px]">موسیقی مجاز نیکسو</p>
            <div className="flex flex-wrap gap-1 text-[11px]">
              <button type="button" className={cn("rounded px-2 py-1", !musicId ? "bg-amber-300 text-[#102824]" : "bg-white/10")} onClick={() => setMusicId(null)}>بدون موسیقی</button>
              {STORY_MUSIC.map((m) => (
                <button key={m.id} type="button" className={cn("rounded px-2 py-1", musicId === m.id ? "bg-amber-300 text-[#102824]" : "bg-white/10")} onClick={() => setMusicId(m.id)}>{m.label}</button>
              ))}
            </div>
            <Input value={linkUrl} onChange={(e) => setLinkUrl(e.target.value)} placeholder="لینک (https://)" dir="ltr" className="mt-2 bg-black/20 text-left text-xs" />
            <select className="mt-2 w-full rounded-lg bg-black/30 p-2 text-xs" value={visibility} onChange={(e) => setVisibility(e.target.value)}>
              <option value="everyone">همه</option>
              <option value="contacts">مخاطبین</option>
              <option value="closeFriends">دوستان نزدیک</option>
              <option value="selected">افراد انتخاب‌شده</option>
            </select>
            {visibility === "selected" && (
              <div className="mt-2 max-h-24 overflow-auto text-[11px]">
                {people.map((p) => (
                  <label key={p.id} className="flex items-center gap-2">
                    <input
                      type="checkbox"
                      checked={allowIds.includes(p.id)}
                      onChange={() =>
                        setAllowIds((ids) => (ids.includes(p.id) ? ids.filter((x) => x !== p.id) : [...ids, p.id]))
                      }
                    />
                    {p.name}
                  </label>
                ))}
              </div>
            )}
            <p className="mt-2 text-[11px]">مخفی از (Hide Story From)</p>
            <div className="max-h-24 overflow-auto text-[11px]">
              {people.map((p) => (
                <label key={p.id} className="flex items-center gap-2">
                  <input
                    type="checkbox"
                    checked={hideFromIds.includes(p.id)}
                    onChange={() =>
                      setHideFromIds((ids) => (ids.includes(p.id) ? ids.filter((x) => x !== p.id) : [...ids, p.id]))
                    }
                  />
                  {p.name}
                </label>
              ))}
            </div>
            <label className="mt-2 flex items-center gap-2 text-xs">
              <input type="checkbox" checked={allowShare} onChange={(e) => setAllowShare(e.target.checked)} />
              اجازهٔ اشتراک استوری
            </label>
            <div className="mt-3 flex gap-2">
              <Button type="button" variant="ghost" className="flex-1 text-white" onClick={onClose}>انصراف</Button>
              <Button type="button" className="flex-1 bg-amber-300 text-[#102824]" disabled={busy} onClick={() => void publish()}>انتشار ۲۴ساعته</Button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
