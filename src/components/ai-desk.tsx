"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { toast } from "sonner";
import { NixoMark } from "@/components/nixo-mark";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { AI_MODELS, AI_TOPICS, type AiTopic } from "@/lib/ai-types";

type Chat = { id: string; title: string; topic: string; model: string; updatedAt: number };
type Msg = {
  id: string;
  role: "user" | "assistant";
  text: string;
  imageSvg?: string | null;
  feedback?: string | null;
  generatedByAi?: boolean;
  confidence?: number;
  overridden?: boolean;
};

export function AiDesk() {
  const [chats, setChats] = useState<Chat[]>([]);
  const [chatId, setChatId] = useState<string | null>(null);
  const [messages, setMessages] = useState<Msg[]>([]);
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<"idle" | "thinking" | "generating">("idle");
  const [model, setModel] = useState("balanced");
  const [available, setAvailable] = useState(true);
  const [offlineNote, setOfflineNote] = useState<string | null>(null);
  const abort = useRef(false);
  const fileRef = useRef<HTMLInputElement>(null);

  function boot() {
    fetch("/api/ai", { cache: "no-store" })
      .then((r) => r.json())
      .then((d) => {
        if (d.ok) {
          setChats(d.chats ?? []);
          if (d.prefs?.model) setModel(d.prefs.model);
          setAvailable(d.available !== false);
          setOfflineNote(d.offlineNote ?? null);
        }
      })
      .catch(() => undefined);
  }

  useEffect(() => {
    boot();
  }, []);

  function loadChat(id: string) {
    fetch(`/api/ai?chatId=${encodeURIComponent(id)}`, { cache: "no-store" })
      .then((r) => r.json())
      .then((d) => {
        if (d.ok) {
          setChatId(id);
          setMessages(d.messages ?? []);
          setModel(d.chat?.model ?? model);
        }
      })
      .catch(() => undefined);
  }

  async function send(payload: Record<string, unknown>) {
    abort.current = false;
    setBusy(true);
    setStatus("thinking");
    const think = window.setTimeout(() => {
      if (!abort.current) setStatus("generating");
    }, 280);
    try {
      if (abort.current) return;
      const res = await fetch("/api/ai", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const data = await res.json();
      if (!res.ok) {
        toast.error(data.error ?? "AI پاسخ نداد.");
        return;
      }
      if (abort.current) {
        await fetch("/api/ai", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action: "stop", chatId: data.chatId }),
        });
        return;
      }
      setChatId(data.chatId);
      setMessages((m) => [...m, data.userMessage, data.assistant].filter(Boolean));
      boot();
    } finally {
      window.clearTimeout(think);
      setBusy(false);
      setStatus("idle");
    }
  }

  async function onNew(topic: AiTopic) {
    const res = await fetch("/api/ai", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "new", topic }),
    });
    const data = await res.json();
    if (data.ok) {
      setChatId(data.chat.id);
      setMessages([]);
      boot();
    }
  }

  const lastUser = [...messages].reverse().find((m) => m.role === "user")?.text ?? "";

  function speak(t: string) {
    if (!("speechSynthesis" in window)) {
      toast.message("Text-to-Speech در این مرورگر نیست.");
      return;
    }
    const u = new SpeechSynthesisUtterance(t.slice(0, 400));
    u.lang = /[آ-ی]/.test(t) ? "fa-IR" : "en-US";
    window.speechSynthesis.cancel();
    window.speechSynthesis.speak(u);
  }

  function listen() {
    const SR = (window as unknown as { webkitSpeechRecognition?: new () => { start: () => void; lang: string; onresult: (e: { results: { [k: number]: { [k: number]: { transcript: string } } } }) => void } }).webkitSpeechRecognition;
    if (!SR) {
      toast.message("Speech Recognition در این مرورگر پشتیبانی نمی‌شود.");
      return;
    }
    const rec = new SR();
    rec.lang = "fa-IR";
    rec.onresult = (e) => {
      const said = e.results[0]?.[0]?.transcript ?? "";
      setText((t) => `${t} ${said}`.trim());
    };
    rec.start();
  }

  return (
    <main className="flex min-h-dvh flex-col bg-[#071614] text-emerald-50 md:flex-row">
      <aside className="w-full border-b border-white/10 p-3 md:w-64 md:border-b-0 md:border-e">
        <div className="flex items-center gap-2">
          <NixoMark size={28} />
          <div>
            <p className="text-xs text-amber-200">NIXO AI</p>
            <p className="text-[11px] opacity-60">دستیار داخلی — نه حقیقت قطعی · محتوای AI مشخص است</p>
          </div>
        </div>
        {!available && <p className="mt-2 text-xs text-amber-200">{offlineNote ?? "AI خاموش است. چت معمولی کار می‌کند."}</p>}
        <Link href="/app/settings/ai" className="mt-2 block text-[11px] text-amber-200">Settings → AI → Data Controls</Link>
        <Link href="/app" className="block text-[11px] text-amber-200">بازگشت به گفتگو</Link>
        <p className="mt-3 text-[11px] font-medium">New AI Chat</p>
        <div className="mt-1 flex flex-wrap gap-1">
          {AI_TOPICS.map((t) => (
            <Button key={t.id} type="button" size="xs" variant="secondary" onClick={() => void onNew(t.id)}>
              {t.label}
            </Button>
          ))}
        </div>
        <ul className="mt-3 max-h-56 space-y-1 overflow-auto text-xs">
          {chats.map((c) => (
            <li key={c.id}>
              <button type="button" className={`w-full rounded-lg px-2 py-1 text-right ${c.id === chatId ? "bg-white/15" : "hover:bg-white/5"}`} onClick={() => loadChat(c.id)}>
                {c.title}
              </button>
            </li>
          ))}
        </ul>
      </aside>
      <section className="flex min-h-0 flex-1 flex-col">
        <header className="flex flex-wrap items-center gap-2 border-b border-white/10 p-2 text-[11px]">
          <select
            className="rounded bg-black/30 px-2 py-1"
            value={model}
            onChange={(e) => {
              setModel(e.target.value);
              if (chatId) {
                void fetch("/api/ai", {
                  method: "POST",
                  headers: { "Content-Type": "application/json" },
                  body: JSON.stringify({ action: "model", chatId, model: e.target.value }),
                });
              }
            }}
          >
            {AI_MODELS.map((m) => (
              <option key={m.id} value={m.id}>{m.name}</option>
            ))}
          </select>
          <Button type="button" size="xs" variant="secondary" onClick={listen}>Voice → Text</Button>
        </header>
        <div className="flex-1 space-y-3 overflow-auto p-4">
          {messages.length === 0 && (
            <p className="text-sm leading-7 text-emerald-100/70">
              سؤال بپرس، ترجمه کن، خلاصه بگیر، متن بنویس یا ایده بخواه. داده فقط همان است که این‌جا می‌فرستی. چت‌های E2EE بدون اجازه اینجا باز نمی‌شوند.
            </p>
          )}
          {messages.map((m) => (
            <article key={m.id} className={`max-w-[92%] rounded-2xl px-3 py-2 text-sm ${m.role === "user" ? "ms-auto bg-amber-300/20" : "bg-white/10"}`}>
              <p className="whitespace-pre-wrap leading-6" dir={/[آ-ی]/.test(m.text) ? "rtl" : "ltr"}>{m.text}</p>
              {m.role === "assistant" && (
                <p className="mt-1 text-[10px] text-amber-200/80">
                  تولیدشده توسط نیکسو AI
                  {typeof m.confidence === "number" ? ` · اطمینان ${Math.round(m.confidence * 100)}٪` : ""}
                  {m.overridden ? " · بازنویسی انسانی" : ""}
                </p>
              )}
              {m.imageSvg && (
                <div className="mt-2 overflow-hidden rounded-lg bg-black/30" dangerouslySetInnerHTML={{ __html: m.imageSvg }} />
              )}
              {m.role === "assistant" && (
                <div className="mt-2 flex flex-wrap gap-1 text-[10px]">
                  <Button type="button" size="xs" variant="ghost" onClick={() => void navigator.clipboard.writeText(m.text)}>Copy</Button>
                  <Button
                    type="button"
                    size="xs"
                    variant="ghost"
                    onClick={() =>
                      void fetch("/api/ai", {
                        method: "POST",
                        headers: { "Content-Type": "application/json" },
                        body: JSON.stringify({ action: "save", text: m.text }),
                      }).then(() => toast.success("Save شد."))
                    }
                  >
                    Save
                  </Button>
                  <Button type="button" size="xs" variant="ghost" onClick={() => speak(m.text)}>TTS</Button>
                  <Button
                    type="button"
                    size="xs"
                    variant="ghost"
                    onClick={() => void send({ action: "regenerate", chatId, text: lastUser })}
                  >
                    Regenerate
                  </Button>
                  <Button type="button" size="xs" variant="ghost" onClick={() => void fetch("/api/ai", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "feedback", messageId: m.id, feedback: "up" }) })}>👍</Button>
                  <Button type="button" size="xs" variant="ghost" onClick={() => void fetch("/api/ai", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "feedback", messageId: m.id, feedback: "down" }) })}>👎</Button>
                </div>
              )}
            </article>
          ))}
          {status !== "idle" && <p className="text-xs text-amber-200">{status === "thinking" ? "Thinking..." : "Generating..."}</p>}
        </div>
        <form
          className="space-y-2 border-t border-white/10 p-3"
          onSubmit={(e) => {
            e.preventDefault();
            const t = text.trim();
            if (!t) return;
            setText("");
            void send({ action: "send", chatId: chatId || undefined, text: t });
          }}
        >
          <div className="flex flex-wrap gap-1">
            {["translate", "summarize", "write", "rewrite", "grammar", "reply", "image", "ocr", "file", "search"].map((intent) => (
              <Button key={intent} type="button" size="xs" variant="secondary" disabled={busy} onClick={() => {
                if (!text.trim() && intent !== "image") return;
                void send({ action: "send", chatId: chatId || undefined, text: text || "Create a futuristic NIXO wallpaper.", intent });
                setText("");
              }}>
                {intent}
              </Button>
            ))}
            <Button type="button" size="xs" variant="secondary" onClick={() => fileRef.current?.click()}>فایل متنی</Button>
            <input
              ref={fileRef}
              type="file"
              accept=".txt,.md,.csv,.json,text/plain"
              className="hidden"
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (!f) return;
                f.text().then((fileText) => {
                  void send({ action: "send", chatId: chatId || undefined, text: `درباره این فایل بگو: ${f.name}`, intent: "file", fileText: fileText.slice(0, 18000) });
                });
              }}
            />
          </div>
          <div className="flex gap-2">
            <Input value={text} onChange={(e) => setText(e.target.value)} placeholder="از نیکسو AI بپرس…" className="flex-1" aria-label="متن درخواست هوش مصنوعی" />
            {busy ? (
              <Button type="button" variant="secondary" onClick={() => { abort.current = true; setBusy(false); setStatus("idle"); toast.message("Stop"); }}>Stop</Button>
            ) : (
              <Button type="submit" className="bg-amber-300 text-[#102824]">ارسال</Button>
            )}
          </div>
        </form>
      </section>
    </main>
  );
}
