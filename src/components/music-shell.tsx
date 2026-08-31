"use client";

import { createContext, useCallback, useContext, useEffect, useRef, useState } from "react";
import { Pause, Play, SkipBack, SkipForward, X } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import type { RepeatMode } from "@/lib/music-types";

export type Playable = {
  id: string;
  catalog: boolean;
  title: string;
  artist: string;
  album: string;
  streamUrl: string;
  durationMs: number;
  lastPositionMs?: number;
  mime?: string;
  size?: number;
  kind?: string;
  format?: string;
};

type Ctx = {
  current: Playable | null;
  queue: Playable[];
  playing: boolean;
  progress: number;
  shuffle: boolean;
  repeat: RepeatMode;
  speed: number;
  volume: number;
  full: boolean;
  sleepLeft: number | null;
  play: (item: Playable, queue?: Playable[], opts?: { startMs?: number }) => void;
  toggle: () => void;
  next: () => void;
  prev: () => void;
  seek: (ratio: number) => void;
  setVolume: (v: number) => void;
  setSpeed: (s: number) => void;
  setShuffle: (v: boolean) => void;
  setRepeat: (v: RepeatMode) => void;
  setQueue: (q: Playable[]) => void;
  setFull: (v: boolean) => void;
  armSleep: (mins: number | null) => void;
  enqueue: (item: Playable) => void;
  removeFromQueue: (i: number) => void;
  clearQueue: () => void;
  error: string | null;
};

const MusicCtx = createContext<Ctx | null>(null);

export function useMusic() {
  const v = useContext(MusicCtx);
  if (!v) throw new Error("useMusic");
  return v;
}

export function useMusicOptional() {
  return useContext(MusicCtx);
}

function formatClock(ms: number) {
  const s = Math.max(0, Math.floor(ms / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

export function MusicShell({ children }: { children: React.ReactNode }) {
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const [current, setCurrent] = useState<Playable | null>(null);
  const [queue, setQueueState] = useState<Playable[]>([]);
  const [index, setIndex] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [progress, setProgress] = useState(0);
  const [shuffle, setShuffle] = useState(false);
  const [repeat, setRepeat] = useState<RepeatMode>("off");
  const [speed, setSpeedState] = useState(1);
  const [volume, setVolumeState] = useState(1);
  const [full, setFull] = useState(false);
  const [sleepLeft, setSleepLeft] = useState<number | null>(null);
  const [customSleep, setCustomSleep] = useState("45");
  const [error, setError] = useState<string | null>(null);
  const sleepUntil = useRef<number | null>(null);
  const orderRef = useRef<number[]>([]);

  const playAt = useCallback(
    (i: number, list: Playable[], startMs?: number) => {
      const item = list[i];
      if (!item) return;
      setIndex(i);
      setCurrent(item);
      setError(null);
      const el = audioRef.current;
      if (!el) return;
      const start = () => {
        const resume = startMs ?? (item.lastPositionMs && item.lastPositionMs > 1500 ? item.lastPositionMs / 1000 : 0);
        el.onloadedmetadata = () => {
          if (resume && Number.isFinite(el.duration)) el.currentTime = Math.min(resume, el.duration * 0.97);
        };
        el.playbackRate = speed;
        el.volume = volume;
        el.play()
          .then(() => setPlaying(true))
          .catch(() => {
            setPlaying(false);
            setError("این فایل پخش نشد. ناقص، ناسازگار یا بدون مجوز است.");
            toast.error("پخش انجام نشد؛ برنامه متوقف نمی‌شود.");
          });
      };
      el.preload = "metadata";
      const applySrc = (src: string) => {
        el.src = src;
        start();
      };
      if (typeof caches === "undefined") {
        applySrc(item.streamUrl);
      } else {
        void caches
          .open("nixo-audio")
          .then((c) => c.match(item.streamUrl))
          .then((hit) => {
            if (hit) return hit.blob().then((b) => URL.createObjectURL(b));
            return item.streamUrl;
          })
          .catch(() => item.streamUrl)
          .then(applySrc);
      }
      void fetch("/api/music", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "played", id: item.id, catalog: item.catalog, positionMs: 0 }),
      });
      if ("mediaSession" in navigator) {
        try {
          navigator.mediaSession.metadata = new MediaMetadata({
            title: item.title,
            artist: item.artist,
            album: item.album,
          });
        } catch {
          /* older browsers */
        }
      }
    },
    [speed, volume],
  );

  const next = useCallback(() => {
    if (!queue.length) return;
    if (repeat === "one" && current) {
      playAt(index, queue, 0);
      return;
    }
    let n = index + 1;
    if (shuffle && orderRef.current.length) {
      const pos = orderRef.current.indexOf(index);
      n = orderRef.current[(pos + 1) % orderRef.current.length] ?? 0;
    }
    if (n >= queue.length) {
      if (repeat === "all") n = 0;
      else {
        setPlaying(false);
        audioRef.current?.pause();
        return;
      }
    }
    playAt(n, queue, 0);
  }, [queue, index, repeat, shuffle, current, playAt]);

  const prev = useCallback(() => {
    const el = audioRef.current;
    if (el && el.currentTime > 3) {
      el.currentTime = 0;
      return;
    }
    playAt(Math.max(0, index - 1), queue);
  }, [index, queue, playAt]);

  function play(item: Playable, nextQueue?: Playable[], opts?: { startMs?: number }) {
    const list = nextQueue?.length ? nextQueue : [item, ...queue.filter((q) => q.id !== item.id)];
    setQueueState(list);
    orderRef.current = list.map((_, i) => i).sort(() => Math.random() - 0.5);
    const i = Math.max(0, list.findIndex((x) => x.id === item.id && x.catalog === item.catalog));
    playAt(i, list, opts?.startMs !== undefined ? opts.startMs / 1000 : undefined);
  }

  function toggle() {
    const el = audioRef.current;
    if (!el || !current) return;
    if (playing) {
      el.pause();
      setPlaying(false);
    } else {
      el.play().then(() => setPlaying(true)).catch(() => setError("پخش انجام نشد."));
    }
  }

  function enqueue(item: Playable) {
    setQueueState((q) => (q.some((x) => x.id === item.id && x.catalog === item.catalog) ? q : [...q, item]));
    toast.message("به Queue اضافه شد.");
  }

  function removeFromQueue(i: number) {
    setQueueState((q) => {
      const nextQ = q.filter((_, idx) => idx !== i);
      if (i === index && nextQ.length) playAt(Math.min(i, nextQ.length - 1), nextQ);
      if (!nextQ.length) {
        audioRef.current?.pause();
        setPlaying(false);
        setCurrent(null);
      }
      return nextQ;
    });
  }

  function clearQueue() {
    audioRef.current?.pause();
    setPlaying(false);
    setCurrent(null);
    setQueueState([]);
    setFull(false);
  }

  function seek(ratio: number) {
    const el = audioRef.current;
    if (!el?.duration) return;
    el.currentTime = ratio * el.duration;
  }

  function armSleep(mins: number | null) {
    if (mins == null) {
      sleepUntil.current = null;
      setSleepLeft(null);
      return;
    }
    queueMicrotask(() => {
      sleepUntil.current = Date.now() + mins * 60_000;
    });
    setSleepLeft(mins * 60);
  }

  useEffect(() => {
    const el = audioRef.current;
    if (!el) return;
    const onTime = () => {
      setProgress(el.duration ? el.currentTime / el.duration : 0);
      if (current && Math.floor(el.currentTime) % 8 === 0) {
        void fetch("/api/music", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            action: "played",
            id: current.id,
            catalog: current.catalog,
            positionMs: Math.round(el.currentTime * 1000),
          }),
        });
      }
    };
    const onEnd = () => next();
    const onErr = () => {
      setError("فایل خراب یا ناسازگار است.");
      setPlaying(false);
    };
    el.addEventListener("timeupdate", onTime);
    el.addEventListener("ended", onEnd);
    el.addEventListener("error", onErr);
    return () => {
      el.removeEventListener("timeupdate", onTime);
      el.removeEventListener("ended", onEnd);
      el.removeEventListener("error", onErr);
    };
  }, [current, next]);

  useEffect(() => {
    if (!("mediaSession" in navigator)) return;
    navigator.mediaSession.setActionHandler("play", () => {
      void audioRef.current?.play();
      setPlaying(true);
    });
    navigator.mediaSession.setActionHandler("pause", () => {
      audioRef.current?.pause();
      setPlaying(false);
    });
    navigator.mediaSession.setActionHandler("previoustrack", () => prev());
    navigator.mediaSession.setActionHandler("nexttrack", () => next());
    navigator.mediaSession.setActionHandler("seekto", (d) => {
      if (audioRef.current && typeof d.seekTime === "number") audioRef.current.currentTime = d.seekTime;
    });
  }, [next, prev]);

  useEffect(() => {
    const t = window.setInterval(() => {
      if (!sleepUntil.current) return;
      const left = Math.max(0, Math.round((sleepUntil.current - Date.now()) / 1000));
      setSleepLeft(left);
      if (left <= 0) {
        audioRef.current?.pause();
        setPlaying(false);
        sleepUntil.current = null;
        setSleepLeft(null);
        toast.message("Sleep Timer تمام شد.");
      }
    }, 1000);
    return () => window.clearInterval(t);
  }, []);

  const value: Ctx = {
    current,
    queue,
    playing,
    progress,
    shuffle,
    repeat,
    speed,
    volume,
    full,
    sleepLeft,
    play,
    toggle,
    next,
    prev,
    seek,
    setVolume: (v) => {
      setVolumeState(v);
      if (audioRef.current) audioRef.current.volume = v;
    },
    setSpeed: (s) => {
      setSpeedState(s);
      if (audioRef.current) audioRef.current.playbackRate = s;
      void fetch("/api/music", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "prefs", speed: s }),
      });
    },
    setShuffle,
    setRepeat,
    setQueue: setQueueState,
    setFull,
    armSleep,
    enqueue,
    removeFromQueue,
    clearQueue,
    error,
  };

  return (
    <MusicCtx.Provider value={value}>
      <audio ref={audioRef} preload="metadata" className="hidden" />
      <div className={current ? "pb-16" : ""}>{children}</div>
      {current && !full && (
        <div className="fixed inset-x-0 bottom-0 z-40 border-t border-white/10 bg-[#0b2421]/95 p-2 text-emerald-50">
          <button type="button" className="flex w-full items-center gap-2 text-right" onClick={() => setFull(true)}>
            <span className="grid size-10 place-items-center rounded-lg bg-amber-300/90 text-[#102824] text-lg">♪</span>
            <span className="min-w-0 flex-1">
              <span className="block truncate text-sm">{current.title}</span>
              <span className="block truncate text-[11px] opacity-60">{current.artist}</span>
            </span>
          </button>
          <div className="mt-1 flex items-center justify-center gap-3">
            <button type="button" aria-label="قبلی" onClick={prev}><SkipBack className="size-4" /></button>
            <button type="button" aria-label={playing ? "مکث" : "پخش"} onClick={toggle}>
              {playing ? <Pause className="size-5" /> : <Play className="size-5" />}
            </button>
            <button type="button" aria-label="بعدی" onClick={next}><SkipForward className="size-4" /></button>
          </div>
          <div className="mt-1 h-1 overflow-hidden rounded bg-white/10">
            <div className="h-full bg-amber-300" style={{ width: `${progress * 100}%` }} />
          </div>
        </div>
      )}
      {full && current && (
        <div className="fixed inset-0 z-50 overflow-auto bg-[#071614] p-5 text-emerald-50">
          <div className="mx-auto max-w-md space-y-4">
            <div className="flex justify-between">
              <p className="text-xs text-amber-200">NIXO Player</p>
              <button type="button" onClick={() => setFull(false)} aria-label="بستن"><X className="size-5" /></button>
            </div>
            <div className="grid aspect-square place-items-center rounded-3xl bg-gradient-to-br from-amber-300/80 to-emerald-800 text-6xl text-[#102824]">♪</div>
            <div>
              <h1 className="text-xl font-semibold">{current.title}</h1>
              <p className="text-sm opacity-70">{current.artist} · {current.album}</p>
              {error && <p className="mt-1 text-xs text-rose-200">{error}</p>}
            </div>
            <input
              type="range"
              min={0}
              max={1000}
              value={Math.round(progress * 1000)}
              className="w-full"
              onChange={(e) => seek(Number(e.target.value) / 1000)}
            />
            <p className="text-center text-[11px] tabular-nums" dir="ltr">
              {formatClock((current.durationMs || 0) * progress)} / {formatClock(current.durationMs)}
            </p>
            <div className="flex items-center justify-center gap-6">
              <button type="button" onClick={prev}><SkipBack className="size-7" /></button>
              <button type="button" className="grid size-14 place-items-center rounded-full bg-amber-300 text-[#102824]" onClick={toggle}>
                {playing ? <Pause className="size-7" /> : <Play className="size-7" />}
              </button>
              <button type="button" onClick={next}><SkipForward className="size-7" /></button>
            </div>
            <div className="flex flex-wrap gap-2 text-xs">
              <Button type="button" size="sm" variant={shuffle ? "default" : "secondary"} className={shuffle ? "bg-amber-300 text-[#102824]" : ""} onClick={() => setShuffle((v) => !v)}>Shuffle</Button>
              <Button type="button" size="sm" variant="secondary" onClick={() => setRepeat(repeat === "off" ? "all" : repeat === "all" ? "one" : "off")}>
                Repeat {repeat === "off" ? "Off" : repeat === "all" ? "All" : "One"}
              </Button>
              {[0.5, 1, 1.5, 2].map((s) => (
                <button key={s} type="button" className={`rounded-full px-2 py-1 ${speed === s ? "bg-amber-300 text-[#102824]" : "bg-white/10"}`} onClick={() => value.setSpeed(s)}>{s}x</button>
              ))}
            </div>
            <label className="flex items-center gap-2 text-xs">صدا
              <input type="range" min={0} max={100} value={Math.round(volume * 100)} onChange={(e) => value.setVolume(Number(e.target.value) / 100)} className="flex-1" />
            </label>
            <div className="text-xs">
              <p className="mb-1">Sleep Timer {sleepLeft != null ? `· ${Math.ceil(sleepLeft / 60)} min` : ""}</p>
              {[15, 30, 45, 60].map((m) => (
                <Button key={m} type="button" size="sm" variant="ghost" className="text-white" onClick={() => armSleep(m)}>{m} min</Button>
              ))}
              <input
                className="ml-1 w-16 rounded bg-black/30 px-1 text-xs"
                value={customSleep}
                onChange={(e) => setCustomSleep(e.target.value)}
                aria-label="دقیقه سفارشی"
              />
              <Button type="button" size="sm" variant="ghost" className="text-white" onClick={() => armSleep(Math.max(1, Math.min(180, Number(customSleep) || 10)))}>Custom</Button>
              <Button type="button" size="sm" variant="ghost" className="text-white" onClick={() => armSleep(null)}>Off</Button>
            </div>
            <section>
              <div className="flex items-center justify-between">
                <h2 className="text-sm font-medium">Queue</h2>
                <Button type="button" size="sm" variant="ghost" className="text-white" onClick={clearQueue}>پاک کردن Queue</Button>
              </div>
              <ul className="mt-1 space-y-1 text-xs">
                {queue.map((q, i) => (
                  <li key={`${q.catalog}-${q.id}`} className={`flex items-center justify-between rounded-lg px-2 py-1 ${i === index ? "bg-white/10" : ""}`}>
                    <button type="button" className="truncate text-right" onClick={() => playAt(i, queue)}>{q.title}</button>
                    <span className="flex gap-1">
                      <button type="button" onClick={() => {
                        if (i === 0) return;
                        const nextQ = [...queue];
                        const [row] = nextQ.splice(i, 1);
                        nextQ.splice(i - 1, 0, row!);
                        setQueueState(nextQ);
                      }}>↑</button>
                      <button type="button" onClick={() => {
                        if (i >= queue.length - 1) return;
                        const nextQ = [...queue];
                        const [row] = nextQ.splice(i, 1);
                        nextQ.splice(i + 1, 0, row!);
                        setQueueState(nextQ);
                      }}>↓</button>
                      <button type="button" className="text-rose-200" onClick={() => removeFromQueue(i)}>×</button>
                    </span>
                  </li>
                ))}
              </ul>
            </section>
            <p className="text-[11px] opacity-45">پخش در پس‌زمینهٔ نیکسو ادامه دارد. کنترل Lock Screen در مرورگرهایی که Media Session دارند. نیکسو موسیقی دارای کپی‌رایت را بدون مجوز عرضه نمی‌کند.</p>
          </div>
        </div>
      )}
    </MusicCtx.Provider>
  );
}
