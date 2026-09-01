"use client";

import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import { PhotoPicker, type PhotoValue } from "@/components/photo-picker";
import { PURPOSE_FA, type ChannelPurpose } from "@/lib/channel-types";

const COLORS = ["#fbbf24", "#34d399", "#7dd3fc", "#c4b5fd", "#fda4af", "#67e8f9"];

export function ChannelCreate({ onCreated, onClose }: { onCreated: (id: string) => void; onClose: () => void }) {
  const [step, setStep] = useState(0);
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [username, setUsername] = useState("");
  const [color, setColor] = useState(COLORS[0]!);
  const [photo, setPhoto] = useState<PhotoValue>({ kind: "default" });
  const [visibility, setVisibility] = useState<"public" | "private">("public");
  const [purpose, setPurpose] = useState<ChannelPurpose>("general");
  const [joinMode, setJoinMode] = useState<"invite" | "request">("invite");
  const [busy, setBusy] = useState(false);

  function photoDataUrl() {
    if (photo.kind === "upload") return photo.dataUrl;
    if (photo.kind === "catalog") return photo.previewUrl;
    return null;
  }

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
          photoDataUrl: photoDataUrl(),
          username: visibility === "public" ? username : username || undefined,
          visibility,
          joinMode: visibility === "private" ? joinMode : "open",
          purpose,
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
      <div className="max-h-[92dvh] w-full max-w-md overflow-auto rounded-3xl bg-[#102824] p-5" onClick={(e) => e.stopPropagation()}>
        <p className="text-xs text-amber-200">Create Channel · مرحله {step + 1} از ۴</p>
        {step === 0 && (
          <>
            <h2 className="mt-1 text-lg font-semibold">Channel Name</h2>
            <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="نام کانال" className="mt-3 bg-black/20" maxLength={48} />
          </>
        )}
        {step === 1 && (
          <>
            <h2 className="mt-1 text-lg font-semibold">Channel Photo</h2>
            <p className="mt-1 text-[11px] text-emerald-100/55">گالری، دوربین، یا تصاویر داخلی نیکسو.</p>
            <div className="mt-3">
              <PhotoPicker value={photo} onChange={setPhoto} />
            </div>
            <p className="mt-3 text-xs">رنگ جایگزین</p>
            <div className="mt-1 flex gap-2">
              {COLORS.map((c) => (
                <button key={c} type="button" className={cn("size-8 rounded-full", color === c && "ring-2 ring-white")} style={{ background: c }} onClick={() => setColor(c)} />
              ))}
            </div>
          </>
        )}
        {step === 2 && (
          <>
            <h2 className="mt-1 text-lg font-semibold">Description</h2>
            <Textarea value={description} onChange={(e) => setDescription(e.target.value)} placeholder="توضیحات و قوانین کوتاه" className="mt-3 min-h-28 bg-black/20" maxLength={800} />
            <p className="mt-2 text-xs">موضوع کانال کسب‌وکار</p>
            <div className="mt-1 flex flex-wrap gap-1">
              {(Object.keys(PURPOSE_FA) as ChannelPurpose[]).map((p) => (
                <button key={p} type="button" className={cn("rounded-full px-2 py-1 text-[11px]", purpose === p ? "bg-amber-300 text-[#102824]" : "bg-white/10")} onClick={() => setPurpose(p)}>
                  {PURPOSE_FA[p]}
                </button>
              ))}
            </div>
          </>
        )}
        {step === 3 && (
          <>
            <h2 className="mt-1 text-lg font-semibold">Privacy</h2>
            <label className="mt-3 flex items-center gap-2 text-sm">
              <input type="radio" checked={visibility === "public"} onChange={() => setVisibility("public")} />
              Public — @username یکتا در Search
            </label>
            <label className="mt-2 flex items-center gap-2 text-sm">
              <input type="radio" checked={visibility === "private"} onChange={() => setVisibility("private")} />
              Private — Invite Link، دعوت مستقیم، یا Join Request
            </label>
            {visibility === "private" && (
              <div className="mt-2 space-y-1 text-sm">
                <label className="flex items-center gap-2">
                  <input type="radio" checked={joinMode === "invite"} onChange={() => setJoinMode("invite")} />
                  فقط لینک / دعوت
                </label>
                <label className="flex items-center gap-2">
                  <input type="radio" checked={joinMode === "request"} onChange={() => setJoinMode("request")} />
                  Join Request برای تأیید ادمین
                </label>
              </div>
            )}
            <Input
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              placeholder={visibility === "public" ? "@nixo_news اجباری" : "@username اختیاری"}
              dir="ltr"
              className="mt-3 bg-black/20 text-left"
            />
            <p className="mt-3 text-xs text-emerald-100/55">{name || "بدون نام"} · Username روی سرور یکتا است.</p>
          </>
        )}
        <div className="mt-4 flex gap-2">
          <Button type="button" variant="ghost" className="flex-1 text-white" onClick={step === 0 ? onClose : () => setStep((s) => s - 1)}>
            {step === 0 ? "انصراف" : "قبلی"}
          </Button>
          {step < 3 ? (
            <Button type="button" className="flex-1 bg-amber-300 text-[#102824]" disabled={step === 0 && name.trim().length < 2} onClick={() => setStep((s) => s + 1)}>
              بعدی
            </Button>
          ) : (
            <Button type="button" className="flex-1 bg-amber-300 text-[#102824]" disabled={busy || (visibility === "public" && username.trim().length < 3)} onClick={() => void create()}>
              Create
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}
