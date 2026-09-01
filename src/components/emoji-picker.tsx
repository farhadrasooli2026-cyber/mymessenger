"use client";

import { useMemo, useState } from "react";
import { EMOJI_CATEGORIES, searchEmoji } from "@/lib/emoji-data";
import { cn } from "@/lib/utils";

type Prefs = { emojiRecent?: string[]; emojiFavorites?: string[] };

export function EmojiPicker({
  recent,
  favorites,
  onPick,
  onFavorite,
}: {
  recent?: string[];
  favorites?: string[];
  onPick: (emoji: string) => void;
  onFavorite?: (emoji: string, next: boolean) => void;
  prefs?: Prefs;
}) {
  const [q, setQ] = useState("");
  const [cat, setCat] = useState("smileys");
  const results = useMemo(() => (q.trim() ? searchEmoji(q) : EMOJI_CATEGORIES.find((c) => c.id === cat)?.items ?? []), [q, cat]);

  return (
    <div className="rounded-2xl border border-white/10 bg-[#0b1f1c] p-3 text-emerald-50" role="dialog" aria-label="Emoji picker">
      <input
        value={q}
        onChange={(e) => setQ(e.target.value)}
        placeholder="Search emoji"
        aria-label="Search emoji"
        className="mb-2 h-9 w-full rounded-lg bg-black/30 px-3 text-sm"
      />
      <div className="mb-2 flex flex-wrap gap-1 text-[11px]">
        {EMOJI_CATEGORIES.map((c) => (
          <button
            key={c.id}
            type="button"
            className={cn("rounded-full px-2 py-1", cat === c.id && !q ? "bg-amber-300 text-[#102824]" : "bg-white/10")}
            onClick={() => {
              setCat(c.id);
              setQ("");
            }}
          >
            {c.label}
          </button>
        ))}
      </div>
      {!q && (recent?.length || favorites?.length) ? (
        <div className="mb-2 space-y-1">
          {favorites && favorites.length > 0 && (
            <p className="text-[11px] text-emerald-100/60">Favorites</p>
          )}
          <div className="flex flex-wrap gap-1">
            {(favorites ?? []).map((e) => (
              <button key={`f-${e}`} type="button" className="text-xl" aria-label={`Favorite ${e}`} onClick={() => onPick(e)}>
                {e}
              </button>
            ))}
          </div>
          {recent && recent.length > 0 && <p className="text-[11px] text-emerald-100/60">Recently used</p>}
          <div className="flex flex-wrap gap-1">
            {(recent ?? []).map((e) => (
              <button key={`r-${e}`} type="button" className="text-xl" aria-label={`Recent ${e}`} onClick={() => onPick(e)}>
                {e}
              </button>
            ))}
          </div>
        </div>
      ) : null}
      <div className="grid max-h-48 grid-cols-8 gap-1 overflow-y-auto">
        {results.length === 0 ? (
          <p className="col-span-8 py-6 text-center text-sm text-emerald-100/60">No results found</p>
        ) : (
          results.map((item) => (
            <button
              key={item.e + item.n}
              type="button"
              className="rounded p-1 text-xl hover:bg-white/10"
              aria-label={item.n}
              title={item.n}
              onClick={() => onPick(item.e)}
              onContextMenu={(ev) => {
                ev.preventDefault();
                onFavorite?.(item.e, !(favorites ?? []).includes(item.e));
              }}
            >
              {item.e}
            </button>
          ))
        )}
      </div>
    </div>
  );
}
