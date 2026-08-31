"use client";

import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";

type Props = {
  onCapture: (dataUrl: string) => void;
  onCancel: () => void;
};

export function CameraCapture({ onCapture, onCancel }: Props) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const [shot, setShot] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    navigator.mediaDevices
      .getUserMedia({ video: { facingMode: "user" }, audio: false })
      .then((stream) => {
        if (cancelled) {
          stream.getTracks().forEach((t) => t.stop());
          return;
        }
        streamRef.current = stream;
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
  }, []);

  function take() {
    const video = videoRef.current;
    if (!video) return;
    const canvas = document.createElement("canvas");
    canvas.width = 720;
    canvas.height = 720;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    const side = Math.min(video.videoWidth, video.videoHeight);
    const sx = (video.videoWidth - side) / 2;
    const sy = (video.videoHeight - side) / 2;
    ctx.drawImage(video, sx, sy, side, side, 0, 0, 720, 720);
    setShot(canvas.toDataURL("image/jpeg", 0.9));
    streamRef.current?.getTracks().forEach((t) => t.stop());
  }

  function retake() {
    setShot(null);
    navigator.mediaDevices.getUserMedia({ video: { facingMode: "user" }, audio: false }).then((stream) => {
      streamRef.current = stream;
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        void videoRef.current.play();
      }
    }).catch(() => setError("دوربین دوباره باز نشد."));
  }

  return (
    <div className="space-y-3">
      {error && <p className="text-sm text-red-200">{error}</p>}
      {shot ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={shot} alt="پیش‌نمایش عکس" className="mx-auto aspect-square w-full max-w-sm rounded-3xl object-cover" />
      ) : (
        <video ref={videoRef} playsInline muted className="mx-auto aspect-square w-full max-w-sm rounded-3xl bg-black object-cover" />
      )}
      <div className="flex gap-2">
        <Button type="button" variant="ghost" className="flex-1 text-white" onClick={onCancel}>
          انصراف
        </Button>
        {shot ? (
          <>
            <Button type="button" variant="outline" className="flex-1 border-white/15 bg-transparent text-white" onClick={retake}>
              عکس دوباره
            </Button>
            <Button type="button" className="flex-1 bg-amber-300 text-[#102824] hover:bg-amber-200" onClick={() => onCapture(shot)}>
              تأیید عکس
            </Button>
          </>
        ) : (
          <Button type="button" className="flex-1 bg-amber-300 text-[#102824] hover:bg-amber-200" onClick={take} disabled={Boolean(error)}>
            گرفتن عکس
          </Button>
        )}
      </div>
    </div>
  );
}
