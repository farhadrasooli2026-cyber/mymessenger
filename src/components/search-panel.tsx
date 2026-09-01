"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { SEARCH_KINDS, SEARCH_PRIMARY_TABS, type SearchHit, type SearchKind } from "@/lib/search-types";
import { searchLocalChats, type LocalThreadHint } from "@/lib/client-search";
import { highlightText } from "@/lib/search-match";

const KIND_FA: Record<SearchKind, string> = {
  all: "همه",
  people: "افراد",
  users: "کاربران",
  friends: "دوستان",
  chats: "چت‌ها",
  messages: "پیام‌ها",
  groups: "گروه‌ها",
  channels: "کانال‌ها",
  communities: "جامعه‌ها",
  bots: "ربات‌ها",
  mini: "مینی‌اپ",
  business: "کسب‌وکار",
  products: "محصولات",
  files: "فایل",
  media: "رسانه",
  photos: "عکس",
  videos: "ویدیو",
  gifs: "GIF",
  voice: "صوت",
  music: "موسیقی",
  links: "لینک",
  live: "لایو",
  hashtags: "هشتگ",
  mentions: "منشن",
  stickers: "استیکر",
  emoji: "ایموجی",
  highlights: "هایلایت",
  members: "اعضا",
  subscribers: "مشترک‌ها",
  posts: "پست‌ها",
  stories: "استوری",
  images: "تصویر",
  audio: "صوت",
};

export function SearchPanel({
  threads,
  initialQuery,
  onClose,
  onOpen,
  chatId,
}: {
  threads: LocalThreadHint[];
  initialQuery?: string;
  onClose: () => void;
  onOpen: (hit: SearchHit) => void;
  chatId?: string | null;
}) {
  const router = useRouter();
  const [q, setQ] = useState(initialQuery ?? "");
  const [kind, setKind] = useState<SearchKind>("all");
  const [from, setFrom] = useState("");
  const [fromDate, setFromDate] = useState("");
  const [toDate, setToDate] = useState("");
  const [minPrice, setMinPrice] = useState("");
  const [maxPrice, setMaxPrice] = useState("");
  const [category, setCategory] = useState("");
  const [sort, setSort] = useState("relevance");
  const [fileType, setFileType] = useState("");
  const [groupId, setGroupId] = useState("");
  const [channelId, setChannelId] = useState("");
  const [exact, setExact] = useState(false);
  const [scopeChat, setScopeChat] = useState(false);
  const [feed, setFeed] = useState<"" | "discovery" | "trending">("");
  const [hints, setHints] = useState<string[]>([]);
  const [hits, setHits] = useState<SearchHit[]>([]);
  const [history, setHistory] = useState<string[]>([]);
  const [suggestions, setSuggestions] = useState<string[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [hasMore, setHasMore] = useState(false);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    const t = window.setTimeout(() => {
      fetch("/api/search?history=1", { cache: "no-store" })
        .then((r) => r.json())
        .then((d) => setHistory(d.history ?? []))
        .catch(() => undefined);
    }, 0);
    return () => window.clearTimeout(t);
  }, []);

  useEffect(() => {
    const t = window.setTimeout(() => {
      if (q.trim().length < 2) {
        setSuggestions([]);
        return;
      }
      fetch(`/api/search?suggest=1&q=${encodeURIComponent(q)}`, { cache: "no-store" })
        .then((r) => r.json())
        .then((d) => setSuggestions(d.suggestions ?? []))
        .catch(() => undefined);
    }, 180);
    return () => window.clearTimeout(t);
  }, [q]);

  useEffect(() => {
    const t = window.setTimeout(() => {
      if (q.trim().length < 2 && !feed) return;
      void run(0, q, true);
    }, 220);
    return () => window.clearTimeout(t);
    // live debounce; submit still records history
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [q, kind, sort, feed]);

  async function run(nextOffset = 0, seed = q, live = false, nextCursor?: string | null) {
    abortRef.current?.abort();
    const ac = new AbortController();
    abortRef.current = ac;
    setBusy(true);
    setError(null);
    try {
      const fromMs = fromDate ? new Date(fromDate).getTime() : undefined;
      const toMs = toDate ? new Date(toDate).getTime() + 86_400_000 - 1 : undefined;
      const params = new URLSearchParams({
        q: seed,
        kind,
        offset: String(nextOffset),
        sort,
      });
      if (from.trim()) params.set("from", from.trim());
      if (fromMs) params.set("fromDate", String(fromMs));
      if (toMs) params.set("toDate", String(toMs));
      if (minPrice) params.set("minPrice", minPrice);
      if (maxPrice) params.set("maxPrice", maxPrice);
      if (category.trim()) params.set("category", category.trim());
      if (fileType.trim()) params.set("fileType", fileType.trim());
      if (groupId.trim()) params.set("groupId", groupId.trim());
      if (channelId.trim()) params.set("channelId", channelId.trim());
      if (exact) params.set("exact", "1");
      if (scopeChat && chatId) params.set("chatId", chatId);
      if (feed) {
        params.set("feed", feed);
        params.set("historyWrite", "0");
      }
      if (live) params.set("historyWrite", "0");
      if (nextCursor) params.set("cursor", nextCursor);
      const res = await fetch(`/api/search?${params}`, { cache: "no-store", signal: ac.signal });
      const data = await res.json().catch(() => null);
      if (!res.ok || !data) {
        setError(data?.error ?? (res.status >= 500 ? "Server Error" : "Network Error"));
        toast.error(data?.error ?? "جستجو نشد.");
        return;
      }
      const remote = (data.hits ?? []) as SearchHit[];
      const local =
        kind === "users" ||
        kind === "people" ||
        kind === "groups" ||
        kind === "channels" ||
        kind === "communities" ||
        kind === "bots" ||
        kind === "business" ||
        kind === "products" ||
        kind === "mini"
          ? []
          : await searchLocalChats(threads, seed, {
              kind,
              from: from.trim() || undefined,
              fromDate: fromMs,
              toDate: toMs,
              chatId: scopeChat && chatId ? chatId : undefined,
              exact,
            });
      const merged = [...(nextOffset === 0 ? local : []), ...remote];
      const seen = new Set<string>();
      const unique = merged.filter((h) => {
        if (seen.has(h.id)) return false;
        seen.add(h.id);
        return true;
      });
      setHits((prev) => (nextOffset === 0 && !nextCursor ? unique : [...prev, ...remote]));
      setHasMore(Boolean(data.hasMore));
      setCursor(data.nextCursor ?? null);
      setHistory(data.history ?? history);
      setSuggestions(data.suggestions ?? suggestions);
      setNote(data.note ?? "");
      setHints(data.noResultHints ?? []);
    } catch (err) {
      if ((err as { name?: string }).name === "AbortError") return;
      setError("Network Error / Timeout");
      toast.error("جستجو قطع شد.");
    } finally {
      setBusy(false);
    }
  }

  async function openHit(hit: SearchHit) {
    const res = await fetch(`/api/search/open?id=${encodeURIComponent(hit.id)}`, { cache: "no-store" });
    const data = await res.json().catch(() => null);
    if (!res.ok) {
      toast.error("این نتیجه در دسترس تو نیست.");
      return;
    }
    onOpen({ ...hit, target: data.target ?? hit.target });
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
          <Input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder='from:@user  has:link  in:username  "عبارت دقیق"  #هشتگ'
            className="h-10 bg-black/20"
            enterKeyHint="search"
            inputMode="search"
            autoComplete="off"
          />
          <Button type="submit" className="bg-amber-300 text-[#102824]" disabled={busy}>
            {busy ? "…" : "بجو"}
          </Button>
          {busy && (
            <Button
              type="button"
              variant="secondary"
              onClick={() => {
                abortRef.current?.abort();
                setBusy(false);
              }}
            >
              توقف
            </Button>
          )}
        </form>
        {suggestions.length > 0 && (
          <div className="mt-1 flex flex-wrap gap-1">
            {suggestions.map((s) => (
              <button
                key={s}
                type="button"
                className="rounded-full bg-amber-300/15 px-2 py-0.5 text-[11px] text-amber-100"
                onClick={() => {
                  setQ(s);
                  void run(0, s);
                }}
              >
                {s}
              </button>
            ))}
          </div>
        )}
        <div className="mt-2 flex flex-wrap gap-1">
          {(["", "discovery", "trending"] as const).map((f) => (
            <button
              key={f || "search"}
              type="button"
              className={`rounded-full px-2 py-0.5 text-[11px] ${feed === f ? "bg-amber-300 text-[#102824]" : "bg-white/10"}`}
              onClick={() => {
                setFeed(f);
                if (f) void run(0, q || "nixo");
              }}
            >
              {f === "" ? "جستجو" : f === "discovery" ? "Discovery" : "Trending"}
            </button>
          ))}
        </div>
        <div className="mt-2 flex flex-wrap gap-1">
          {SEARCH_PRIMARY_TABS.map((k) => (
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
        <div className="mt-1 flex flex-wrap gap-1">
          {SEARCH_KINDS.filter((k) => !(SEARCH_PRIMARY_TABS as readonly string[]).includes(k)).map((k) => (
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
          <Input value={from} onChange={(e) => setFrom(e.target.value)} placeholder="From User / @username" dir="ltr" className="h-8 bg-black/20 text-left" />
          <select
            className="h-8 rounded-md bg-black/30 px-2 text-[11px]"
            value={sort}
            onChange={(e) => setSort(e.target.value)}
            aria-label="مرتب‌سازی"
          >
            <option value="relevance">Relevance</option>
            <option value="newest">Newest</option>
            <option value="oldest">Oldest</option>
            <option value="popular">Popular</option>
          </select>
          <Input value={category} onChange={(e) => setCategory(e.target.value)} placeholder="Category محصول" className="h-8 bg-black/20" />
          <Input value={fileType} onChange={(e) => setFileType(e.target.value)} placeholder="File type (pdf, zip…)" dir="ltr" className="h-8 bg-black/20 text-left" />
          <Input value={groupId} onChange={(e) => setGroupId(e.target.value)} placeholder="Group ID" dir="ltr" className="h-8 bg-black/20 text-left" />
          <Input value={channelId} onChange={(e) => setChannelId(e.target.value)} placeholder="Channel ID" dir="ltr" className="h-8 bg-black/20 text-left" />
          <label className="flex items-center gap-1">
            From
            <input type="date" className="flex-1 rounded bg-black/30 px-1" value={fromDate} onChange={(e) => setFromDate(e.target.value)} />
          </label>
          <label className="flex items-center gap-1">
            To
            <input type="date" className="flex-1 rounded bg-black/30 px-1" value={toDate} onChange={(e) => setToDate(e.target.value)} />
          </label>
          {(kind === "products" || kind === "all") && (
            <>
              <Input value={minPrice} onChange={(e) => setMinPrice(e.target.value)} placeholder="Min price" className="h-8 bg-black/20" />
              <Input value={maxPrice} onChange={(e) => setMaxPrice(e.target.value)} placeholder="Max price" className="h-8 bg-black/20" />
            </>
          )}
          <label className="col-span-2 flex items-center gap-2 text-[11px] text-emerald-100/70">
            <input type="checkbox" checked={exact} onChange={(e) => setExact(e.target.checked)} />
            Exact Search
          </label>
          {chatId ? (
            <label className="col-span-2 flex items-center gap-2 text-[11px] text-emerald-100/70">
              <input type="checkbox" checked={scopeChat} onChange={(e) => setScopeChat(e.target.checked)} />
              فقط همین گفتگو
            </label>
          ) : null}
        </div>
        <p className="mt-1 text-[10px] leading-4 text-emerald-100/45">
          عملگرها: from:@user · in:username · after:2026-01-01 · has:link|file|media · minsize:10kb. Query خالی تاریخچه و Discovery را نشان می‌دهد نه فهرست همهٔ کاربران.
        </p>
        {history.length > 0 && (
          <div className="mt-2">
            <div className="flex items-center justify-between text-[11px] text-emerald-100/60">
              <span>Recent Searches</span>
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
              <button
                type="button"
                className="text-amber-200"
                onClick={async () => {
                  const res = await fetch("/api/search?export=1", { cache: "no-store" });
                  const data = await res.json();
                  if (!res.ok) {
                    toast.error("خروجی گرفته نشد.");
                    return;
                  }
                  const blob = new Blob([JSON.stringify(data.export, null, 2)], { type: "application/json" });
                  const a = document.createElement("a");
                  a.href = URL.createObjectURL(blob);
                  a.download = "nixo-search-history.json";
                  a.click();
                }}
              >
                خروجی تاریخچه
              </button>
            </div>
            <div className="mt-1 flex flex-wrap gap-1">
              {history.map((h) => (
                <span key={h} className="inline-flex items-center gap-1 rounded-full bg-white/10 px-2 py-0.5 text-[11px]">
                  <button
                    type="button"
                    onClick={() => {
                      setQ(h);
                      void run(0, h);
                    }}
                  >
                    {h}
                  </button>
                  <button
                    type="button"
                    className="text-rose-200"
                    aria-label="حذف"
                    onClick={async () => {
                      const res = await fetch(`/api/search?item=${encodeURIComponent(h)}`, { method: "DELETE" });
                      const data = await res.json();
                      setHistory(data.history ?? history.filter((x) => x !== h));
                    }}
                  >
                    ×
                  </button>
                </span>
              ))}
            </div>
          </div>
        )}
        <p className="mt-2 text-[10px] leading-5 text-emerald-100/50">
          فقط چیزهایی که اجازهٔ دیدنشان را داری. متن چت خصوصی و گروه E2EE روی دستگاه است. {note}
        </p>
        <div
          className="mt-2 min-h-0 flex-1 space-y-1 overflow-auto"
          onScroll={(e) => {
            const el = e.currentTarget;
            if (hasMore && !busy && el.scrollTop + el.clientHeight >= el.scrollHeight - 48) {
              void run(0, q, true, cursor);
            }
          }}
        >
          {busy && <p className="text-xs text-amber-200">Loading…</p>}
          {error && <p className="text-xs text-rose-200">{error}</p>}
          {hits.length === 0 && !busy && !error && (
            <div>
              <p className="text-xs text-emerald-100/50">No results found</p>
              {hints.length > 0 && (
                <div className="mt-1 flex flex-wrap gap-1">
                  {hints.map((h) => (
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
              )}
            </div>
          )}
              {(["user", "chat", "group", "channel", "community", "bot", "mini", "business", "live"] as const).map((scope) => {
            const group = hits.filter((h) => h.scope === scope || (scope === "chat" && h.scope === "chatLocal"));
            if (!group.length) return null;
            const label =
              scope === "user"
                ? "People"
                : scope === "chat"
                  ? "Chats"
                  : scope === "group"
                    ? "Groups"
                    : scope === "channel"
                      ? "Channels"
                      : scope === "bot"
                        ? "Bots"
                        : scope === "mini"
                          ? "Mini Apps"
                          : scope;
            return (
              <div key={scope}>
                <p className="mt-2 text-[10px] uppercase tracking-wide text-emerald-100/40">{label}</p>
                {group.map((hit) => (
                  <div key={hit.id} className="mt-1 rounded-xl bg-black/25 px-3 py-2">
                    <button type="button" className="block w-full text-right" onClick={() => void openHit(hit)}>
                      {hit.photoUrl || hit.kind === "photo" || hit.kind === "gif" ? (
                        <span className="mb-1 inline-block h-10 w-10 overflow-hidden rounded-lg bg-black/40 text-[10px] leading-10 text-center">
                          {hit.photoUrl ? (
                            // eslint-disable-next-line @next/next/no-img-element
                            <img src={hit.photoUrl} alt="" className="h-10 w-10 object-cover" />
                          ) : (
                            "رسانه"
                          )}
                        </span>
                      ) : null}
                      <p className="text-sm font-medium">
                        {highlightText(hit.title, q).map((p, i) => (
                          <span key={i} className={p.hit ? "bg-amber-300/50 text-[#102824]" : undefined}>
                            {p.t}
                          </span>
                        ))}
                        {hit.verified ? <span className="mr-1 text-amber-200"> ✓</span> : null}
                      </p>
                      <p className="truncate text-xs text-emerald-100/70">
                        {highlightText(hit.preview, q).map((p, i) => (
                          <span key={`p${i}`} className={p.hit ? "bg-amber-300/40" : undefined}>
                            {p.t}
                          </span>
                        ))}
                      </p>
                      {hit.fileName ? (
                        <p className="truncate text-[10px] text-emerald-100/50">
                          {hit.fileKind ?? "file"} · {hit.fileName}
                        </p>
                      ) : null}
                    </button>
                    {hit.chatName === "Discovery" || hit.chatName === "Trending" ? (
                      <button
                        type="button"
                        className="mt-1 text-[10px] text-rose-200"
                        onClick={() =>
                          void fetch("/api/search", {
                            method: "POST",
                            headers: { "Content-Type": "application/json" },
                            body: JSON.stringify({ action: "hide", id: hit.target.id }),
                          }).then(() => {
                            setHits((prev) => prev.filter((h) => h.target.id !== hit.target.id));
                            toast.success("از پیشنهادها حذف شد.");
                          })
                        }
                      >
                        پیشنهاد نشود
                      </button>
                    ) : null}
                    {hit.target.type === "user" && (
                      <div className="mt-1 flex flex-wrap gap-1 text-[10px]">
                        <button
                          type="button"
                          className="rounded bg-white/10 px-2 py-0.5"
                          onClick={() => {
                            if (hit.username) router.push(`/app/u/${hit.username}`);
                            else onOpen(hit);
                          }}
                        >
                          Open Profile
                        </button>
                        <button type="button" className="rounded bg-white/10 px-2 py-0.5" onClick={() => void openHit(hit)}>
                          Message
                        </button>
                        <button
                          type="button"
                          className="rounded bg-white/10 px-2 py-0.5"
                          onClick={() =>
                            void fetch("/api/users/search", {
                              method: "POST",
                              headers: { "Content-Type": "application/json" },
                              body: JSON.stringify({ userId: hit.target.id }),
                            }).then(() => toast.success("به مخاطبین اضافه شد."))
                          }
                        >
                          Add Contact
                        </button>
                        <button
                          type="button"
                          className="rounded bg-white/10 px-2 py-0.5"
                          onClick={() =>
                            void fetch("/api/contacts", {
                              method: "POST",
                              headers: { "Content-Type": "application/json" },
                              body: JSON.stringify({ action: "block", peerKey: hit.target.id, blocked: true }),
                            }).then(() => toast.success("مسدود شد."))
                          }
                        >
                          Block
                        </button>
                        <button
                          type="button"
                          className="rounded bg-white/10 px-2 py-0.5"
                          onClick={() =>
                            void fetch("/api/contacts", {
                              method: "POST",
                              headers: { "Content-Type": "application/json" },
                              body: JSON.stringify({ action: "report", peerKey: hit.target.id, category: "spam" }),
                            }).then(() => toast.success("گزارش ارسال شد."))
                          }
                        >
                          Report
                        </button>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            );
          })}
          {hits
            .filter((h) => !["user", "chat", "chatLocal", "group", "channel", "community", "bot", "mini", "business"].includes(h.scope))
            .map((hit) => (
              <button
                key={hit.id}
                type="button"
                className="block w-full rounded-xl bg-black/25 px-3 py-2 text-right"
                onClick={() => void openHit(hit)}
              >
                <p className="text-sm font-medium">
                  {highlightText(hit.title, q).map((p, i) => (
                    <span key={i} className={p.hit ? "bg-amber-300/50 text-[#102824]" : undefined}>
                      {p.t}
                    </span>
                  ))}
                </p>
                <p className="truncate text-xs text-emerald-100/70">
                  {highlightText(hit.preview, q).map((p, i) => (
                    <span key={`m${i}`} className={p.hit ? "bg-amber-300/40" : undefined}>
                      {p.t}
                    </span>
                  ))}
                </p>
                {hit.fileName ? <p className="text-[10px] text-emerald-100/50">{hit.fileName}</p> : null}
              </button>
            ))}
          {hasMore && (
            <Button type="button" variant="secondary" className="w-full" disabled={busy} onClick={() => void run(0, q, true, cursor)}>
              نتایج بیشتر
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}
