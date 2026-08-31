"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { toast } from "sonner";
import { NixoMark } from "@/components/nixo-mark";
import { Button } from "@/components/ui/button";

type Init = {
  html: string;
  mini: { id: string; title: string; description: string; paymentHint: boolean };
  bot: { username: string; name: string };
  grant: { profile: boolean } | null;
  init: { user: { id: string; username: string | null; displayName: string | null } | null; hash: string; auth_date: number };
};

export function MiniAppFrame({ miniId }: { miniId: string }) {
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const [pack, setPack] = useState<Init | null>(null);
  const [ask, setAsk] = useState(false);

  function load() {
    fetch(`/api/mini?id=${encodeURIComponent(miniId)}`, { cache: "no-store" })
      .then((r) => r.json())
      .then((d) => {
        if (d.ok) setPack(d as Init);
      })
      .catch(() => undefined);
  }

  useEffect(() => {
    fetch(`/api/mini?id=${encodeURIComponent(miniId)}`, { cache: "no-store" })
      .then((r) => r.json())
      .then((d) => {
        if (d.ok) setPack(d as Init);
      })
      .catch(() => undefined);
  }, [miniId]);

  useEffect(() => {
    function onMsg(ev: MessageEvent) {
      if (ev.data?.type === "nixo-request-profile") setAsk(true);
    }
    window.addEventListener("message", onMsg);
    return () => window.removeEventListener("message", onMsg);
  }, []);

  useEffect(() => {
    if (!pack || !iframeRef.current?.contentWindow) return;
    iframeRef.current.contentWindow.postMessage(
      { type: "nixo-init", user: pack.init.user, hash: pack.init.hash, auth_date: pack.init.auth_date },
      "*",
    );
  }, [pack]);

  async function grant(allow: boolean) {
    const res = await fetch("/api/mini", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "grant", miniId, allow }),
    });
    const data = await res.json();
    if (!res.ok) toast.error(data.error);
    setAsk(false);
    load();
  }

  async function pay() {
    const res = await fetch("/api/mini", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "pay" }) });
    const data = await res.json();
    toast.message(data.error ?? "پرداخت نیکسو.");
  }

  if (!pack) {
    return <main className="min-h-dvh bg-[#071614] p-6 text-emerald-50">در حال باز کردن مینی‌اپ…</main>;
  }

  return (
    <main className="flex min-h-dvh flex-col bg-[#071614] text-emerald-50">
      <header className="flex items-center gap-2 border-b border-white/10 p-3">
        <NixoMark size={28} />
        <div className="flex-1">
          <p className="text-sm font-medium">{pack.mini.title}</p>
          <p className="text-[11px] text-amber-200">از @{pack.bot.username} · سندباکس</p>
        </div>
        <Link href="/app/bots" className="text-xs text-amber-200">بستن</Link>
      </header>
      <p className="px-3 py-2 text-[11px] leading-5 text-emerald-100/70">
        Mini App به رمز عبور، OTP و کلید خصوصی دسترسی ندارد. فقط پس از Allow، شناسه و نام نمایشی فرستاده می‌شود.
      </p>
      {ask && (
        <div className="mx-3 rounded-2xl border border-amber-300/40 bg-amber-300/10 p-3 text-sm">
          <p>Allow this Mini App to access your profile?</p>
          <div className="mt-2 flex gap-2">
            <Button type="button" size="sm" className="bg-amber-300 text-[#102824]" onClick={() => void grant(true)}>Allow</Button>
            <Button type="button" size="sm" variant="secondary" onClick={() => void grant(false)}>Deny</Button>
          </div>
        </div>
      )}
      <iframe
        ref={iframeRef}
        title={pack.mini.title}
        sandbox="allow-scripts"
        className="mx-3 mt-2 min-h-[420px] flex-1 rounded-2xl border border-white/10 bg-black"
        srcDoc={pack.html}
      />
      {pack.mini.paymentHint && (
        <div className="p-3">
          <Button type="button" variant="secondary" className="w-full" onClick={() => void pay()}>
            پرداخت از مسیر رسمی NIXO Pay
          </Button>
        </div>
      )}
    </main>
  );
}
