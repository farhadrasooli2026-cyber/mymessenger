"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  Camera,
  CameraOff,
  Maximize2,
  MessageCircle,
  Mic,
  MicOff,
  Minimize2,
  MonitorUp,
  Phone,
  PhoneOff,
  PictureInPicture2,
  SwitchCamera,
  Video,
  Volume2,
} from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { callKindFa, callStatusFa, formatCallClock, videoStateFa } from "@/lib/call-copy";
import {
  applyBitrate,
  attachCamera,
  cameraSettingsHint,
  debugDeviceLabel,
  getMediaErrorMessage,
  listAudioOutputs,
  listAudioInputs,
  listCameras,
  sampleCallQuality,
  shareScreen,
  startCameraPreview,
  startMediaLoop,
  stopLoop,
  stopStream,
  switchCamera,
  watchVideoFreeze,
  type LoopSession,
} from "@/lib/webrtc-loop";
import { startBridgedCall } from "@/lib/webrtc-bridge";

export type LiveCall = {
  id: string;
  threadId: string;
  peerKey: string;
  peerName: string;
  peerColor: string;
  kind: "voice" | "video";
  direction: "out" | "in";
  status: "ringing" | "active" | "ended" | "declined" | "missed" | "queued";
  createdAt: number;
  connectedAt: number | null;
  bridged?: boolean;
  sessionId?: string | null;
  mediaToken?: string | null;
  peerMicMuted?: boolean;
  camOff?: boolean;
  peerCamOff?: boolean;
  sharing?: boolean;
  peerSharing?: boolean;
  voiceFallback?: boolean;
  videoState?: string;
};

export function CallStage({
  call,
  waiting,
  lowData,
  hideLockInfo,
  myName,
  onClose,
  onMessageDecline,
  onWaitingAction,
  onRetry,
  minimized,
  onMinimized,
}: {
  call: LiveCall;
  waiting?: LiveCall | null;
  lowData: boolean;
  hideLockInfo: boolean;
  myName: string;
  onClose: () => void;
  onMessageDecline: () => void;
  onWaitingAction?: (action: "accept" | "decline" | "end-current-accept", waitingId: string) => void;
  onRetry?: () => void;
  minimized: boolean;
  onMinimized: (v: boolean) => void;
}) {
  const localRef = useRef<HTMLVideoElement>(null);
  const remoteRef = useRef<HTMLVideoElement>(null);
  const audioRef = useRef<HTMLAudioElement>(null);
  const loopRef = useRef<LoopSession | null>(null);
  const stopShareRef = useRef<(() => void) | null>(null);
  const [phase, setPhase] = useState<"ringing" | "active" | "reconnect" | "poor">(
    call.status === "active" ? "active" : "ringing",
  );
  const [muted, setMuted] = useState(false);
  const [camOff, setCamOff] = useState(call.kind === "voice");
  const [facing, setFacing] = useState<"user" | "environment">("user");
  const [speaker, setSpeaker] = useState<"earpiece" | "speaker" | "bluetooth" | "headphones">("speaker");
  const [sinks, setSinks] = useState<{ deviceId: string; label: string }[]>([]);
  const [mics, setMics] = useState<{ deviceId: string; label: string }[]>([]);
  const [audioDeviceId, setAudioDeviceId] = useState<string | undefined>();
  const [tokenById, setTokenById] = useState<{ id: string; token?: string | null }>({
    id: call.id,
    token: call.mediaToken,
  });
  const mediaToken = tokenById.id === call.id ? (tokenById.token ?? call.mediaToken) : call.mediaToken;
  const [failed, setFailed] = useState(false);
  const [quality, setQuality] = useState<"auto" | "saver" | "high">(lowData ? "saver" : "auto");
  const [sharing, setSharing] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const [busy, setBusy] = useState(false);
  const [metrics, setMetrics] = useState<{ rttMs: number; loss: number; jitterMs: number; frozen?: boolean } | null>(null);
  const [voiceFallback, setVoiceFallback] = useState(Boolean(call.voiceFallback));
  const [frozen, setFrozen] = useState(false);
  const [cameras, setCameras] = useState<{ deviceId: string; label: string }[]>([]);
  const previewRef = useRef<MediaStream | null>(null);
  const incoming = call.direction === "in" && phase === "ringing";
  const bridged = Boolean(call.bridged);

  const attach = useCallback((session: LoopSession) => {
    loopRef.current = session;
    if (localRef.current) {
      localRef.current.srcObject = session.local;
      void localRef.current.play().catch(() => undefined);
    }
    if (remoteRef.current) {
      remoteRef.current.srcObject = session.remote;
      void remoteRef.current.play().catch(() => undefined);
    }
    if (audioRef.current) {
      audioRef.current.srcObject = session.remote;
      void audioRef.current.play().catch(() => undefined);
    }
    const onIce = () => {
      const st = session.pcLocal.iceConnectionState;
      if (st === "disconnected" || st === "failed") {
        setPhase("reconnect");
        void fetch(`/api/calls/${call.id}`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action: "reconnect" }),
        }).then(async (res) => {
          if (res.status === 429) {
            toast.error("اتصال مجدد به سقف رسید.");
            void fetch(`/api/calls/${call.id}`, {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ action: "fail" }),
            });
          }
        });
        void fetch(`/api/calls/${call.id}/signal`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ type: "reconnect", body: st, token: mediaToken }),
        });
      } else if (st === "checking") setPhase("poor");
      else if (st === "connected" || st === "completed") {
        setPhase("active");
        void fetch(`/api/calls/${call.id}/signal`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ type: "quality", body: `ice:${st}`, token: mediaToken }),
        });
      }
    };
    session.pcLocal.addEventListener("iceconnectionstatechange", onIce);
  }, [call.id, mediaToken]);

  async function mediaForConnect() {
    try {
      stopStream(previewRef.current);
      previewRef.current = null;
      const session = bridged
        ? await startBridgedCall({
            callId: call.id,
            offerer: call.direction === "in",
            video: call.kind === "video",
            lowData: quality === "saver" || lowData,
            token: mediaToken,
            quality,
            audioDeviceId,
          })
        : await startMediaLoop({
            video: call.kind === "video",
            lowData: quality === "saver" || lowData,
            audioDeviceId,
          });
      attach(session);
      return session.voiceFallback && call.kind === "video" ? "fallback" : "ok";
    } catch (err) {
      toast.error(getMediaErrorMessage(err));
      return "fail";
    }
  }

  useEffect(() => {
    if (incoming) return;
    void mediaForConnect().then((r) => {
      if (r === "fail") {
        setFailed(true);
        void hang("fail");
        return;
      }
      if (r === "fallback") {
        setVoiceFallback(true);
        setCamOff(true);
        toast.message("دوربین در دسترس نیست. تماس با صدا ادامه دارد.");
        void fetch(`/api/calls/${call.id}`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action: "voice-fallback" }),
        });
      }
    });
    return () => {
      stopShareRef.current?.();
      stopStream(previewRef.current);
      stopLoop(loopRef.current);
      loopRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [call.id]);

  useEffect(() => {
    void listAudioOutputs().then(setSinks);
    void listAudioInputs().then(setMics);
    void listCameras().then(setCameras);
  }, []);

  useEffect(() => {
    if (!incoming || call.kind !== "video") return;
    let live = true;
    void startCameraPreview(facing)
      .then((stream) => {
        if (!live) {
          stopStream(stream);
          return;
        }
        previewRef.current = stream;
        if (localRef.current) {
          localRef.current.srcObject = stream;
          void localRef.current.play().catch(() => undefined);
        }
      })
      .catch((err) => toast.error(getMediaErrorMessage(err)));
    return () => {
      live = false;
      stopStream(previewRef.current);
      previewRef.current = null;
    };
  }, [incoming, call.kind, facing]);

  useEffect(() => {
    if (!bridged || call.direction !== "out" || phase !== "ringing") return;
    const t = window.setInterval(async () => {
      const res = await fetch("/api/calls?live=1", { cache: "no-store" });
      if (!res.ok) return;
      const data = (await res.json()) as { call?: LiveCall | null };
      if (data.call?.id === call.id && data.call.status === "active") setPhase("active");
    }, 1200);
    return () => window.clearInterval(t);
  }, [bridged, call.direction, call.id, phase]);

  useEffect(() => {
    const onOff = () => setPhase("reconnect");
    const onOn = () => setPhase("poor");
    window.addEventListener("offline", onOff);
    window.addEventListener("online", onOn);
    return () => {
      window.removeEventListener("offline", onOff);
      window.removeEventListener("online", onOn);
    };
  }, []);

  useEffect(() => {
    if (call.direction !== "out" || phase !== "ringing" || bridged) return;
    const t = window.setTimeout(async () => {
      const res = await fetch(`/api/calls/${call.id}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "connect" }),
      });
      if (res.ok) setPhase("active");
    }, 1800);
    return () => window.clearTimeout(t);
  }, [call.direction, call.id, phase, bridged]);

  useEffect(() => {
    if (phase !== "active" && phase !== "poor") return;
    const started = Date.now();
    const t = window.setInterval(() => setElapsed(Date.now() - started), 500);
    return () => window.clearInterval(t);
  }, [phase]);

  useEffect(() => {
    if (phase !== "active" && phase !== "poor" && phase !== "reconnect") return;
    const t = window.setInterval(async () => {
      const session = loopRef.current;
      if (!session) return;
      const sample = await sampleCallQuality(session.pcLocal);
      if (!sample) return;
      setMetrics(sample);
      if (sample.loss >= 8 || sample.rttMs >= 400) setPhase((p) => (p === "reconnect" ? p : "poor"));
      if (sample.frozen) setFrozen(true);
      const nonce = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
      void fetch(`/api/calls/${call.id}/signal`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          type: "quality",
          nonce,
          body: `rtt=${sample.rttMs},loss=${sample.loss},jitter=${sample.jitterMs},fr=${sample.framesDecoded},br=${sample.bitrateKbps},fz=${sample.frozen ? 1 : 0},dev=${debugDeviceLabel()}`,
          token: mediaToken,
        }),
      });
    }, 5000);
    return () => window.clearInterval(t);
  }, [phase, call.id, mediaToken]);

  useEffect(() => {
    if (!incoming) return;
    try {
      navigator.vibrate?.([220, 80, 220, 80, 400]);
    } catch {
      /* unsupported */
    }
    let ctx: AudioContext | null = null;
    let stop = false;
    const beep = async () => {
      const AC = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      if (!AC) return;
      ctx = new AC();
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.frequency.value = 480;
      osc.type = "sine";
      gain.gain.value = 0.05;
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start();
      await new Promise((r) => window.setTimeout(r, 350));
      if (!stop) osc.stop();
    };
    void beep();
    const t = window.setInterval(() => {
      if (!stop) void beep();
    }, 1800);
    return () => {
      stop = true;
      window.clearInterval(t);
      void ctx?.close();
    };
  }, [incoming]);

  useEffect(() => {
    if (!hideLockInfo && incoming && "Notification" in window && Notification.permission === "granted") {
      new Notification("تماس ورودی نیکسو", { body: `${call.peerName} · ${callKindFa(call.kind)}` });
    } else if (hideLockInfo && incoming && "Notification" in window && Notification.permission === "granted") {
      new Notification("تماس ورودی نیکسو", { body: "تماس خصوصی" });
    }
  }, [incoming, hideLockInfo, call.peerName, call.kind]);

  async function hang(action: "end" | "decline" | "message-decline" | "cancel" | "fail") {
    setBusy(true);
    await fetch(`/api/calls/${call.id}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action }),
    });
    stopShareRef.current?.();
    stopLoop(loopRef.current);
    loopRef.current = null;
    if (action === "fail") {
      setFailed(true);
      setBusy(false);
      setPhase("ringing");
      toast.error("تماس برقرار نشد. می‌توانی دوباره تلاش کنی.");
      return;
    }
    if (action === "message-decline") onMessageDecline();
    else onClose();
  }

  async function accept() {
    setBusy(true);
    const media = await mediaForConnect();
    if (media === "fail") {
      setBusy(false);
      await hang("fail");
      return;
    }
    if (media === "fallback") {
      setVoiceFallback(true);
      setCamOff(true);
      toast.message("دوربین در دسترس نیست. تماس با صدا ادامه دارد.");
      void fetch(`/api/calls/${call.id}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "voice-fallback" }),
      });
    }
    const res = await fetch(`/api/calls/${call.id}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "accept" }),
    });
    const data = (await res.json().catch(() => null)) as { mediaToken?: string } | null;
    setBusy(false);
    if (!res.ok) {
      toast.error("پذیرش تماس انجام نشد.");
      return;
    }
    if (data?.mediaToken) setTokenById({ id: call.id, token: data.mediaToken });
    setPhase("active");
  }

  function toggleMute() {
    const next = !muted;
    setMuted(next);
    loopRef.current?.local.getAudioTracks().forEach((t) => {
      t.enabled = !next;
    });
    void fetch(`/api/calls/${call.id}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: next ? "mute" : "unmute" }),
    });
  }

  function toggleCam() {
    if (call.kind !== "video") return;
    const next = !camOff;
    setCamOff(next);
    loopRef.current?.local.getVideoTracks().forEach((t) => {
      t.enabled = !next;
    });
    void fetch(`/api/calls/${call.id}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: next ? "cam-off" : "cam-on" }),
    });
  }

  async function retryVideo() {
    if (!loopRef.current) return;
    try {
      await attachCamera(loopRef.current, { lowData: quality === "saver" || lowData, facing, deviceId: undefined });
      setVoiceFallback(false);
      setCamOff(false);
      void fetch(`/api/calls/${call.id}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "retry-video" }),
      });
      toast.success("دوربین دوباره روشن شد.");
    } catch (err) {
      toast.error(getMediaErrorMessage(err));
    }
  }

  async function flipCam() {
    if (!loopRef.current || call.kind !== "video" || sharing) return;
    const next = facing === "user" ? "environment" : "user";
    try {
      await switchCamera(loopRef.current, next);
      setFacing(next);
    } catch {
      toast.error("تعویض دوربین روی این دستگاه پشتیبانی نشد.");
    }
  }

  async function pip() {
    const el = remoteRef.current ?? localRef.current;
    if (!el) return;
    try {
      if (document.pictureInPictureElement) await document.exitPictureInPicture();
      else await el.requestPictureInPicture();
    } catch {
      toast.message("تصویر در تصویر در این مرورگر در دسترس نیست.");
    }
  }

  async function pickSink(id: string, label: string) {
    const el = audioRef.current;
    setSpeaker(
      /bluetooth/i.test(label) ? "bluetooth" : /head|earbud/i.test(label) ? "headphones" : id ? "earpiece" : "speaker",
    );
    if (el && "setSinkId" in el) {
      try {
        await (el as HTMLAudioElement & { setSinkId: (id: string) => Promise<void> }).setSinkId(id);
      } catch {
        toast.message("خروجی صدا توسط مرورگر محدود شد.");
      }
    }
  }

  async function toggleShare() {
    if (!loopRef.current || call.kind !== "video") {
      toast.message("اشتراک صفحه فقط در تماس تصویری.");
      return;
    }
    if (sharing) {
      stopShareRef.current?.();
      stopShareRef.current = null;
      setSharing(false);
      void fetch(`/api/calls/${call.id}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "share-stop" }),
      });
      return;
    }
    try {
      toast.message("فقط پنجره یا صفحه‌ای که خودت انتخاب می‌کنی فرستاده می‌شود.");
      const stop = await shareScreen(loopRef.current);
      stopShareRef.current = () => {
        stop();
        setSharing(false);
        void fetch(`/api/calls/${call.id}`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action: "share-stop" }),
        });
      };
      setSharing(true);
      void fetch(`/api/calls/${call.id}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "share-start" }),
      });
    } catch {
      toast.error("اشتراک صفحه لغو شد یا مرورگر اجازه نداد.");
    }
  }

  useEffect(() => {
    const session = loopRef.current;
    if (!session) return;
    void applyBitrate(session.pcLocal, lowData || voiceFallback, quality);
  }, [lowData, quality, voiceFallback]);

  useEffect(() => {
    const el = remoteRef.current;
    if (!el || call.kind !== "video" || phase === "ringing") return;
    return watchVideoFreeze(
      el,
      () => {
        setFrozen(true);
        toast.message("تصویر گیر کرده؛ در حال بازیابی…");
        void fetch(`/api/calls/${call.id}`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action: "reconnect" }),
        });
      },
      () => setFrozen(false),
    );
  }, [call.id, call.kind, phase]);

  const statusText =
    phase === "reconnect"
      ? "در حال اتصال مجدد · Reconnecting"
      : phase === "poor"
        ? "اتصال ضعیف · Poor Connection"
        : phase === "active"
          ? "متصل · Connected"
          : incoming
            ? "تماس ورودی · Incoming"
            : "در حال زنگ · Calling";

  if (minimized && (phase === "active" || phase === "poor" || phase === "reconnect")) {
    return (
      <button
        type="button"
        className="fixed bottom-20 left-4 z-50 flex items-center gap-3 rounded-2xl border border-amber-300/40 bg-[#102824] px-3 py-2 text-sm shadow-xl md:bottom-6"
        onClick={() => onMinimized(false)}
      >
        <span className="grid size-9 place-items-center rounded-full" style={{ background: call.peerColor }}>
          {call.peerName.slice(0, 1)}
        </span>
        <span>
          <span className="block font-medium">{call.peerName}</span>
          <span className="text-[11px] text-amber-200" dir="ltr">
            {phase === "reconnect" ? "Reconnecting…" : formatCallClock(elapsed)}
          </span>
        </span>
      </button>
    );
  }

  return (
    <div className={cn("fixed inset-0 z-50 flex flex-col bg-[#071614] text-emerald-50", incoming && "bg-[#0b1c1a]")}>
      <audio ref={audioRef} autoPlay playsInline />
      {waiting && onWaitingAction && (
        <div className="z-10 border-b border-amber-300/30 bg-[#1a2e2a] px-4 py-3 text-sm">
          <p className="font-medium">تماس همزمان از {waiting.peerName}</p>
          <p className="text-[11px] text-amber-200">{callKindFa(waiting.kind)}</p>
          <div className="mt-2 flex flex-wrap gap-2">
            <Button type="button" size="sm" className="bg-emerald-500 text-[#071614]" onClick={() => onWaitingAction("accept", waiting.id)}>
              پذیرش
            </Button>
            <Button type="button" size="sm" variant="secondary" onClick={() => onWaitingAction("end-current-accept", waiting.id)}>
              قطع فعلی و پذیرش
            </Button>
            <Button type="button" size="sm" className="bg-rose-500 text-white" onClick={() => onWaitingAction("decline", waiting.id)}>
              رد
            </Button>
          </div>
        </div>
      )}
      {call.kind === "video" && (
        <div className="relative min-h-0 flex-1 bg-black">
          <video
            ref={remoteRef}
            autoPlay
            playsInline
            className={cn("h-full w-full object-cover", (call.peerCamOff || voiceFallback) && "opacity-0")}
          />
          {(call.peerCamOff || frozen || voiceFallback) && (
            <div className="absolute inset-0 grid place-items-center bg-[#071614]">
              <span
                className="grid size-28 place-items-center rounded-[2rem] text-4xl font-semibold text-[#071614]"
                style={{ background: call.peerColor }}
              >
                {call.peerName.slice(0, 1)}
              </span>
              <p className="mt-3 text-sm text-amber-200">
                {frozen ? "تصویر گیر کرده" : call.peerCamOff ? "دوربین مخاطب خاموش است" : "تماس با صدا · Voice fallback"}
              </p>
            </div>
          )}
          <div className="absolute bottom-4 left-4 h-32 w-24 overflow-hidden rounded-xl border border-white/20">
            <video ref={localRef} autoPlay muted playsInline className={cn("h-full w-full object-cover", (camOff || voiceFallback) && "hidden")} />
            {(camOff || voiceFallback) && (
              <div className="grid h-full w-full place-items-center bg-[#102824] text-xs">شما · دوربین خاموش</div>
            )}
          </div>
          <div className="absolute right-3 top-20 flex flex-col gap-1 text-[10px]">
            {!camOff && !voiceFallback ? (
              <span className="rounded-full bg-rose-500/90 px-2 py-0.5">دوربین روشن</span>
            ) : null}
            {!muted ? <span className="rounded-full bg-emerald-600/90 px-2 py-0.5">میکروفون روشن</span> : null}
            {sharing ? <span className="rounded-full bg-amber-300 px-2 py-0.5 text-[#102824]">اشتراک صفحه</span> : null}
            {call.peerSharing ? <span className="rounded-full bg-white/20 px-2 py-0.5">مخاطب در حال اشتراک</span> : null}
          </div>
        </div>
      )}
      {call.kind === "voice" && (
        <div className="flex flex-1 flex-col items-center justify-center gap-4 p-6">
          <span
            className="grid size-28 place-items-center rounded-[2rem] text-4xl font-semibold text-[#071614]"
            style={{ background: call.peerColor }}
          >
            {call.peerName.slice(0, 1)}
          </span>
          <p className="text-2xl font-semibold">{hideLockInfo && incoming ? "تماس خصوصی" : call.peerName}</p>
          <p className="text-sm text-amber-200">{statusText}</p>
          {call.peerMicMuted ? <p className="text-xs text-emerald-100/60">میکروفون مخاطب قطع است</p> : null}
          {(phase === "active" || phase === "poor") && (
            <p className="text-lg tabular-nums" dir="ltr">
              {formatCallClock(elapsed)}
            </p>
          )}
        </div>
      )}
      {call.kind === "video" && (
        <div className="absolute inset-x-0 top-0 bg-gradient-to-b from-black/70 to-transparent p-4 pt-8">
          <p className="text-lg font-semibold">{call.peerName}</p>
          <p className="text-xs text-amber-200">
            {statusText}
            {call.videoState ? ` · ${videoStateFa(voiceFallback ? "camera-off" : call.videoState)}` : ""}
            {phase === "active" || phase === "poor" ? ` · ${formatCallClock(elapsed)}` : ""}
          </p>
        </div>
      )}

      <div className="space-y-3 px-4 pb-[calc(1.5rem+env(safe-area-inset-bottom))] pt-3">
        <p className="text-center text-[11px] leading-5 text-emerald-100/55">
          سیگنال تماس با نشست احرازشده روی سرور است. رسانه با DTLS/SRTP مرورگر رمز می‌شود و نیکسو صدا/تصویر را نمی‌بیند.
          برای مخاطب واقعی، Offer/Answer و ICE فقط در اتاق همان نشست رد و بدل می‌شود. Echo Cancellation، Noise Suppression و AGC در صورت پشتیبانی مرورگر فعال است. نیکسو جایگزین تماس اضطراری سیستم‌عامل نیست.
        </p>
        <p className="text-center text-[10px] text-emerald-100/40" role="status">
          ضبط تماس خاموش است · Recording off
          {metrics
            ? ` · RTT ${metrics.rttMs}ms · Loss ${metrics.loss}% · Jitter ${metrics.jitterMs}ms`
            : ""}
          {frozen ? " · Freeze" : ""}
        </p>
        {voiceFallback && call.kind === "video" ? (
          <div className="rounded-xl bg-amber-300/15 px-3 py-2 text-center text-[11px] text-amber-100">
            {cameraSettingsHint()}
            <button type="button" className="mt-1 block w-full text-emerald-200 underline" onClick={() => void retryVideo()}>
              تلاش دوباره تصویر
            </button>
          </div>
        ) : null}
        {failed ? (
          <div className="flex flex-col items-center gap-3">
            <p className="text-center text-sm text-amber-100">تماس برقرار نشد. بدون میکروفون تماس ناقص شروع نمی‌شود.</p>
            <div className="flex w-full gap-2">
              <Button
                type="button"
                className="h-12 flex-1 rounded-2xl bg-emerald-500 text-[#071614]"
                onClick={() => {
                  setFailed(false);
                  if (onRetry) onRetry();
                  else onClose();
                }}
              >
                تماس دوباره
              </Button>
              <Button type="button" variant="secondary" className="h-12 flex-1 rounded-2xl" onClick={onClose}>
                بستن
              </Button>
            </div>
          </div>
        ) : incoming ? (
          <div className="flex justify-center gap-3">
            <Button type="button" className="h-14 flex-1 rounded-2xl bg-rose-500 text-white" disabled={busy} onClick={() => void hang("decline")}>
              <PhoneOff className="size-5" />
              رد
            </Button>
            <Button type="button" variant="secondary" className="h-14 flex-1 rounded-2xl" disabled={busy} onClick={() => void hang("message-decline")}>
              <MessageCircle className="size-5" />
              پیام
            </Button>
            <Button type="button" className="h-14 flex-1 rounded-2xl bg-emerald-500 text-[#071614]" disabled={busy} onClick={() => void accept()}>
              {call.kind === "video" ? <Video className="size-5" /> : <Phone className="size-5" />}
              پذیرش
            </Button>
          </div>
        ) : (
          <div className="flex flex-wrap items-center justify-center gap-2">
            <Ctrl on={muted} onClick={toggleMute} label={muted ? "صدا قطع" : "قطع میکروفون"}>
              {muted ? <MicOff className="size-5" /> : <Mic className="size-5" />}
            </Ctrl>
            <Ctrl
              on={speaker === "speaker"}
              onClick={() => void pickSink("", speaker === "speaker" ? "earpiece" : "speaker")}
              label="بلندگو"
            >
              <Volume2 className="size-5" />
            </Ctrl>
            {call.kind === "video" && (
              <>
                <Ctrl on={camOff} onClick={toggleCam} label="دوربین">
                  {camOff ? <CameraOff className="size-5" /> : <Camera className="size-5" />}
                </Ctrl>
                <Ctrl on={false} onClick={() => void flipCam()} label="تعویض دوربین">
                  <SwitchCamera className="size-5" />
                </Ctrl>
                <Ctrl on={sharing} onClick={() => void toggleShare()} label={sharing ? "توقف اشتراک" : "اشتراک صفحه"}>
                  <MonitorUp className="size-5" />
                </Ctrl>
                <Ctrl on={false} onClick={() => void pip()} label="تصویر در تصویر">
                  <PictureInPicture2 className="size-5" />
                </Ctrl>
                <Ctrl on={false} onClick={() => void remoteRef.current?.requestFullscreen()} label="تمام‌صفحه">
                  <Maximize2 className="size-5" />
                </Ctrl>
                <Ctrl on={false} onClick={() => onMinimized(true)} label="کوچک">
                  <Minimize2 className="size-5" />
                </Ctrl>
              </>
            )}
            {call.kind === "voice" && (
              <Ctrl on={false} onClick={() => onMinimized(true)} label="ادامه در پس‌زمینه نیکسو">
                <Minimize2 className="size-5" />
              </Ctrl>
            )}
            <Button
              type="button"
              className="h-14 min-w-14 rounded-full bg-rose-500 text-white"
              disabled={busy}
              onClick={() => void hang(phase === "ringing" && call.direction === "out" ? "cancel" : "end")}
              aria-label={phase === "ringing" && call.direction === "out" ? "لغو تماس" : "پایان تماس"}
            >
              <PhoneOff className="size-6" />
            </Button>
          </div>
        )}
        {!incoming && (
          <div className="flex flex-wrap items-center justify-center gap-2 text-[11px]">
            {(["auto", "saver", "high"] as const).map((q) => (
              <button
                key={q}
                type="button"
                className={cn("rounded-full px-2 py-1", quality === q ? "bg-amber-300 text-[#102824]" : "bg-white/10")}
                onClick={() => setQuality(q)}
              >
                {q === "auto" ? "کیفیت خودکار" : q === "saver" ? "کم‌مصرف" : "کیفیت بالا"}
              </button>
            ))}
            {mics.map((m) => (
              <button
                key={m.deviceId}
                type="button"
                className={cn("rounded-full px-2 py-1", audioDeviceId === m.deviceId ? "bg-amber-300 text-[#102824]" : "bg-white/10")}
                onClick={() => {
                  setAudioDeviceId(m.deviceId);
                  if (!loopRef.current) return;
                  void navigator.mediaDevices
                    .getUserMedia({ audio: { deviceId: { exact: m.deviceId }, echoCancellation: true, noiseSuppression: true } })
                    .then(async (stream) => {
                      const track = stream.getAudioTracks()[0];
                      const sender = loopRef.current?.pcLocal.getSenders().find((s) => s.track?.kind === "audio");
                      if (track) await sender?.replaceTrack(track);
                    })
                    .catch(() => toast.error("این میکروفون در دسترس نیست."));
                }}
              >
                {m.label.slice(0, 16) || "میکروفون"}
              </button>
            ))}
            {cameras.map((c) => (
              <button
                key={c.deviceId}
                type="button"
                className="rounded-full bg-white/10 px-2 py-1"
                onClick={() => {
                  if (!loopRef.current) return;
                  void navigator.mediaDevices
                    .getUserMedia({ video: { deviceId: { exact: c.deviceId } }, audio: false })
                    .then(async (stream) => {
                      const track = stream.getVideoTracks()[0];
                      const sender = loopRef.current?.pcLocal.getSenders().find((s) => s.track?.kind === "video");
                      if (track) await sender?.replaceTrack(track);
                    })
                    .catch(() => toast.error("این دوربین در دسترس نیست."));
                }}
              >
                {c.label.slice(0, 16) || "دوربین"}
              </button>
            ))}
            {sinks.map((s) => (
              <button
                key={s.deviceId}
                type="button"
                className="rounded-full bg-white/10 px-2 py-1"
                onClick={() => void pickSink(s.deviceId, s.label)}
              >
                {s.label.slice(0, 18) || "خروجی"}
              </button>
            ))}
          </div>
        )}
        <p className="text-center text-[10px] text-emerald-100/40">
          {callStatusFa(call.status, call.direction, call.kind)} · برای {myName}
        </p>
      </div>
    </div>
  );
}

function Ctrl({
  children,
  onClick,
  label,
  on,
}: {
  children: React.ReactNode;
  onClick: () => void;
  label: string;
  on: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      aria-pressed={on}
      className={cn(
        "grid size-12 place-items-center rounded-full",
        on ? "bg-amber-300 text-[#102824]" : "bg-white/10 text-white",
      )}
    >
      {children}
    </button>
  );
}
