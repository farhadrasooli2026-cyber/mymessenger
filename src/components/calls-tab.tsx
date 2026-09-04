"use client";

import { Phone, PhoneIncoming, PhoneMissed, PhoneOutgoing, Video } from "lucide-react";
import { cn } from "@/lib/utils";
import { callStatusFa, formatCallClock, formatCallWhen } from "@/lib/call-copy";
import type { LiveCall } from "@/components/call-stage";

export type HistoryCall = LiveCall & {
  endedAt: number | null;
  durationMs: number;
  group?: boolean;
  participantCount?: number;
};

export function CallsTab({
  calls,
  filter,
  onFilter,
  onCall,
}: {
  calls: HistoryCall[];
  filter: string;
  onFilter: (f: string) => void;
  onCall: (threadId: string, kind: "voice" | "video") => void;
}) {
  const chips = [
    { id: "all", label: "همه" },
    { id: "missed", label: "بی‌پاسخ" },
    { id: "voice", label: "صوتی" },
    { id: "video", label: "تصویری" },
  ];

  return (
    <div className="flex h-full flex-col overflow-auto pb-24 md:pb-6">
      <header className="px-4 pb-2 pt-4">
        <h2 className="text-xl font-semibold">تماس‌ها</h2>
      </header>
      <div className="flex gap-1 overflow-x-auto px-4 pb-3">
        {chips.map((c) => (
          <button
            key={c.id}
            type="button"
            className={cn("shrink-0 rounded-full px-3 py-1.5 text-[12px]", filter === c.id ? "bg-amber-300 text-[#102824]" : "bg-white/10")}
            onClick={() => onFilter(c.id)}
          >
            {c.label}
          </button>
        ))}
      </div>
      <ul>
        {calls.length === 0 && (
          <li className="px-4 py-16 text-center text-sm text-emerald-100/50">هنوز تماسی ثبت نشده</li>
        )}
        {calls.map((c) => {
          const missed = c.status === "missed" || c.status === "declined";
          return (
            <li key={c.id} className="flex items-center gap-3 px-4 py-2.5 hover:bg-white/5">
              <span className="relative grid size-12 place-items-center rounded-full text-[#071614]" style={{ background: c.peerColor }}>
                {c.peerName.slice(0, 1)}
                <span className="absolute -bottom-0.5 -start-0.5 grid size-5 place-items-center rounded-full bg-[#0b2421] text-emerald-50">
                  {c.kind === "video" ? <Video className="size-3" /> : <Phone className="size-3" />}
                </span>
              </span>
              <button type="button" className="min-w-0 flex-1 text-right" onClick={() => !c.group && onCall(c.threadId, c.kind)}>
                <p className={cn("truncate text-[15px] font-medium", missed && "text-rose-300")}>
                  {c.peerName}
                  {c.group ? " · گروهی" : ""}
                </p>
                <p className={cn("mt-0.5 flex items-center gap-1.5 text-[12px]", missed ? "text-rose-300/80" : "text-emerald-100/55")}>
                  {c.status === "missed" ? (
                    <PhoneMissed className="size-3.5" />
                  ) : c.direction === "in" ? (
                    <PhoneIncoming className="size-3.5" />
                  ) : (
                    <PhoneOutgoing className="size-3.5" />
                  )}
                  <span>
                    {callStatusFa(c.status, c.direction, c.kind)}
                    {" · "}
                    {formatCallWhen(c.createdAt)}
                    {c.durationMs > 0 ? ` · ${formatCallClock(c.durationMs)}` : ""}
                  </span>
                </p>
              </button>
              {!c.group && (
                <button
                  type="button"
                  className="grid size-10 place-items-center rounded-full text-amber-200"
                  onClick={() => onCall(c.threadId, c.kind)}
                  aria-label={c.kind === "video" ? "تماس تصویری" : "تماس صوتی"}
                >
                  {c.kind === "video" ? <Video className="size-5" /> : <Phone className="size-5" />}
                </button>
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
}
