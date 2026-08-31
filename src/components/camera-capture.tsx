"use client";

import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";

type Props = {
  onCapture: (dataUrl: string, kind?: "photo" | "video") => void;
  onCancel: () => void;
};

export function CameraCapture({ onCapture, onCancel }: Props) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const [shot, setShot] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [facing, setFacing] = useState<"user" | "environment">("user");
  const [recording, setRecording] = useState(false);
  const [flash, setFlash] = useState(false);

  useEffect(() => {
    let cancelled = false;
    navigator.mediaDevices
      .getUserMedia({ video: { facingMode: facing }, audio: false })
      .then((stream) => {
        if (cancelled) {
          stream.getTracks().forEach((t) => t.stop());
          return;
        }
        streamRef.current = stream;
        const track = stream.getVideoTracks()[0];
        if (track && flash) {
          const caps = track.getCapabilities?.() as { torch?: boolean } | undefined;
          if (caps?.torch) {
            void track.applyConstraints({ advanced: [{ torch: true }] } as unknown as MediaTrackConstraints);
          }
        }
        if (videoRef.current) {
          videoRef.current.srcObject = stream;
          void videoRef.current.play();
        }
      })
      .catch(() => setError("دسترسی به دوربین ممکن نشد. از گالری استفاده کنید یا مجوز را بدهید."));
    return () => {
      cancelled = true;
      streamRef.current?.getTracks().forEach((t) => t.stop());
    };
  }, [facing, flash]);

  function take() {
    const video = videoRef.current;
    if (!video) return;
    const canvas = document.createElement("canvas");
    canvas.width = 720;
    canvas.height = 720;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    const side = Math.min(video.videoWidth || 720, video.videoHeight || 720);
    const sx = ((video.videoWidth || side) - side) / 2;
    const sy = ((video.videoHeight || side) - side) / 2;
    ctx.drawImage(video, sx, sy, side, side, 0, 0, 720, 720);
    setShot(canvas.toDataURL("image/jpeg", 0.9));
    streamRef.current?.getTracks().forEach((t) => t.stop());
  }

  async function recordClip() {
    const stream = streamRef.current;
    if (!stream || typeof MediaRecorder === "undefined") {
      setError("ضبط ویدیو در این مرورگر نیست. از گالری استفاده کن.");
      return;
    }
    setRecording(true);
    const chunks: Blob[] = [];
    const rec = new MediaRecorder(stream, { mimeType: MediaRecorder.isTypeSupported("video/webm") ? "video/webm" : undefined });
    rec.ondataavailable = (e) => {
      if (e.data.size) chunks.push(e.data);
    };
    rec.onstop = async () => {
      setRecording(false);
      const blob = new Blob(chunks, { type: chunks[0]?.type || "video/webm" });
      if (blob.size > 280_000) {
        setError("ویدیو را کوتاه‌تر بگیر (حداکثر حدود ۱۵ثانیه و حجم کم).");
        return;
      }
      const url = await new Promise<string>((resolve) => {
        const r = new FileReader();
        r.onload = () => resolve(String(r.result));
        r.readAsDataURL(blob);
      });
      onCapture(url, "video");
    };
    rec.start();
    window.setTimeout(() => {
      if (rec.state === "recording") rec.stop();
    }, 8000);
  }

  return (
    <div className="space-y-3">
      <p className="text-xs text-amber-200">دوربین جلو / عقب داخل نیکسو</p>
      {error && <p className="text-sm text-red-200">{error}</p>}
      {shot ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={shot} alt="پیش‌نمایش عکس" className="mx-auto aspect-square w-full max-w-sm rounded-3xl object-cover" />
      ) : (
        <video ref={videoRef} playsInline muted className="mx-auto aspect-square w-full max-w-sm rounded-3xl bg-black object-cover" />
      )}
      <div className="flex flex-wrap gap-2">
        <Button type="button" variant="ghost" className="flex-1 text-white" onClick={onCancel}>
          انصراف
        </Button>
        {!shot && (
          <>
            <Button type="button" variant="secondary" className="flex-1" onClick={() => setFacing((f) => (f === "user" ? "environment" : "user"))}>
              {facing === "user" ? "دوربین عقب" : "دوربین جلو"}
            </Button>
            <Button type="button" variant="secondary" className="flex-1" onClick={() => setFlash((f) => !f)}>
              Flash {flash ? "روشن" : "خاموش"}
            </Button>
          </>
        )}
        {shot ? (
          <>
            <Button type="button" variant="outline" className="flex-1 border-white/15 bg-transparent text-white" onClick={() => setShot(null)}>
              عکس دوباره
            </Button>
            <Button type="button" className="flex-1 bg-amber-300 text-[#102824] hover:bg-amber-200" onClick={() => onCapture(shot, "photo")}>
              تأیید عکس
            </Button>
          </>
        ) : (
          <>
            <Button type="button" className="flex-1 bg-amber-300 text-[#102824] hover:bg-amber-200" onClick={take} disabled={Boolean(error)}>
              گرفتن عکس
            </Button>
            <Button type="button" variant="secondary" className="flex-1" onClick={() => void recordClip()} disabled={recording || Boolean(error)}>
              {recording ? "در حال ضبط…" : "ویدیو کوتاه"}
            </Button>
          </>
        )}
      </div>
    </div>
  );
}
