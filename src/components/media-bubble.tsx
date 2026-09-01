"use client";

import { useEffect, useState } from "react";
import { Download, Forward, Maximize2, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { decryptBytes, decryptText, encryptBytes, encryptText, loadOrCreateThreadKey, type CipherEnvelope } from "@/lib/e2ee";
import { formatBytes, type MediaMeta } from "@/lib/media";
import { ViewOnceShield } from "@/components/view-once-shield";
import { ExpiryBadge } from "@/components/expiry-badge";

export type MediaMsg = {
  id: string;
  sender: "me" | "peer";
  createdAt: number;
  enc: string;
  ciphertext: string;
  nonce: string;
  kind: "photo" | "video" | "file";
  blobId?: string | null;
  chunkCount?: number | null;
  byteLength?: number | null;
  viewOnce?: boolean;
  expired?: boolean;
  forwarded?: boolean;
  disappearAfterMs?: number | null;
  expireFrom?: "send" | "view" | null;
  expiresAt?: number | null;
  viewedAt?: number | null;
};

function newBlobId() {
  const bytes = crypto.getRandomValues(new Uint8Array(12));
  return Array.from(bytes, (n) => n.toString(16).padStart(2, "0")).join("");
}

async function loadBlob(
  threadId: string,
  msg: MediaMsg,
  chunkBase?: string,
): Promise<{ blob: Blob; meta: MediaMeta } | null> {
  if (!msg.blobId || !msg.chunkCount || msg.enc !== "e2ee-v1") return null;
  const key = await loadOrCreateThreadKey(threadId);
  const metaRaw = await decryptText(key, { enc: "e2ee-v1", ciphertext: msg.ciphertext, nonce: msg.nonce });
  const meta = JSON.parse(metaRaw) as MediaMeta;
  const base = chunkBase ?? `/api/chats/${threadId}`;
  const parts: Uint8Array[] = [];
  for (let i = 0; i < msg.chunkCount; i += 1) {
    const res = await fetch(`${base}/blobs/${msg.blobId}/chunks/${i}`);
    if (!res.ok) return null;
    const data = (await res.json()) as { chunk: CipherEnvelope };
    parts.push(await decryptBytes(key, data.chunk));
  }
  const total = parts.reduce((n, p) => n + p.length, 0);
  const bytes = new Uint8Array(total);
  let o = 0;
  parts.forEach((p) => {
    bytes.set(p, o);
    o += p.length;
  });
  return { blob: new Blob([new Uint8Array(bytes)], { type: meta.mime || "application/octet-stream" }), meta };
}

export function MediaBubble({
  msg,
  threadId,
  threads,
  onGone,
  onOpen,
  chunkBase,
  senderLabel,
}: {
  msg: MediaMsg;
  threadId: string;
  threads: { id: string; peerName: string }[];
  onGone?: () => void;
  onOpen?: (url: string, meta: MediaMeta, msg: MediaMsg) => void;
  chunkBase?: string;
  senderLabel?: string;
}) {
  const [url, setUrl] = useState<string | null>(null);
  const [meta, setMeta] = useState<MediaMeta | null>(null);
  const [progress, setProgress] = useState(0);
  const [spent, setSpent] = useState(Boolean(msg.expired));
  const [forwardOpen, setForwardOpen] = useState(false);
  const [unlocked, setUnlocked] = useState(!msg.viewOnce);
  const [replayOff, setReplayOff] = useState(false);
  const locked = Boolean(msg.viewOnce) && !unlocked && !spent;

  useEffect(() => {
    let revoke: string | null = null;
    let cancelled = false;
    if (msg.expired || !msg.blobId || msg.enc !== "e2ee-v1" || (msg.viewOnce && !unlocked)) return;
    loadBlob(threadId, msg, chunkBase).then((loaded) => {
      if (cancelled) return;
      if (!loaded) {
        setSpent(true);
        return;
      }
      revoke = URL.createObjectURL(loaded.blob);
      setMeta(loaded.meta);
      setUrl(revoke);
      setProgress(100);
    });
    return () => {
      cancelled = true;
      if (revoke) URL.revokeObjectURL(revoke);
    };
  }, [msg, threadId, unlocked, chunkBase]);

  async function markViewed(mode: "open" | "play") {
    await fetch(`/api/chats/${threadId}/messages/${msg.id}/played`, { method: "POST" });
    if (msg.viewOnce && mode === "open") {
      setReplayOff(true);
      setSpent(true);
      onGone?.();
      return;
    }
    if (msg.viewOnce && mode === "play") {
      setReplayOff(true);
      return;
    }
    onGone?.();
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
    onGone?.();
  }

  async function forwardTo(targetId: string) {
    if (msg.viewOnce) {
      toast.error("محتوای یک‌بارمصرف قابل هدایت نیست.");
      return;
    }
    if (!url || !meta || !msg.blobId || !msg.chunkCount) return;
    const buf = await fetch(url).then((r) => r.arrayBuffer());
    const bytes = new Uint8Array(buf);
    const key = await loadOrCreateThreadKey(targetId);
    const blobId = newBlobId();
    const chunk = 160 * 1024;
    const count = Math.ceil(bytes.length / chunk);
    for (let i = 0; i < count; i += 1) {
      const envelope = await encryptBytes(key, bytes.slice(i * chunk, (i + 1) * chunk));
      await fetch(`/api/chats/${targetId}/blobs/${blobId}/chunks/${i}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(envelope),
      });
    }
    const metaEnv = await encryptText(key, JSON.stringify(meta));
    const res = await fetch(`/api/chats/${targetId}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        ...metaEnv,
        kind: msg.kind,
        blobId,
        chunkCount: count,
        byteLength: bytes.length,
        mimeClass: msg.kind === "photo" ? "image" : msg.kind === "video" ? "video" : "file",
        forwarded: true,
      }),
    });
    if (!res.ok) toast.error("هدایت انجام نشد.");
    else toast.success("هدایت شد.");
    setForwardOpen(false);
  }

  if (locked) {
    return (
      <button
        type="button"
        className="px-3 py-4 text-xs"
        onClick={() => setUnlocked(true)}
      >
        {msg.kind === "photo" ? "عکس یک‌بارمصرف — برای مشاهده بزن" : "ویدیوی یک‌بارمصرف — برای پخش بزن"}
      </button>
    );
  }

  if (spent) {
    return <p className="px-3 py-2 text-xs text-emerald-100/55">{msg.viewOnce ? "مشاهده شد و محتوا منقضی شد." : "رسانه در دسترس نیست."}</p>;
  }

  const restricted = Boolean(msg.viewOnce);

  return (
    <ViewOnceShield active={restricted} threadId={threadId} messageId={msg.id} className="min-w-[180px] max-w-[92vw] space-y-1 p-2">
      <ExpiryBadge
        createdAt={msg.createdAt}
        expireFrom={msg.expireFrom}
        disappearAfterMs={msg.disappearAfterMs}
        expiresAt={msg.expiresAt}
        viewedAt={msg.viewedAt}
        viewOnce={msg.viewOnce}
      />
      {progress < 100 && !url && <p className="text-[11px]">دانلود {progress}%</p>}
      {msg.kind === "photo" && url && (
        <button
          type="button"
          onClick={() => {
            onOpen?.(url, meta!, msg);
            void markViewed("open");
          }}
        >
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={url} alt={meta?.caption ?? ""} className="pointer-events-none max-h-56 w-full rounded-xl object-cover" draggable={false} />
        </button>
      )}
      {msg.kind === "video" && url && (
        <video
          src={url}
          controls={!restricted && !replayOff}
          disablePictureInPicture
          controlsList="nodownload noplaybackrate noremoteplayback"
          className="max-h-56 w-full rounded-xl"
          muted={meta?.mute}
          onPlay={() => {
            if (restricted || msg.expireFrom === "view") void markViewed("play");
          }}
          onEnded={() => {
            if (restricted) {
              setSpent(true);
              setUrl(null);
              onGone?.();
            }
          }}
          style={{ transform: meta?.rotation ? `rotate(${meta.rotation}deg)` : undefined }}
        />
      )}
      {msg.kind === "file" && (
        <div className="px-2 py-1 text-xs">
          <p className="font-medium">{meta?.name ?? "فایل"}</p>
          <p className="text-emerald-100/60">{meta?.mime} · {formatBytes(msg.byteLength ?? 0)}</p>
          {url && (meta?.mime === "application/pdf" || meta?.name?.toLowerCase().endsWith(".pdf")) && (
            <iframe title={meta?.name ?? "pdf"} src={url} className="mt-2 h-40 w-full rounded bg-white" />
          )}
          {url && meta?.mime.startsWith("audio/") && <audio src={url} controls className="mt-2 w-full" />}
          {url && meta?.mime.startsWith("image/") && (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={url} alt="" className="mt-2 max-h-40 rounded object-cover" />
          )}
          {url && meta?.mime.startsWith("video/") && <video src={url} controls className="mt-2 max-h-40 w-full rounded" />}
          <p className="mt-1 text-[10px] opacity-50">
            {senderLabel ?? (msg.sender === "me" ? "تو" : "مخاطب")} · {new Date(msg.createdAt).toLocaleString("fa-IR")}
          </p>
        </div>
      )}
      {meta?.caption && <p className="px-2 text-xs">{meta.caption}</p>}
      <div className="flex flex-wrap gap-1 px-1">
        <Button
          type="button"
          size="sm"
          variant="ghost"
          className="h-7 px-2 text-[11px]"
          disabled={restricted && msg.kind !== "photo"}
          onClick={() => {
            if (!url || !meta) return;
            if (restricted && msg.kind === "photo") {
              onOpen?.(url, meta, msg);
              void markViewed("open");
              return;
            }
            if (restricted) return;
            onOpen?.(url, meta, msg);
          }}
        >
          <Maximize2 className="size-3" />
        </Button>
        <Button
          type="button"
          size="sm"
          variant="ghost"
          className="h-7 px-2 text-[11px]"
          disabled={restricted}
          onClick={() => {
            if (!url || !meta || restricted) return;
            const a = document.createElement("a");
            a.href = url;
            const name = window.prompt("نام فایل روی دستگاه", meta.name || "nixo-file") || meta.name;
            a.download = name;
            a.click();
          }}
        >
          <Download className="size-3" />
        </Button>
        <Button type="button" size="sm" variant="ghost" className="h-7 px-2 text-[11px]" disabled={restricted} onClick={() => setForwardOpen(true)}>
          <Forward className="size-3" />
        </Button>
        <Button type="button" size="sm" variant="ghost" className="h-7 px-2 text-[11px]" onClick={() => remove("me")}>
          <Trash2 className="size-3" />
        </Button>
        {msg.sender === "me" && (
          <Button type="button" size="sm" variant="ghost" className="h-7 px-2 text-[11px]" onClick={() => remove("everyone")}>
            برای همه
          </Button>
        )}
        {url && navigator.share && !restricted && (
          <Button
            type="button"
            size="sm"
            variant="ghost"
            className="h-7 px-2 text-[11px]"
            onClick={() => void navigator.share({ title: meta?.name, url })}
          >
            اشتراک
          </Button>
        )}
      </div>
      {forwardOpen && (
        <div className="max-h-28 space-y-1 overflow-auto rounded bg-black/20 p-2">
          {threads.filter((t) => t.id !== threadId).map((t) => (
            <button key={t.id} type="button" className="block w-full text-right text-xs" onClick={() => void forwardTo(t.id)}>
              {t.peerName}
            </button>
          ))}
        </div>
      )}
    </ViewOnceShield>
  );
}
