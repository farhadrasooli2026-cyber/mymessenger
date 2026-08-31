"use client";

import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { NixoMark } from "@/components/nixo-mark";

export default function JoinCommunityPage() {
  const params = useParams<{ token: string }>();
  const router = useRouter();
  const token = params.token;
  const [info, setInfo] = useState<{
    name: string;
    description: string;
    color: string;
    memberCount: number;
    rules: string;
    joinMode: string;
    groupCount: number;
    channelCount: number;
  } | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetch(`/api/communities/join/${token}`)
      .then((r) => r.json())
      .then((d) => {
        if (!d.ok) setError(d.error ?? "لینک نامعتبر است.");
        else setInfo(d.community);
      })
      .catch(() => setError("بارگذاری نشد."));
  }, [token]);

  async function join() {
    const res = await fetch(`/api/communities/join/${token}`, { method: "POST" });
    const data = await res.json();
    if (res.status === 401) {
      router.replace("/");
      return;
    }
    if (!res.ok) {
      setError(data.error ?? "پیوستن انجام نشد.");
      return;
    }
    if (data.pending) {
      setError("درخواست عضویت ارسال شد. منتظر تأیید ادمین بمان.");
      return;
    }
    router.replace("/app");
  }

  return (
    <main className="grid min-h-dvh place-items-center bg-[#071614] p-6 text-emerald-50">
      <div className="w-full max-w-md rounded-3xl border border-white/10 bg-[#102824] p-6 text-center">
        <NixoMark size={48} className="mx-auto" />
        {error && !info && <p className="mt-4 text-sm text-rose-200">{error}</p>}
        {info && (
          <>
            <span
              className="mx-auto mt-4 grid size-16 place-items-center rounded-3xl text-2xl font-semibold text-[#071614]"
              style={{ background: info.color }}
            >
              {info.name.slice(0, 1)}
            </span>
            <h1 className="mt-3 text-xl font-semibold">{info.name}</h1>
            <p className="mt-1 text-xs text-emerald-100/60">
              {info.memberCount} عضو · {info.groupCount} گروه · {info.channelCount} کانال
            </p>
            <p className="mt-3 text-sm leading-7">{info.description}</p>
            {info.rules && (
              <p className="mt-3 whitespace-pre-wrap text-right text-xs leading-6 text-emerald-100/70">{info.rules}</p>
            )}
            {error && <p className="mt-2 text-xs text-amber-200">{error}</p>}
            <Button type="button" className="mt-5 h-11 w-full bg-amber-300 text-[#102824]" onClick={() => void join()}>
              {info.joinMode === "request" ? "ارسال درخواست عضویت" : "پیوستن به جامعه"}
            </Button>
          </>
        )}
      </div>
    </main>
  );
}
