"use client";

import { useEffect, useRef, useState } from "react";
import { Camera, Images, LayoutGrid, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { CameraCapture } from "@/components/camera-capture";
import { ImageComposer } from "@/components/image-composer";
import { PUBLIC_AVATARS, publicAvatarFor } from "@/lib/public-assets";
import { cn } from "@/lib/utils";

export type PhotoValue =
  | { kind: "default" }
  | { kind: "catalog"; catalogId: string; previewUrl: string }
  | { kind: "public"; path: string }
  | { kind: "upload"; dataUrl: string };

type Category = { id: string; en: string; fa: string };
type Item = { id: string; categoryId: string; title: string; svg: string };

type Props = {
  value: PhotoValue;
  onChange: (value: PhotoValue) => void;
};

export function PhotoPicker({ value, onChange }: Props) {
  const [mode, setMode] = useState<"menu" | "camera" | "gallery" | "catalog">("menu");
  const [gallerySrc, setGallerySrc] = useState<string | null>(null);
  const [catalog, setCatalog] = useState<{ categories: Category[]; items: Item[] } | null>(null);
  const [cat, setCat] = useState("male");
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    fetch("/api/catalog")
      .then((r) => r.json())
      .then((d) => {
        setCatalog({ categories: d.categories ?? [], items: d.items ?? [] });
        if (d.categories?.[0]?.id) setCat(d.categories[0].id);
      })
      .catch(() => undefined);
  }, []);

  const preview =
    value.kind === "upload"
      ? value.dataUrl
      : value.kind === "catalog"
        ? value.previewUrl
        : value.kind === "public"
          ? value.path
          : publicAvatarFor("me");

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-4">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={preview} alt="عکس پروفایل" className="size-24 rounded-3xl object-cover ring-2 ring-amber-300/40" />
        <div className="text-sm text-emerald-100/70">
          {value.kind === "default" && "آواتار پیش‌فرض نیکسو"}
          {value.kind === "catalog" && "عکس آماده نیکسو"}
          {value.kind === "public" && "آواتار public نیکسو"}
          {value.kind === "upload" && "عکس دوربین یا گالری"}
        </div>
      </div>

      {mode === "menu" && (
        <div className="grid gap-2 sm:grid-cols-2">
          <SourceBtn icon={Camera} label="دوربین" onClick={() => setMode("camera")} />
          <SourceBtn icon={Images} label="گالری" onClick={() => fileRef.current?.click()} />
          <SourceBtn icon={LayoutGrid} label="عکس‌های آماده نیکسو" onClick={() => setMode("catalog")} />
          <SourceBtn
            icon={Trash2}
            label="حذف عکس"
            onClick={() => onChange({ kind: "default" })}
          />
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

      {mode === "catalog" && (
        <div className="space-y-3">
          <p className="text-xs text-emerald-100/55">آواتارهای public نیکسو</p>
          <div className="grid grid-cols-4 gap-2">
            {PUBLIC_AVATARS.map((a) => (
              <button
                key={a.id}
                type="button"
                className={cn("overflow-hidden rounded-2xl ring-offset-2 ring-offset-[#0f2f2c]", value.kind === "public" && value.path === a.path && "ring-2 ring-amber-300")}
                onClick={() => {
                  onChange({ kind: "public", path: a.path });
                  setMode("menu");
                }}
              >
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={a.path} alt={a.fa} className="aspect-square w-full object-cover" />
              </button>
            ))}
          </div>
          {catalog && (
            <>
          <div className="flex gap-2 overflow-x-auto pb-1">
            {catalog.categories.map((c) => (
              <button
                key={c.id}
                type="button"
                onClick={() => setCat(c.id)}
                className={cn(
                  "shrink-0 rounded-full px-3 py-1 text-xs",
                  cat === c.id ? "bg-amber-300 text-[#102824]" : "bg-white/10 text-emerald-50",
                )}
              >
                {c.fa}
              </button>
            ))}
          </div>
          <div className="grid grid-cols-3 gap-2 sm:grid-cols-4">
            {catalog.items
              .filter((i) => i.categoryId === cat)
              .map((item) => (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => {
                    onChange({
                      kind: "catalog",
                      catalogId: item.id,
                      previewUrl: `/api/media/catalog/${item.id}`,
                    });
                    setMode("menu");
                  }}
                  className="overflow-hidden rounded-2xl ring-offset-2 ring-offset-[#0f2f2c] hover:ring-2 hover:ring-amber-300"
                >
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={`data:image/svg+xml;utf8,${encodeURIComponent(item.svg)}`} alt={item.title} className="aspect-square w-full" />
                </button>
              ))}
          </div>
            </>
          )}
          <Button type="button" variant="ghost" className="w-full text-white" onClick={() => setMode("menu")}>
            بازگشت
          </Button>
        </div>
      )}
    </div>
  );
}

function SourceBtn({
  icon: Icon,
  label,
  onClick,
}: {
  icon: typeof Camera;
  label: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex items-center gap-3 rounded-2xl border border-white/10 bg-black/20 px-4 py-3 text-sm hover:bg-white/5"
    >
      <Icon className="size-4 text-amber-200" />
      {label}
    </button>
  );
}
