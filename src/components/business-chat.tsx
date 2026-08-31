"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

type Msg = { id: string; from: string; text: string; createdAt: number };

export function BusinessChat({ businessId }: { businessId: string }) {
  const [name, setName] = useState("");
  const [messages, setMessages] = useState<Msg[]>([]);
  const [text, setText] = useState("");
  const [ai, setAi] = useState("");

  function load() {
    fetch(`/api/business?view=customerChat&businessId=${businessId}`, { cache: "no-store" })
      .then((r) => r.json())
      .then((d) => {
        if (d.ok) setMessages(d.messages ?? []);
      })
      .catch(() => undefined);
    fetch(`/api/business?id=${encodeURIComponent(businessId)}`, { cache: "no-store" })
      .then((r) => r.json())
      .then((d) => {
        if (d.ok) setName(d.business.name);
      })
      .catch(() => undefined);
  }

  useEffect(() => {
    fetch(`/api/business?view=customerChat&businessId=${businessId}`, { cache: "no-store" })
      .then((r) => r.json())
      .then((d) => {
        if (d.ok) setMessages(d.messages ?? []);
      })
      .catch(() => undefined);
    fetch(`/api/business?id=${encodeURIComponent(businessId)}`, { cache: "no-store" })
      .then((r) => r.json())
      .then((d) => {
        if (d.ok) setName(d.business.name);
      })
      .catch(() => undefined);
  }, [businessId]);

  async function send() {
    const res = await fetch("/api/business", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "message", businessId, text }),
    });
    const data = await res.json();
    if (!res.ok) {
      toast.error(data.error);
      return;
    }
    setText("");
    load();
  }

  return (
    <main className="min-h-dvh bg-[#071614] p-5 text-emerald-50">
      <div className="mx-auto flex min-h-[80dvh] max-w-lg flex-col">
        <div className="mb-3">
          <p className="text-xs text-amber-200">پشتیبانی مشتری</p>
          <h1 className="text-lg font-semibold">{name || "Business Chat"}</h1>
          <p className="text-[11px] text-emerald-100/55">شماره و ایمیل شخصی‌ات برای کسب‌وکار نمایش داده نمی‌شود.</p>
        </div>
        <div className="flex-1 space-y-2 overflow-auto rounded-2xl border border-white/10 p-3">
          {messages.length === 0 && <p className="text-xs text-emerald-100/50">اولین پیام Welcome و در صورت تعطیلی Away را می‌سازد. دستورهایی مثل /price پاسخ آماده می‌گیرند.</p>}
          {messages.map((m) => (
            <div key={m.id} className={`max-w-[85%] rounded-xl px-3 py-2 text-sm ${m.from === "customer" ? "ms-auto bg-amber-300 text-[#102824]" : "bg-white/10"}`}>
              {m.text}
            </div>
          ))}
        </div>
        {ai && <p className="mt-2 text-xs text-amber-100/80">{ai}</p>}
        <form
          className="mt-3 flex gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            void send();
          }}
        >
          <Input value={text} onChange={(e) => setText(e.target.value)} placeholder="پیام یا /price" />
          <Button type="submit" className="bg-amber-300 text-[#102824]">
            ارسال
          </Button>
        </form>
        <Button
          type="button"
          variant="ghost"
          className="mt-1 text-xs"
          onClick={() => {
            void fetch("/api/business", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ action: "ai", businessId, task: "faq", text }),
            })
              .then((r) => r.json())
              .then((d) => {
                if (d.ok) setAi(d.text);
                else toast.error(d.error);
              });
          }}
        >
          پیشنهاد AI (در صورت اجازه)
        </Button>
        <Link href={`/app/business/b/${businessId}`} className="mt-3 text-xs text-amber-200">
          پروفایل کسب‌وکار
        </Link>
      </div>
    </main>
  );
}
