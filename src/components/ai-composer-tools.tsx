"use client";

import { runAiEngine, suggestReplies, translateText } from "@/lib/ai-engine";
import { Button } from "@/components/ui/button";
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
  const [lang, setLang] = useState<"fa" | "en" | "tr">("en");
  const suggestions = useMemo(() => (lastIncoming ? suggestReplies(lastIncoming) : []), [lastIncoming]);

  function run(intent: "rewrite" | "translate" | "grammar" | "reply") {
    const src = intent === "reply" ? lastIncoming || draft : draft;
    if (!src.trim()) return;
    const out = runAiEngine({
      text: src,
      intent: intent === "grammar" ? "grammar" : intent,
      lang,
    });
    onDraft(out.suggestions?.[0] ?? out.text.split("\n—")[0] ?? out.text);
  }

  return (
    <div className="space-y-1">
      <p className="text-[10px] leading-4 text-emerald-100/55">
        ابزار AI روی دستگاه است. متن چت E2EE به سرور نمی‌رود مگر در Settings → AI گزینهٔ ابری را روشن کنی.
      </p>
      <div className="flex flex-wrap gap-1">
        <Button type="button" size="xs" variant="secondary" onClick={() => run("rewrite")}>Rewrite</Button>
        <Button type="button" size="xs" variant="secondary" onClick={() => run("grammar")}>Improve</Button>
        <Button
          type="button"
          size="xs"
          variant="secondary"
          onClick={() => {
            if (!draft.trim()) return;
            onDraft(translateText(draft, lang));
          }}
        >
          Translate
        </Button>
        <select
          className="h-6 rounded bg-black/30 px-1 text-[10px]"
          value={lang}
          onChange={(e) => setLang(e.target.value as "fa" | "en" | "tr")}
        >
          <option value="fa">فارسی</option>
          <option value="en">English</option>
          <option value="tr">Türkçe</option>
        </select>
        <Button type="button" size="xs" variant="secondary" onClick={() => run("reply")}>Generate Reply</Button>
      </div>
      {suggestions.length > 0 && (
        <div className="flex flex-wrap gap-1">
          {suggestions.map((s) => (
            <button
              key={s}
              type="button"
              className="rounded-full bg-white/10 px-2 py-0.5 text-[10px]"
              onClick={() => onDraft(s)}
            >
              {s}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
