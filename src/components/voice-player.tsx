"use client";

import { useEffect, useRef, useState } from "react";
import { Download, Forward, Info, MoreVertical, Pause, Play, Share2, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { decryptText, loadOrCreateThreadKey, type CipherEnvelope } from "@/lib/e2ee";
import {
  formatClock,
  loadPlayHead,
  parseVoiceInner,
  savePlayHead,
  voiceSaveAllowed,
  type VoiceInner,
} from "@/lib/voice";
import { ViewOnceShield } from "@/components/view-once-shield";
import { ExpiryBadge } from "@/components/expiry-badge";
import { useVoiceQueue } from "@/components/voice-queue";

export type VoiceMsg = {
  id: string;
  sender: "me" | "peer";
  createdAt: number;
  enc: string;
  ciphertext: string;
  nonce: string;
  durationMs?: number | null;
  viewOnce?: boolean;
  expired?: boolean;
  forwarded?: boolean;
  disappearAfterMs?: number | null;
  expireFrom?: "send" | "view" | null;
  expiresAt?: number | null;
  viewedAt?: number | null;
};

const SPEEDS = [0.5, 1, 1.5, 2] as const;

function Waveform({
  peaks,
  progress,
  onSeek,
  disabled,
}: {
  peaks: number[];
  progress: number;
  onSeek: (ratio: number) => void;
  disabled?: boolean;
}) {
  const bars = peaks.length ? peaks : Array.from({ length: 32 }, () => 0.25);
  return (
    <button
      type="button"
      dir="ltr"
      className="flex h-10 flex-1 items-center gap-[2px]"
      disabled={disabled}
      aria-label="موج صدا — برای رفتن به نقطه لمس کنید"
      onClick={(e) => {
        const rect = e.currentTarget.getBoundingClientRect();
        const ratio = (e.clientX - rect.left) / rect.width;
        onSeek(Math.min(1, Math.max(0, ratio)));
      }}
    >
      {bars.map((p, i) => {
        const filled = i / bars.length <= progress;
        return (
          <span
            key={i}
            className={cn("w-[3px] rounded-full", filled ? "bg-current" : "bg-current/30")}
            style={{ height: `${Math.max(16, Math.min(100, p * 100))}%` }}
          />
        );
      })}
    </button>
  );
}

export function VoicePlayer({
  msg,
  threadId,
  threads,
  onGone,
  senderLabel,
  deleteMode = "dm",
  groupId,
}: {
  msg: VoiceMsg;
  threadId: string;
  threads: { id: string; peerName: string }[];
  onGone?: () => void;
  senderLabel?: string;
  deleteMode?: "dm" | "group";
  groupId?: string;
}) {
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const [inner, setInner] = useState<VoiceInner | null>(null);
  const [url, setUrl] = useState<string | null>(null);
  const [playing, setPlaying] = useState(false);
  const [progress, setProgress] = useState(0);
  const [speed, setSpeed] = useState<(typeof SPEEDS)[number]>(1);
  const [menu, setMenu] = useState(false);
  const [forwardOpen, setForwardOpen] = useState(false);
  const [infoOpen, setInfoOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState("");
  const [sink, setSink] = useState<"speaker" | "earpiece">("speaker");
  const [spent, setSpent] = useState(Boolean(msg.expired) || msg.enc !== "e2ee-v1" || !msg.ciphertext);
  const saveOk = voiceSaveAllowed() && !msg.viewOnce && !msg.expired;
  const queue = useVoiceQueue();
  const qid = `${threadId}:${msg.id}`;

  useEffect(() => {
    if (msg.expired || msg.enc !== "e2ee-v1" || !msg.ciphertext) {
      return;
    }
    let revoke: string | null = null;
    let cancelled = false;
    setLoading(true);
    const envelope: CipherEnvelope = { enc: "e2ee-v1", ciphertext: msg.ciphertext, nonce: msg.nonce };
    loadOrCreateThreadKey(threadId)
      .then((key) => decryptText(key, envelope))
      .then((raw) => {
        if (cancelled) return;
        const parsed = parseVoiceInner(raw);
        if (!parsed) {
          setErr("فرمت صدا نامعتبر است.");
          return;
        }
        setInner(parsed);
        const bin = Uint8Array.from(atob(parsed.audio), (c) => c.charCodeAt(0));
        const blob = new Blob([new Uint8Array(bin)], { type: parsed.mime || "audio/webm" });
        revoke = URL.createObjectURL(blob);
        setUrl(revoke);
      })
      .catch(() => {
        if (!cancelled) {
          setSpent(true);
          setErr("رمزگشایی صدا ممکن نشد.");
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
      if (revoke) URL.revokeObjectURL(revoke);
    };
  }, [msg.ciphertext, msg.enc, msg.expired, msg.nonce, threadId]);

  useEffect(() => {
    const el = audioRef.current;
    if (!el || !url) return;
    el.src = url;
    const start = loadPlayHead(msg.id);
    if (start > 0 && !msg.viewOnce) el.currentTime = start;
    const onTime = () => {
      setProgress(el.duration ? el.currentTime / el.duration : 0);
      savePlayHead(msg.id, el.currentTime);
    };
    const onEnd = () => {
      setPlaying(false);
      savePlayHead(msg.id, 0);
      queue?.ended(qid);
      if (msg.viewOnce) {
        setSpent(true);
        setUrl(null);
        onGone?.();
      }
    };
    const onError = () => setErr("پخش با خطا روبه‌رو شد. اتصال را بررسی کنید.");
    el.addEventListener("timeupdate", onTime);
    el.addEventListener("ended", onEnd);
    el.addEventListener("error", onError);
    return () => {
      el.removeEventListener("timeupdate", onTime);
      el.removeEventListener("ended", onEnd);
      el.removeEventListener("error", onError);
    };
  }, [url, msg.id, msg.viewOnce, onGone, queue, qid]);

  const durationLabel = formatClock(inner?.durationMs ?? msg.durationMs ?? 0);

  const playNowRef = useRef<() => Promise<void>>(async () => undefined);

  async function playNow() {
    const el = audioRef.current;
    if (!el || spent) return;
    el.playbackRate = speed;
    try {
      await el.play();
      setPlaying(true);
      if (deleteMode === "dm" && (msg.viewOnce || msg.expireFrom === "view")) {
        void fetch(`/api/chats/${threadId}/messages/${msg.id}/played`, { method: "POST" });
      }
      if ("mediaSession" in navigator) {
        try {
          navigator.mediaSession.metadata = new MediaMetadata({
            title: "پیام صوتی",
            artist: senderLabel ?? (msg.sender === "me" ? "تو" : "مخاطب"),
            album: "NIXO",
          });
        } catch {
          /* optional */
        }
      }
    } catch {
      toast.error("پخش انجام نشد.");
    }
  }

  playNowRef.current = playNow;

  async function toggle() {
    const el = audioRef.current;
    if (!el || spent) return;
    if (playing) {
      el.pause();
      setPlaying(false);
      return;
    }
    await playNow();
  }

  useEffect(() => {
    if (!queue) return;
    queue.register(qid, () => void playNowRef.current());
    return () => queue.unregister(qid);
  }, [qid, queue]);

  useEffect(() => {
    const a = audioRef.current;
    if (!a || !("setSinkId" in a)) return;
    const sinkId = sink === "earpiece" ? "communications" : "default";
    void (a as HTMLAudioElement & { setSinkId?: (id: string) => Promise<void> }).setSinkId?.(sinkId).catch(() => undefined);
  }, [sink]);

  async function remove(scope: "me" | "everyone") {
    if (deleteMode === "group" && groupId) {
      const res = await fetch(`/api/groups/${groupId}/messages/${msg.id}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "delete" }),
      });
      if (!res.ok) {
        toast.error("حذف انجام نشد.");
        return;
      }
      toast.success("حذف شد.");
      onGone?.();
      return;
    }
    const res = await fetch(`/api/chats/${threadId}/messages/${msg.id}`, {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ scope }),
    });
    if (!res.ok) {
      toast.error("حذف انجام نشد.");
      return;
    }
    toast.success(scope === "everyone" ? "برای همه حذف شد." : "برای تو حذف شد.");
    onGone?.();
  }

  async function forwardTo(targetId: string) {
    if (msg.viewOnce) {
      toast.error("پیام یک‌بارمصرف قابل هدایت نیست.");
      return;
    }
    if (!inner) return;
    const key = await loadOrCreateThreadKey(targetId);
    const { encryptText } = await import("@/lib/e2ee");
    const envelope = await encryptText(key, JSON.stringify(inner));
    const res = await fetch(`/api/chats/${targetId}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        ...envelope,
        kind: "voice",
        durationMs: inner.durationMs,
        forwarded: true,
      }),
    });
    if (!res.ok) {
      toast.error("هدایت انجام نشد.");
      return;
    }
    toast.success("پیام صوتی هدایت شد.");
    setForwardOpen(false);
  }

  function saveFile() {
    if (!url || !saveOk) return;
    const a = document.createElement("a");
    a.href = url;
    a.download = `nixo-voice-${msg.id}.webm`;
    a.click();
  }

  async function share() {
    if (!url || !saveOk) {
      toast.error("اشتراک این صدا مجاز نیست.");
      return;
    }
    try {
      const blob = await fetch(url).then((r) => r.blob());
      const file = new File([blob], `nixo-voice-${msg.id}.webm`, { type: blob.type || "audio/webm" });
      if (navigator.share && navigator.canShare?.({ files: [file] })) {
        await navigator.share({ files: [file], title: "پیام صوتی نیکسو" });
        return;
      }
      saveFile();
    } catch {
      /* cancelled */
    }
  }

  async function persistSaved(patch: { bookmark?: boolean; favorite?: boolean }) {
    const sourceType = deleteMode === "group" ? "group" : "chat";
    const sourceId = deleteMode === "group" ? (groupId ?? threadId.replace(/^group:/, "")) : threadId;
    const res = await fetch("/api/saved", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        kind: "voice",
        body: "پیام صوتی",
        bookmark: Boolean(patch.bookmark),
        favorite: Boolean(patch.favorite),
        source: { type: sourceType, id: sourceId, name: senderLabel ?? "", messageId: msg.id },
      }),
    });
    if (res.ok) toast.success(patch.favorite ? "Favorite شد." : "در Saved Messages ذخیره شد.");
    else toast.error("ذخیره مجاز نشد — دسترسی از پیام اصلی بیشتر نمی‌شود.");
  }

  if (spent) {
    return (
      <p className="px-3 py-2 text-xs text-emerald-100/55">
        {msg.viewOnce ? "پیام صوتی یک‌بارمصرف منقضی شد." : "این پیام صوتی دیگر در دسترس نیست."}
      </p>
    );
  }

  const sizeHint = msg.ciphertext ? `${Math.round((msg.ciphertext.length * 3) / 4 / 1024)} کیلوبایت (رمز)` : "—";

  return (
    <ViewOnceShield active={Boolean(msg.viewOnce)} threadId={threadId} messageId={msg.id} className="min-w-[220px] max-w-[92vw] space-y-1 px-3 py-2">
      <audio ref={audioRef} preload="metadata" />
      {loading ? <p className="text-[10px] opacity-60">بارگذاری صدا…</p> : null}
      {err ? <p className="text-[10px] text-rose-200">{err}</p> : null}
      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={() => void toggle()}
          className="grid size-9 shrink-0 place-items-center rounded-full bg-black/20"
          aria-label={playing ? "مکث" : "پخش"}
        >
          {playing ? <Pause className="size-4" /> : <Play className="size-4" />}
        </button>
        <Waveform
          peaks={inner?.peaks ?? []}
          progress={progress}
          onSeek={(ratio) => {
            if (msg.viewOnce) return;
            const el = audioRef.current;
            if (!el?.duration) return;
            el.currentTime = ratio * el.duration;
          }}
          disabled={Boolean(msg.viewOnce)}
        />
        <span className="w-10 text-[10px] tabular-nums" dir="ltr">
          {durationLabel}
        </span>
      </div>
      <div className="flex items-center justify-between gap-2 text-[10px]">
        <div className="flex gap-1">
          {SPEEDS.map((s) => (
            <button
              key={s}
              type="button"
              className={cn("rounded-full px-1.5 py-0.5", speed === s ? "bg-black/25" : "opacity-60")}
              onClick={() => {
                setSpeed(s);
                if (audioRef.current) audioRef.current.playbackRate = s;
              }}
            >
              {s}×
            </button>
          ))}
        </div>
        <div className="flex items-center gap-1">
          {msg.viewOnce && <span>یک‌بارمصرف</span>}
          {msg.forwarded && <span>هدایت‌شده</span>}
          <ExpiryBadge
            createdAt={msg.createdAt}
            expireFrom={msg.expireFrom}
            disappearAfterMs={msg.disappearAfterMs}
            expiresAt={msg.expiresAt}
            viewedAt={msg.viewedAt}
            viewOnce={msg.viewOnce}
          />
          <button type="button" onClick={() => setSink((v) => (v === "speaker" ? "earpiece" : "speaker"))} aria-label="تغییر مسیر پخش">
            {sink === "speaker" ? "بلندگو" : "گوشی"}
          </button>
          <button type="button" onClick={() => setInfoOpen((v) => !v)} aria-label="اطلاعات پیام صوتی">
            <Info className="size-3.5" />
          </button>
          <button type="button" onClick={() => setMenu((v) => !v)} aria-label="گزینه‌ها">
            <MoreVertical className="size-3.5" />
          </button>
        </div>
      </div>
      {infoOpen && (
        <dl className="space-y-0.5 pt-1 text-[10px] opacity-80">
          <div className="flex justify-between gap-2">
            <dt>مدت</dt>
            <dd dir="ltr">{durationLabel}</dd>
          </div>
          <div className="flex justify-between gap-2">
            <dt>زمان</dt>
            <dd>{new Date(msg.createdAt).toLocaleString("fa-IR")}</dd>
          </div>
          <div className="flex justify-between gap-2">
            <dt>فرستنده</dt>
            <dd>{senderLabel ?? (msg.sender === "me" ? "تو" : "مخاطب")}</dd>
          </div>
          <div className="flex justify-between gap-2">
            <dt>حجم تقریبی</dt>
            <dd>{sizeHint}</dd>
          </div>
          <div className="flex justify-between gap-2">
            <dt>وضعیت</dt>
            <dd>{msg.viewedAt ? "خوانده‌شده" : msg.sender === "me" ? "ارسال‌شده" : "دریافت‌شده"}</dd>
          </div>
        </dl>
      )}
      {menu && (
        <div className="flex flex-wrap gap-1 pt-1">
          <Button type="button" size="sm" variant="ghost" className="h-7 px-2 text-[11px]" onClick={() => void remove("me")}>
            <Trash2 className="size-3" />
            حذف برای من
          </Button>
          {msg.sender === "me" && deleteMode === "dm" && (
            <Button type="button" size="sm" variant="ghost" className="h-7 px-2 text-[11px]" onClick={() => void remove("everyone")}>
              حذف برای همه
            </Button>
          )}
          <Button
            type="button"
            size="sm"
            variant="ghost"
            className="h-7 px-2 text-[11px]"
            disabled={Boolean(msg.viewOnce)}
            onClick={() => setForwardOpen(true)}
          >
            <Forward className="size-3" />
            هدایت
          </Button>
          <Button type="button" size="sm" variant="ghost" className="h-7 px-2 text-[11px]" disabled={!saveOk} onClick={saveFile}>
            <Download className="size-3" />
            دانلود
          </Button>
          <Button type="button" size="sm" variant="ghost" className="h-7 px-2 text-[11px]" disabled={!saveOk} onClick={() => void share()}>
            <Share2 className="size-3" />
            اشتراک
          </Button>
          <Button type="button" size="sm" variant="ghost" className="h-7 px-2 text-[11px]" onClick={() => void persistSaved({})}>
            ذخیره
          </Button>
          <Button type="button" size="sm" variant="ghost" className="h-7 px-2 text-[11px]" onClick={() => void persistSaved({ bookmark: true })}>
            نشانک
          </Button>
          <Button type="button" size="sm" variant="ghost" className="h-7 px-2 text-[11px]" onClick={() => void persistSaved({ favorite: true })}>
            Favorite
          </Button>
        </div>
      )}
      {forwardOpen && (
        <div className="mt-1 max-h-32 space-y-1 overflow-auto rounded-lg bg-black/20 p-2">
          {threads
            .filter((t) => t.id !== threadId)
            .map((t) => (
              <button key={t.id} type="button" className="block w-full rounded px-2 py-1 text-right text-xs hover:bg-white/10" onClick={() => void forwardTo(t.id)}>
                {t.peerName}
              </button>
            ))}
        </div>
      )}
    </ViewOnceShield>
  );
}

export function ChannelVoicePlayer({ src, durationMs }: { src: string; durationMs?: number }) {
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const [playing, setPlaying] = useState(false);
  const [progress, setProgress] = useState(0);
  if (!src.startsWith("data:audio") && !src.startsWith("blob:")) {
    return <p className="text-xs opacity-70">پیام صوتی کانال</p>;
  }
  return (
    <div className="mt-2 flex items-center gap-2">
      <audio
        ref={audioRef}
        src={src}
        preload="metadata"
        onTimeUpdate={() => {
          const a = audioRef.current;
          if (a?.duration) setProgress(a.currentTime / a.duration);
        }}
        onEnded={() => setPlaying(false)}
      />
      <button
        type="button"
        className="grid size-9 place-items-center rounded-full bg-black/20"
        aria-label={playing ? "مکث" : "پخش"}
        onClick={() => {
          const a = audioRef.current;
          if (!a) return;
          if (playing) {
            a.pause();
            setPlaying(false);
          } else {
            void a.play().then(() => setPlaying(true));
          }
        }}
      >
        {playing ? <Pause className="size-4" /> : <Play className="size-4" />}
      </button>
      <div className="h-2 flex-1 overflow-hidden rounded-full bg-white/15">
        <div className="h-full bg-amber-300" style={{ width: `${Math.round(progress * 100)}%` }} />
      </div>
      <span className="text-[10px] tabular-nums" dir="ltr">
        {formatClock(durationMs ?? 0)}
      </span>
    </div>
  );
}
