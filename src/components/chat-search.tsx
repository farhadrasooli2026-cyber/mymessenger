"use client";

import { useMemo, useState } from "react";
import { Input } from "@/components/ui/input";
import type { SearchKind } from "@/lib/search-types";
import { searchDecryptedMessages } from "@/lib/client-search";
import { highlightText } from "@/lib/search-match";

const FILTERS: { id: SearchKind; label: string }[] = [
  { id: "all", label: "همه" },
  { id: "messages", label: "متن" },
  { id: "photos", label: "عکس" },
  { id: "videos", label: "ویدیو" },
  { id: "files", label: "فایل" },
  { id: "links", label: "لینک" },
  { id: "voice", label: "صوت" },
  { id: "music", label: "موسیقی" },
];

export function ChatSearch({
  chatName,
  threadId,
  messages,
  onJump,
  onClose,
}: {
  chatName: string;
  threadId: string;
  messages: { id: string; text: string; createdAt: number; sender: "me" | "peer"; kind?: string }[];
  onJump: (messageId: string) => void;
  onClose: () => void;
}) {
  const [q, setQ] = useState("");
  const [kind, setKind] = useState<SearchKind>("all");
  const [from, setFrom] = useState<"" | "me" | "peer">("");
  const [fromDate, setFromDate] = useState("");
  const [toDate, setToDate] = useState("");

  const hits = useMemo(
    () =>
      searchDecryptedMessages(messages, chatName, threadId, q, {
        kind,
        from: from || undefined,
        fromDate: fromDate ? new Date(fromDate).getTime() : undefined,
        toDate: toDate ? new Date(toDate).getTime() + 86_399_000 : undefined,
      }),
    [messages, chatName, threadId, q, kind, from, fromDate, toDate],
  );

  return (
    <div className="border-b border-white/10 bg-black/40 p-3">
      <div className="flex items-center justify-between">
        <p className="text-xs font-medium">Search in Conversation</p>
        <button type="button" className="text-[11px] text-amber-200" onClick={onClose}>
          بستن
        </button>
      </div>
      <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="متن، رسانه، فایل، لینک، صوت…" className="mt-2 h-9 bg-black/20" />
      <div className="mt-2 flex flex-wrap gap-1">
        {FILTERS.map((f) => (
          <button
            key={f.id}
            type="button"
            className={`rounded-full px-2 py-0.5 text-[10px] ${kind === f.id ? "bg-amber-300 text-[#102824]" : "bg-white/10"}`}
            onClick={() => setKind(f.id)}
          >
            {f.label}
          </button>
        ))}
      </div>
      <div className="mt-2 flex flex-wrap gap-2 text-[10px]">
        <select className="rounded bg-black/30 px-1 py-1" value={from} onChange={(e) => setFrom(e.target.value as typeof from)}>
          <option value="">همه فرستنده‌ها</option>
          <option value="me">از من</option>
          <option value="peer">از مخاطب</option>
        </select>
        <input type="date" className="rounded bg-black/30 px-1" value={fromDate} onChange={(e) => setFromDate(e.target.value)} />
        <input type="date" className="rounded bg-black/30 px-1" value={toDate} onChange={(e) => setToDate(e.target.value)} />
      </div>
      <div className="mt-2 max-h-40 space-y-1 overflow-auto">
        {q.trim() && hits.length === 0 && <p className="text-[11px] text-emerald-100/50">چیزی در پیام‌های این دستگاه پیدا نشد.</p>}
        {hits.map((h) => (
          <button
            key={h.id}
            type="button"
            className="block w-full rounded-lg bg-white/5 px-2 py-1 text-right text-[11px]"
            onClick={() => onJump(h.id)}
          >
            <span className="opacity-60">{h.sender} · </span>
            {highlightText(h.preview || h.kind, q).map((p, i) => (
              <span key={i} className={p.hit ? "bg-amber-300/40 text-amber-50" : undefined}>
                {p.t}
              </span>
            ))}
          </button>
        ))}
      </div>
      <p className="mt-1 text-[10px] text-emerald-100/40">جستجوی متن خصوصی بدون اینترنت، روی کپی رمزگشایی‌شدهٔ همین دستگاه است.</p>
    </div>
  );
}
