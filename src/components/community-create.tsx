"use client";

import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";

const COLORS = ["#fbbf24", "#34d399", "#7dd3fc", "#c4b5fd", "#fda4af", "#67e8f9"];

type OwnedGroup = { id: string; name: string; color: string; memberCount: number };

export function CommunityCreate({ onCreated, onClose }: { onCreated: (id: string) => void; onClose: () => void }) {
  const [step, setStep] = useState(0);
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [username, setUsername] = useState("");
  const [color, setColor] = useState(COLORS[0]!);
  const [joinMode, setJoinMode] = useState<"invite" | "request" | "open">("invite");
  const [picked, setPicked] = useState<string[]>([]);
  const [channelNames, setChannelNames] = useState("اطلاعیه‌ها\nاخبار");
  const [groups, setGroups] = useState<OwnedGroup[]>([]);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    fetch("/api/groups", { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (d) setGroups((d.groups ?? []) as OwnedGroup[]);
      })
      .catch(() => undefined);
  }, []);

  async function create() {
    setBusy(true);
    try {
      const res = await fetch("/api/communities", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name,
          description,
          color,
          username: username || undefined,
          joinMode,
          groupIds: picked,
          channelNames: channelNames.split("\n").map((s) => s.trim()).filter(Boolean),
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        toast.error(data.error ?? "ساخت جامعه انجام نشد.");
        return;
      }
      toast.success("جامعه ساخته شد.");
      onCreated(data.community.id);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="fixed inset-0 z-40 grid place-items-center bg-black/70 p-4" onClick={onClose}>
      <div className="w-full max-w-md rounded-3xl bg-[#102824] p-5" onClick={(e) => e.stopPropagation()}>
        <p className="text-xs text-amber-200">ساخت جامعه · مرحله {step + 1} از ۳</p>
        {step === 0 && (
          <>
            <h2 className="mt-1 text-lg font-semibold">نام، عکس و توضیحات</h2>
            <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="نام جامعه" className="mt-3 bg-black/20" maxLength={48} />
            <Input
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              placeholder="نام کاربری جامعه (اختیاری)"
              dir="ltr"
              className="mt-2 bg-black/20 text-left"
            />
            <Textarea value={description} onChange={(e) => setDescription(e.target.value)} placeholder="توضیحات" className="mt-2 min-h-20 bg-black/20" maxLength={800} />
            <p className="mt-2 text-xs">رنگ / عکس</p>
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
          </>
        )}
        {step === 1 && (
          <>
            <h2 className="mt-1 text-lg font-semibold">گروه‌ها و کانال‌ها</h2>
            <p className="mt-2 text-xs text-emerald-100/60">گروه‌هایی که مالکی را وصل کن. کانال‌های داخل جامعه را نام ببر (هر خط یکی).</p>
            <div className="mt-3 max-h-40 space-y-1 overflow-auto">
              {groups.length === 0 && <p className="text-xs text-emerald-100/50">هنوز گروهی نداری.</p>}
              {groups.map((g) => (
                <label key={g.id} className="flex items-center gap-2 rounded-xl bg-white/5 px-3 py-2 text-sm">
                  <input
                    type="checkbox"
                    checked={picked.includes(g.id)}
                    onChange={(e) =>
                      setPicked((list) => (e.target.checked ? [...list, g.id] : list.filter((id) => id !== g.id)))
                    }
                  />
                  {g.name}
                </label>
              ))}
            </div>
            <Textarea value={channelNames} onChange={(e) => setChannelNames(e.target.value)} className="mt-3 min-h-20 bg-black/20" />
            <p className="text-[10px] opacity-60">کانال جامعه برای اطلاع‌رسانی یک‌طرفه است؛ محصول کامل کانال نیکسو جدا می‌آید.</p>
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
              {name || "بدون نام"} · {picked.length} گروه · {channelNames.split("\n").filter((s) => s.trim()).length} کانال
            </p>
          </>
        )}
        <div className="mt-4 flex gap-2">
          <Button type="button" variant="ghost" className="flex-1 text-white" onClick={step === 0 ? onClose : () => setStep((s) => s - 1)}>
            {step === 0 ? "انصراف" : "قبلی"}
          </Button>
          {step < 2 ? (
            <Button type="button" className="flex-1 bg-amber-300 text-[#102824]" onClick={() => setStep((s) => s + 1)} disabled={step === 0 && name.trim().length < 2}>
              بعدی
            </Button>
          ) : (
            <Button type="button" className="flex-1 bg-amber-300 text-[#102824]" disabled={busy} onClick={() => void create()}>
              ایجاد جامعه
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}
