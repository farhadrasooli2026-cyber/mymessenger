"use client";

import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

type Sticker = {
  id: string;
  packId: string;
  name: string;
  emoji: string;
  kind: string;
  url: string;
  favorite?: boolean;
};

type Pack = {
  id: string;
  name: string;
  official: boolean;
  owner: boolean;
  privacy: string;
  shareToken: string | null;
  stickers: Sticker[];
};

export function StickerPicker({
  onSend,
  draft,
}: {
  onSend: (stickerId: string) => Promise<void> | void;
  draft?: string;
}) {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [q, setQ] = useState("");
  const [packs, setPacks] = useState<Pack[]>([]);
  const [recent, setRecent] = useState<(Sticker | null)[]>([]);
  const [favorites, setFavorites] = useState<(Sticker | null)[]>([]);
  const [suggestions, setSuggestions] = useState<(Sticker | null)[]>([]);
  const [search, setSearch] = useState<(Sticker | null)[] | null>(null);
  const [packId, setPackId] = useState<string>("");
  const [preview, setPreview] = useState<Sticker | null>(null);

  async function load(query = q) {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams();
      if (query.trim()) params.set("q", query.trim());
      if (draft?.trim()) params.set("suggest", draft.trim().slice(0, 24));
      const res = await fetch(`/api/stickers?${params}`, { cache: "no-store" });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "بارگذاری نشد.");
      setPacks(data.packs ?? []);
      setRecent(data.recent ?? []);
      setFavorites(data.favorites ?? []);
      setSuggestions(data.suggestions ?? []);
      setSearch(data.search);
      if (!packId && data.packs?.[0]) setPackId(data.packs[0].id);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Network Error");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    let cancelled = false;
    fetch("/api/stickers", { cache: "no-store" })
      .then((res) => res.json().then((data) => ({ res, data })))
      .then(({ res, data }) => {
        if (cancelled) return;
        if (!res.ok) throw new Error(data.error ?? "بارگذاری نشد.");
        setPacks(data.packs ?? []);
        setRecent(data.recent ?? []);
        setFavorites(data.favorites ?? []);
        setSuggestions(data.suggestions ?? []);
        setSearch(data.search);
        setPackId((id) => id || data.packs?.[0]?.id || "");
      })
      .catch((e) => {
        if (!cancelled) setError(e instanceof Error ? e.message : "Network Error");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const active = packs.find((p) => p.id === packId) ?? packs[0];
  const grid = useMemo(() => {
    if (search) return search.filter(Boolean) as Sticker[];
    return (active?.stickers ?? []).filter(Boolean) as Sticker[];
  }, [search, active]);

  return (
    <div className="rounded-2xl border border-white/10 bg-[#0b1f1c] p-3 text-emerald-50" role="dialog" aria-label="Sticker picker">
      <div className="mb-2 flex gap-2">
        <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search stickers" aria-label="Search stickers" className="h-9 bg-black/30" />
        <Button type="button" size="sm" variant="secondary" onClick={() => void load(q)}>
          Search
        </Button>
      </div>
      {loading && <p className="py-6 text-center text-sm text-emerald-100/60">Loading…</p>}
      {error && (
        <div className="space-y-2 py-4 text-center text-sm">
          <p>{error}</p>
          <Button type="button" size="sm" onClick={() => void load(q)}>
            Retry
          </Button>
        </div>
      )}
      {!loading && !error && (
        <>
          {suggestions.filter(Boolean).length > 0 && (
            <div className="mb-2">
              <p className="text-[11px] text-emerald-100/60">Suggestions</p>
              <div className="flex gap-2 overflow-x-auto">
                {suggestions.filter(Boolean).map((s) => (
                  <button key={s!.id} type="button" onClick={() => setPreview(s!)}>
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={s!.url} alt={s!.name} className="h-12 w-12" />
                  </button>
                ))}
              </div>
            </div>
          )}
          <div className="mb-2 flex gap-1 overflow-x-auto text-[11px]">
            <button type="button" className="rounded-full bg-white/10 px-2 py-1" onClick={() => { setPackId(""); setSearch(null); }}>
              Recent
            </button>
            {packs.map((p) => (
              <button
                key={p.id}
                type="button"
                className={`whitespace-nowrap rounded-full px-2 py-1 ${packId === p.id ? "bg-amber-300 text-[#102824]" : "bg-white/10"}`}
                onClick={() => {
                  setPackId(p.id);
                  setSearch(null);
                }}
              >
                {p.name}
              </button>
            ))}
          </div>
          <div className="grid max-h-48 grid-cols-4 gap-2 overflow-y-auto">
            {(packId === "" && !search ? (recent.filter(Boolean) as Sticker[]) : grid).length === 0 ? (
              <p className="col-span-4 py-6 text-center text-sm text-emerald-100/60">No results found</p>
            ) : (
              (packId === "" && !search ? (recent.filter(Boolean) as Sticker[]) : grid).map((s) => (
                <button key={s.id} type="button" className="rounded-xl bg-black/20 p-1" onClick={() => setPreview(s)} aria-label={s.name}>
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={s.url} alt={s.name} className="mx-auto h-14 w-14" loading="lazy" />
                </button>
              ))
            )}
          </div>
          {favorites.filter(Boolean).length > 0 && (
            <p className="mt-2 text-[11px] text-emerald-100/55">{favorites.filter(Boolean).length} favorites</p>
          )}
        </>
      )}
      {preview && (
        <div className="mt-3 rounded-xl bg-black/30 p-3 text-center">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={preview.url} alt={preview.name} className="mx-auto h-24 w-24" />
          <p className="mt-1 text-sm">{preview.name}</p>
          <div className="mt-2 flex justify-center gap-2">
            <Button
              type="button"
              size="sm"
              onClick={async () => {
                await onSend(preview.id);
                setPreview(null);
              }}
            >
              Send
            </Button>
            <Button
              type="button"
              size="sm"
              variant="secondary"
              onClick={async () => {
                await fetch("/api/stickers", {
                  method: "POST",
                  headers: { "Content-Type": "application/json" },
                  body: JSON.stringify({ action: "favoriteSticker", stickerId: preview.id }),
                });
                toast.success("Favorite به‌روز شد.");
                void load(q);
              }}
            >
              Favorite
            </Button>
            <Button type="button" size="sm" variant="ghost" onClick={() => setPreview(null)}>
              Close
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
