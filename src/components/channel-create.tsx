"use client";

import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";

const COLORS = ["#fbbf24", "#34d399", "#7dd3fc", "#c4b5fd", "#fda4af", "#67e8f9"];

export function ChannelCreate({ onCreated, onClose }: { onCreated: (id: string) => void; onClose: () => void }) {
  const [step, setStep] = useState(0);
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [username, setUsername] = useState("");
  const [color, setColor] = useState(COLORS[0]!);
  const [visibility, setVisibility] = useState<"public" | "private">("public");
  const [busy, setBusy] = useState(false);

  async function create() {
    setBusy(true);
    try {
      const res = await fetch("/api/channels", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name,
          description,
          color,
          username: visibility === "public" ? username : username || undefined,
          visibility,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        toast.error(data.error ?? "ساخت کانال انجام نشد.");
        return;
      }
      toast.success("کانال ساخته شد.");
      onCreated(data.channel.id);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="fixed inset-0 z-40 grid place-items-center bg-black/70 p-4" onClick={onClose}>
      <div className="w-full max-w-md rounded-3xl bg-[#102824] p-5" onClick={(e) => e.stopPropagation()}>
        <p className="text-xs text-amber-200">ساخت کانال · مرحله {step + 1} از ۲</p>
        {step === 0 && (
          <>
            <h2 className="mt-1 text-lg font-semibold">نام، عکس و توضیحات</h2>
            <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="نام کانال" className="mt-3 bg-black/20" maxLength={48} />
            <Textarea value={description} onChange={(e) => setDescription(e.target.value)} placeholder="توضیحات" className="mt-2 min-h-20 bg-black/20" maxLength={800} />
            <p className="mt-2 text-xs">رنگ / عکس</p>
            <div className="mt-1 flex gap-2">
              {COLORS.map((c) => (
                <button key={c} type="button" className={cn("size-8 rounded-full", color === c && "ring-2 ring-white")} style={{ background: c }} onClick={() => setColor(c)} />
              ))}
            </div>
          </>
        )}
        {step === 1 && (
          <>
            <h2 className="mt-1 text-lg font-semibold">عمومی یا خصوصی</h2>
            <label className="mt-3 flex items-center gap-2 text-sm">
              <input type="radio" checked={visibility === "public"} onChange={() => setVisibility("public")} />
              عمومی — با @username در جستجو
            </label>
            <label className="mt-2 flex items-center gap-2 text-sm">
              <input type="radio" checked={visibility === "private"} onChange={() => setVisibility("private")} />
              خصوصی — فقط لینک دعوت / QR / دعوت مستقیم
            </label>
            <Input
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              placeholder={visibility === "public" ? "@username اجباری" : "@username اختیاری"}
              dir="ltr"
              className="mt-3 bg-black/20 text-left"
            />
          </>
        )}
        <div className="mt-4 flex gap-2">
          <Button type="button" variant="ghost" className="flex-1 text-white" onClick={step === 0 ? onClose : () => setStep(0)}>
            {step === 0 ? "انصراف" : "قبلی"}
          </Button>
          {step === 0 ? (
            <Button type="button" className="flex-1 bg-amber-300 text-[#102824]" disabled={name.trim().length < 2} onClick={() => setStep(1)}>
              بعدی
            </Button>
          ) : (
            <Button type="button" className="flex-1 bg-amber-300 text-[#102824]" disabled={busy || (visibility === "public" && username.trim().length < 3)} onClick={() => void create()}>
              ایجاد کانال
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}
