"use client";

import { useState } from "react";
import Link from "next/link";
import { toast } from "sonner";
import { BackgroundPicker } from "@/components/background-picker";
import { NixoMark } from "@/components/nixo-mark";
import { ThemeApplicator } from "@/components/theme-applicator";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { defaultAppearance, DEFAULT_CUSTOM_THEME, type Appearance, type BubbleStyle, type TextSize, type ThemeMode } from "@/lib/appearance-types";
import { backgroundPreview } from "@/lib/background-style";
import { cn } from "@/lib/utils";

export function AppearanceSettings({ initial, mode }: { initial: Appearance; mode: "app" | "chat" }) {
  const [draft, setDraft] = useState<Appearance>(initial);
  const [previewing, setPreviewing] = useState(true);
  const [busy, setBusy] = useState(false);
  const live = previewing ? draft : initial;

  async function apply() {
    setBusy(true);
    try {
      const res = await fetch("/api/appearance", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(draft),
      });
      const data = await res.json();
      if (!res.ok) {
        toast.error(data.error ?? "اعمال نشد.");
        return;
      }
      setDraft(data.appearance);
      setPreviewing(false);
      toast.success("ظاهر نیکسو ذخیره شد.");
      window.location.reload();
    } finally {
      setBusy(false);
    }
  }

  async function reset() {
    setBusy(true);
    try {
      const res = await fetch("/api/appearance", { method: "DELETE" });
      if (!res.ok) {
        toast.error("بازنشانی نشد.");
        return;
      }
      setDraft(defaultAppearance());
      toast.success("ظاهر به پیش‌فرض نیکسو برگشت.");
      window.location.reload();
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="min-h-dvh px-4 py-8 text-[var(--nixo-text,#ecfdf5)]" style={backgroundPreview(live.appBackground, live.appBackground.kind === "upload" ? undefined : undefined)}>
      <ThemeApplicator appearance={live} />
      <div className="mx-auto w-full max-w-lg space-y-6">
        <header className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <NixoMark size={36} />
            <div>
              <p className="text-xs opacity-70">تنظیمات → {mode === "chat" ? "ظاهر گفتگو" : "ظاهر"}</p>
              <p className="text-lg font-semibold">{mode === "chat" ? "پس‌زمینه گفتگو" : "ظاهر نیکسو"}</p>
            </div>
          </div>
          <Link href="/app" className="text-sm text-amber-200">بازگشت</Link>
        </header>

        {mode === "app" && (
          <>
            <section className="space-y-2">
              <Label>تم</Label>
              <div className="flex flex-wrap gap-2">
                {(["light", "dark", "system"] as ThemeMode[]).map((t) => (
                  <Chip key={t} active={draft.theme === t} onClick={() => setDraft({ ...draft, theme: t })}>
                    {t === "light" ? "روشن" : t === "dark" ? "تیره" : "سیستم"}
                  </Chip>
                ))}
              </div>
            </section>
            <BackgroundPicker value={draft.appBackground} onChange={(appBackground) => setDraft({ ...draft, appBackground })} label="پس‌زمینه برنامه" />
            <section className="space-y-2">
              <Label>تم سفارشی</Label>
              <div className="grid grid-cols-2 gap-3 text-xs">
                {(
                  [
                    ["main", "رنگ اصلی"],
                    ["secondary", "رنگ ثانویه"],
                    ["accent", "اکسنت"],
                    ["background", "پس‌زمینه"],
                    ["text", "متن"],
                    ["bubble", "حباب پیام"],
                  ] as const
                ).map(([key, fa]) => (
                  <label key={key} className="flex items-center justify-between gap-2 rounded-xl bg-black/20 px-3 py-2">
                    {fa}
                    <input
                      type="color"
                      value={(draft.customTheme ?? DEFAULT_CUSTOM_THEME)[key]}
                      onChange={(e) =>
                        setDraft({
                          ...draft,
                          customTheme: { ...(draft.customTheme ?? DEFAULT_CUSTOM_THEME), [key]: e.target.value },
                        })
                      }
                    />
                  </label>
                ))}
              </div>
              <Button type="button" variant="ghost" className="text-amber-200" onClick={() => setDraft({ ...draft, customTheme: null })}>
                حذف تم سفارشی
              </Button>
            </section>
            <section className="space-y-2">
              <Label>اندازه متن گفتگو</Label>
              <div className="flex flex-wrap gap-2">
                {(["small", "medium", "large", "xl"] as TextSize[]).map((s) => (
                  <Chip key={s} active={draft.textSize === s} onClick={() => setDraft({ ...draft, textSize: s })}>
                    {s === "small" ? "کوچک" : s === "medium" ? "متوسط" : s === "large" ? "بزرگ" : "خیلی بزرگ"}
                  </Chip>
                ))}
              </div>
            </section>
            <section className="space-y-2">
              <Label>سبک حباب پیام</Label>
              <div className="flex flex-wrap gap-2">
                {(["classic", "rounded", "minimal", "compact"] as BubbleStyle[]).map((s) => (
                  <Chip key={s} active={draft.bubbleStyle === s} onClick={() => setDraft({ ...draft, bubbleStyle: s })}>
                    {s === "classic" ? "کلاسیک" : s === "rounded" ? "گرد" : s === "minimal" ? "مینیمال" : "فشرده"}
                  </Chip>
                ))}
              </div>
            </section>
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={draft.syncAppearance}
                onChange={(e) => setDraft({ ...draft, syncAppearance: e.target.checked })}
              />
              همگام‌سازی ظاهر بین دستگاه‌های مجاز این حساب
            </label>
          </>
        )}

        {mode === "chat" && (
          <>
          <BackgroundPicker
            value={draft.chatBackground}
            onChange={(chatBackground) => setDraft({ ...draft, chatBackground })}
            label="پس‌زمینه پیش‌فرض همهٔ گفتگوها"
          />
          <section className="space-y-2">
            <Label>تصاویر public</Label>
            <div className="grid grid-cols-2 gap-2">
              {["/wallpapers/aurora.svg", "/wallpapers/dusk.svg", "/wallpapers/mist.svg", "/wallpapers/nixo-grid.svg"].map((path) => (
                <button
                  key={path}
                  type="button"
                  className="overflow-hidden rounded-xl border border-white/10"
                  onClick={() => setDraft({ ...draft, chatBackground: { kind: "public", path } })}
                >
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={path} alt="" className="h-16 w-full object-cover" />
                </button>
              ))}
            </div>
          </section>
          </>
        )}

        <div className="rounded-2xl border border-white/10 p-4">
          <p className="mb-2 text-xs opacity-70">پیش‌نمایش زنده گفتگو</p>
          <div className="nixo-glass-panel space-y-2 rounded-2xl p-3" style={backgroundPreview(mode === "chat" ? draft.chatBackground : draft.appBackground)}>
            <p className={cn("max-w-[80%] bg-[var(--nixo-bubble,#fbbf24)] px-3 text-[var(--nixo-bubble-text,#102824)]", bubbleClass(draft.bubbleStyle), textClass(draft.textSize))}>
              سلام از نیکسو
            </p>
            <p className={cn("ms-auto max-w-[80%] bg-black/30 px-3", bubbleClass(draft.bubbleStyle), textClass(draft.textSize))}>
              ظاهر، فونت و پس‌زمینه همین‌جا دیده می‌شود.
            </p>
          </div>
        </div>

        <div className="flex flex-wrap gap-2">
          <Button type="button" variant="outline" className="border-white/15 bg-transparent" onClick={() => setPreviewing(true)}>
            پیش‌نمایش
          </Button>
          <Button type="button" className="bg-amber-300 text-[#102824]" disabled={busy} onClick={apply}>
            اعمال
          </Button>
          <Button type="button" variant="ghost" onClick={() => { setDraft(initial); setPreviewing(false); }}>
            انصراف
          </Button>
          <Button type="button" variant="ghost" className="text-amber-200" disabled={busy} onClick={reset}>
            بازگشت به پیش‌فرض
          </Button>
        </div>
        <p className="text-xs leading-6 opacity-60">
          ظاهر و پس‌زمینه روی حریم خصوصی اثر نمی‌گذارند؛ عکس‌های گالری فقط برای حساب شما ذخیره می‌شوند و عمومی نیستند.
        </p>
      </div>
    </div>
  );
}

function Chip({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn("rounded-full px-3 py-1 text-xs", active ? "bg-amber-300 text-[#102824]" : "bg-black/25")}
    >
      {children}
    </button>
  );
}

function bubbleClass(style: BubbleStyle) {
  if (style === "classic") return "rounded-md py-2";
  if (style === "minimal") return "rounded-none border border-white/20 py-2";
  if (style === "compact") return "rounded-lg py-1";
  return "rounded-2xl py-2";
}

function textClass(size: TextSize) {
  if (size === "small") return "text-xs leading-5";
  if (size === "large") return "text-base leading-7";
  if (size === "xl") return "text-lg leading-8";
  return "text-sm leading-6";
}
