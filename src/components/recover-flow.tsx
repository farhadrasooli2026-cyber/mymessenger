"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { NixoMark } from "@/components/nixo-mark";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { InputOTP, InputOTPGroup, InputOTPSlot } from "@/components/ui/input-otp";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";

export function RecoverFlow() {
  const router = useRouter();
  const [channel, setChannel] = useState<"phone" | "email">("phone");
  const [identifier, setIdentifier] = useState("");
  const [humanToken, setHumanToken] = useState("");
  const [humanAcked, setHumanAcked] = useState(false);
  const [honeypot, setHoneypot] = useState("");
  const [step, setStep] = useState<"start" | "verify">("start");
  const [code, setCode] = useState("");
  const [masked, setMasked] = useState("");
  const [inbox, setInbox] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    fetch("/api/register/challenge", { cache: "no-store" })
      .then((r) => r.json())
      .then((d) => {
        if (d.token) setHumanToken(d.token);
      })
      .catch(() => undefined);
  }, []);

  async function ack(checked: boolean) {
    if (!checked) {
      setHumanAcked(false);
      return;
    }
    const res = await fetch("/api/register/ack", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ token: humanToken }),
    });
    setHumanAcked(res.ok);
    if (!res.ok) toast.error("تأیید امنیتی انجام نشد.");
  }

  async function onStart(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (!humanAcked) {
      setError("گزینه «من ربات نیستم» را تأیید کنید.");
      return;
    }
    setBusy(true);
    try {
      const res = await fetch("/api/recover?phase=start", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ channel, identifier, humanToken, website: honeypot }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? "انجام نشد.");
        return;
      }
      setMasked(data.masked ?? "");
      setStep("verify");
      toast.message(data.message);
      const inboxRes = await fetch("/api/register/inbox", { cache: "no-store" });
      if (inboxRes.ok) {
        const box = await inboxRes.json();
        if (box.message?.body) setInbox(box.message.body);
      }
    } finally {
      setBusy(false);
    }
  }

  async function onVerify(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      const res = await fetch("/api/recover?phase=verify", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ code }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? "کد نادرست است.");
        return;
      }
      if (data.next === "twostep") {
        toast.message("رمز دومرحله‌ای برای بازیابی لازم است. Verification دور زده نمی‌شود.");
        router.push("/");
        return;
      }
      toast.success("بازیابی انجام شد. نشست‌های دیگر باطل شدند. Security Checkup را ببینید.");
      router.push(data.next || "/app/settings/security?recovered=1");
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="flex min-h-dvh items-center justify-center bg-[#071614] p-6 text-emerald-50">
      <div className="w-full max-w-md space-y-4 rounded-3xl border border-white/10 bg-[#0f2f2c] p-6">
        <NixoMark size={44} />
        <h1 className="text-xl font-semibold">بازیابی حساب</h1>
        <p className="text-xs leading-6 text-emerald-100/70">
          Forgot Account یعنی Skip Verification نیست. باید کد یک‌بارمصرف منقضی‌شونده بگیرید. اگر Two-Step روشن باشد، عامل دوم هم لازم است. Recovery Codeها یک‌بارمصرف‌اند و باید در جای امن باشند.
        </p>
        {error && <p className="text-xs text-red-200">{error}</p>}
        {step === "start" && (
          <form onSubmit={onStart} className="space-y-3">
            <div className="flex gap-3 text-xs">
              <label>
                <input type="radio" checked={channel === "phone"} onChange={() => setChannel("phone")} /> شماره
              </label>
              <label>
                <input type="radio" checked={channel === "email"} onChange={() => setChannel("email")} /> ایمیل تأییدشده
              </label>
            </div>
            <Input value={identifier} onChange={(e) => setIdentifier(e.target.value)} placeholder={channel === "phone" ? "09…" : "email"} />
            <input className="hidden" tabIndex={-1} autoComplete="off" value={honeypot} onChange={(e) => setHoneypot(e.target.value)} />
            <label className="flex items-center gap-2 text-xs">
              <Checkbox checked={humanAcked} onCheckedChange={(v) => void ack(v === true)} />
              من ربات نیستم
            </label>
            <Button type="submit" disabled={busy} className="w-full bg-amber-300 text-[#102824]">
              ارسال کد بازیابی
            </Button>
          </form>
        )}
        {step === "verify" && (
          <form onSubmit={onVerify} className="space-y-3">
            <p className="text-xs">کد به {masked} ارسال شد.</p>
            <Label>کد ۶ رقمی</Label>
            <div className="flex justify-center" dir="ltr">
              <InputOTP maxLength={6} value={code} onChange={setCode}>
                <InputOTPGroup>
                  {Array.from({ length: 6 }).map((_, i) => (
                    <InputOTPSlot key={i} index={i} className="size-10 bg-black/30" />
                  ))}
                </InputOTPGroup>
              </InputOTP>
            </div>
            {inbox && <pre className="whitespace-pre-wrap rounded-lg bg-black/30 p-2 text-[11px]">{inbox}</pre>}
            <Button type="submit" disabled={busy || code.length !== 6} className="w-full bg-amber-300 text-[#102824]">
              تأیید و ادامه
            </Button>
          </form>
        )}
      </div>
    </main>
  );
}
