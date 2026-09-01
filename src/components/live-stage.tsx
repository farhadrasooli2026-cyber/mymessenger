"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  Camera,
  CameraOff,
  Mic,
  MicOff,
  MonitorUp,
  PictureInPicture2,
  Radio,
} from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import {
  applyBitrate,
  getMediaErrorMessage,
  shareScreen,
  startMediaLoop,
  stopLoop,
  type LoopSession,
} from "@/lib/webrtc-loop";

type LiveUi = {
  id: string;
  title: string;
  description: string;
  hostName: string;
  status: string;
  visibility: string;
  viewerCount: number;
  durationMs: number;
  audioOnly: boolean;
  quality: "auto" | "low" | "medium" | "high";
  chatEnabled: boolean;
  slowModeMs: number;
  reactionsEnabled: boolean;
  guestRequestsEnabled: boolean;
  recordEnabled: boolean;
  maxViewers: number;
  iAmHost: boolean;
  canModerate: boolean;
  myRole: string | null;
  canWatch: boolean;
  watchError: string | null;
  accessToken: string | null;
  inviteLink: string | null;
  reminderOn: boolean;
  hasReplay: boolean;
  recordingId: string | null;
  scheduledAt: number | null;
  endedAt: number | null;
  thumbDataUrl: string;
  analytics: { peakViewers: number; totalViewers: number; durationMs: number; engagement: number } | null;
  participants: { userId: string; name: string; role: string; me: boolean; mutedChat: boolean }[];
  guestQueue: { userId: string; name: string }[];
  chat: { id: string; name: string; body: string; createdAt: number; mine: boolean }[];
};

function clock(ms: number) {
  const s = Math.max(0, Math.floor(ms / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

export function LiveStage({ liveId, invite }: { liveId: string; invite?: string }) {
  const router = useRouter();
  const [live, setLive] = useState<LiveUi | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [chat, setChat] = useState("");
  const [conn, setConn] = useState<"ok" | "poor" | "offline" | "buffering">("ok");
  const [camOff, setCamOff] = useState(false);
  const [muted, setMuted] = useState(false);
  const [sharing, setSharing] = useState(false);
  const videoRef = useRef<HTMLVideoElement>(null);
  const loopRef = useRef<LoopSession | null>(null);
  const recRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const stopShareRef = useRef<(() => void) | null>(null);

  const refresh = useCallback(async () => {
    const q = invite ? `?invite=${encodeURIComponent(invite)}` : "";
    const res = await fetch(`/api/live/${liveId}${q}`, { cache: "no-store" });
    const data = await res.json();
    if (!res.ok) {
      setError(data.error ?? "Live در دسترس نیست.");
      setLive(null);
      return;
    }
    setLive(data.live);
    setError(null);
  }, [liveId, invite]);

  async function act(action: string, extra: Record<string, unknown> = {}) {
    const res = await fetch(`/api/live/${liveId}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action, inviteToken: invite, ...extra }),
    });
    const data = await res.json();
    if (!res.ok) {
      toast.error(data.error ?? "انجام نشد.");
      return;
    }
    setLive(data.live);
  }

  useEffect(() => {
    void (async () => {
      await refresh();
      setLoading(false);
      const q = invite ? `?invite=${encodeURIComponent(invite)}` : "";
      const snap = await fetch(`/api/live/${liveId}${q}`, { cache: "no-store" }).then((r) => r.json());
      if (snap.live && snap.live.status !== "scheduled" && snap.live.status !== "ended") {
        await act("join");
      }
    })();
    const t = window.setInterval(() => void act("heartbeat"), 8000);
    const onOff = () => setConn("offline");
    const onOn = () => {
      setConn("ok");
      void act("join");
    };
    window.addEventListener("offline", onOff);
    window.addEventListener("online", onOn);
    return () => {
      window.clearInterval(t);
      window.removeEventListener("offline", onOff);
      window.removeEventListener("online", onOn);
      void fetch(`/api/live/${liveId}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "leave" }),
        keepalive: true,
      });
      stopLoop(loopRef.current);
      loopRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [liveId]);

  useEffect(() => {
    if (!live?.iAmHost) return;
    if (live.status !== "live" && live.status !== "starting" && live.status !== "paused") return;
    if (loopRef.current) return;
    let gone = false;
    void startMediaLoop({ video: !live.audioOnly, lowData: live.quality === "low" })
      .then(async (session) => {
        if (gone) {
          stopLoop(session);
          return;
        }
        loopRef.current = session;
        if (videoRef.current) videoRef.current.srcObject = session.local;
        await applyBitrate(session.pcLocal, live.quality === "low", live.quality);
        if (live.recordEnabled && typeof MediaRecorder !== "undefined") {
          try {
            const rec = new MediaRecorder(session.local);
            chunksRef.current = [];
            rec.ondataavailable = (e) => {
              if (e.data.size) chunksRef.current.push(e.data);
            };
            rec.start(1000);
            recRef.current = rec;
          } catch {
            toast.message("Recording روی این مرورگر شروع نشد.");
          }
        }
      })
      .catch((err) => toast.error(getMediaErrorMessage(err)));
    return () => {
      gone = true;
    };
  }, [live?.iAmHost, live?.status, live?.audioOnly, live?.quality, live?.recordEnabled]);

  async function finishRecording() {
    const rec = recRef.current;
    if (!rec || rec.state === "inactive") return;
    await new Promise<void>((resolve) => {
      rec.onstop = () => resolve();
      rec.stop();
    });
    const blob = new Blob(chunksRef.current, { type: rec.mimeType || "video/webm" });
    if (blob.size < 64) return;
    const res = await fetch(`/api/live/${liveId}?record=1&duration=${live?.durationMs ?? 0}`, {
      method: "POST",
      headers: { "Content-Type": blob.type },
      body: blob,
    });
    if (!res.ok) toast.error("ذخیره Recording نشد.");
    else toast.success("Replay ذخیره شد.");
  }

  async function pip() {
    const el = videoRef.current;
    if (!el) return;
    try {
      if (document.pictureInPictureElement) await document.exitPictureInPicture();
      else await el.requestPictureInPicture();
    } catch {
      toast.error("Picture-in-Picture روی این دستگاه پشتیبانی نشد.");
    }
  }

  if (loading) return <main className="grid min-h-dvh place-items-center bg-[#071614] text-emerald-50">ورود به Live…</main>;
  if (error && !live) {
    return (
      <main className="min-h-dvh bg-[#071614] p-6 text-emerald-50">
        <p className="text-rose-200">{error}</p>
        <Link href="/app/live" className="mt-4 block text-amber-200">بازگشت</Link>
      </main>
    );
  }
  if (!live) return null;

  if (live.status === "ended") {
    return (
      <main className="min-h-dvh bg-[#071614] p-5 text-emerald-50">
        <div className="mx-auto max-w-lg space-y-3 rounded-3xl bg-white/5 p-6 text-center">
          <p className="text-lg font-semibold">Live Ended</p>
          <p className="text-sm opacity-70">مدت {clock(live.durationMs)}</p>
          {live.hasReplay && (
            <video src={`/api/live/${live.id}/replay`} controls className="w-full rounded-xl" />
          )}
          <Link href="/app/live" className="block text-amber-200">Discovery</Link>
          <Link href="/app" className="block text-amber-200">Return to Chat</Link>
        </div>
      </main>
    );
  }

  return (
    <main className="flex min-h-dvh flex-col bg-[#071614] text-emerald-50">
      <header className="flex items-center gap-2 border-b border-white/10 px-4 py-3">
        <Radio className="size-4 text-rose-300" />
        <div className="min-w-0 flex-1">
          <p className="truncate font-medium">{live.title}</p>
          <p className="text-[11px] opacity-60">
            {live.hostName} · {live.status} · {live.viewerCount} بیننده · {clock(live.durationMs)} · {conn === "ok" ? "اتصال پایدار" : conn === "offline" ? "آفلاین — بازیابی" : conn === "buffering" ? "Buffering" : "اتصال ضعیف"}
          </p>
        </div>
        <Button type="button" size="sm" variant="ghost" className="text-white" onClick={() => router.push("/app/live")}>خروج</Button>
      </header>
      <div className="grid flex-1 gap-0 lg:grid-cols-[1fr_280px]">
        <section className="relative bg-black">
          {live.iAmHost ? (
            <video ref={videoRef} autoPlay muted playsInline className={cn("h-[42vh] w-full object-cover lg:h-full", live.audioOnly && "hidden")} />
          ) : live.thumbDataUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={live.thumbDataUrl} alt="" className="h-[42vh] w-full object-cover lg:h-full" />
          ) : (
            <div className="grid h-[42vh] place-items-center lg:h-full">
              <p className="px-6 text-center text-sm opacity-70">
                {live.audioOnly ? "Audio Only — رسانه روی دستگاه میزبان است." : "بیننده‌ها سیگنال حضور می‌گیرند. پیکسل Live از دستگاه Host حلقه می‌شود نه از CDN عمومی."}
              </p>
            </div>
          )}
          <p className="absolute right-3 top-3 rounded-full bg-rose-600 px-2 py-0.5 text-[11px]">
            {live.status === "live" ? "LIVE" : live.status.toUpperCase()}
          </p>
          {live.iAmHost && (
            <div className="absolute bottom-3 left-0 right-0 flex flex-wrap justify-center gap-2 px-3">
              <button type="button" className={cn("grid size-11 place-items-center rounded-full", muted ? "bg-amber-300 text-[#102824]" : "bg-white/15")} aria-label="میکروفون" onClick={() => { const n = !muted; setMuted(n); loopRef.current?.local.getAudioTracks().forEach((t) => { t.enabled = !n; }); }}>
                {muted ? <MicOff className="size-4" /> : <Mic className="size-4" />}
              </button>
              {!live.audioOnly && (
                <button type="button" className={cn("grid size-11 place-items-center rounded-full", camOff ? "bg-amber-300 text-[#102824]" : "bg-white/15")} aria-label="دوربین" onClick={() => { const n = !camOff; setCamOff(n); loopRef.current?.local.getVideoTracks().forEach((t) => { t.enabled = !n; }); }}>
                  {camOff ? <CameraOff className="size-4" /> : <Camera className="size-4" />}
                </button>
              )}
              <button
                type="button"
                className={cn("grid size-11 place-items-center rounded-full", sharing && "bg-amber-300 text-[#102824]")}
                aria-label="اشتراک صفحه"
                onClick={() => {
                  if (!loopRef.current) return;
                  if (sharing) {
                    stopShareRef.current?.();
                    setSharing(false);
                    return;
                  }
                  void shareScreen(loopRef.current)
                    .then((stop) => {
                      stopShareRef.current = stop;
                      setSharing(true);
                    })
                    .catch(() => toast.error("اجازهٔ اشتراک صفحه داده نشد."));
                }}
              >
                <MonitorUp className="size-4" />
              </button>
              <button type="button" className="grid size-11 place-items-center rounded-full bg-white/15" aria-label="Picture in Picture" onClick={() => void pip()}>
                <PictureInPicture2 className="size-4" />
              </button>
            </div>
          )}
        </section>
        <aside className="flex max-h-[48vh] flex-col border-t border-white/10 lg:max-h-none lg:border-r lg:border-t-0">
          <div className="flex-1 space-y-1 overflow-auto p-3 text-xs">
            {live.chat.map((m) => (
              <p key={m.id}><span className="text-amber-200">{m.name}:</span> {m.body}</p>
            ))}
          </div>
          {live.chatEnabled && live.status === "live" && (
            <form
              className="flex gap-1 p-2"
              onSubmit={(e) => {
                e.preventDefault();
                void act("chat", { body: chat });
                setChat("");
              }}
            >
              <Input value={chat} onChange={(e) => setChat(e.target.value)} placeholder="Live Chat" className="h-8 bg-black/20 text-xs" />
              <Button type="submit" size="sm">ارسال</Button>
            </form>
          )}
          {live.reactionsEnabled && (
            <div className="flex gap-1 px-2 pb-2">
              {["❤", "🔥", "👏", "😂"].map((e) => (
                <button key={e} type="button" className="rounded bg-white/10 px-2 py-1" onClick={() => void act("react")}>{e}</button>
              ))}
            </div>
          )}
        </aside>
      </div>
      <footer className="space-y-2 border-t border-white/10 p-3 text-xs">
        <p className="opacity-60">{live.description}</p>
        <div className="flex flex-wrap gap-2">
          {live.status === "scheduled" && (
            <Button type="button" size="sm" variant="secondary" onClick={() => void act("reminder", { on: !live.reminderOn })}>
              {live.reminderOn ? "Reminder روشن" : "Reminder"}
            </Button>
          )}
          {live.iAmHost && live.status !== "live" && live.status !== "ended" && (
            <Button type="button" size="sm" className="bg-rose-500 text-white" onClick={() => void act("start")}>شروع Live</Button>
          )}
          {live.iAmHost && live.status === "live" && (
            <Button type="button" size="sm" variant="secondary" onClick={() => void act("pause")}>Pause</Button>
          )}
          {live.iAmHost && live.status === "paused" && (
            <Button type="button" size="sm" className="bg-rose-500 text-white" onClick={() => void act("start")}>ادامه</Button>
          )}
          {live.iAmHost && (
            <Button
              type="button"
              size="sm"
              variant="ghost"
              className="text-rose-200"
              onClick={() => {
                void finishRecording().then(() => act("end"));
              }}
            >
              پایان
            </Button>
          )}
          {live.canModerate && (
            <>
              <Button type="button" size="sm" variant="secondary" onClick={() => void act("settings", { chatEnabled: !live.chatEnabled })}>
                {live.chatEnabled ? "خاموش کردن چت" : "روشن کردن چت"}
              </Button>
              <Button type="button" size="sm" variant="secondary" onClick={() => void act("settings", { reactionsEnabled: !live.reactionsEnabled })}>
                واکنش
              </Button>
              <Button type="button" size="sm" variant="secondary" onClick={() => void act("settings", { slowModeMs: live.slowModeMs ? 0 : 5000 })}>
                Slow Mode
              </Button>
            </>
          )}
          {live.guestRequestsEnabled && !live.iAmHost && (
            <Button type="button" size="sm" variant="secondary" onClick={() => void act("guest-request")}>درخواست Guest</Button>
          )}
          {live.inviteLink && live.iAmHost && (
            <Button
              type="button"
              size="sm"
              variant="secondary"
              onClick={() => {
                const url = `${window.location.origin}${live.inviteLink}`;
                void navigator.clipboard.writeText(url);
                if (navigator.share) void navigator.share({ title: live.title, url });
                toast.success("لینک کپی شد. لینک خصوصی بدون ورود به حساب کار نمی‌کند.");
              }}
            >
              Share / لینک
            </Button>
          )}
          <Button type="button" size="sm" variant="ghost" className="text-rose-200" onClick={() => void fetch("/api/reports", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ targetKind: "live", targetKey: live.id, category: "other", details: "live" }) }).then(() => toast.success("گزارش شد."))}>گزارش Live</Button>
          <Button type="button" size="sm" variant="ghost" className="text-rose-200" onClick={() => void act("block-host")}>Block Host</Button>
        </div>
        {live.iAmHost && live.analytics && (
          <p className="opacity-70">آمار: اوج {live.analytics.peakViewers} · یکتا {live.analytics.totalViewers} · تعامل {live.analytics.engagement} — شناسه بیننده‌ها نشان داده نمی‌شود.</p>
        )}
        {live.canModerate && (
          <ul className="max-h-28 space-y-1 overflow-auto">
            {live.participants.filter((p) => !p.me).map((p) => (
              <li key={p.userId || p.name} className="flex justify-between gap-2">
                <span>{p.name} · {p.role}</span>
                <span className="flex gap-1">
                  <button type="button" onClick={() => void act("cohost", { targetUserId: p.userId })}>Co-Host</button>
                  <button type="button" onClick={() => void act("mute", { targetUserId: p.userId })}>Mute</button>
                  <button type="button" onClick={() => void act("kick", { targetUserId: p.userId })}>Kick</button>
                  <button type="button" onClick={() => void act("ban", { targetUserId: p.userId })}>Ban</button>
                </span>
              </li>
            ))}
            {live.guestQueue.map((g) => (
              <li key={g.userId} className="flex justify-between">
                <span>Guest {g.name}</span>
                <button type="button" onClick={() => void act("guest-decide", { targetUserId: g.userId, accept: true })}>قبول</button>
              </li>
            ))}
          </ul>
        )}
        {live.iAmHost && (
          <div className="flex flex-wrap gap-1">
            {(["auto", "low", "medium", "high"] as const).map((q) => (
              <button key={q} type="button" className={cn("rounded-full px-2 py-0.5", live.quality === q ? "bg-amber-300 text-[#102824]" : "bg-white/10")} onClick={() => { void act("settings", { quality: q }); if (loopRef.current) void applyBitrate(loopRef.current.pcLocal, q === "low", q); }}>
                {q}
              </button>
            ))}
            <Button type="button" size="sm" variant="ghost" className="text-rose-200" onClick={() => void act("emergency")}>Emergency Stop</Button>
            {live.recordingId && <Button type="button" size="sm" variant="ghost" onClick={() => void fetch(`/api/live/${live.id}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "delete-recording" }) }).then(refresh)}>حذف Replay</Button>}
          </div>
        )}
      </footer>
    </main>
  );
}
