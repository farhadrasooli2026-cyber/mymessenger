"use client";

import { useCallback, useEffect, useState } from "react";
import { ChevronDown, ChevronLeft, Megaphone, Plus } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

type CommunityCard = {
  id: string;
  name: string;
  description: string;
  color: string;
  memberCount: number;
  groups: { id: string; name: string; color: string; memberCount: number }[];
  channels: { id: string; name: string; color: string }[];
};

type Example = {
  id: string;
  name: string;
  description: string;
  color: string;
  memberCount: number;
  groupCount: number;
  joined: boolean;
};

export function CommunitiesDesk({
  onCreate,
  onOpenCommunity,
  onOpenGroup,
}: {
  onCreate: () => void;
  onOpenCommunity: (id: string) => void;
  onOpenGroup: (id: string) => void;
}) {
  const [mine, setMine] = useState<CommunityCard[] | null>(null);
  const [openId, setOpenId] = useState<string | null>(null);
  const [examples, setExamples] = useState<Example[] | null>(null);
  const [err, setErr] = useState("");

  const load = useCallback(async () => {
    const res = await fetch("/api/communities", { cache: "no-store" });
    const data = await res.json();
    if (!res.ok) {
      setErr(data.error ?? "بارگذاری نشد.");
      setMine([]);
      return;
    }
    setErr("");
    setMine(data.communities ?? []);
  }, []);

  useEffect(() => {
    const t = window.setTimeout(() => void load(), 0);
    return () => window.clearTimeout(t);
  }, [load]);

  async function showExamples() {
    const res = await fetch("/api/communities/discover", { cache: "no-store" });
    const data = await res.json();
    if (!res.ok) {
      toast.error(data.error ?? "نمونه‌ها بارگذاری نشد.");
      return;
    }
    setExamples(data.communities ?? []);
  }

  async function joinExample(id: string) {
    const res = await fetch("/api/communities/join", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ communityId: id, acceptRules: true }),
    });
    const data = await res.json();
    if (!res.ok) {
      toast.error(data.error ?? "پیوستن انجام نشد.");
      return;
    }
    toast.success("به انجمن پیوستی.");
    setExamples(null);
    await load();
    onOpenCommunity(id);
  }

  const empty = mine && mine.length === 0;

  return (
    <div className="flex min-h-0 flex-1 flex-col bg-[#071614] text-emerald-50">
      <header className="flex items-center justify-between px-3 py-3">
        <button
          type="button"
          className="grid size-10 place-items-center rounded-full bg-emerald-500 text-white shadow-md shadow-emerald-900/40 hover:bg-emerald-400"
          aria-label="انجمن جدید"
          onClick={onCreate}
        >
          <Plus className="size-5" />
        </button>
        <h1 className="text-lg font-semibold">انجمن‌ها</h1>
        <span className="size-10" aria-hidden />
      </header>

      <div className="min-h-0 flex-1 overflow-auto px-4 pb-24">
        {err ? <p className="py-4 text-center text-sm text-rose-200">{err}</p> : null}

        {empty && !examples && (
          <div className="mx-auto flex max-w-md flex-col items-center pt-6 text-center">
            <CommunityArt />
            <h2 className="mt-6 text-xl font-semibold leading-8">در ارتباط با یک انجمن بمانید</h2>
            <p className="mt-3 text-sm leading-7 text-emerald-100/65">
              انجمن‌ها اعضا را در گروه‌های موضوعی گرد هم می‌آورند. هر انجمنی که به آن اضافه شوید در اینجا نمایش داده می‌شود.
            </p>
            <button type="button" className="mt-5 text-sm font-medium text-emerald-300" onClick={() => void showExamples()}>
              مشاهده نمونه انجمن‌ها
            </button>
            <Button type="button" className="mt-8 h-12 w-full max-w-xs bg-emerald-500 text-base text-white hover:bg-emerald-400" onClick={onCreate}>
              + انجمن جدید
            </Button>
          </div>
        )}

        {examples && (
          <div className="mx-auto max-w-lg space-y-3 pt-2">
            <button type="button" className="text-sm text-emerald-300" onClick={() => setExamples(null)}>
              بازگشت
            </button>
            <h2 className="text-base font-semibold">نمونه انجمن‌ها</h2>
            {examples.length === 0 ? (
              <p className="text-sm text-emerald-100/55">هنوز انجمن عمومی‌ای برای نمایش نیست. می‌توانی اولین انجمن را بسازی.</p>
            ) : (
              examples.map((ex) => (
                <div key={ex.id} className="flex items-center gap-3 rounded-2xl bg-white/5 p-3">
                  <span className="grid size-12 place-items-center rounded-2xl text-lg font-semibold text-[#071614]" style={{ background: ex.color }}>
                    {ex.name.slice(0, 1)}
                  </span>
                  <div className="min-w-0 flex-1 text-right">
                    <p className="truncate font-medium">{ex.name}</p>
                    <p className="truncate text-[12px] text-emerald-100/55">{ex.description || `${ex.memberCount} عضو · ${ex.groupCount} گروه`}</p>
                  </div>
                  {ex.joined ? (
                    <Button type="button" size="sm" variant="secondary" onClick={() => onOpenCommunity(ex.id)}>
                      باز کردن
                    </Button>
                  ) : (
                    <Button type="button" size="sm" className="bg-emerald-500 text-white hover:bg-emerald-400" onClick={() => void joinExample(ex.id)}>
                      پیوستن
                    </Button>
                  )}
                </div>
              ))
            )}
          </div>
        )}

        {mine && mine.length > 0 && !examples && (
          <ul className="mx-auto max-w-lg space-y-3 pt-1">
            {mine.map((c) => {
              const expanded = openId === c.id;
              const announce = c.channels[0];
              return (
                <li key={c.id} className="overflow-hidden rounded-2xl bg-white/5">
                  <button
                    type="button"
                    className="flex w-full items-center gap-3 px-3 py-3 text-right"
                    onClick={() => setOpenId(expanded ? null : c.id)}
                    aria-expanded={expanded}
                  >
                    <span className="grid size-12 shrink-0 place-items-center rounded-2xl text-lg font-semibold text-[#071614]" style={{ background: c.color }}>
                      {c.name.slice(0, 1)}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate font-medium">{c.name}</span>
                      <span className="text-[12px] text-emerald-100/50">{c.memberCount} عضو · {c.groups.length} گروه</span>
                    </span>
                    <ChevronDown className={cn("size-4 text-emerald-100/40 transition", expanded && "rotate-180")} />
                  </button>
                  {expanded && (
                    <div className="border-t border-white/5 pb-2">
                      {announce && (
                        <button
                          type="button"
                          className="flex w-full items-center gap-3 px-3 py-2.5 text-right hover:bg-white/5"
                          onClick={() => onOpenCommunity(c.id)}
                        >
                          <span className="grid size-10 place-items-center rounded-full bg-emerald-500/20 text-emerald-200">
                            <Megaphone className="size-4" />
                          </span>
                          <span className="min-w-0 flex-1">
                            <span className="block text-sm">{announce.name || "اعلانات عمومی"}</span>
                            <span className="text-[11px] text-emerald-100/45">گروه اعلانات عمومی</span>
                          </span>
                          <ChevronLeft className="size-4 text-emerald-100/30" />
                        </button>
                      )}
                      {c.groups.map((g) => (
                        <button
                          key={g.id}
                          type="button"
                          className="flex w-full items-center gap-3 px-3 py-2.5 text-right hover:bg-white/5"
                          onClick={() => onOpenGroup(g.id)}
                        >
                          <span className="grid size-10 place-items-center rounded-full text-sm font-semibold text-[#071614]" style={{ background: g.color }}>
                            {g.name.slice(0, 1)}
                          </span>
                          <span className="min-w-0 flex-1">
                            <span className="block text-sm">{g.name}</span>
                            <span className="text-[11px] text-emerald-100/45">{g.memberCount} عضو</span>
                          </span>
                          <ChevronLeft className="size-4 text-emerald-100/30" />
                        </button>
                      ))}
                      {!announce && c.groups.length === 0 && (
                        <p className="px-3 py-2 text-[12px] text-emerald-100/45">هنوز زیرگروهی نیست.</p>
                      )}
                      <button type="button" className="px-3 py-2 text-[12px] text-emerald-300" onClick={() => onOpenCommunity(c.id)}>
                        مشاهده انجمن
                      </button>
                    </div>
                  )}
                </li>
              );
            })}
            <Button type="button" className="h-12 w-full bg-emerald-500 text-white hover:bg-emerald-400" onClick={onCreate}>
              + انجمن جدید
            </Button>
          </ul>
        )}

        {mine === null && <p className="py-16 text-center text-sm text-emerald-100/45">در حال بارگذاری…</p>}
      </div>
    </div>
  );
}

function CommunityArt() {
  return (
    <svg width="220" height="150" viewBox="0 0 220 150" aria-hidden className="text-emerald-300">
      <ellipse cx="110" cy="128" rx="72" ry="10" fill="currentColor" opacity="0.12" />
      <circle cx="110" cy="58" r="36" fill="#0b3d36" stroke="currentColor" strokeWidth="2" />
      <circle cx="110" cy="46" r="12" fill="#34d399" />
      <path d="M88 78c6-14 38-14 44 0v8H88z" fill="#34d399" />
      <circle cx="58" cy="72" r="22" fill="#102824" stroke="#6ee7b7" strokeWidth="2" />
      <circle cx="58" cy="64" r="8" fill="#6ee7b7" />
      <circle cx="162" cy="72" r="22" fill="#102824" stroke="#6ee7b7" strokeWidth="2" />
      <circle cx="162" cy="64" r="8" fill="#6ee7b7" />
      <path d="M40 118c18-22 50-22 70 0" fill="none" stroke="#34d399" strokeWidth="2" opacity="0.5" />
      <path d="M110 118c20-22 52-22 70 0" fill="none" stroke="#34d399" strokeWidth="2" opacity="0.5" />
    </svg>
  );
}
