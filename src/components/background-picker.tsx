"use client";

import { useEffect, useRef, useState } from "react";
import { Camera, Images, LayoutGrid, Paintbrush, Rainbow, RotateCcw } from "lucide-react";
import { CameraCapture } from "@/components/camera-capture";
import { ImageComposer } from "@/components/image-composer";
import { Button } from "@/components/ui/button";
import { GRADIENT_DIRS, SOLID_PRESETS, type BackgroundSpec, type GradientDir } from "@/lib/appearance-types";
import { backgroundPreview } from "@/lib/background-style";
import { cn } from "@/lib/utils";

export type BgDraft = BackgroundSpec & { dataUrl?: string };

type Category = { id: string; en: string; fa: string };
type Item = { id: string; categoryId: string; title: string; svg: string };

type Props = {
  value: BgDraft;
  onChange: (value: BgDraft) => void;
  label?: string;
};

export function BackgroundPicker({ value, onChange, label = "پس‌زمینه" }: Props) {
  const [mode, setMode] = useState<"menu" | "camera" | "gallery" | "catalog" | "solid" | "gradient">("menu");
  const [gallerySrc, setGallerySrc] = useState<string | null>(null);
  const [catalog, setCatalog] = useState<{ categories: Category[]; items: Item[] } | null>(null);
  const [cat, setCat] = useState("dark");
  const [custom, setCustom] = useState("#1d4ed8");
  const [gFrom, setGFrom] = useState("#071614");
  const [gTo, setGTo] = useState("#fbbf24");
  const [gDir, setGDir] = useState<GradientDir>("to bottom");
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    fetch("/api/bg-catalog")
      .then((r) => r.json())
      .then((d) => {
        setCatalog({ categories: d.categories ?? [], items: d.items ?? [] });
        if (d.categories?.[0]?.id) setCat(d.categories[0].id);
      })
      .catch(() => undefined);
  }, []);

  return (
    <div className="space-y-4">
      <p className="text-sm font-medium">{label}</p>
      <div className="h-28 overflow-hidden rounded-2xl border border-white/10" style={backgroundPreview(value, value.kind === "upload" ? value.dataUrl : undefined)} />

      {mode === "menu" && (
        <div className="grid gap-2 sm:grid-cols-2">
          <Source icon={RotateCcw} label="پیش‌فرض نیکسو" onClick={() => onChange({ kind: "default" })} />
          <Source icon={LayoutGrid} label="پس‌زمینه‌های نیکسو" onClick={() => setMode("catalog")} />
          <Source icon={Images} label="گالری" onClick={() => fileRef.current?.click()} />
          <Source icon={Camera} label="دوربین" onClick={() => setMode("camera")} />
          <Source icon={Paintbrush} label="رنگ ساده" onClick={() => setMode("solid")} />
          <Source icon={Rainbow} label="گرادیان" onClick={() => setMode("gradient")} />
        </div>
      )}

      <input
        ref={fileRef}
        type="file"
        accept="image/*"
        className="hidden"
        onChange={(e) => {
          const file = e.target.files?.[0];
          e.target.value = "";
          if (!file) return;
          const reader = new FileReader();
          reader.onload = () => {
            setGallerySrc(String(reader.result));
            setMode("gallery");
          };
          reader.readAsDataURL(file);
        }}
      />

      {mode === "camera" && (
        <CameraCapture
          onCapture={(dataUrl) => {
            setGallerySrc(dataUrl);
            setMode("gallery");
          }}
          onCancel={() => setMode("menu")}
        />
      )}

      {mode === "gallery" && gallerySrc && (
        <ImageComposer
          wide
          source={gallerySrc}
          onCancel={() => {
            setGallerySrc(null);
            setMode("menu");
          }}
          onConfirm={(dataUrl) => {
            onChange({ kind: "upload", dataUrl });
            setGallerySrc(null);
            setMode("menu");
          }}
        />
      )}

      {mode === "catalog" && catalog && (
        <div className="space-y-3">
          <div className="flex gap-2 overflow-x-auto pb-1">
            {catalog.categories.map((c) => (
              <button
                key={c.id}
                type="button"
                onClick={() => setCat(c.id)}
                className={cn(
                  "shrink-0 rounded-full px-3 py-1 text-xs",
                  cat === c.id ? "bg-amber-300 text-[#102824]" : "bg-white/10",
                )}
              >
                {c.fa}
              </button>
            ))}
          </div>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
            {catalog.items
              .filter((i) => i.categoryId === cat)
              .map((item) => (
                <button
                  key={item.id}
                  type="button"
                  className="overflow-hidden rounded-xl"
                  onClick={() => {
                    onChange({ kind: "catalog", catalogId: item.id });
                    setMode("menu");
                  }}
                >
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={`data:image/svg+xml;utf8,${encodeURIComponent(item.svg)}`} alt={item.title} className="aspect-video w-full" />
                </button>
              ))}
          </div>
          <Button type="button" variant="ghost" className="w-full text-white" onClick={() => setMode("menu")}>
            بازگشت
          </Button>
        </div>
      )}

      {mode === "solid" && (
        <div className="space-y-3">
          <div className="grid grid-cols-3 gap-2">
            {SOLID_PRESETS.map((p) => (
              <button
                key={p.id}
                type="button"
                className="rounded-xl border border-white/10 px-2 py-6 text-xs"
                style={{ background: p.color, color: p.id === "white" ? "#111" : "#fff" }}
                onClick={() => {
                  onChange({ kind: "solid", color: p.color });
                  setMode("menu");
                }}
              >
                {p.fa}
              </button>
            ))}
          </div>
          <label className="flex items-center gap-2 text-sm">
            رنگ سفارشی
            <input
              type="color"
              value={custom}
              onChange={(e) => setCustom(e.target.value)}
              className="h-9 w-14 rounded bg-transparent"
            />
            <Button
              type="button"
              size="sm"
              onClick={() => {
                onChange({ kind: "solid", color: custom });
                setMode("menu");
              }}
            >
              تأیید
            </Button>
          </label>
          <Button type="button" variant="ghost" className="w-full text-white" onClick={() => setMode("menu")}>
            انصراف
          </Button>
        </div>
      )}

      {mode === "gradient" && (
        <div className="space-y-3">
          <div className="h-20 rounded-xl" style={{ backgroundImage: `linear-gradient(${gDir}, ${gFrom}, ${gTo})` }} />
          <div className="flex gap-3">
            <label className="text-xs">
              رنگ اول
              <input type="color" value={gFrom} onChange={(e) => setGFrom(e.target.value)} className="mt-1 block h-9 w-16" />
            </label>
            <label className="text-xs">
              رنگ دوم
              <input type="color" value={gTo} onChange={(e) => setGTo(e.target.value)} className="mt-1 block h-9 w-16" />
            </label>
          </div>
          <div className="flex flex-wrap gap-2">
            {GRADIENT_DIRS.map((d) => (
              <button
                key={d.id}
                type="button"
                className={cn("rounded-full px-3 py-1 text-xs", gDir === d.id ? "bg-amber-300 text-[#102824]" : "bg-white/10")}
                onClick={() => setGDir(d.id)}
              >
                {d.fa}
              </button>
            ))}
          </div>
          <div className="flex gap-2">
            <Button type="button" variant="ghost" className="flex-1 text-white" onClick={() => setMode("menu")}>
              انصراف
            </Button>
            <Button
              type="button"
              className="flex-1 bg-amber-300 text-[#102824]"
              onClick={() => {
                onChange({ kind: "gradient", from: gFrom, to: gTo, direction: gDir });
                setMode("menu");
              }}
            >
              تأیید
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}

function Source({ icon: Icon, label, onClick }: { icon: typeof Camera; label: string; onClick: () => void }) {
  return (
    <button type="button" onClick={onClick} className="flex items-center gap-3 rounded-2xl border border-white/10 bg-black/20 px-4 py-3 text-sm hover:bg-white/5">
      <Icon className="size-4 text-amber-200" />
      {label}
    </button>
  );
}
