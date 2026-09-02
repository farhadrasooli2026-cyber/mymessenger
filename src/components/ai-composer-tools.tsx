"use client";

import { runAiEngine, suggestReplies, translateText } from "@/lib/ai-engine";
import { Button } from "@/components/ui/button";
import { Sparkles } from "lucide-react";
import { useMemo, useState } from "react";

export function AiComposerTools({
  draft,
  onDraft,
  lastIncoming,
}: {
  draft: string;
  onDraft: (next: string) => void;
  lastIncoming?: string;
}) {
  const [open, setOpen] = useState(false);
  const [lang, setLang] = useState<"fa" | "en" | "tr">("en");
  const suggestions = useMemo(() => (lastIncoming ? suggestReplies(lastIncoming) : []), [lastIncoming]);

  function run(intent: "rewrite" | "translate" | "grammar" | "reply" | "summarize") {
    const src = intent === "reply" || intent === "summarize" ? lastIncoming || draft : draft;
    if (!src.trim()) return;
    const out = runAiEngine({
      text: src,
      intent: intent === "grammar" ? "grammar" : intent === "summarize" ? "rewrite" : intent,
      lang,
    });
    onDraft(out.suggestions?.[0] ?? out.text.split("\n—")[0] ?? out.text);
    setOpen(false);
  }

  return (
    <div className="relative">
      <Button
        type="button"
        size="icon"
        variant="ghost"
        className="size-10 shrink-0 text-cyan-200 hover:bg-white/10"
        aria-label="ابزار هوش مصنوعی"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
      >
        <Sparkles className="size-4" />
      </Button>
      {open && (
        <div className="absolute bottom-12 end-0 z-30 w-56 rounded-2xl border border-white/10 bg-[#0b1824]/95 p-2 shadow-xl backdrop-blur">
          <p className="px-2 pb-1 text-[10px] text-emerald-100/50">روی دستگاه · متن به سرور نمی‌رود</p>
          <button type="button" className="block w-full rounded-lg px-2 py-1.5 text-start text-xs hover:bg-white/10" onClick={() => run("rewrite")}>
            بازنویسی
          </button>
          <button type="button" className="block w-full rounded-lg px-2 py-1.5 text-start text-xs hover:bg-white/10" onClick={() => run("grammar")}>
            بهبود
          </button>
          <button
            type="button"
            className="block w-full rounded-lg px-2 py-1.5 text-start text-xs hover:bg-white/10"
            onClick={() => {
              if (!draft.trim()) return;
              onDraft(translateText(draft, lang));
              setOpen(false);
            }}
          >
            ترجمه
          </button>
          <button type="button" className="block w-full rounded-lg px-2 py-1.5 text-start text-xs hover:bg-white/10" onClick={() => run("reply")}>
            پیشنهاد پاسخ
          </button>
          <button type="button" className="block w-full rounded-lg px-2 py-1.5 text-start text-xs hover:bg-white/10" onClick={() => run("summarize")}>
            خلاصه
          </button>
          <select
            className="mt-1 h-7 w-full rounded-lg bg-black/40 px-2 text-[10px]"
            value={lang}
            onChange={(e) => setLang(e.target.value as "fa" | "en" | "tr")}
          >
            <option value="fa">فارسی</option>
            <option value="en">English</option>
            <option value="tr">Türkçe</option>
          </select>
          {suggestions.length > 0 && (
            <div className="mt-2 space-y-1 border-t border-white/10 pt-2">
              {suggestions.map((s) => (
                <button
                  key={s}
                  type="button"
                  className="block w-full truncate rounded-lg px-2 py-1 text-start text-[10px] text-emerald-100/70 hover:bg-white/10"
                  onClick={() => {
                    onDraft(s);
                    setOpen(false);
                  }}
                >
                  {s}
                </button>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
