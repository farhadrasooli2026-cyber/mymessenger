"use client";

import { NIXO_LOGO } from "@/lib/public-assets";
import { cn } from "@/lib/utils";

export function NixoMark({ className, size = 40 }: { className?: string; size?: number }) {
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={NIXO_LOGO}
      alt=""
      width={size}
      height={size}
      className={cn("shrink-0 object-contain", className)}
      style={{ width: size, height: size }}
    />
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

export function NixoSplash({ label = "در حال آماده‌سازی نشست امن..." }: { label?: string }) {
  return (
    <div className="flex flex-col items-center py-16 text-center">
      <NixoMark size={96} className="drop-shadow-[0_0_24px_rgba(56,189,248,0.45)]" />
      <p className="mt-4 bg-gradient-to-l from-cyan-300 to-blue-400 bg-clip-text text-xl font-semibold tracking-[0.4em] text-transparent">
        NIXO
      </p>
      <p className="mt-2 text-sm text-slate-300">{label}</p>
    </div>
  );
}
