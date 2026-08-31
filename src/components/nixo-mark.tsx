import { cn } from "@/lib/utils";

export function NixoMark({ className, size = 40 }: { className?: string; size?: number }) {
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src="/nixo-logo.png"
      alt=""
      width={size}
      height={size}
      className={cn("shrink-0 object-contain", className)}
      aria-hidden="true"
    />
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
