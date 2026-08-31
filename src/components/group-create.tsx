"use client";

import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { SEED_PEERS } from "@/lib/chat-copy";
import { cn } from "@/lib/utils";

const COLORS = ["#fbbf24", "#34d399", "#7dd3fc", "#c4b5fd", "#fda4af", "#67e8f9"];

export function GroupCreate({ onCreated, onClose }: { onCreated: (id: string) => void; onClose: () => void }) {
  const [step, setStep] = useState(0);
  const [picked, setPicked] = useState<string[]>([]);
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [username, setUsername] = useState("");
  const [color, setColor] = useState(COLORS[0]!);
  const [joinMode, setJoinMode] = useState<"invite" | "request" | "open">("invite");
  const [busy, setBusy] = useState(false);
  const [search, setSearch] = useState("");
  const [hits, setHits] = useState<{ id: string; displayName: string; username: string | null }[]>([]);

  async function create() {
    setBusy(true);
    try {
      const res = await fetch("/api/groups", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name,
          description,
          color,
          memberKeys: picked,
          joinMode,
          username: username || undefined,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        toast.error(data.error ?? "ساخت گروه انجام نشد.");
        return;
      }
      toast.success("گروه ساخته شد.");
      onCreated(data.group.id);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="fixed inset-0 z-40 grid place-items-center bg-black/70 p-4" onClick={onClose}>
      <div className="w-full max-w-md rounded-3xl bg-[#102824] p-5" onClick={(e) => e.stopPropagation()}>
        <p className="text-xs text-amber-200">ساخت گروه · مرحله {step + 1} از ۳</p>
        {step === 0 && (
          <>
            <h2 className="mt-1 text-lg font-semibold">انتخاب اعضا</h2>
            <div className="mt-3 max-h-48 space-y-1 overflow-auto">
              {SEED_PEERS.map((p) => (
                <label key={p.peerKey} className="flex items-center gap-2 rounded-xl bg-white/5 px-3 py-2 text-sm">
                  <input
                    type="checkbox"
                    checked={picked.includes(p.peerKey)}
                    onChange={(e) =>
                      setPicked((list) => (e.target.checked ? [...list, p.peerKey] : list.filter((k) => k !== p.peerKey)))
                    }
                  />
                  {p.peerName}
                </label>
              ))}
            </div>
            <div className="mt-3 flex gap-2">
              <Input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="@username"
                dir="ltr"
                className="h-9 bg-black/20 text-left text-xs"
              />
              <Button
                type="button"
                size="sm"
                variant="secondary"
                onClick={async () => {
                  const res = await fetch(`/api/users/search?q=${encodeURIComponent(search)}`);
                  const data = await res.json();
                  setHits(data.users ?? []);
                }}
              >
                جستجو
              </Button>
            </div>
            {hits.map((h) => (
              <button
                key={h.id}
                type="button"
                className="mt-1 block w-full rounded-lg bg-white/5 px-2 py-1 text-right text-xs"
                onClick={() => setPicked((list) => (list.includes(h.id) ? list : [...list, h.id]))}
              >
                {h.displayName} @{h.username}
              </button>
            ))}
          </>
        )}
        {step === 1 && (
          <>
            <h2 className="mt-1 text-lg font-semibold">نام، عکس و توضیحات</h2>
            <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="نام گروه" className="mt-3 bg-black/20" maxLength={48} />
            <Input
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              placeholder="نام کاربری گروه (اختیاری)"
              dir="ltr"
              className="mt-2 bg-black/20 text-left"
            />
            <Textarea value={description} onChange={(e) => setDescription(e.target.value)} placeholder="توضیحات" className="mt-2 min-h-20 bg-black/20" maxLength={500} />
            <p className="mt-2 text-xs">رنگ / عکس گروه</p>
            <div className="mt-1 flex gap-2">
              {COLORS.map((c) => (
                <button
                  key={c}
                  type="button"
                  className={cn("size-8 rounded-full", color === c && "ring-2 ring-white")}
                  style={{ background: c }}
                  onClick={() => setColor(c)}
                />
              ))}
            </div>
            <div
              className="mt-3 grid h-20 place-items-center rounded-2xl text-2xl font-semibold text-[#071614]"
              style={{ background: color }}
            >
              {name.slice(0, 1) || "گ"}
            </div>
          </>
        )}
        {step === 2 && (
          <>
            <h2 className="mt-1 text-lg font-semibold">نحوهٔ عضویت</h2>
            {(
              [
                ["invite", "فقط با لینک دعوت"],
                ["request", "درخواست عضویت (تأیید ادمین)"],
                ["open", "ورود مستقیم با لینک"],
              ] as const
            ).map(([id, label]) => (
              <label key={id} className="mt-2 flex items-center gap-2 text-sm">
                <input type="radio" checked={joinMode === id} onChange={() => setJoinMode(id)} />
                {label}
              </label>
            ))}
            <p className="mt-3 text-xs leading-6 text-emerald-100/60">
              {picked.length} عضو انتخاب شده · {name || "بدون نام"}
            </p>
          </>
        )}
        <div className="mt-4 flex gap-2">
          <Button type="button" variant="ghost" className="flex-1 text-white" onClick={step === 0 ? onClose : () => setStep((s) => s - 1)}>
            {step === 0 ? "انصراف" : "قبلی"}
          </Button>
          {step < 2 ? (
            <Button type="button" className="flex-1 bg-amber-300 text-[#102824]" onClick={() => setStep((s) => s + 1)} disabled={step === 1 && name.trim().length < 2}>
              بعدی
            </Button>
          ) : (
            <Button type="button" className="flex-1 bg-amber-300 text-[#102824]" disabled={busy} onClick={() => void create()}>
              ایجاد گروه
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}
