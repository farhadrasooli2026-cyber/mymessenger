"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { ArrowRight, Copy, RefreshCw, Send, Square, Volume2 } from "lucide-react";
import { toast } from "sonner";
import { NixoMark } from "@/components/nixo-mark";
import { NIXO_AI_UNAVAILABLE } from "@/lib/nixo-ai-copy";
import { cn } from "@/lib/utils";

type Msg = {
  id: string;
  role: "user" | "assistant";
  text: string;
};

export function AiDesk() {
  const [chatId, setChatId] = useState<string | null>(null);
  const [messages, setMessages] = useState<Msg[]>([]);
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<"idle" | "thinking" | "generating">("idle");
  const abort = useRef(false);
  const scroller = useRef<HTMLDivElement>(null);
  const field = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    const el = scroller.current;
    if (!el) return;
    el.scrollTop = el.scrollHeight;
  }, [messages, status]);

  function resizeField() {
    const el = field.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, 160)}px`;
  }

  async function send(payload: { text: string; regenerate?: boolean }) {
    abort.current = false;
    const prompt = payload.text.trim();
    if (!prompt) return;

    const optimistic: Msg | null = payload.regenerate
      ? null
      : { id: `local-${Date.now()}`, role: "user", text: prompt };
    if (optimistic) setMessages((m) => [...m, optimistic]);

    setBusy(true);
    setStatus("thinking");
    const think = window.setTimeout(() => {
      if (!abort.current) setStatus("generating");
    }, 280);
    try {
      const history = messages
        .filter((m) => m.role === "user" || m.role === "assistant")
        .slice(-16)
        .map((m) => ({ role: m.role, text: m.text }));
      const res = await fetch("/api/nixo-ai", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          prompt,
          chatId: chatId || undefined,
          regenerate: Boolean(payload.regenerate),
          messages: history,
        }),
      });
      const data = await res.json().catch(() => ({ error: NIXO_AI_UNAVAILABLE }));
      if (abort.current) return;
      if (!res.ok) {
        const err = typeof data.error === "string" && data.error.trim() ? data.error : NIXO_AI_UNAVAILABLE;
        toast.error(err);
        const assistant: Msg = data.assistant ?? { id: `err-${Date.now()}`, role: "assistant", text: err };
        setChatId(data.chatId ?? chatId);
        setMessages((m) => {
          const withoutTemp = optimistic ? m.filter((x) => x.id !== optimistic.id) : m;
          const userMsg = data.userMessage ?? optimistic;
          return [...withoutTemp, userMsg, assistant].filter(Boolean) as Msg[];
        });
        return;
      }
      setChatId(data.chatId);
      setMessages((m) => {
        const withoutTemp = optimistic ? m.filter((x) => x.id !== optimistic.id) : m;
        return [...withoutTemp, data.userMessage, data.assistant].filter(Boolean);
      });
    } catch {
      toast.error(NIXO_AI_UNAVAILABLE);
      setMessages((m) => [...m, { id: `err-${Date.now()}`, role: "assistant", text: NIXO_AI_UNAVAILABLE }]);
    } finally {
      window.clearTimeout(think);
      setBusy(false);
      setStatus("idle");
    }
  }

  const lastUser = [...messages].reverse().find((m) => m.role === "user")?.text ?? "";

  function speak(t: string) {
    if (!("speechSynthesis" in window)) {
      toast.message("Text-to-Speech در این مرورگر نیست.");
      return;
    }
    const u = new SpeechSynthesisUtterance(t.slice(0, 4000));
    u.lang = /[آ-ی]/.test(t) ? "fa-IR" : "en-US";
    window.speechSynthesis.cancel();
    window.speechSynthesis.speak(u);
  }

  return (
    <main className="flex min-h-dvh flex-col bg-[#0b1211] text-emerald-50">
      <header className="sticky top-0 z-10 flex items-center gap-2 border-b border-white/8 bg-[#0b1211]/90 px-3 py-3 backdrop-blur-md">
        <Link
          href="/app"
          className="inline-flex h-10 items-center gap-2 rounded-full px-3 text-sm text-emerald-50 hover:bg-white/10"
          aria-label="بازگشت به گفتگوها"
        >
          <ArrowRight className="size-5" aria-hidden />
          <span>بازگشت</span>
        </Link>
        <div className="mx-auto flex items-center gap-2 pe-16">
          <NixoMark size={28} />
          <p className="text-sm font-semibold tracking-wide">NIXO AI</p>
        </div>
      </header>

      <div ref={scroller} className="mx-auto flex w-full max-w-2xl flex-1 flex-col overflow-auto px-4 py-6">
        {messages.length === 0 && status === "idle" && (
          <div className="flex flex-1 flex-col items-center justify-center pb-16 text-center">
            <NixoMark size={56} className="opacity-90" />
            <h1 className="mt-5 text-2xl font-semibold tracking-tight">NIXO AI</h1>
            <p className="mt-2 max-w-sm text-sm leading-7 text-emerald-100/55">
              بپرس، ترجمه کن، کد بنویس یا خلاصه بخواه. نیت را خودش تشخیص می‌دهد.
            </p>
          </div>
        )}
        <div className="space-y-5">
          {messages.map((m) => (
            <article key={m.id} className={cn("max-w-[92%]", m.role === "user" ? "ms-auto" : "me-auto")}>
              <div
                className={cn(
                  "rounded-[1.4rem] px-4 py-3 text-[15px] leading-7",
                  m.role === "user" ? "bg-emerald-500/20" : "bg-white/[0.06]",
                )}
                dir={/[آ-ی]/.test(m.text) ? "rtl" : "ltr"}
              >
                <p className="whitespace-pre-wrap">{m.text}</p>
              </div>
              {m.role === "assistant" && (
                <div className="mt-1.5 flex gap-1 text-emerald-100/50">
                  <button
                    type="button"
                    className="grid size-8 place-items-center rounded-full hover:bg-white/10 hover:text-emerald-50"
                    aria-label="Copy"
                    onClick={() => void navigator.clipboard.writeText(m.text).then(() => toast.success("کپی شد."))}
                  >
                    <Copy className="size-3.5" />
                  </button>
                  <button
                    type="button"
                    className="grid size-8 place-items-center rounded-full hover:bg-white/10 hover:text-emerald-50"
                    aria-label="TTS"
                    onClick={() => speak(m.text)}
                  >
                    <Volume2 className="size-3.5" />
                  </button>
                  <button
                    type="button"
                    className="grid size-8 place-items-center rounded-full hover:bg-white/10 hover:text-emerald-50"
                    aria-label="Regenerate"
                    disabled={busy || !lastUser}
                    onClick={() => void send({ text: lastUser, regenerate: true })}
                  >
                    <RefreshCw className="size-3.5" />
                  </button>
                </div>
              )}
            </article>
          ))}
          {status !== "idle" && (
            <article className="me-auto max-w-[92%] rounded-[1.4rem] bg-white/[0.06] px-4 py-3" aria-live="polite">
              <div className="flex items-center gap-2 text-xs text-emerald-100/70">
                <span className="flex gap-1">
                  <span className="size-1.5 animate-bounce rounded-full bg-emerald-200 [animation-delay:-0.2s]" />
                  <span className="size-1.5 animate-bounce rounded-full bg-emerald-200 [animation-delay:-0.1s]" />
                  <span className="size-1.5 animate-bounce rounded-full bg-emerald-200" />
                </span>
                {status === "thinking" ? "در حال فکر کردن…" : "در حال نوشتن…"}
              </div>
            </article>
          )}
        </div>
      </div>

      <form
        className="mx-auto w-full max-w-2xl px-4 pb-[max(1rem,env(safe-area-inset-bottom))] pt-2"
        onSubmit={(e) => {
          e.preventDefault();
          const t = text.trim();
          if (!t || busy) return;
          setText("");
          requestAnimationFrame(() => {
            if (field.current) {
              field.current.style.height = "auto";
            }
          });
          void send({ text: t });
        }}
      >
        <div className="flex items-end gap-2 rounded-[1.75rem] border border-white/10 bg-white/[0.06] px-3 py-2 shadow-[0_12px_40px_rgba(0,0,0,0.28)] focus-within:border-emerald-400/40">
          <textarea
            ref={field}
            value={text}
            rows={1}
            disabled={busy}
            placeholder="از NIXO AI بپرس…"
            aria-label="پیام Nixo AI"
            className="max-h-40 min-h-11 flex-1 resize-none bg-transparent py-2.5 text-[15px] leading-6 outline-none placeholder:text-emerald-100/35"
            onChange={(e) => {
              setText(e.target.value);
              resizeField();
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                e.currentTarget.form?.requestSubmit();
              }
            }}
          />
          {busy ? (
            <button
              type="button"
              className="mb-0.5 grid size-10 shrink-0 place-items-center rounded-full bg-white/10 text-emerald-50"
              aria-label="توقف"
              onClick={() => {
                abort.current = true;
                setBusy(false);
                setStatus("idle");
              }}
            >
              <Square className="size-3.5 fill-current" />
            </button>
          ) : (
            <button
              type="submit"
              disabled={!text.trim()}
              className="mb-0.5 grid size-10 shrink-0 place-items-center rounded-full bg-emerald-400 text-[#071614] disabled:opacity-35"
              aria-label="ارسال"
            >
              <Send className="size-4" />
            </button>
          )}
        </div>
      </form>
    </main>
  );
}
