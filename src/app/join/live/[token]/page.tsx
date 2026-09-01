"use client";

import { use, useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

type Peek = { title: string; hostName: string; status: string; live: boolean; visibility: string };

export default function JoinLivePage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = use(params);
  const router = useRouter();
  const [peek, setPeek] = useState<Peek | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    fetch(`/api/live/join/${token}`)
      .then(async (r) => {
        const j = await r.json();
        if (r.status === 401) {
          setError("برای ورود به Live باید وارد حساب NIXO شوید.");
          return;
        }
        if (!r.ok) {
          setError(j.error ?? "این لینک نامعتبر است یا منقضی شده.");
          return;
        }
        setPeek(j.peek);
        if (!j.canJoin) setError(j.error ?? "اجازهٔ ورود نداری.");
      })
      .catch(() => setError("شبکه در دسترس نیست."));
  }, [token]);

  const join = useCallback(async () => {
    setBusy(true);
    const r = await fetch(`/api/live/join/${token}`, { method: "POST" });
    const j = await r.json();
    setBusy(false);
    if (!r.ok) {
      setError(j.error ?? "ورود ممکن نشد.");
      return;
    }
    router.push(`/app/live/${j.live.id}?invite=${encodeURIComponent(token)}`);
  }, [token, router]);

  return (
    <main className="grid min-h-dvh place-items-center bg-[#071614] p-4 text-emerald-50">
      <Card className="w-full max-w-md border-white/10 bg-[#102824] text-emerald-50">
        <CardHeader>
          <CardTitle>ورود به Live نیکسو</CardTitle>
          <CardDescription className="text-emerald-100/70">لینک خصوصی بدون نشست معتبر کار نمی‌کند.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          {peek && (
            <p className="text-sm">
              {peek.title} · {peek.hostName} · {peek.status}
            </p>
          )}
          {error && <p className="text-sm text-rose-200">{error}</p>}
          <Button type="button" className="w-full bg-amber-300 text-[#102824]" disabled={busy || !peek} onClick={() => void join()}>
            Join Live
          </Button>
        </CardContent>
      </Card>
    </main>
  );
}
