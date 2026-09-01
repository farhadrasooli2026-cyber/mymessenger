"use client";

"use client";

import { useId } from "react";
import { cn } from "@/lib/utils";

export function NixoMark({ className, size = 40 }: { className?: string; size?: number }) {
  const gid = useId().replace(/:/g, "");
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 80 80"
      className={cn("shrink-0", className)}
      aria-hidden="true"
    >
      <defs>
        <linearGradient id={`${gid}-stroke`} x1="8" y1="8" x2="72" y2="72" gradientUnits="userSpaceOnUse">
          <stop offset="0%" stopColor="#22d3ee" />
          <stop offset="55%" stopColor="#38bdf8" />
          <stop offset="100%" stopColor="#3b82f6" />
        </linearGradient>
        <filter id={`${gid}-glow`} x="-20%" y="-20%" width="140%" height="140%">
          <feGaussianBlur stdDeviation="1.4" result="b" />
          <feMerge>
            <feMergeNode in="b" />
            <feMergeNode in="SourceGraphic" />
          </feMerge>
        </filter>
      </defs>
      <path
        d="M20 14h28c8.8 0 16 7.2 16 16v16c0 8.8-7.2 16-16 16H36.5L22 74V62H20C11.2 62 4 54.8 4 46V30c0-8.8 7.2-16 16-16z"
        fill="rgba(6,12,24,0.55)"
        stroke={`url(#${gid}-stroke)`}
        strokeWidth="2.4"
        filter={`url(#${gid}-glow)`}
      />
      <path
        d="M27 27 L51 51 M51 27 L27 51"
        stroke={`url(#${gid}-stroke)`}
        strokeWidth="5"
        strokeLinecap="round"
        filter={`url(#${gid}-glow)`}
      />
    </svg>
  );
}

export function NixoWordmark({ compact = false }: { compact?: boolean }) {
  return (
    <div className="flex items-center gap-3">
      <NixoMark size={compact ? 36 : 44} />
      <div>
        <p className="bg-gradient-to-l from-cyan-300 to-blue-400 bg-clip-text text-lg font-semibold tracking-[0.28em] text-transparent">
          NIXO
        </p>
        <p className="text-xs tracking-[0.22em] text-cyan-200/70">{compact ? "نیکسو" : "MESSENGER"}</p>
      </div>
    </div>
  );
}

export function NixoHeroLogo({ size = 92 }: { size?: number }) {
  return (
    <div className="flex flex-col items-center text-center">
      <NixoMark size={size} />
      <p className="mt-3 bg-gradient-to-l from-cyan-300 via-sky-300 to-blue-400 bg-clip-text text-[1.65rem] font-semibold tracking-[0.38em] text-transparent">
        NIXO
      </p>
      <p className="mt-1 text-[11px] font-medium tracking-[0.48em] text-cyan-300/90">MESSENGER</p>
    </div>
  );
}
