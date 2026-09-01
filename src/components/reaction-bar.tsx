"use client";

import { useState } from "react";
import { DEFAULT_REACTIONS } from "@/lib/emoji-data";
import { cn } from "@/lib/utils";

export type PublicReaction = {
  emoji: string;
  count?: number;
  mine?: boolean;
  keys?: string[];
  users?: { username: string; visible?: boolean }[];
};

function countOf(r: PublicReaction) {
  return r.count ?? r.keys?.length ?? 0;
}

export function ReactionBar({
  reactions,
  allowed,
  disabled,
  failed,
  onPick,
  onRetry,
}: {
  reactions: PublicReaction[] | undefined;
  allowed?: string[] | null;
  disabled?: boolean;
  failed?: boolean;
  onPick: (emoji: string) => void;
  onRetry?: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [usersFor, setUsersFor] = useState<string | null>(null);
  const set = allowed && allowed.length ? allowed : [...DEFAULT_REACTIONS];
  const list = reactions ?? [];

  return (
    <div className="mt-1 space-y-1">
      <div className="flex flex-wrap items-center gap-1 text-[11px]">
        {list.map((r) => (
          <button
            key={r.emoji}
            type="button"
            disabled={disabled}
            className={cn("rounded-full px-1.5 py-0.5", r.mine ? "bg-amber-300/90 text-[#102824]" : "bg-white/10")}
            aria-label={`Reaction ${r.emoji} ${countOf(r)}`}
            onClick={() => onPick(r.emoji)}
            onContextMenu={(e) => {
              e.preventDefault();
              setUsersFor(r.emoji);
            }}
          >
            {r.emoji}
            {countOf(r) || ""}
          </button>
        ))}
        {!disabled && (
          <button type="button" className="rounded-full bg-white/10 px-2" aria-label="Add reaction" onClick={() => setOpen((v) => !v)}>
            +
          </button>
        )}
        {failed && (
          <button type="button" className="text-rose-200" onClick={onRetry}>
            Retry
          </button>
        )}
      </div>
      {open && (
        <div className="flex flex-wrap gap-1 rounded-xl bg-black/40 p-2" role="listbox" aria-label="Reaction picker">
          {set.map((e) => (
            <button key={e} type="button" className="text-lg" aria-label={e} onClick={() => { onPick(e); setOpen(false); }}>
              {e}
            </button>
          ))}
        </div>
      )}
      {usersFor && (
        <p className="text-[10px] text-emerald-100/60">
          {(list.find((r) => r.emoji === usersFor)?.users ?? []).map((u) => u.username).join("، ") || "نام‌ها طبق حریم پنهان است."}
        </p>
      )}
    </div>
  );
}
