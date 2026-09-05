"use client";

import type { ReactNode } from "react";
import Link from "next/link";
import { MoreVertical, Sparkles } from "lucide-react";
import { NixoMark } from "@/components/nixo-mark";
import { cn } from "@/lib/utils";

export function NixoAiHeaderButton({ className }: { className?: string }) {
  return (
    <Link
      href="/app/ai"
      className={cn(
        "flex h-10 items-center gap-1 rounded-full px-2 text-cyan-200 hover:bg-white/10",
        className,
      )}
      aria-label="Nixo AI"
    >
      <NixoMark size={22} />
      <Sparkles className="size-3.5" aria-hidden />
      <span className="text-[11px] font-semibold tracking-wide">AI</span>
    </Link>
  );
}

export function HeaderOverflowButton({
  open,
  onToggle,
  children,
}: {
  open: boolean;
  onToggle: () => void;
  children: ReactNode;
}) {
  return (
    <div className="relative">
      <button
        type="button"
        className="grid size-10 place-items-center rounded-full text-emerald-50 hover:bg-white/10"
        aria-label="More"
        aria-expanded={open}
        onClick={(e) => {
          e.stopPropagation();
          onToggle();
        }}
      >
        <MoreVertical className="size-5" />
      </button>
      {open ? (
        <div
          className="absolute start-0 top-11 z-40 min-w-52 overflow-hidden rounded-2xl border border-white/10 bg-[#122e2a] py-1 text-sm shadow-2xl"
          onClick={(e) => e.stopPropagation()}
        >
          {children}
        </div>
      ) : null}
    </div>
  );
}

export function OverflowRow({ onClick, children }: { onClick: () => void; children: ReactNode }) {
  return (
    <button type="button" className="block w-full px-4 py-2.5 text-start hover:bg-white/10" onClick={onClick}>
      {children}
    </button>
  );
}
