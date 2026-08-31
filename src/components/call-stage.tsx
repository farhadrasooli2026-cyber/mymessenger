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
import { callKindFa, callStatusFa, formatCallClock } from "@/lib/call-copy";
import {
  applyBitrate,
  getMediaErrorMessage,
  listAudioOutputs,
  shareScreen,
  startMediaLoop,
  stopLoop,
  switchCamera,
  type LoopSession,
} from "@/lib/webrtc-loop";

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
  const [quality, setQuality] = useState<"auto" | "saver" | "high">(lowData ? "saver" : "auto");
  const [sharing, setSharing] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const [busy, setBusy] = useState(false);
  const incoming = call.direction === "in" && phase === "ringing";

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
      if (st === "disconnected" || st === "failed") setPhase("reconnect");
      else if (st === "checking") setPhase("poor");
      else if (st === "connected" || st === "completed") setPhase("active");
    };
    session.pcLocal.addEventListener("iceconnectionstatechange", onIce);
  }, []);

  async function mediaForConnect() {
    try {
      const session = await startMediaLoop({
        video: call.kind === "video",
        lowData: quality === "saver" || lowData,
      });
      attach(session);
      return true;
    } catch (err) {
      toast.error(getMediaErrorMessage(err));
      return false;
    }
  }

  useEffect(() => {
    if (incoming) return;
    void mediaForConnect();
    return () => {
      stopShareRef.current?.();
      stopLoop(loopRef.current);
      loopRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [call.id]);

  useEffect(() => {
    void listAudioOutputs().then(setSinks);
  }, []);

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
    if (call.direction !== "out" || phase !== "ringing") return;
    const t = window.setTimeout(async () => {
      const res = await fetch(`/api/calls/${call.id}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "connect" }),
      });
      if (res.ok) setPhase("active");
    }, 1800);
    return () => window.clearTimeout(t);
  }, [call.direction, call.id, phase]);

  useEffect(() => {
    if (phase !== "active" && phase !== "poor") return;
    const started = Date.now();
    const t = window.setInterval(() => setElapsed(Date.now() - started), 500);
    return () => window.clearInterval(t);
  }, [phase]);

  useEffect(() => {
    if (!hideLockInfo && incoming && "Notification" in window && Notification.permission === "granted") {
      new Notification("تماس ورودی نیکسو", { body: `${call.peerName} · ${callKindFa(call.kind)}` });
    } else if (hideLockInfo && incoming && "Notification" in window && Notification.permission === "granted") {
      new Notification("تماس ورودی نیکسو", { body: "تماس خصوصی" });
    }
  }, [incoming, hideLockInfo, call.peerName, call.kind]);

  async function hang(action: "end" | "decline" | "message-decline") {
    setBusy(true);
    await fetch(`/api/calls/${call.id}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action }),
    });
    stopShareRef.current?.();
    stopLoop(loopRef.current);
    loopRef.current = null;
    if (action === "message-decline") onMessageDecline();
    else onClose();
  }

  async function accept() {
    setBusy(true);
    const ok = await mediaForConnect();
    if (!ok) {
      setBusy(false);
      return;
    }
    const res = await fetch(`/api/calls/${call.id}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "accept" }),
    });
    setBusy(false);
    if (!res.ok) {
      toast.error("پذیرش تماس انجام نشد.");
      return;
    }
    setPhase("active");
  }

  function toggleMute() {
    const next = !muted;
    setMuted(next);
    loopRef.current?.local.getAudioTracks().forEach((t) => {
      t.enabled = !next;
    });
  }

  function toggleCam() {
    if (call.kind !== "video") return;
    const next = !camOff;
    setCamOff(next);
    loopRef.current?.local.getVideoTracks().forEach((t) => {
      t.enabled = !next;
    });
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
      return;
    }
    try {
      const stop = await shareScreen(loopRef.current);
      stopShareRef.current = () => {
        stop();
        setSharing(false);
      };
      setSharing(true);
    } catch {
      toast.error("اشتراک صفحه لغو شد یا مرورگر اجازه نداد.");
    }
  }

  useEffect(() => {
    const session = loopRef.current;
    if (!session) return;
    void applyBitrate(session.pcLocal, lowData, quality);
  }, [lowData, quality]);

  const statusText =
    phase === "reconnect"
      ? "در حال اتصال مجدد…"
      : phase === "poor"
        ? "اتصال ضعیف · تماس حفظ می‌شود"
        : phase === "active"
          ? "متصل · رسانه روی دستگاه رمز می‌شود"
          : incoming
            ? "تماس ورودی"
            : "در حال زنگ…";

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
          <video ref={remoteRef} autoPlay playsInline className="h-full w-full object-cover" />
          <video
            ref={localRef}
            autoPlay
            muted
            playsInline
            className="absolute bottom-4 left-4 h-32 w-24 rounded-xl border border-white/20 object-cover"
          />
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
            {phase === "active" || phase === "poor" ? ` · ${formatCallClock(elapsed)}` : ""}
          </p>
        </div>
      )}

      <div className="space-y-3 px-4 pb-[calc(1.5rem+env(safe-area-inset-bottom))] pt-3">
        <p className="text-center text-[11px] leading-5 text-emerald-100/55">
          سیگنال تماس روی سرور است؛ صدا و تصویر در این برش با WebRTC روی همین دستگاه حلقه می‌شود و نیکسو رسانه را نمی‌بیند.
          تماس خصوصی برای سرور قابل شنیدن یا دیدن نیست. نیکسو جایگزین تماس اضطراری سیستم‌عامل نیست.
        </p>
        <p className="text-center text-[10px] text-emerald-100/40">
          ضبط تماس فعال نیست. اگر بعداً اضافه شود، قبل از ضبط اطلاع‌رسانی واضح و رضایت لازم است.
        </p>
        {incoming ? (
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
              onClick={() => void hang("end")}
              aria-label="پایان تماس"
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
      className={cn(
        "grid size-12 place-items-center rounded-full",
        on ? "bg-amber-300 text-[#102824]" : "bg-white/10 text-white",
      )}
    >
      {children}
    </button>
  );
}
