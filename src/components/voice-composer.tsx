"use client";

import { useEffect, useRef, useState } from "react";
import { Lock, Mic, Pause, Play, Send, Trash2, Unlock } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { encryptText, loadOrCreateThreadKey } from "@/lib/e2ee";
import {
  DISAPPEAR_PRESETS,
  VOICE_BITRATE,
  VOICE_MAX_MS,
  VOICE_MIN_MS,
  formatClock,
  pickRecorderMime,
  type DisappearId,
} from "@/lib/voice";

type Phase = "idle" | "holding" | "locked" | "paused" | "preview" | "denied";

function blobToB64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const s = String(reader.result ?? "");
      resolve(s.includes(",") ? s.slice(s.indexOf(",") + 1) : s);
    };
    reader.onerror = () => reject(new Error("read"));
    reader.readAsDataURL(blob);
  });
}

export function VoiceComposer({
  threadId,
  disabled,
  onSent,
  onRecordingChange,
  children,
}: {
  threadId: string;
  disabled?: boolean;
  onSent: () => void;
  onRecordingChange?: (active: boolean) => void;
  children?: React.ReactNode;
}) {
  const [phase, setPhase] = useState<Phase>("idle");
  const [elapsed, setElapsed] = useState(0);
  const [peaks, setPeaks] = useState<number[]>([]);
  const [hint, setHint] = useState<"none" | "cancel" | "lock">("none");
  const [viewOnce, setViewOnce] = useState(false);
  const [disappear, setDisappear] = useState<DisappearId>("off");
  const [customMs, setCustomMs] = useState(120_000);
  const [retry, setRetry] = useState<{
    envelope: { enc: "e2ee-v1"; ciphertext: string; nonce: string };
    durationMs: number;
    viewOnce: boolean;
    disappearAfterMs: number | null;
  } | null>(null);
  const [sending, setSending] = useState(false);

  const recRef = useRef<MediaRecorder | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const startRef = useRef(0);
  const elapsedRef = useRef(0);
  const originRef = useRef({ x: 0, y: 0 });
  const lockedRef = useRef(false);
  const cancelRef = useRef(false);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const rafRef = useRef<number>(0);
  const timerRef = useRef<number>(0);
  const blobRef = useRef<Blob | null>(null);
  const previewUrl = useRef<string | null>(null);

  const busy = phase === "holding" || phase === "locked" || phase === "paused" || phase === "preview";

  useEffect(() => {
    onRecordingChange?.(busy);
  }, [busy, onRecordingChange]);

  function stopTracks() {
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    if (rafRef.current) cancelAnimationFrame(rafRef.current);
    window.clearInterval(timerRef.current);
  }

  function resetAll() {
    recRef.current = null;
    chunksRef.current = [];
    blobRef.current = null;
    lockedRef.current = false;
    cancelRef.current = false;
    elapsedRef.current = 0;
    setElapsed(0);
    setPeaks([]);
    setHint("none");
    setPhase("idle");
    if (previewUrl.current) {
      URL.revokeObjectURL(previewUrl.current);
      previewUrl.current = null;
    }
    stopTracks();
  }

  useEffect(() => () => stopTracks(), []);

  async function startRecording() {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: true, channelCount: 1 },
      });
      streamRef.current = stream;
      const ctx = new AudioContext();
      const source = ctx.createMediaStreamSource(stream);
      const analyser = ctx.createAnalyser();
      analyser.fftSize = 256;
      source.connect(analyser);
      analyserRef.current = analyser;
      const mime = pickRecorderMime();
      const rec = new MediaRecorder(stream, { mimeType: mime, audioBitsPerSecond: VOICE_BITRATE });
      chunksRef.current = [];
      rec.ondataavailable = (e) => {
        if (e.data.size > 0) chunksRef.current.push(e.data);
      };
      rec.start(120);
      recRef.current = rec;
      startRef.current = Date.now();
      elapsedRef.current = 0;
      setElapsed(0);
      timerRef.current = window.setInterval(() => {
        const ms = Date.now() - startRef.current;
        elapsedRef.current = ms;
        setElapsed(ms);
        if (ms >= VOICE_MAX_MS) void finishToPreview();
      }, 200);
      const tick = () => {
        const a = analyserRef.current;
        if (a) {
          const data = new Uint8Array(a.frequencyBinCount);
          a.getByteTimeDomainData(data);
          let sum = 0;
          data.forEach((v) => {
            const n = (v - 128) / 128;
            sum += n * n;
          });
          const amp = Math.min(1, Math.sqrt(sum / data.length) * 4);
          setPeaks((prev) => [...prev.slice(-47), amp || 0.12]);
        }
        rafRef.current = requestAnimationFrame(tick);
      };
      tick();
    } catch {
      setPhase("denied");
    }
  }

  async function collectBlob(): Promise<Blob | null> {
    const rec = recRef.current;
    if (!rec) return blobRef.current;
    if (rec.state !== "inactive") {
      await new Promise<void>((resolve) => {
        rec.addEventListener("stop", () => resolve(), { once: true });
        rec.stop();
      });
    }
    stopTracks();
    const blob = new Blob(chunksRef.current, { type: rec.mimeType || "audio/webm" });
    blobRef.current = blob;
    return blob;
  }

  async function finishToPreview() {
    lockedRef.current = true;
    const blob = await collectBlob();
    if (!blob || elapsedRef.current < VOICE_MIN_MS) {
      toast.error("ضبط خیلی کوتاه بود.");
      resetAll();
      return;
    }
    if (previewUrl.current) URL.revokeObjectURL(previewUrl.current);
    previewUrl.current = URL.createObjectURL(blob);
    setPhase("preview");
  }

  async function sendBlob() {
    const blob = blobRef.current ?? (await collectBlob());
    if (!blob || elapsedRef.current < VOICE_MIN_MS) {
      toast.error("ضبط خیلی کوتاه بود.");
      resetAll();
      return;
    }
    setSending(true);
    try {
      const audio = await blobToB64(blob);
      const key = await loadOrCreateThreadKey(threadId);
      const inner = JSON.stringify({
        mime: blob.type || "audio/webm",
        audio,
        durationMs: elapsedRef.current,
        peaks,
      });
      const envelope = await encryptText(key, inner);
      const preset = DISAPPEAR_PRESETS.find((p) => p.id === disappear);
      const disappearAfterMs =
        disappear === "off" ? null : disappear === "custom" ? customMs : preset && preset.ms > 0 ? preset.ms : null;
      const body = {
        ...envelope,
        kind: "voice" as const,
        durationMs: elapsedRef.current,
        viewOnce,
        disappearAfterMs,
      };
      const res = await fetch(`/api/chats/${threadId}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        setRetry({ envelope, durationMs: elapsedRef.current, viewOnce, disappearAfterMs });
        toast.error("ارسال نشد. دوباره تلاش کن.");
        return;
      }
      setRetry(null);
      resetAll();
      onSent();
    } finally {
      setSending(false);
    }
  }

  async function retrySend() {
    if (!retry) return;
    setSending(true);
    try {
      const res = await fetch(`/api/chats/${threadId}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...retry.envelope,
          kind: "voice",
          durationMs: retry.durationMs,
          viewOnce: retry.viewOnce,
          disappearAfterMs: retry.disappearAfterMs,
        }),
      });
      if (!res.ok) {
        toast.error("ارسال نشد.");
        return;
      }
      setRetry(null);
      resetAll();
      onSent();
    } finally {
      setSending(false);
    }
  }

  function onPointerDown(e: React.PointerEvent<HTMLButtonElement>) {
    if (disabled || phase === "denied") return;
    e.preventDefault();
    e.currentTarget.setPointerCapture(e.pointerId);
    originRef.current = { x: e.clientX, y: e.clientY };
    lockedRef.current = false;
    cancelRef.current = false;
    setPhase("holding");
    void startRecording();
  }

  function onPointerMove(e: React.PointerEvent) {
    if (phase !== "holding") return;
    const dx = e.clientX - originRef.current.x;
    const dy = e.clientY - originRef.current.y;
    if (dy < -56) {
      lockedRef.current = true;
      setHint("lock");
      setPhase("locked");
      return;
    }
    if (dx < -64) {
      cancelRef.current = true;
      setHint("cancel");
    } else {
      cancelRef.current = false;
      setHint("none");
    }
  }

  function onPointerUp() {
    if (lockedRef.current) return;
    if (phase !== "holding") return;
    if (cancelRef.current) {
      recRef.current?.stop();
      resetAll();
      toast.message("ضبط لغو شد.");
      return;
    }
    void sendBlob();
  }

  function pauseRec() {
    if (recRef.current?.state === "recording") {
      recRef.current.pause();
      window.clearInterval(timerRef.current);
      setPhase("paused");
    }
  }

  function resumeRec() {
    if (recRef.current?.state === "paused") {
      recRef.current.resume();
      startRef.current = Date.now() - elapsedRef.current;
      timerRef.current = window.setInterval(() => {
        const ms = Date.now() - startRef.current;
        elapsedRef.current = ms;
        setElapsed(ms);
        if (ms >= VOICE_MAX_MS) void finishToPreview();
      }, 200);
      setPhase("locked");
    }
  }

  const recording = phase === "holding" || phase === "locked" || phase === "paused";

  return (
    <div className="border-t border-white/10 bg-[#0b2421]/95 p-3">
      {retry && (
        <div className="mb-2 flex items-center justify-between gap-2 rounded-xl bg-rose-500/15 px-3 py-2 text-xs">
          <span>ارسال پیام صوتی ناموفق بود.</span>
          <div className="flex gap-1">
            <Button type="button" size="sm" variant="ghost" className="h-7 text-white" onClick={() => setRetry(null)}>
              انصراف
            </Button>
            <Button type="button" size="sm" className="h-7 bg-amber-300 text-[#102824]" disabled={sending} onClick={() => void retrySend()}>
              تلاش دوباره
            </Button>
          </div>
        </div>
      )}
      {phase === "denied" && (
        <p className="mb-2 text-xs leading-6 text-amber-100">
          دسترسی میکروفون داده نشد. از تنظیمات مرورگر یا سیستم‌عامل میکروفون را برای نیکسو فعال کن.
        </p>
      )}
      {!recording && phase !== "preview" && (
        <div className="mb-2 flex flex-wrap items-center gap-2 text-[11px]">
          <button
            type="button"
            className={cn("rounded-full px-2 py-1", viewOnce ? "bg-amber-300 text-[#102824]" : "bg-white/10")}
            onClick={() => setViewOnce((v) => !v)}
          >
            View Once
          </button>
          {DISAPPEAR_PRESETS.map((p) => (
            <button
              key={p.id}
              type="button"
              className={cn("rounded-full px-2 py-1", disappear === p.id ? "bg-amber-300 text-[#102824]" : "bg-white/10")}
              onClick={() => setDisappear(p.id)}
            >
              {p.label}
            </button>
          ))}
          {disappear === "custom" && (
            <input
              type="number"
              min={5}
              max={3600}
              className="h-7 w-20 rounded bg-black/30 px-2 text-[11px]"
              value={Math.round(customMs / 1000)}
              onChange={(e) => setCustomMs(Math.max(5, Number(e.target.value) || 5) * 1000)}
              aria-label="ثانیه سفارشی"
            />
          )}
        </div>
      )}
      {recording && (
        <div className="mb-3 space-y-2 rounded-2xl bg-black/30 p-3">
          <div className="flex items-center justify-between text-xs">
            <span className="tabular-nums text-amber-200" dir="ltr">
              {formatClock(elapsed)}
            </span>
            <span className="text-emerald-100/70">
              {hint === "cancel"
                ? "رها کن تا لغو شود"
                : phase === "locked" || phase === "paused"
                  ? "قفل ضبط"
                  : "بکش بالا: قفل · بکش کنار: لغو"}
            </span>
          </div>
          <div className="flex h-8 items-end gap-[2px]" dir="ltr">
            {peaks.map((p, i) => (
              <span key={i} className="w-[3px] rounded-full bg-amber-300" style={{ height: `${Math.max(10, p * 100)}%` }} />
            ))}
          </div>
          {(phase === "locked" || phase === "paused") && (
            <div className="flex flex-wrap gap-2">
              {phase === "paused" ? (
                <Button type="button" size="sm" variant="secondary" onClick={resumeRec}>
                  <Play className="size-3.5" />
                  ادامه
                </Button>
              ) : (
                <Button type="button" size="sm" variant="secondary" onClick={pauseRec}>
                  <Pause className="size-3.5" />
                  مکث
                </Button>
              )}
              <Button type="button" size="sm" variant="secondary" onClick={() => void finishToPreview()}>
                پیش‌نمایش
              </Button>
              <Button type="button" size="sm" className="bg-amber-300 text-[#102824]" disabled={sending} onClick={() => void sendBlob()}>
                <Send className="size-3.5" />
                ارسال
              </Button>
              <Button type="button" size="sm" variant="ghost" className="text-rose-200" onClick={resetAll}>
                <Trash2 className="size-3.5" />
                لغو
              </Button>
            </div>
          )}
        </div>
      )}
      {phase === "preview" && previewUrl.current && (
        <div className="mb-3 space-y-2 rounded-2xl bg-black/30 p-3">
          <p className="text-xs text-emerald-100/70">پیش‌نمایش · {formatClock(elapsed)}</p>
          <audio src={previewUrl.current} controls className="w-full" />
          <div className="flex gap-2">
            <Button type="button" size="sm" className="bg-amber-300 text-[#102824]" disabled={sending} onClick={() => void sendBlob()}>
              ارسال
            </Button>
            <Button type="button" size="sm" variant="ghost" className="text-white" onClick={resetAll}>
              لغو
            </Button>
          </div>
        </div>
      )}
      <div className="flex items-end gap-2">
        {!recording && phase !== "preview" && <div className="min-w-0 flex-1">{children}</div>}
        {phase !== "preview" && (
          <button
            type="button"
            disabled={disabled || sending}
            onPointerDown={onPointerDown}
            onPointerMove={onPointerMove}
            onPointerUp={onPointerUp}
            onPointerCancel={() => {
              if (!lockedRef.current && phase === "holding") {
                recRef.current?.stop();
                resetAll();
              }
            }}
            className={cn(
              "grid size-12 shrink-0 place-items-center rounded-full touch-none",
              recording ? "bg-rose-400 text-[#102824]" : "bg-amber-300 text-[#102824]",
              disabled && "opacity-40",
            )}
            aria-label="نگه دار تا ضبط شود"
          >
            {phase === "locked" || phase === "paused" ? (
              <Lock className="size-5" />
            ) : recording ? (
              <Unlock className="size-5" />
            ) : (
              <Mic className="size-5" />
            )}
          </button>
        )}
      </div>
    </div>
  );
}
