"use client";

import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { NixoMark } from "@/components/nixo-mark";
import { formatSubscribers } from "@/lib/channel-types";

export default function JoinChannelPage() {
  const params = useParams<{ token: string }>();
  const router = useRouter();
  const token = params.token;
  const [info, setInfo] = useState<{
    name: string;
    description: string;
    color: string;
    subscriberCount: number;
    verified: boolean;
  } | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetch(`/api/channels/join/${token}`)
      .then((r) => r.json())
      .then((d) => {
        if (!d.ok) setError(d.error ?? "لینک نامعتبر است.");
        else setInfo(d.channel);
      })
      .catch(() => setError("بارگذاری نشد."));
  }, [token]);

  async function join() {
    const res = await fetch(`/api/channels/join/${token}`, { method: "POST" });
    const data = await res.json();
    if (res.status === 401) {
      router.replace("/");
      return;
    }
    if (!res.ok) {
      setError(data.error ?? "دنبال کردن انجام نشد.");
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
            <span className="mx-auto mt-4 grid size-16 place-items-center rounded-3xl text-2xl font-semibold text-[#071614]" style={{ background: info.color }}>
              {info.name.slice(0, 1)}
            </span>
            <h1 className="mt-3 text-xl font-semibold">
              {info.name}
              {info.verified ? " ✓" : ""}
            </h1>
            <p className="mt-1 text-xs text-emerald-100/60">{formatSubscribers(info.subscriberCount)} دنبال‌کننده</p>
            <p className="mt-3 text-sm leading-7">{info.description}</p>
            {error && <p className="mt-2 text-xs text-amber-200">{error}</p>}
            <Button type="button" className="mt-5 h-11 w-full bg-amber-300 text-[#102824]" onClick={() => void join()}>
              دنبال کردن کانال
            </Button>
          </>
        )}
      </div>
    </main>
  );
}
