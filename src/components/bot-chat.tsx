"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { NixoMark } from "@/components/nixo-mark";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { BOT_REPORT_CATEGORIES } from "@/lib/bot-types";

type Msg = { id: string; from: string; text: string; buttons: { id: string; label: string; payload: string }[]; createdAt: number };
type Mini = { id: string; title: string };

export function BotChat({ botId }: { botId: string }) {
  const router = useRouter();
  const [name, setName] = useState("");
  const [username, setUsername] = useState("");
  const [verified, setVerified] = useState(false);
  const [started, setStarted] = useState(false);
  const [notify, setNotify] = useState<"on" | "off" | "mute">("on");
  const [messages, setMessages] = useState<Msg[]>([]);
  const [mini, setMini] = useState<Mini[]>([]);
  const [commands, setCommands] = useState<{ command: string; description: string }[]>([]);
  const [reviews, setReviews] = useState<{ stars: number; body: string }[]>([]);
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [stars, setStars] = useState(5);
  const [reviewBody, setReviewBody] = useState("");

  function load() {
    fetch(`/api/bots/chat?botId=${encodeURIComponent(botId)}`, { cache: "no-store" })
      .then((r) => r.json())
      .then((d) => {
        if (!d.ok) return;
        setName(d.bot.name);
        setUsername(d.bot.username);
        setVerified(Boolean(d.bot.verified));
        setStarted(Boolean(d.chat?.started));
        setNotify(d.chat?.notify ?? "on");
        setMessages(d.messages ?? []);
        setMini(d.miniApps ?? []);
        setCommands(d.commands ?? []);
        setReviews(d.reviews ?? []);
      })
      .catch(() => undefined);
  }

  useEffect(() => {
    fetch(`/api/bots/chat?botId=${encodeURIComponent(botId)}`, { cache: "no-store" })
      .then((r) => r.json())
      .then((d) => {
        if (!d.ok) return;
        setName(d.bot.name);
        setUsername(d.bot.username);
        setVerified(Boolean(d.bot.verified));
        setStarted(Boolean(d.chat?.started));
        setNotify(d.chat?.notify ?? "on");
        setMessages(d.messages ?? []);
        setMini(d.miniApps ?? []);
        setCommands(d.commands ?? []);
        setReviews(d.reviews ?? []);
      })
      .catch(() => undefined);
  }, [botId]);

  async function act(body: Record<string, unknown>) {
    setBusy(true);
    try {
      const res = await fetch("/api/bots/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ botId, ...body }),
      });
      const data = await res.json();
      if (!res.ok) {
        toast.error(data.error ?? "انجام نشد.");
        return;
      }
      load();
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="flex min-h-dvh flex-col bg-[#071614] text-emerald-50">
      <header className="flex items-center gap-2 border-b border-white/10 p-3">
        <NixoMark size={32} />
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-medium">
            {name} {verified ? "· Verified" : ""}
          </p>
          <p className="text-[11px] text-amber-200" dir="ltr">@{username}</p>
        </div>
        <Link href="/app/bots" className="text-xs text-amber-200">Directory</Link>
      </header>
      <div className="flex flex-wrap gap-2 border-b border-white/10 p-2 text-[11px]">
        <Button type="button" size="xs" disabled={busy} onClick={() => void act({ action: "notify", notify: notify === "on" ? "mute" : notify === "mute" ? "off" : "on" })}>
          اعلان: {notify === "on" ? "Enable" : notify === "mute" ? "Mute" : "Disable"}
        </Button>
        <Button type="button" size="xs" variant="secondary" disabled={busy} onClick={() => void act({ action: "stop" })}>Stop</Button>
        <Button type="button" size="xs" variant="secondary" disabled={busy} onClick={() => void act({ action: "block", blocked: true })}>Block</Button>
        <Button
          type="button"
          size="xs"
          variant="secondary"
          disabled={busy}
          onClick={() => void act({ action: "report", category: BOT_REPORT_CATEGORIES[0].id, details: "گزارش از گفتگو" })}
        >
          Report
        </Button>
        {mini[0] && (
          <Button type="button" size="xs" className="bg-amber-300 text-[#102824]" onClick={() => router.push(`/app/mini/${mini[0]!.id}`)}>
            Open Mini App
          </Button>
        )}
      </div>
      <div className="flex-1 space-y-2 overflow-auto p-3">
        {!started && (
          <div className="rounded-2xl bg-white/5 p-4 text-sm">
            <p>برای شروع، Start را بزن. تا آن زمان ربات به این گفتگو دسترسی ندارد.</p>
            <Button type="button" className="mt-3 bg-amber-300 text-[#102824]" disabled={busy} onClick={() => void act({ action: "start" })}>
              Start
            </Button>
          </div>
        )}
        {messages.map((m) => (
          <div key={m.id} className={`max-w-[90%] rounded-2xl px-3 py-2 text-sm ${m.from === "user" ? "ms-auto bg-amber-300/20" : "bg-white/10"}`}>
            <p className="whitespace-pre-wrap leading-6">{m.text}</p>
            {m.buttons?.length > 0 && (
              <div className="mt-2 flex flex-wrap gap-1">
                {m.buttons.map((b) => (
                  <Button key={b.id} type="button" size="xs" variant="secondary" disabled={busy} onClick={() => {
                    if (b.payload === "open_mini" && mini[0]) router.push(`/app/mini/${mini[0].id}`);
                    else void act({ action: "callback", messageId: m.id, buttonId: b.id });
                  }}>
                    {b.label}
                  </Button>
                ))}
              </div>
            )}
          </div>
        ))}
      </div>
      {started && commands.length > 0 && (
        <div className="flex flex-wrap gap-1 border-t border-white/10 p-2" role="navigation" aria-label="فهرست دستور ربات">
          {commands.map((c) => (
            <Button key={c.command} type="button" size="xs" variant="secondary" disabled={busy} onClick={() => void act({ action: "send", text: `/${c.command}` })}>
              /{c.command}
            </Button>
          ))}
        </div>
      )}
      {started && (
        <form
          className="flex gap-2 border-t border-white/10 p-3"
          onSubmit={(e) => {
            e.preventDefault();
            const t = text.trim();
            if (!t) return;
            setText("");
            void act({ action: "send", text: t });
          }}
        >
          <Input value={text} onChange={(e) => setText(e.target.value)} placeholder="/help یا پیام" aria-label="پیام به ربات" />
          <Button type="submit" disabled={busy}>ارسال</Button>
        </form>
      )}
      <section className="border-t border-white/10 p-3 text-xs">
        <p className="font-medium">نظر و امتیاز</p>
        <div className="mt-2 flex gap-2">
          <select className="h-8 rounded-lg bg-black/30" value={stars} onChange={(e) => setStars(Number(e.target.value))} aria-label="امتیاز ربات">
            {[1, 2, 3, 4, 5].map((n) => (
              <option key={n} value={n}>{n}</option>
            ))}
          </select>
          <Input value={reviewBody} onChange={(e) => setReviewBody(e.target.value)} placeholder="نظر بدون لینک هرزنامه" />
          <Button type="button" size="sm" disabled={busy} onClick={() => void act({ action: "review", stars, body: reviewBody })}>ثبت</Button>
        </div>
        <ul className="mt-2 space-y-1 opacity-80">
          {reviews.map((r, i) => (
            <li key={i}>{"★".repeat(r.stars)} {r.body}</li>
          ))}
        </ul>
      </section>
    </main>
  );
}
