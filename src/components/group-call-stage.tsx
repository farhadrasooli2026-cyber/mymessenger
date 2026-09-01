"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  Camera,
  CameraOff,
  Link2,
  Mic,
  MicOff,
  Minimize2,
  MonitorUp,
  PhoneOff,
  PictureInPicture2,
  SwitchCamera,
  UserMinus,
  UserPlus,
  Volume2,
} from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { formatCallClock } from "@/lib/call-copy";
import {
  applyBitrate,
  getMediaErrorMessage,
  shareScreen,
  startMediaLoop,
  stopLoop,
  switchCamera,
  type LoopSession,
} from "@/lib/webrtc-loop";

export type PublicGroupCallUi = {
  id: string;
  groupId: string;
  groupName: string;
  hostUserId: string;
  kind: "voice" | "video";
  status: "ringing" | "active" | "ended";
  maxParticipants: number;
  createdAt: number;
  inviteToken: string | boolean | null;
  participants: { userId: string; name: string; role: string; mutedByHost: boolean; camOff?: boolean; micMuted?: boolean; sharing?: boolean; speaking?: boolean; me: boolean }[];
  iAmHost: boolean;
  canModerate: boolean;
  activeSpeakerId?: string | null;
};

export function GroupCallStage({
  initial,
  members,
  lowData,
  minimized,
  onMinimized,
  onClose,
}: {
  initial: PublicGroupCallUi;
  members: { key: string; name: string }[];
  lowData: boolean;
  minimized: boolean;
  onMinimized: (v: boolean) => void;
  onClose: () => void;
}) {
  const [room, setRoom] = useState(initial);
  const [muted, setMuted] = useState(false);
  const [camOff, setCamOff] = useState(initial.kind === "voice");
  const [sharing, setSharing] = useState(false);
  const [facing, setFacing] = useState<"user" | "environment">("user");
  const [quality, setQuality] = useState<"auto" | "saver" | "high">(lowData ? "saver" : "auto");
  const [phase, setPhase] = useState<"active" | "poor" | "reconnect">("active");
  const [elapsed, setElapsed] = useState(0);
  const [addOpen, setAddOpen] = useState(false);
  const localRef = useRef<HTMLVideoElement>(null);
  const loopRef = useRef<LoopSession | null>(null);
  const stopShareRef = useRef<(() => void) | null>(null);

  const refresh = useCallback(async () => {
    const res = await fetch(`/api/calls/group/${room.id}`, { cache: "no-store" });
    const data = await res.json();
    if (!res.ok) {
      toast.error(data.error ?? "تماس گروهی در دسترس نیست.");
      onClose();
      return;
    }
    const next = data.call as PublicGroupCallUi;
    setRoom(next);
    if (next.status === "ended" || !next.participants.some((p) => p.me)) onClose();
  }, [onClose, room.id]);

  useEffect(() => {
    const t = window.setInterval(() => void refresh(), 2500);
    return () => window.clearInterval(t);
  }, [refresh]);

  useEffect(() => {
    const t = window.setInterval(() => {
      if (!muted) void act("media", { speaking: true });
    }, 2000);
    return () => window.clearInterval(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [muted, room.id]);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const session = await startMediaLoop({ video: room.kind === "video", lowData: quality === "saver" || lowData });
        if (cancelled) {
          stopLoop(session);
          return;
        }
        loopRef.current = session;
        if (localRef.current) {
          localRef.current.srcObject = session.local;
          void localRef.current.play().catch(() => undefined);
        }
        const onIce = () => {
          const st = session.pcLocal.iceConnectionState;
          if (st === "disconnected" || st === "failed") setPhase("reconnect");
          else if (st === "checking") setPhase("poor");
          else setPhase("active");
        };
        session.pcLocal.addEventListener("iceconnectionstatechange", onIce);
      } catch (err) {
        toast.error(getMediaErrorMessage(err));
      }
    })();
    return () => {
      cancelled = true;
      stopShareRef.current?.();
      stopLoop(loopRef.current);
      loopRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [room.id]);

  useEffect(() => {
    const started = Date.now();
    const t = window.setInterval(() => setElapsed(Date.now() - started), 500);
    return () => window.clearInterval(t);
  }, []);

  useEffect(() => {
    if (loopRef.current) void applyBitrate(loopRef.current.pcLocal, lowData, quality);
  }, [lowData, quality]);

  async function act(action: string, extra?: Record<string, unknown>) {
    const res = await fetch(`/api/calls/group/${room.id}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action, ...extra }),
    });
    const data = await res.json();
    if (!res.ok) {
      toast.error(data.error ?? "انجام نشد.");
      return;
    }
    setRoom(data.call as PublicGroupCallUi);
    if (action === "leave" || action === "end") {
      stopShareRef.current?.();
      stopLoop(loopRef.current);
      onClose();
    }
  }

  async function toggleShare() {
    if (!loopRef.current || room.kind !== "video") return;
    if (sharing) {
      stopShareRef.current?.();
      stopShareRef.current = null;
      setSharing(false);
      void act("media", { sharing: false });
      return;
    }
    try {
      const stop = await shareScreen(loopRef.current);
      stopShareRef.current = () => {
        stop();
        setSharing(false);
        void act("media", { sharing: false });
      };
      setSharing(true);
      void act("media", { sharing: true });
    } catch {
      toast.error("اشتراک صفحه ممکن نشد.");
    }
  }

  const outsiders = members.filter((m) => !room.participants.some((p) => p.userId === m.key));
  const statusText =
    phase === "reconnect" ? "در حال اتصال مجدد…" : phase === "poor" ? "اتصال ضعیف" : "تماس گروهی · سیگنال روی سرور";

  if (minimized) {
    return (
      <button
        type="button"
        className="fixed bottom-20 left-4 z-50 rounded-2xl border border-amber-300/40 bg-[#102824] px-3 py-2 text-sm shadow-xl md:bottom-6"
        onClick={() => onMinimized(false)}
      >
        {room.groupName} · {formatCallClock(elapsed)} · {room.participants.length} نفر
      </button>
    );
  }

  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-[#071614] text-emerald-50">
      {room.kind === "video" && (
        <div className="relative min-h-0 flex-1 bg-black">
          <video ref={localRef} autoPlay muted playsInline className="h-full w-full object-cover" />
        </div>
      )}
      {room.kind === "voice" && (
        <div className="flex flex-1 flex-col items-center justify-center gap-3 p-6">
          <p className="text-2xl font-semibold">{room.groupName}</p>
          <p className="text-sm text-amber-200">{statusText}</p>
          <p className="tabular-nums" dir="ltr">
            {formatCallClock(elapsed)}
          </p>
        </div>
      )}
      <div className="border-t border-white/10 px-4 py-3">
        <p className="text-center text-[11px] text-emerald-100/55">
          حداکثر {room.maxParticipants} نفر (سقف سرور). رسانه روی این دستگاه حلقه می‌شود؛ سرور اتاق و مجوز را مدیریت می‌کند نه صدا/تصویر.
        </p>
        <ul className="mt-2 max-h-28 space-y-1 overflow-auto text-xs">
          {room.participants.map((p) => (
            <li key={p.userId} className={cn("flex items-center justify-between gap-2 rounded-lg px-2 py-1", (p.speaking || room.activeSpeakerId === p.userId) && "bg-amber-300/20")}>
              <span>
                {p.name} · {p.role}
                {p.mutedByHost ? " · بی‌صدا از طرف Host" : ""}
                {p.micMuted ? " · میکروفون خاموش" : ""}
                {p.camOff ? " · دوربین خاموش" : ""}
                {p.sharing ? " · اشتراک صفحه" : ""}
                {p.speaking || room.activeSpeakerId === p.userId ? " · در حال صحبت" : ""}
                {p.me ? " · شما" : ""}
              </span>
              {room.canModerate && !p.me && (
                <span className="flex gap-1">
                  <button type="button" className="rounded bg-white/10 px-2 py-0.5" onClick={() => void act(p.mutedByHost ? "unmute" : "mute", { targetUserId: p.userId })}>
                    {p.mutedByHost ? "باز کردن صدا" : "Mute"}
                  </button>
                  <button type="button" className="rounded bg-rose-500/80 px-2 py-0.5" onClick={() => void act("kick", { targetUserId: p.userId })}>
                    <UserMinus className="inline size-3" /> خروج
                  </button>
                </span>
              )}
            </li>
          ))}
        </ul>
        <div className="mt-3 flex flex-wrap items-center justify-center gap-2">
          <button
            type="button"
            className={cn("grid size-12 place-items-center rounded-full", muted ? "bg-amber-300 text-[#102824]" : "bg-white/10")}
            onClick={() => {
              const next = !muted;
              setMuted(next);
              loopRef.current?.local.getAudioTracks().forEach((t) => {
                t.enabled = !next;
              });
              void act("media", { micMuted: next });
            }}
            aria-label="میکروفون"
          >
            {muted ? <MicOff className="size-5" /> : <Mic className="size-5" />}
          </button>
          <button type="button" className="grid size-12 place-items-center rounded-full bg-white/10" aria-label="بلندگو">
            <Volume2 className="size-5" />
          </button>
          {room.kind === "video" && (
            <>
              <button
                type="button"
                className={cn("grid size-12 place-items-center rounded-full", camOff ? "bg-amber-300 text-[#102824]" : "bg-white/10")}
                onClick={() => {
                  const next = !camOff;
                  setCamOff(next);
                  loopRef.current?.local.getVideoTracks().forEach((t) => {
                    t.enabled = !next;
                  });
                  void act("media", { camOff: next });
                }}
              >
                {camOff ? <CameraOff className="size-5" /> : <Camera className="size-5" />}
              </button>
              <button
                type="button"
                className="grid size-12 place-items-center rounded-full bg-white/10"
                onClick={() => {
                  if (!loopRef.current) return;
                  const next = facing === "user" ? "environment" : "user";
                  void switchCamera(loopRef.current, next).then(() => setFacing(next)).catch(() => toast.error("تعویض دوربین ممکن نشد."));
                }}
              >
                <SwitchCamera className="size-5" />
              </button>
              <button type="button" className={cn("grid size-12 place-items-center rounded-full", sharing && "bg-amber-300 text-[#102824]")} onClick={() => void toggleShare()}>
                <MonitorUp className="size-5" />
              </button>
              <button
                type="button"
                className="grid size-12 place-items-center rounded-full bg-white/10"
                onClick={() => {
                  const el = localRef.current;
                  if (!el) return;
                  void (document.pictureInPictureElement ? document.exitPictureInPicture() : el.requestPictureInPicture()).catch(() =>
                    toast.message("PiP در این مرورگر نیست."),
                  );
                }}
              >
                <PictureInPicture2 className="size-5" />
              </button>
            </>
          )}
          {room.canModerate && (
            <button type="button" className="grid size-12 place-items-center rounded-full bg-white/10" onClick={() => setAddOpen((v) => !v)} aria-label="افزودن">
              <UserPlus className="size-5" />
            </button>
          )}
          {room.canModerate && (
            <button
              type="button"
              className="grid size-12 place-items-center rounded-full bg-white/10"
              onClick={async () => {
                const res = await fetch(`/api/calls/group/${room.id}`, {
                  method: "POST",
                  headers: { "Content-Type": "application/json" },
                  body: JSON.stringify({ action: "link" }),
                });
                const data = await res.json();
                if (!res.ok) {
                  toast.error(data.error ?? "لینک ساخته نشد.");
                  return;
                }
                setRoom(data.call as PublicGroupCallUi);
                const tok = data.call?.inviteToken;
                if (typeof tok === "string") {
                  const url = `${window.location.origin}/join/call/${tok}`;
                  await navigator.clipboard.writeText(url).catch(() => undefined);
                  toast.success("لینک Join Call کپی شد. انقضا دارد و فقط اعضای واردشدهٔ گروه می‌توانند وارد شوند.");
                }
              }}
            >
              <Link2 className="size-5" />
            </button>
          )}
          <button type="button" className="grid size-12 place-items-center rounded-full bg-white/10" onClick={() => onMinimized(true)}>
            <Minimize2 className="size-5" />
          </button>
          <Button type="button" className="h-12 rounded-full bg-white/10" onClick={() => void act("leave")}>
            ترک
          </Button>
          {room.canModerate && (
            <Button type="button" className="h-12 rounded-full bg-rose-500 text-white" onClick={() => void act("end")}>
              <PhoneOff className="size-5" />
              End Call
            </Button>
          )}
        </div>
        <div className="mt-2 flex justify-center gap-2 text-[11px]">
          {(["auto", "saver", "high"] as const).map((q) => (
            <button key={q} type="button" className={cn("rounded-full px-2 py-1", quality === q ? "bg-amber-300 text-[#102824]" : "bg-white/10")} onClick={() => setQuality(q)}>
              {q === "saver" ? "کم‌مصرف" : q === "high" ? "کیفیت بالا" : "خودکار"}
            </button>
          ))}
        </div>
        {addOpen && room.canModerate && (
          <div className="mt-2 max-h-32 overflow-auto rounded-xl bg-black/30 p-2 text-xs">
            {outsiders.length === 0 && <p>عضو دیگری برای افزودن نیست.</p>}
            {outsiders.map((m) => (
              <button key={m.key} type="button" className="block w-full rounded px-2 py-1 text-right hover:bg-white/10" onClick={() => void act("add", { targetUserId: m.key })}>
                افزودن {m.name}
              </button>
            ))}
          </div>
        )}
        <p className="mt-2 text-center text-[10px] text-emerald-100/40">NIXO جایگزین تماس اضطراری سیستم‌عامل نیست. ضبط تماس فعال نیست.</p>
      </div>
    </div>
  );
}
