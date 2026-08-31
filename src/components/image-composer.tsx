"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Slider } from "@/components/ui/slider";

type Props = {
  source: string;
  onConfirm: (dataUrl: string) => void;
  onCancel: () => void;
  confirmLabel?: string;
};

export function ImageComposer({ source, onConfirm, onCancel, confirmLabel = "تأیید عکس" }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const imgRef = useRef<HTMLImageElement | null>(null);
  const [zoom, setZoom] = useState(1);
  const [rotation, setRotation] = useState(0);
  const [offset, setOffset] = useState({ x: 0, y: 0 });
  const drag = useRef<{ x: number; y: number } | null>(null);

  const draw = useCallback(() => {
    const canvas = canvasRef.current;
    const img = imgRef.current;
    if (!canvas || !img) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    const size = canvas.width;
    ctx.fillStyle = "#102824";
    ctx.fillRect(0, 0, size, size);
    ctx.save();
    ctx.translate(size / 2 + offset.x, size / 2 + offset.y);
    ctx.rotate((rotation * Math.PI) / 180);
    ctx.scale(zoom, zoom);
    const scale = Math.max(size / img.width, size / img.height);
    ctx.drawImage(img, (-img.width * scale) / 2, (-img.height * scale) / 2, img.width * scale, img.height * scale);
    ctx.restore();
  }, [offset, rotation, zoom]);

  useEffect(() => {
    const img = new Image();
    img.onload = () => {
      imgRef.current = img;
      draw();
    };
    img.src = source;
  }, [source, draw]);

  useEffect(() => {
    draw();
  }, [draw]);

  function onPointerDown(e: React.PointerEvent<HTMLCanvasElement>) {
    drag.current = { x: e.clientX - offset.x, y: e.clientY - offset.y };
    e.currentTarget.setPointerCapture(e.pointerId);
  }
  function onPointerMove(e: React.PointerEvent<HTMLCanvasElement>) {
    if (!drag.current) return;
    setOffset({ x: e.clientX - drag.current.x, y: e.clientY - drag.current.y });
  }
  function onPointerUp() {
    drag.current = null;
  }

  function confirm() {
    const canvas = canvasRef.current;
    if (!canvas) return;
    onConfirm(canvas.toDataURL("image/jpeg", 0.86));
  }

  return (
    <div className="space-y-4">
      <canvas
        ref={canvasRef}
        width={512}
        height={512}
        className="mx-auto aspect-square w-full max-w-sm cursor-move rounded-3xl border border-white/10 bg-black/30"
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
      />
      <div className="space-y-2">
        <p className="text-xs text-emerald-100/70">بزرگ‌نمایی</p>
        <Slider
          value={[zoom]}
          min={0.6}
          max={3}
          step={0.05}
          onValueChange={(v) => setZoom(Array.isArray(v) ? (v[0] ?? 1) : Number(v))}
        />
      </div>
      <div className="flex flex-wrap gap-2">
        <Button type="button" variant="outline" className="border-white/15 bg-transparent text-white" onClick={() => setRotation((r) => r - 90)}>
          چرخش راست
        </Button>
        <Button type="button" variant="outline" className="border-white/15 bg-transparent text-white" onClick={() => setRotation((r) => r + 90)}>
          چرخش چپ
        </Button>
        <Button type="button" variant="ghost" className="text-emerald-100" onClick={() => { setZoom(1); setRotation(0); setOffset({ x: 0, y: 0 }); }}>
          بازنشانی کادر
        </Button>
      </div>
      <p className="text-xs text-emerald-100/55">عکس را بکشید تا جابه‌جا شود. سپس تأیید کنید.</p>
      <div className="flex gap-2">
        <Button type="button" variant="ghost" className="flex-1 text-white" onClick={onCancel}>
          انصراف
        </Button>
        <Button type="button" className="flex-1 bg-amber-300 text-[#102824] hover:bg-amber-200" onClick={confirm}>
          {confirmLabel}
        </Button>
      </div>
    </div>
  );
}
