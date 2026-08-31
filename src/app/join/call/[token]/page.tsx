"use client";

import { use, useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

type Peek = { groupTitle: string; kind: string; live: boolean; participantCount: number };

export default function JoinCallPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = use(params);
  const router = useRouter();
  const [peek, setPeek] = useState<Peek | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    fetch(`/api/calls/join/${token}`)
      .then(async (r) => {
        const j = await r.json();
        if (r.status === 401) {
          setError("برای ورود به تماس باید وارد حساب NIXO شوید.");
          return;
        }
        if (!r.ok) {
          setError(j.error ?? "این لینک نامعتبر است، منقضی شده، یا شما عضو گروه نیستید.");
          return;
        }
        setPeek(j.peek);
      })
      .catch(() => setError("شبکه در دسترس نیست."));
  }, [token]);

  const join = useCallback(async () => {
    setBusy(true);
    const r = await fetch(`/api/calls/join/${token}`, { method: "POST" });
    const j = await r.json();
    setBusy(false);
    if (!r.ok) {
      setError(j.error === "not-member" ? "فقط اعضای گروه می‌توانند وارد شوند." : (j.error ?? "ورود ممکن نشد."));
      return;
    }
    router.push("/");
  }, [router, token]);

  return (
    <main className="mx-auto flex min-h-screen max-w-md items-center p-4">
      <Card className="w-full">
        <CardHeader>
          <CardTitle>ورود به تماس گروهی</CardTitle>
          <CardDescription>
            لینک تماس فقط برای اعضای واردشدهٔ همان گروه معتبر است. سرور عضویت را چک می‌کند؛ صدا و تصویر روی دستگاه می‌ماند.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3 text-sm">
          {error ? <p className="text-destructive">{error}</p> : null}
          {peek ? (
            <p>
              {peek.groupTitle} · {peek.kind === "video" ? "تصویری" : "صوتی"} ·{" "}
              {peek.live ? `${peek.participantCount} نفر در تماس` : "تماس پایان یافته"}
            </p>
          ) : null}
          <p className="text-xs text-muted-foreground">
            NIXO جایگزین تماس اضطراری سیستم‌عامل یا شماره‌های اضطراری کشور نیست.
          </p>
          <div className="flex gap-2">
            <Button type="button" disabled={busy || !peek?.live} onClick={() => void join()}>
              ورود به تماس
            </Button>
            <Button type="button" variant="outline" onClick={() => router.push("/")}>
              بازگشت
            </Button>
          </div>
        </CardContent>
      </Card>
    </main>
  );
}
