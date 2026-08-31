"use client";

import { DISAPPEAR_PRESETS, type DisappearId } from "@/lib/disappear";
import { cn } from "@/lib/utils";

export type TimerChoice = DisappearId | "inherit";

export function DisappearPicker({
  value,
  onChange,
  customMs,
  onCustomMs,
  allowInherit,
}: {
  value: TimerChoice;
  onChange: (id: TimerChoice) => void;
  customMs: number;
  onCustomMs: (ms: number) => void;
  allowInherit?: boolean;
}) {
  return (
    <div className="flex flex-wrap items-center gap-1 text-[11px]">
      {allowInherit && (
        <button
          type="button"
          className={cn("rounded-full px-2 py-1", value === "inherit" ? "bg-amber-300 text-[#102824]" : "bg-white/10")}
          onClick={() => onChange("inherit")}
        >
          طبق گفتگو
        </button>
      )}
      {DISAPPEAR_PRESETS.map((p) => (
        <button
          key={p.id}
          type="button"
          className={cn("rounded-full px-2 py-1", value === p.id ? "bg-amber-300 text-[#102824]" : "bg-white/10")}
          onClick={() => onChange(p.id)}
        >
          {p.label}
        </button>
      ))}
      {value === "custom" && (
        <input
          type="number"
          min={5}
          max={604800}
          className="h-7 w-20 rounded bg-black/30 px-2 text-[11px]"
          value={Math.round(customMs / 1000)}
          onChange={(e) => onCustomMs(Math.max(5, Number(e.target.value) || 5) * 1000)}
          aria-label="ثانیه سفارشی"
        />
      )}
    </div>
  );
}

export function msFromChoice(choice: TimerChoice, customMs: number): number | null | undefined {
  if (choice === "inherit") return undefined;
  if (choice === "off") return 0;
  if (choice === "custom") return customMs;
  const hit = DISAPPEAR_PRESETS.find((p) => p.id === choice);
  return hit && hit.ms > 0 ? hit.ms : 0;
}
