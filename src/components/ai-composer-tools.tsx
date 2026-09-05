"use client";

import { Button } from "@/components/ui/button";
import { NIXO_AI_UNAVAILABLE } from "@/lib/nixo-ai-copy";
import { Sparkles } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

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
  const [busy, setBusy] = useState(false);

  async function run(intent: "rewrite" | "translate" | "grammar" | "reply" | "summarize") {
    const src = intent === "reply" || intent === "summarize" ? lastIncoming || draft : draft;
    if (!src.trim() || busy) return;
    setBusy(true);
    try {
      const prompt =
        intent === "translate"
          ? `Translate the following into ${lang === "fa" ? "Persian" : lang === "tr" ? "Turkish" : "English"}. Return only the translation:\n\n${src}`
          : intent === "grammar"
            ? `Improve grammar and clarity. Return only the revised text:\n\n${src}`
            : intent === "rewrite"
              ? `Rewrite more clearly. Return only the rewritten text:\n\n${src}`
              : intent === "summarize"
                ? `Summarize concisely:\n\n${src}`
                : `Suggest a short reply to this message:\n\n${src}`;
      const res = await fetch("/api/nixo-ai", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ prompt, intent }),
      });
      const data = await res.json().catch(() => ({ error: NIXO_AI_UNAVAILABLE }));
      const text = typeof data.text === "string" ? data.text.trim() : "";
      if (!res.ok || !text) {
        toast.error(typeof data.error === "string" ? data.error : NIXO_AI_UNAVAILABLE);
        return;
      }
      onDraft(text);
      setOpen(false);
    } catch {
      toast.error(NIXO_AI_UNAVAILABLE);
    } finally {
      setBusy(false);
    }
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
        disabled={busy}
        onClick={() => setOpen((v) => !v)}
      >
        <Sparkles className={`size-4 ${busy ? "animate-pulse" : ""}`} />
      </Button>
      {open && (
        <div className="absolute bottom-12 end-0 z-30 w-56 rounded-2xl border border-white/10 bg-[#0b1824]/95 p-2 shadow-xl backdrop-blur">
          <p className="px-2 pb-1 text-[10px] text-emerald-100/50">{busy ? "Nixo AI در حال نوشتن…" : "Nixo AI · Gemini / OpenAI"}</p>
          <button type="button" disabled={busy} className="block w-full rounded-lg px-2 py-1.5 text-start text-xs hover:bg-white/10 disabled:opacity-50" onClick={() => void run("rewrite")}>
            بازنویسی
          </button>
          <button type="button" disabled={busy} className="block w-full rounded-lg px-2 py-1.5 text-start text-xs hover:bg-white/10 disabled:opacity-50" onClick={() => void run("grammar")}>
            بهبود
          </button>
          <button type="button" disabled={busy} className="block w-full rounded-lg px-2 py-1.5 text-start text-xs hover:bg-white/10 disabled:opacity-50" onClick={() => void run("translate")}>
            ترجمه
          </button>
          <button type="button" disabled={busy} className="block w-full rounded-lg px-2 py-1.5 text-start text-xs hover:bg-white/10 disabled:opacity-50" onClick={() => void run("reply")}>
            پیشنهاد پاسخ
          </button>
          <button type="button" disabled={busy} className="block w-full rounded-lg px-2 py-1.5 text-start text-xs hover:bg-white/10 disabled:opacity-50" onClick={() => void run("summarize")}>
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
        </div>
      )}
    </div>
  );
}
