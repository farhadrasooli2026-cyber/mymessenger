"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Bookmark, Send } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";

type Item = {
  id: string;
  kind: string;
  body: string;
  notes: string;
  linkUrl: string;
  linkHost: string;
  fileName: string;
  fileType: string;
  fileSize: number;
  hasMedia: boolean;
  mediaUrl: string;
  tag: string;
  tags: string[];
  folderId: string | null;
  bookmarked: boolean;
  favorite: boolean;
  pinned: boolean;
  createdAt: number;
  source: { type: string; name: string; id?: string; messageId?: string } | null;
  original: { canOpen: boolean; status: string; label: string };
  inTrash: boolean;
  copyrightNote: string;
};

async function post(body: Record<string, unknown>) {
  const res = await fetch("/api/saved", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  const data = await res.json();
  return { res, data };
}

function bubbleTime(ts: number) {
  return new Date(ts).toLocaleTimeString("fa-IR", { hour: "2-digit", minute: "2-digit" });
}

export function SavedPane({ onClose, onJumpChat }: { onClose: () => void; onJumpChat?: (threadId: string, messageId?: string) => void }) {
  const [items, setItems] = useState<Item[]>([]);
  const [body, setBody] = useState("");
  const [busy, setBusy] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [hasMore, setHasMore] = useState(false);
  const [offset, setOffset] = useState(0);
  const scroller = useRef<HTMLDivElement>(null);
  const accountHint = "session";

  const load = useCallback(
    async (nextOffset = 0) => {
      setBusy(true);
      setError(null);
      try {
        const params = new URLSearchParams({ q: "", kind: "all", sort: "oldest", offset: String(nextOffset) });
        const res = await fetch(`/api/saved?${params}`, { cache: "no-store" });
        const d = await res.json();
        if (!res.ok) {
          setError(d.error ?? "بارگذاری نشد.");
          return;
        }
        setItems(nextOffset === 0 ? (d.items ?? []) : (prev) => [...prev, ...(d.items ?? [])]);
        setHasMore(Boolean(d.hasMore));
        setOffset(d.nextOffset ?? nextOffset);
        try {
          if (nextOffset === 0) {
            sessionStorage.setItem(`nixo-saved:${accountHint}`, JSON.stringify({ items: d.items ?? [], at: Date.now() }));
          }
        } catch {
          /* ignore */
        }
        if (nextOffset === 0) {
          requestAnimationFrame(() => {
            const el = scroller.current;
            if (el) el.scrollTop = el.scrollHeight;
          });
        }
      } catch {
        setError("اتصال برقرار نشد.");
        try {
          const raw = sessionStorage.getItem(`nixo-saved:${accountHint}`);
          if (raw) setItems((JSON.parse(raw) as { items: Item[] }).items ?? []);
        } catch {
          /* ignore */
        }
      } finally {
        setBusy(false);
      }
    },
    [accountHint],
  );

  useEffect(() => {
    const t = window.setTimeout(() => void load(0), 0);
    return () => window.clearTimeout(t);
  }, [load]);

  async function send() {
    const text = body.trim();
    if (!text) return;
    const isLink = /^https?:\/\//i.test(text);
    const { res, data } = await post({
      kind: isLink ? "link" : "text",
      body: isLink ? "" : text,
      linkUrl: isLink ? text : "",
    });
    if (!res.ok) {
      toast.error(data.error ?? "ارسال نشد.");
      return;
    }
    setBody("");
    void load(0);
  }

  return (
    <div className="flex h-full min-h-0 flex-col bg-[#0a1f1c]">
      <header className="flex items-center gap-3 border-b border-white/10 px-3 py-2.5">
        <button type="button" className="grid size-10 place-items-center text-emerald-100/80 md:hidden" onClick={onClose} aria-label="بازگشت">
          ‹
        </button>
        <span className="grid size-10 place-items-center rounded-full bg-sky-400 text-[#071614]">
          <Bookmark className="size-5" />
        </span>
        <div className="min-w-0 flex-1">
          <p className="truncate font-medium">پیام‌های ذخیره‌شده</p>
          <p className="text-[11px] text-emerald-100/50">فقط برای تو</p>
        </div>
      </header>
      <div ref={scroller} className="min-h-0 flex-1 space-y-2 overflow-auto px-3 py-4">
        {busy && items.length === 0 && <p className="py-10 text-center text-sm text-emerald-100/45">در حال بارگذاری…</p>}
        {error && (
          <p className="text-center text-sm text-rose-200">
            {error}{" "}
            <button type="button" className="text-amber-200" onClick={() => void load(0)}>
              تلاش دوباره
            </button>
          </p>
        )}
        {!busy && items.length === 0 && (
          <div className="px-6 py-16 text-center">
            <span className="mx-auto mb-3 grid size-16 place-items-center rounded-full bg-sky-400/20 text-sky-200">
              <Bookmark className="size-7" />
            </span>
            <p className="font-medium">پیام‌های ذخیره‌شده</p>
            <p className="mt-1 text-sm text-emerald-100/50">یادداشت‌ها و پیام‌هایی که برای خودت نگه می‌داری اینجا می‌مانند.</p>
          </div>
        )}
        {items
          .filter((i) => !i.inTrash)
          .map((item) => (
            <article key={item.id} className="ms-auto max-w-[85%] rounded-2xl rounded-es-md bg-[#1a4a43] px-3 py-2 text-sm shadow-sm">
              {item.source?.name && <p className="mb-1 text-[10px] text-amber-200/80">از {item.source.name}</p>}
              {item.body && <p className="whitespace-pre-wrap leading-6">{item.body}</p>}
              {item.linkUrl && (
                <a href={item.linkUrl} className="block text-sky-200 underline" target="_blank" rel="noreferrer noopener">
                  {item.linkHost || item.linkUrl}
                </a>
              )}
              {item.hasMedia && item.kind === "photo" && (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={item.mediaUrl} alt="" className="mt-1 max-h-56 rounded-lg" />
              )}
              {item.hasMedia && item.kind === "video" && <video src={item.mediaUrl} controls className="mt-1 max-h-48 w-full rounded-lg" />}
              {item.hasMedia && (item.kind === "voice" || item.kind === "audio") && <audio src={item.mediaUrl} controls className="mt-1 w-full" />}
              {item.fileName && <p className="text-[12px] text-emerald-100/70">{item.fileName}</p>}
              <div className="mt-1 flex items-center justify-end gap-2 text-[10px] text-emerald-100/45">
                {item.original.canOpen && item.source?.type === "chat" && onJumpChat && item.source.id && (
                  <button type="button" className="text-amber-200/80" onClick={() => onJumpChat(item.source!.id!, item.source!.messageId)}>
                    اصل پیام
                  </button>
                )}
                <span>{bubbleTime(item.createdAt)}</span>
              </div>
            </article>
          ))}
        {hasMore && (
          <Button type="button" variant="secondary" className="w-full" onClick={() => void load(offset)}>
            پیام‌های قدیمی‌تر
          </Button>
        )}
      </div>
      <form
        className="flex items-end gap-2 border-t border-white/10 p-3 pb-[max(0.75rem,env(safe-area-inset-bottom))]"
        onSubmit={(e) => {
          e.preventDefault();
          void send();
        }}
      >
        <textarea
          value={body}
          onChange={(e) => setBody(e.target.value)}
          placeholder="پیامی برای خودت بنویس…"
          rows={1}
          className="max-h-32 min-h-11 flex-1 resize-none rounded-2xl bg-white/10 px-3 py-2.5 text-sm outline-none placeholder:text-emerald-100/35"
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              void send();
            }
          }}
        />
        <button
          type="submit"
          disabled={!body.trim()}
          className="grid size-11 place-items-center rounded-full bg-amber-300 text-[#102824] disabled:opacity-40"
          aria-label="ارسال"
        >
          <Send className="size-4" />
        </button>
      </form>
    </div>
  );
}
