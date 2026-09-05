"use client";

import { useMemo, useState } from "react";
import {
  ArrowDownLeft,
  ArrowUpRight,
  CalendarDays,
  Grid3x3,
  Heart,
  Info,
  Phone,
  Plus,
  Search,
} from "lucide-react";
import { toast } from "sonner";
import { HeaderOverflowButton, NixoAiHeaderButton, OverflowRow } from "@/components/nixo-header-tools";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { publicAvatarFor } from "@/lib/public-assets";
import { formatCallClock, formatRecentCallWhen } from "@/lib/call-copy";
import type { LiveCall } from "@/components/call-stage";

export type HistoryCall = LiveCall & {
  endedAt: number | null;
  durationMs: number;
  group?: boolean;
  participantCount?: number;
  unreadMissed?: boolean;
};

type ContactHit = {
  id: string;
  nixoUserId: string | null;
  name: string;
  phone: string;
  username: string;
  favorite: boolean;
};

export function CallsTab({
  calls,
  onCall,
  onOpenChat,
  onReload,
}: {
  calls: HistoryCall[];
  onCall: (threadId: string, kind: "voice" | "video") => void;
  onOpenChat?: (threadId: string) => void;
  onReload?: () => void;
}) {
  const [q, setQ] = useState("");
  const [menu, setMenu] = useState(false);
  const [selecting, setSelecting] = useState(false);
  const [picked, setPicked] = useState<string[]>([]);
  const [sheet, setSheet] = useState<HistoryCall | null>(null);
  const [picker, setPicker] = useState<"call" | "schedule" | "favourites" | "plus" | null>(null);
  const [keypad, setKeypad] = useState(false);
  const [digits, setDigits] = useState("");
  const [contacts, setContacts] = useState<ContactHit[]>([]);
  const [when, setWhen] = useState("");

  const recent = useMemo(() => {
    const n = q.trim().toLowerCase().replace(/^@/, "");
    if (!n) return calls;
    return calls.filter((c) => `${c.peerName} ${c.peerKey}`.toLowerCase().includes(n));
  }, [calls, q]);

  async function loadContacts(favorites = false) {
    const res = await fetch(`/api/contacts?favorites=${favorites ? "1" : "0"}&q=${encodeURIComponent(q)}`, { cache: "no-store" });
    const data = await res.json();
    setContacts(data.contacts ?? []);
  }

  async function openPicker(kind: "call" | "schedule" | "favourites" | "plus") {
    setPicker(kind);
    setMenu(false);
    await loadContacts(kind === "favourites");
  }

  async function startFromContact(c: ContactHit) {
    if (!c.nixoUserId) {
      toast.error("این مخاطب در نیکسو نیست.");
      return;
    }
    const res = await fetch("/api/contacts", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "open-chat", userId: c.nixoUserId }),
    });
    const data = await res.json();
    if (!res.ok || !data.thread?.id) {
      toast.error(data.error ?? "گفتگو باز نشد.");
      return;
    }
    const mode = picker;
    setPicker(null);
    if (mode === "schedule") {
      toast.success(when ? `Call scheduled for ${when}` : "Pick a date and time first.");
      return;
    }
    onCall(data.thread.id, "voice");
  }

  async function readAll() {
    setMenu(false);
    const res = await fetch("/api/calls", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "read-all" }),
    });
    if (!res.ok) toast.error("علامت‌گذاری انجام نشد.");
    else toast.success("همه تماس‌های از دست‌رفته خوانده شد.");
    onReload?.();
  }

  async function deletePicked() {
    if (!picked.length) return;
    const res = await fetch("/api/calls", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "clear-history", ids: picked }),
    });
    if (!res.ok) toast.error("حذف نشد.");
    else {
      toast.success("سوابق حذف شد.");
      setPicked([]);
      setSelecting(false);
      onReload?.();
    }
  }

  function statusLine(c: HistoryCall) {
    const missed = c.status === "missed" || c.status === "declined";
    if (missed) return { label: "Missed", cls: "text-rose-400", Icon: null as typeof ArrowUpRight | null };
    if (c.direction === "in") return { label: "Incoming", cls: "text-emerald-100/55", Icon: ArrowDownLeft };
    return { label: "Outgoing", cls: "text-emerald-100/55", Icon: ArrowUpRight };
  }

  return (
    <div className="flex h-full flex-col overflow-auto pb-24 text-emerald-50 md:pb-6" dir="ltr">
      <header className="flex items-center justify-between px-3 pt-4">
        <div className="flex items-center gap-0.5">
          <HeaderOverflowButton open={menu} onToggle={() => setMenu((v) => !v)}>
            <OverflowRow
              onClick={() => {
                setMenu(false);
                setSelecting(true);
                setPicked([]);
              }}
            >
              Select
            </OverflowRow>
            <OverflowRow onClick={() => void readAll()}>Read All</OverflowRow>
          </HeaderOverflowButton>
          <NixoAiHeaderButton />
        </div>
        <h1 className="text-xl font-semibold">Calls</h1>
        <button
          type="button"
          className="grid size-10 place-items-center rounded-full bg-emerald-500 text-white shadow-md shadow-emerald-900/40 hover:bg-emerald-400"
          aria-label="New call"
          onClick={() => void openPicker("plus")}
        >
          <Plus className="size-5" />
        </button>
      </header>

      <div className="px-4 pb-3 pt-3">
        <label className="flex h-11 items-center gap-2 rounded-xl border border-white/10 bg-black/30 px-3">
          <Search className="size-4 shrink-0 text-emerald-100/45" />
          <Input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Name, number, @username"
            className="h-10 border-0 bg-transparent px-0 text-sm shadow-none focus-visible:ring-0"
            aria-label="Name, number, @username"
          />
        </label>
      </div>

      <div className="grid grid-cols-4 gap-2 px-4 pb-5">
        {(
          [
            { id: "call" as const, label: "Call", icon: Phone },
            { id: "schedule" as const, label: "Schedule", icon: CalendarDays },
            { id: "keypad" as const, label: "Keypad", icon: Grid3x3 },
            { id: "favourites" as const, label: "Favourites", icon: Heart },
          ]
        ).map((item) => (
          <button
            key={item.id}
            type="button"
            className="flex flex-col items-center gap-2"
            onClick={() => {
              if (item.id === "keypad") {
                setKeypad(true);
                return;
              }
              void openPicker(item.id);
            }}
          >
            <span className="grid size-14 place-items-center rounded-full bg-white/10 text-emerald-50">
              <item.icon className="size-6" />
            </span>
            <span className="text-[11px] text-emerald-100/70">{item.label}</span>
          </button>
        ))}
      </div>

      {selecting && (
        <div className="mx-4 mb-2 flex items-center gap-3 rounded-xl bg-emerald-500/15 px-3 py-2 text-xs">
          <span className="flex-1">{picked.length} selected</span>
          <button type="button" className="text-rose-200" onClick={() => void deletePicked()}>
            Delete
          </button>
          <button
            type="button"
            className="text-amber-200"
            onClick={() => {
              setSelecting(false);
              setPicked([]);
            }}
          >
            Cancel
          </button>
        </div>
      )}

      <h2 className="px-4 pb-1 text-sm font-semibold text-emerald-100/80">Recent</h2>
      <ul>
        {recent.length === 0 && <li className="px-4 py-16 text-center text-sm text-emerald-100/50">No recent calls</li>}
        {recent.map((c) => {
          const st = statusLine(c);
          const missed = c.status === "missed" || c.status === "declined";
          return (
            <li key={c.id} className="flex items-center gap-3 px-4 py-2.5 hover:bg-white/5">
              {selecting && (
                <button
                  type="button"
                  className={cn(
                    "grid size-5 shrink-0 place-items-center rounded-full border",
                    picked.includes(c.id) ? "border-emerald-400 bg-emerald-500 text-[10px]" : "border-white/30",
                  )}
                  onClick={() => setPicked((cur) => (cur.includes(c.id) ? cur.filter((id) => id !== c.id) : [...cur, c.id]))}
                >
                  {picked.includes(c.id) ? "✓" : ""}
                </button>
              )}
              <span className="relative size-12 shrink-0 overflow-hidden rounded-full">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={publicAvatarFor(c.peerKey || c.peerName, c.group ? "group" : "user")} alt="" className="size-12 object-cover" />
                {c.unreadMissed ? <span className="absolute end-0 top-0 size-2.5 rounded-full bg-emerald-400" /> : null}
              </span>
              <button
                type="button"
                className="min-w-0 flex-1 text-start"
                onClick={() => {
                  if (selecting) {
                    setPicked((cur) => (cur.includes(c.id) ? cur.filter((id) => id !== c.id) : [...cur, c.id]));
                    return;
                  }
                  if (!c.group) onCall(c.threadId, c.kind);
                }}
              >
                <p className={cn("truncate text-[15px] font-bold", missed && "text-rose-300")}>
                  {c.peerName}
                  {c.group ? " · Group" : ""}
                </p>
                <p className={cn("mt-0.5 flex items-center gap-1.5 text-[12px]", st.cls)}>
                  {st.Icon ? <st.Icon className="size-3.5" /> : null}
                  <span>
                    {st.label}
                    {c.durationMs > 0 ? ` · ${formatCallClock(c.durationMs)}` : ""}
                  </span>
                </p>
              </button>
              <span className="shrink-0 text-[11px] text-emerald-100/45">{formatRecentCallWhen(c.createdAt)}</span>
              <button
                type="button"
                className="grid size-9 shrink-0 place-items-center rounded-full border border-white/15 text-emerald-100/70"
                aria-label="Call info"
                onClick={() => setSheet(c)}
              >
                <Info className="size-4" />
              </button>
            </li>
          );
        })}
      </ul>

      {sheet && (
        <div className="fixed inset-0 z-40 flex items-end justify-center bg-black/50 p-4 md:items-center" onClick={() => setSheet(null)}>
          <div className="w-full max-w-sm rounded-3xl bg-[#122e2a] p-5" onClick={(e) => e.stopPropagation()} dir="ltr">
            <div className="flex items-center gap-3">
              <span className="grid size-14 place-items-center rounded-full text-lg font-semibold text-[#071614]" style={{ background: sheet.peerColor }}>
                {sheet.peerName.slice(0, 1)}
              </span>
              <div>
                <p className="font-bold">{sheet.peerName}</p>
                <p className="text-xs text-emerald-100/55">{statusLine(sheet).label} · {formatRecentCallWhen(sheet.createdAt)}</p>
              </div>
            </div>
            <div className="mt-4 flex gap-2">
              {!sheet.group && (
                <>
                  <Button className="flex-1 bg-emerald-500 text-white hover:bg-emerald-400" onClick={() => { onCall(sheet.threadId, "voice"); setSheet(null); }}>
                    Call
                  </Button>
                  <Button variant="secondary" className="flex-1" onClick={() => { onCall(sheet.threadId, "video"); setSheet(null); }}>
                    Video
                  </Button>
                </>
              )}
              {onOpenChat && !sheet.group && (
                <Button variant="ghost" className="text-amber-200" onClick={() => { onOpenChat(sheet.threadId); setSheet(null); }}>
                  Chat
                </Button>
              )}
            </div>
          </div>
        </div>
      )}

      {picker && (
        <div className="fixed inset-0 z-40 flex items-end justify-center bg-black/50 p-4 md:items-center" onClick={() => setPicker(null)}>
          <div className="max-h-[80dvh] w-full max-w-md overflow-auto rounded-3xl bg-[#122e2a] p-4" onClick={(e) => e.stopPropagation()} dir="ltr">
            <div className="mb-3 flex items-center justify-between">
              <h2 className="font-semibold">{picker === "favourites" ? "Favourites" : picker === "schedule" ? "Schedule" : "New call"}</h2>
              <button type="button" className="text-sm text-amber-200" onClick={() => setPicker(null)}>
                Close
              </button>
            </div>
            {picker === "schedule" && (
              <Input type="datetime-local" value={when} onChange={(e) => setWhen(e.target.value)} className="mb-3 h-10 bg-black/30" />
            )}
            <ul className="space-y-1">
              {contacts.length === 0 && <li className="py-8 text-center text-sm text-emerald-100/50">No contacts</li>}
              {contacts.map((c) => (
                <li key={c.id}>
                  <button type="button" className="flex w-full items-center justify-between rounded-xl px-3 py-2.5 hover:bg-white/10" onClick={() => void startFromContact(c)}>
                    <span className="font-medium">{c.name}</span>
                    <span className="text-[11px] text-emerald-100/50">{c.username ? `@${c.username}` : c.phone}</span>
                  </button>
                </li>
              ))}
            </ul>
          </div>
        </div>
      )}

      {keypad && (
        <div className="fixed inset-0 z-40 flex items-end justify-center bg-black/50 p-4 md:items-center" onClick={() => setKeypad(false)}>
          <div className="w-full max-w-xs rounded-3xl bg-[#122e2a] p-5" onClick={(e) => e.stopPropagation()} dir="ltr">
            <p className="mb-3 min-h-8 text-center text-2xl tracking-[0.2em]">{digits || " "}</p>
            <div className="grid grid-cols-3 gap-2">
              {["1", "2", "3", "4", "5", "6", "7", "8", "9", "*", "0", "#"].map((d) => (
                <button
                  key={d}
                  type="button"
                  className="grid h-14 place-items-center rounded-full bg-white/10 text-lg"
                  onClick={() => setDigits((s) => (s + d).slice(0, 16))}
                >
                  {d}
                </button>
              ))}
            </div>
            <div className="mt-3 flex gap-2">
              <Button variant="secondary" className="flex-1" onClick={() => setDigits((s) => s.slice(0, -1))}>
                ⌫
              </Button>
              <Button
                className="flex-1 bg-emerald-500 text-white hover:bg-emerald-400"
                onClick={() => {
                  toast.message(digits ? `Calling ${digits}` : "Enter a number");
                  setKeypad(false);
                }}
              >
                Call
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
