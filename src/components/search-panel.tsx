"use client";

import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { SEARCH_KINDS, type SearchHit, type SearchKind } from "@/lib/search-types";
import { searchLocalChats, type LocalThreadHint } from "@/lib/client-search";

const KIND_FA: Record<SearchKind, string> = {
  all: "همه",
  users: "کاربران",
  groups: "گروه‌ها",
  channels: "کانال‌ها",
  communities: "جامعه‌ها",
  messages: "پیام‌ها",
  photos: "عکس",
  videos: "ویدیو",
  files: "فایل",
  links: "لینک",
  voice: "صوت",
  music: "موسیقی",
  bots: "ربات‌ها",
};

export function SearchPanel({
  threads,
  initialQuery,
  onClose,
  onOpen,
}: {
  threads: LocalThreadHint[];
  initialQuery?: string;
  onClose: () => void;
  onOpen: (hit: SearchHit) => void;
}) {
  const [q, setQ] = useState(initialQuery ?? "");
  const [kind, setKind] = useState<SearchKind>("all");
  const [from, setFrom] = useState("");
  const [fromDate, setFromDate] = useState("");
  const [toDate, setToDate] = useState("");
  const [hits, setHits] = useState<SearchHit[]>([]);
  const [history, setHistory] = useState<string[]>([]);
  const [offset, setOffset] = useState(0);
  const [hasMore, setHasMore] = useState(false);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    fetch("/api/search?history=1", { cache: "no-store" })
      .then((r) => r.json())
      .then((d) => setHistory(d.history ?? []))
      .catch(() => undefined);
  }, []);

  async function run(nextOffset = 0, seed = q) {
    setBusy(true);
    try {
      const fromMs = fromDate ? new Date(fromDate).getTime() : undefined;
      const toMs = toDate ? new Date(toDate).getTime() + 86_400_000 - 1 : undefined;
      const params = new URLSearchParams({
        q: seed,
        kind,
        offset: String(nextOffset),
      });
      if (from.trim()) params.set("from", from.trim());
      if (fromMs) params.set("fromDate", String(fromMs));
      if (toMs) params.set("toDate", String(toMs));
      const res = await fetch(`/api/search?${params}`, { cache: "no-store" });
      const data = await res.json();
      if (!res.ok) {
        toast.error(data.error ?? "جستجو نشد.");
        return;
      }
      const remote = (data.hits ?? []) as SearchHit[];
      const local =
        kind === "users" || kind === "groups" || kind === "channels" || kind === "communities"
          ? []
          : await searchLocalChats(threads, seed, { kind, from: from.trim() || undefined, fromDate: fromMs, toDate: toMs });
      const merged = [...(nextOffset === 0 ? local : []), ...remote];
      const seen = new Set<string>();
      const unique = merged.filter((h) => {
        if (seen.has(h.id)) return false;
        seen.add(h.id);
        return true;
      });
      setHits((prev) => (nextOffset === 0 ? unique : [...prev, ...remote]));
      setHasMore(Boolean(data.hasMore));
      setOffset(data.nextOffset ?? nextOffset);
      setHistory(data.history ?? history);
      setNote(data.note ?? "");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 bg-black/70 p-3" onClick={onClose}>
      <div
        className="mx-auto flex max-h-[92dvh] max-w-lg flex-col overflow-hidden rounded-3xl bg-[#102824] p-4 text-emerald-50"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-semibold">جستجوی نیکسو</h2>
          <button type="button" className="text-sm text-amber-200" onClick={onClose}>
            بستن
          </button>
        </div>
        <form
          className="mt-3 flex gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            void run(0);
          }}
        >
          <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="کاربر، @username، گروه، پیام…" className="h-10 bg-black/20" />
          <Button type="submit" className="bg-amber-300 text-[#102824]" disabled={busy}>
            بجو
          </Button>
        </form>
        <div className="mt-2 flex flex-wrap gap-1">
          {SEARCH_KINDS.map((k) => (
            <button
              key={k}
              type="button"
              className={`rounded-full px-2 py-0.5 text-[11px] ${kind === k ? "bg-amber-300 text-[#102824]" : "bg-white/10"}`}
              onClick={() => setKind(k)}
            >
              {KIND_FA[k]}
            </button>
          ))}
        </div>
        <div className="mt-2 grid grid-cols-2 gap-2 text-[11px]">
          <Input value={from} onChange={(e) => setFrom(e.target.value)} placeholder="از طرف @username" dir="ltr" className="h-8 bg-black/20 text-left" />
          <span />
          <label className="flex items-center gap-1">
            از
            <input type="date" className="flex-1 rounded bg-black/30 px-1" value={fromDate} onChange={(e) => setFromDate(e.target.value)} />
          </label>
          <label className="flex items-center gap-1">
            تا
            <input type="date" className="flex-1 rounded bg-black/30 px-1" value={toDate} onChange={(e) => setToDate(e.target.value)} />
          </label>
        </div>
        {history.length > 0 && (
          <div className="mt-2">
            <div className="flex items-center justify-between text-[11px] text-emerald-100/60">
              <span>جستجوهای اخیر</span>
              <button
                type="button"
                onClick={async () => {
                  await fetch("/api/search", { method: "DELETE" });
                  setHistory([]);
                  toast.success("تاریخچه پاک شد.");
                }}
              >
                Clear Search History
              </button>
            </div>
            <div className="mt-1 flex flex-wrap gap-1">
              {history.map((h) => (
                <button
                  key={h}
                  type="button"
                  className="rounded-full bg-white/10 px-2 py-0.5 text-[11px]"
                  onClick={() => {
                    setQ(h);
                    void run(0, h);
                  }}
                >
                  {h}
                </button>
              ))}
            </div>
          </div>
        )}
        <p className="mt-2 text-[10px] leading-5 text-emerald-100/50">
          فقط چیزهایی که اجازهٔ دیدنشان را داری. متن چت خصوصی روی دستگاه است، نه روی سرور. {note}
        </p>
        <div className="mt-2 min-h-0 flex-1 space-y-1 overflow-auto">
          {hits.length === 0 && !busy && <p className="text-xs text-emerald-100/50">نتیجه‌ای نیست.</p>}
          {hits.map((hit) => (
            <button
              key={hit.id}
              type="button"
              className="block w-full rounded-xl bg-black/25 px-3 py-2 text-right"
              onClick={() => onOpen(hit)}
            >
              <p className="text-sm font-medium">{hit.title}</p>
              <p className="truncate text-xs text-emerald-100/70">{hit.preview}</p>
              <p className="text-[10px] text-emerald-100/45">
                {hit.sender ? `${hit.sender} · ` : ""}
                {hit.chatName} · {new Date(hit.date).toLocaleDateString("fa-IR")}
              </p>
            </button>
          ))}
          {hasMore && (
            <Button type="button" variant="secondary" className="w-full" disabled={busy} onClick={() => void run(offset)}>
              نتایج بیشتر
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}
