"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { ChevronDown, Search } from "lucide-react";
import {
  DIAL_COUNTRIES,
  POPULAR_DIAL_ISOS,
  flagEmoji,
  getDialCountry,
  searchDialCountries,
  type DialCountry,
} from "@/lib/dial-codes";
import { cn } from "@/lib/utils";

export function CountryCodeSelect({
  iso,
  onChange,
  disabled,
}: {
  iso: string;
  onChange: (iso: string) => void;
  disabled?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const rootRef = useRef<HTMLDivElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const selected = getDialCountry(iso) ?? getDialCountry("IR")!;

  const list = useMemo(() => {
    const found = searchDialCountries(query);
    if (query.trim()) return found;
    const popular = POPULAR_DIAL_ISOS.map((id) => getDialCountry(id)).filter(Boolean) as DialCountry[];
    const rest = DIAL_COUNTRIES.filter((c) => !POPULAR_DIAL_ISOS.includes(c.iso as (typeof POPULAR_DIAL_ISOS)[number]));
    const seen = new Set<string>();
    return [...popular, ...rest].filter((c) => {
      if (seen.has(c.iso)) return false;
      seen.add(c.iso);
      return true;
    });
  }, [query]);

  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onDoc);
    const t = window.setTimeout(() => searchRef.current?.focus(), 40);
    return () => {
      document.removeEventListener("mousedown", onDoc);
      window.clearTimeout(t);
    };
  }, [open]);

  return (
    <div ref={rootRef} className="relative shrink-0">
      <button
        type="button"
        disabled={disabled}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label="انتخاب پیش‌شماره کشور"
        onClick={() => {
          setOpen((v) => !v);
          setQuery("");
        }}
        className={cn(
          "flex h-12 min-w-[7.25rem] items-center justify-between gap-1 rounded-2xl border border-sky-400/30 bg-[#050a12] px-2.5 text-sm text-white",
          "hover:border-cyan-400/60 focus-visible:border-cyan-400/70 focus-visible:ring-2 focus-visible:ring-cyan-400/30",
          disabled && "opacity-60",
        )}
      >
        <span className="flex items-center gap-1.5 whitespace-nowrap" dir="ltr">
          <span aria-hidden="true">{flagEmoji(selected.iso)}</span>
          <span className="font-medium text-cyan-100">+{selected.dial}</span>
        </span>
        <ChevronDown className={cn("size-4 text-cyan-300/80 transition", open && "rotate-180")} />
      </button>
      {open && (
        <div
          className="absolute start-0 z-30 mt-2 w-[min(calc(100vw-2.5rem),20rem)] overflow-hidden rounded-2xl border border-sky-400/30 bg-[#070d18]/95 shadow-[0_0_28px_rgba(34,211,238,0.16)] backdrop-blur-xl"
          role="listbox"
        >
          <div className="relative border-b border-white/10 p-2">
            <Search className="pointer-events-none absolute top-1/2 start-4 size-4 -translate-y-1/2 text-cyan-300/70" />
            <input
              ref={searchRef}
              dir="auto"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="جستجوی کشور، Turkey، ترکیه…"
              className="h-10 w-full rounded-xl border border-sky-400/20 bg-[#050a12] pe-3 ps-9 text-sm text-white placeholder:text-slate-500 outline-none focus:border-cyan-400/50"
            />
          </div>
          <ul className="max-h-[min(50vh,18rem)] overflow-y-auto p-1">
            {list.length === 0 ? (
              <li className="px-3 py-4 text-center text-xs text-slate-400">کشوری پیدا نشد</li>
            ) : (
              list.map((c) => (
                <li key={c.iso}>
                  <button
                    type="button"
                    className={cn(
                      "flex min-h-11 w-full items-center justify-between gap-2 rounded-xl px-3 py-2 text-sm hover:bg-cyan-400/10",
                      c.iso === selected.iso && "bg-cyan-400/15 text-cyan-100",
                    )}
                    onClick={() => {
                      onChange(c.iso);
                      setOpen(false);
                      setQuery("");
                    }}
                  >
                    <span className="flex min-w-0 items-center gap-2 text-start">
                      <span aria-hidden="true">{flagEmoji(c.iso)}</span>
                      <span className="truncate">{c.nativeName !== c.name ? `${c.nativeName} · ${c.name}` : c.name}</span>
                    </span>
                    <span className="shrink-0 text-cyan-200" dir="ltr">
                      +{c.dial}
                    </span>
                  </button>
                </li>
              ))
            )}
          </ul>
        </div>
      )}
    </div>
  );
}
