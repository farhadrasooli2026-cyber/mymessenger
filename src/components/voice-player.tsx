"use client";

import { useEffect, useRef, useState } from "react";
import { Download, Forward, MoreVertical, Pause, Play, Trash2 } from "lucide-react";
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
      aria-label="موج صدا"
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
}: {
  msg: VoiceMsg;
  threadId: string;
  threads: { id: string; peerName: string }[];
  onGone?: () => void;
}) {
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const [inner, setInner] = useState<VoiceInner | null>(null);
  const [url, setUrl] = useState<string | null>(null);
  const [playing, setPlaying] = useState(false);
  const [progress, setProgress] = useState(0);
  const [speed, setSpeed] = useState<(typeof SPEEDS)[number]>(1);
  const [menu, setMenu] = useState(false);
  const [forwardOpen, setForwardOpen] = useState(false);
  const [spent, setSpent] = useState(
    Boolean(msg.expired) || msg.enc !== "e2ee-v1" || !msg.ciphertext,
  );
  const saveOk = voiceSaveAllowed() && !msg.viewOnce && !msg.expired;

  useEffect(() => {
    if (msg.expired || msg.enc !== "e2ee-v1" || !msg.ciphertext) {
      return;
    }
    let revoke: string | null = null;
    const envelope: CipherEnvelope = { enc: "e2ee-v1", ciphertext: msg.ciphertext, nonce: msg.nonce };
    loadOrCreateThreadKey(threadId)
      .then((key) => decryptText(key, envelope))
      .then((raw) => {
        const parsed = parseVoiceInner(raw);
        if (!parsed) return;
        setInner(parsed);
        const bin = Uint8Array.from(atob(parsed.audio), (c) => c.charCodeAt(0));
        const blob = new Blob([new Uint8Array(bin)], { type: parsed.mime || "audio/webm" });
        revoke = URL.createObjectURL(blob);
        setUrl(revoke);
      })
      .catch(() => setSpent(true));
    return () => {
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
    const onEnd = async () => {
      setPlaying(false);
      savePlayHead(msg.id, 0);
      if (msg.viewOnce) {
        setSpent(true);
        setUrl(null);
        onGone?.();
      }
    };
    el.addEventListener("timeupdate", onTime);
    el.addEventListener("ended", onEnd);
    return () => {
      el.removeEventListener("timeupdate", onTime);
      el.removeEventListener("ended", onEnd);
    };
  }, [url, msg.id, msg.viewOnce, threadId, onGone]);

  const durationLabel = formatClock(inner?.durationMs ?? msg.durationMs ?? 0);

  async function toggle() {
    const el = audioRef.current;
    if (!el || spent) return;
    if (playing) {
      el.pause();
      setPlaying(false);
      return;
    }
    el.playbackRate = speed;
    try {
      await el.play();
      setPlaying(true);
      if (msg.viewOnce || msg.expireFrom === "view") {
        void fetch(`/api/chats/${threadId}/messages/${msg.id}/played`, { method: "POST" });
      }
    } catch {
      toast.error("پخش انجام نشد.");
    }
  }

  async function remove(scope: "me" | "everyone") {
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

  if (spent) {
    return (
      <p className="px-3 py-2 text-xs text-emerald-100/55">
        {msg.viewOnce ? "پیام صوتی یک‌بارمصرف منقضی شد." : "این پیام صوتی دیگر در دسترس نیست."}
      </p>
    );
  }

  return (
    <ViewOnceShield active={Boolean(msg.viewOnce)} threadId={threadId} messageId={msg.id} className="min-w-[220px] max-w-[92vw] space-y-1 px-3 py-2">
      <audio ref={audioRef} preload="metadata" />
      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={toggle}
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
          <button type="button" onClick={() => setMenu((v) => !v)} aria-label="گزینه‌ها">
            <MoreVertical className="size-3.5" />
          </button>
        </div>
      </div>
      {menu && (
        <div className="flex flex-wrap gap-1 pt-1">
          <Button type="button" size="sm" variant="ghost" className="h-7 px-2 text-[11px]" onClick={() => remove("me")}>
            <Trash2 className="size-3" />
            حذف برای من
          </Button>
          {msg.sender === "me" && (
            <Button type="button" size="sm" variant="ghost" className="h-7 px-2 text-[11px]" onClick={() => remove("everyone")}>
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
            ذخیره
          </Button>
        </div>
      )}
      {forwardOpen && (
        <div className="mt-1 max-h-32 space-y-1 overflow-auto rounded-lg bg-black/20 p-2">
          {threads
            .filter((t) => t.id !== threadId)
            .map((t) => (
              <button key={t.id} type="button" className="block w-full rounded px-2 py-1 text-right text-xs hover:bg-white/10" onClick={() => forwardTo(t.id)}>
                {t.peerName}
              </button>
            ))}
        </div>
      )}
    </ViewOnceShield>
  );
}
