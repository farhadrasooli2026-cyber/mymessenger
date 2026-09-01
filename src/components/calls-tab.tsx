"use client";

import { Phone, PhoneIncoming, PhoneMissed, PhoneOutgoing, Video } from "lucide-react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { callKindFa, callStatusFa, formatCallClock, formatCallWhen } from "@/lib/call-copy";
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
  onDemoIncoming,
  onClearHistory,
  onReport,
  blockedHint,
}: {
  calls: HistoryCall[];
  filter: string;
  onFilter: (f: string) => void;
  onCall: (threadId: string, kind: "voice" | "video") => void;
  onDemoIncoming: (kind: "voice" | "video") => void;
  onClearHistory?: () => void;
  onReport?: (call: HistoryCall) => void;
  blockedHint?: string;
}) {
  const chips = [
    { id: "all", label: "همه" },
    { id: "incoming", label: "ورودی" },
    { id: "outgoing", label: "خروجی" },
    { id: "missed", label: "بی‌پاسخ" },
    { id: "declined", label: "ردشده" },
    { id: "group", label: "گروهی" },
    { id: "voice", label: "صوتی" },
    { id: "video", label: "تصویری" },
  ];

  return (
    <div className="flex h-full flex-col overflow-auto p-4 pb-24 md:pb-6">
      <h2 className="text-xl font-semibold">تماس‌ها</h2>
      <p className="mt-1 text-xs leading-6 text-emerald-100/60">
        Incoming / Outgoing / Missed / Declined. برای هر تماس: Caller، تاریخ، ساعت، مدت، نوع و وضعیت. سابقه روی سرور فقط فراداده است.
        {" "}
        <Link href="/app/calls" className="text-amber-200">
          مرکز تماس
        </Link>
      </p>
      {blockedHint && <p className="mt-2 text-xs text-rose-200">{blockedHint}</p>}
      <div className="mt-3 flex flex-wrap gap-1">
        {chips.map((c) => (
          <button
            key={c.id}
            type="button"
            className={cn("rounded-full px-3 py-1 text-[11px]", filter === c.id ? "bg-amber-300 text-[#102824]" : "bg-white/10")}
            onClick={() => onFilter(c.id)}
          >
            {c.label}
          </button>
        ))}
      </div>
      <div className="mt-3 flex flex-wrap gap-2">
        <Button type="button" size="sm" variant="secondary" onClick={() => onDemoIncoming("voice")}>
          تماس ورودی آزمایشی (صوتی)
        </Button>
        <Button type="button" size="sm" variant="secondary" onClick={() => onDemoIncoming("video")}>
          تماس ورودی آزمایشی (تصویری)
        </Button>
        {onClearHistory && (
          <Button type="button" size="sm" variant="secondary" onClick={() => onClearHistory()}>
            پاک‌کردن سابقه
          </Button>
        )}
      </div>
      <ul className="mt-4 space-y-2">
        {calls.length === 0 && <li className="text-sm text-emerald-100/55">هنوز تماسی ثبت نشده.</li>}
        {calls.map((c) => (
          <li key={c.id} className="flex items-center gap-3 rounded-2xl border border-white/10 bg-white/5 px-3 py-3">
            <span className="grid size-10 place-items-center rounded-2xl text-[#071614]" style={{ background: c.peerColor }}>
              {c.status === "missed" ? (
                <PhoneMissed className="size-4" />
              ) : c.direction === "in" ? (
                <PhoneIncoming className="size-4" />
              ) : (
                <PhoneOutgoing className="size-4" />
              )}
            </span>
            <div className="min-w-0 flex-1">
              <p className="truncate font-medium">{c.peerName}{c.group ? " · گروهی" : ""}</p>
              <p className="text-[11px] text-emerald-100/60">
                {callKindFa(c.kind)} · {callStatusFa(c.status, c.direction, c.kind)} · {formatCallWhen(c.createdAt)}
                {c.durationMs > 0 ? ` · ${formatCallClock(c.durationMs)}` : ""}
                {c.group && c.participantCount ? ` · ${c.participantCount} نفر` : ""}
              </p>
            </div>
            {!c.group && (
              <>
            <button type="button" className="grid size-9 place-items-center rounded-full bg-white/10" onClick={() => onCall(c.threadId, "voice")} aria-label="تماس صوتی">
              <Phone className="size-4" />
            </button>
            <button type="button" className="grid size-9 place-items-center rounded-full bg-white/10" onClick={() => onCall(c.threadId, "video")} aria-label="تماس تصویری">
              <Video className="size-4" />
            </button>
            {onReport && (
              <button type="button" className="rounded-full bg-white/10 px-2 py-1 text-[10px]" onClick={() => onReport(c)}>
                گزارش
              </button>
            )}
              </>
            )}
          </li>
        ))}
      </ul>
      <p className="mt-6 text-[11px] leading-6 text-emerald-100/45">
        تماس گروهی از داخل گروه با Voice Call / Video Call شروع می‌شود. لینک Join Call توکن و انقضا دارد و فقط با ورود و عضویت گروه کار می‌کند. NIXO جایگزین تماس اضطراری سیستم‌عامل نیست. ضبط تماس فعال نیست.
      </p>
    </div>
  );
}
