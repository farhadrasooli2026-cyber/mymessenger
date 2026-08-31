import { cn } from "@/lib/utils";

export function NixoMark({ className, size = 40 }: { className?: string; size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 48 48"
      className={cn("shrink-0", className)}
      aria-hidden="true"
    >
      <rect x="1.5" y="1.5" width="45" height="45" rx="14" fill="#102824" stroke="#fbbf24" strokeWidth="1.5" />
      <path
        d="M14 14 L34 34 M34 14 L14 34"
        stroke="#34d399"
        strokeWidth="4.2"
        strokeLinecap="round"
      />
      <path
        d="M14 14 L34 34 M34 14 L14 34"
        stroke="#fbbf24"
        strokeWidth="1.8"
        strokeLinecap="round"
      />
    </svg>
  );
}

export function NixoWordmark({ compact = false }: { compact?: boolean }) {
  return (
    <div className="flex items-center gap-3">
      <NixoMark size={compact ? 36 : 44} />
      <div>
        <p className="text-lg font-semibold tracking-[0.28em] text-white">NIXO</p>
        <p className="text-xs text-emerald-100/75">{compact ? "نیکسو" : "نیکسو · نسل جدید ارتباط"}</p>
      </div>
    </div>
  );
}
