"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Mail, ShieldCheck, Smartphone } from "lucide-react";
import { toast } from "sonner";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { InputOTP, InputOTPGroup, InputOTPSlot } from "@/components/ui/input-otp";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { cn } from "@/lib/utils";

type Step = "start" | "verify" | "profile" | "complete" | "twostep" | "device" | "recover";
type Channel = "phone" | "email";

type SessionPayload = {
  ok: boolean;
  step: Step;
  user?: {
    identifierMasked: string;
    channel: Channel;
    displayName: string | null;
    status: string;
  } | null;
};

const STEPS: { id: Exclude<Step, "complete">; label: string }[] = [
  { id: "start", label: "شناسه" },
  { id: "verify", label: "تأیید کد" },
  { id: "profile", label: "پروفایل" },
];

export function RegisterFlow() {
  const router = useRouter();
  const [boot, setBoot] = useState(true);
  const [step, setStep] = useState<Step>("start");
  const [channel, setChannel] = useState<Channel>("phone");
  const [identifier, setIdentifier] = useState("");
  const [humanToken, setHumanToken] = useState("");
  const [humanAcked, setHumanAcked] = useState(false);
  const [honeypot, setHoneypot] = useState("");
  const [masked, setMasked] = useState("");
  const [code, setCode] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [cooldown, setCooldown] = useState(0);
  const [ttl, setTtl] = useState(0);
  const [remainingAttempts, setRemainingAttempts] = useState<number | null>(null);
  const [inbox, setInbox] = useState<string | null>(null);
  const [inboxOpen, setInboxOpen] = useState(false);
  const [twoStepPassword, setTwoStepPassword] = useState("");
  const [recovery, setRecovery] = useState("");
  const [hasPasskeys, setHasPasskeys] = useState(false);
  const [demoInbox, setDemoInbox] = useState(false);

  async function loadChallenge() {
    const res = await fetch("/api/register/challenge", { cache: "no-store" });
    const data = (await res.json()) as { ok: boolean; token?: string };
    if (data.ok && data.token) {
      setHumanToken(data.token);
      setHumanAcked(false);
    }
  }

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const [sessionRes] = await Promise.all([
        fetch("/api/register/session", { cache: "no-store" }),
        loadChallenge(),
      ]);
      const session = (await sessionRes.json()) as SessionPayload & { hasPasskeys?: boolean; demoInbox?: boolean };
      if (cancelled) return;
      setDemoInbox(Boolean(session.demoInbox));
      if (session.step === "complete") {
        router.replace("/app");
        return;
      }
      if (session.step === "device") {
        router.replace("/device");
        return;
      }
      if (session.step === "recover") {
        router.replace("/recover");
        return;
      }
      if (session.step === "profile") {
        router.replace("/setup");
        return;
      }
      setStep(session.step);
      if (session.hasPasskeys) setHasPasskeys(true);
      if (session.user) {
        setMasked(session.user.identifierMasked);
        setChannel(session.user.channel);
        if (session.user.displayName) setDisplayName(session.user.displayName);
      }
      setBoot(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [router]);

  useEffect(() => {
    if (cooldown <= 0) return;
    const id = window.setInterval(() => setCooldown((s) => Math.max(0, s - 1)), 1000);
    return () => window.clearInterval(id);
  }, [cooldown]);

  useEffect(() => {
    if (ttl <= 0) return;
    const id = window.setInterval(() => setTtl((s) => Math.max(0, s - 1)), 1000);
    return () => window.clearInterval(id);
  }, [ttl]);

  const stepIndex = useMemo(() => STEPS.findIndex((s) => s.id === step), [step]);

  async function parseError(res: Response) {
    const data = (await res.json()) as { error?: string; remainingAttempts?: number };
    if (typeof data.remainingAttempts === "number") {
      setRemainingAttempts(data.remainingAttempts);
    }
    return data.error ?? "خطایی رخ داد.";
  }

  async function onAck(checked: boolean) {
    if (!checked) {
      setHumanAcked(false);
      return;
    }
    const res = await fetch("/api/register/ack", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ token: humanToken }),
    });
    if (!res.ok) {
      setHumanAcked(false);
      toast.error("تأیید امنیتی انجام نشد. صفحه را تازه‌سازی کنید.");
      await loadChallenge();
      return;
    }
    setHumanAcked(true);
  }

  async function onStart(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (!humanAcked) {
      setError("برای ادامه، گزینه «من ربات نیستم» را تأیید کنید.");
      return;
    }
    setBusy(true);
    try {
      const res = await fetch("/api/register/start", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          channel,
          identifier,
          humanToken,
          website: honeypot,
        }),
      });
      if (!res.ok) {
        setError(await parseError(res));
        await loadChallenge();
        return;
      }
      const data = (await res.json()) as {
        masked: string;
        cooldownSeconds: number;
        ttlSeconds: number;
        channel: Channel;
      };
      setMasked(data.masked);
      setChannel(data.channel);
      setCooldown(data.cooldownSeconds);
      setTtl(data.ttlSeconds);
      setCode("");
      setRemainingAttempts(null);
      setInbox(null);
      setStep("verify");
      toast.success("کد تأیید ارسال شد.");
    } finally {
      setBusy(false);
    }
  }

  async function onVerify(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (code.length !== 6) {
      setError("کد شش‌رقمی را کامل وارد کنید.");
      return;
    }
    setBusy(true);
    try {
      const res = await fetch("/api/register/verify", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ code }),
      });
      if (!res.ok) {
        setError(await parseError(res));
        setCode("");
        return;
      }
      const data = (await res.json()) as { alreadyActive?: boolean; next?: string; hasPasskeys?: boolean };
      if (data.next === "twostep") {
        setHasPasskeys(Boolean(data.hasPasskeys));
        setStep("twostep");
        toast.message("رمز دومرحله‌ای فعال است. عامل دوم را وارد کنید.");
        return;
      }
      if (data.next === "/device") {
        toast.message("New login detected from a new device. منتظر تأیید دستگاه مورد اعتماد بمانید.");
        router.push("/device");
        return;
      }
      if (data.alreadyActive) {
        toast.message("این شناسه قبلاً به یک حساب فعال متصل است.");
        router.push("/app");
        return;
      }
      setStep("profile");
      toast.success("تأیید انجام شد. پروفایل را بسازید.");
      router.push("/setup");
    } finally {
      setBusy(false);
    }
  }

  async function onResend() {
    setError(null);
    setBusy(true);
    try {
      const res = await fetch("/api/register/resend", { method: "POST" });
      if (!res.ok) {
        setError(await parseError(res));
        return;
      }
      const data = (await res.json()) as { cooldownSeconds: number; ttlSeconds: number };
      setCooldown(data.cooldownSeconds);
      setTtl(data.ttlSeconds);
      setCode("");
      setInbox(null);
      setRemainingAttempts(null);
      toast.success("کد جدید ارسال شد. کد قبلی دیگر معتبر نیست.");
    } finally {
      setBusy(false);
    }
  }

  async function onTwoStep(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      const res = await fetch("/api/register/twostep", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          password: twoStepPassword || undefined,
          recovery: recovery || undefined,
        }),
      });
      if (!res.ok) {
        setError(await parseError(res));
        return;
      }
      const data = (await res.json()) as { next?: string; recovered?: boolean };
      if (data.next === "/device") {
        toast.message("New login detected. منتظر تأیید دستگاه مورد اعتماد.");
        router.push("/device");
        return;
      }
      if (data.recovered) {
        toast.success("بازیابی انجام شد. نشست‌های دیگر باطل شدند.");
        router.push(data.next || "/app/settings/security?recovered=1");
        return;
      }
      toast.success("ورود تکمیل شد.");
      router.push(data.next || "/app");
    } finally {
      setBusy(false);
    }
  }

  async function onPasskeyLogin() {
    setError(null);
    if (!window.PublicKeyCredential) {
      setError("این مرورگر Passkey را پشتیبانی نمی‌کند.");
      return;
    }
    setBusy(true);
    try {
      const chRes = await fetch("/api/register/twostep", { cache: "no-store" });
      const ch = await chRes.json();
      if (!chRes.ok || !ch.challenge) {
        setError(ch.error ?? "چالش Passkey گرفته نشد.");
        return;
      }
      const allow = Array.isArray(ch.allowCredentials)
        ? (ch.allowCredentials as string[]).map((id) => ({
            type: "public-key" as const,
            id: Uint8Array.from(atob(id.replace(/-/g, "+").replace(/_/g, "/")), (c) => c.charCodeAt(0)),
          }))
        : [];
      const cred = (await navigator.credentials.get({
        publicKey: {
          challenge: Uint8Array.from(atob(String(ch.challenge).replace(/-/g, "+").replace(/_/g, "/")), (c) =>
            c.charCodeAt(0),
          ),
          timeout: 60_000,
          userVerification: "preferred",
          allowCredentials: allow.length ? allow : undefined,
        },
      })) as PublicKeyCredential | null;
      if (!cred) return;
      const raw = new Uint8Array(cred.rawId);
      let id = "";
      raw.forEach((b) => {
        id += String.fromCharCode(b);
      });
      const credId = btoa(id).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
      const cd = new Uint8Array(cred.response.clientDataJSON);
      let cds = "";
      cd.forEach((b) => {
        cds += String.fromCharCode(b);
      });
      const clientDataJSON = btoa(cds).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
      const res = await fetch("/api/register/twostep", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ credentialId: credId, clientDataJSON, challengeId: ch.challengeId }),
      });
      if (!res.ok) {
        setError(await parseError(res));
        return;
      }
      router.push("/app");
    } catch {
      setError("Passkey روی این میزبان ممکن است کار نکند.");
    } finally {
      setBusy(false);
    }
  }

  async function onProfile(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      const res = await fetch("/api/register/profile", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ displayName }),
      });
      if (!res.ok) {
        setError(await parseError(res));
        return;
      }
      router.push("/app");
    } finally {
      setBusy(false);
    }
  }

  async function onReset() {
    await fetch("/api/register/reset", { method: "POST" });
    setStep("start");
    setCode("");
    setInbox(null);
    setError(null);
    await loadChallenge();
  }

  async function loadInbox() {
    const res = await fetch("/api/register/inbox", { cache: "no-store" });
    if (!res.ok) {
      toast.error("صندوق آزمایشی در دسترس نیست.");
      return;
    }
    const data = (await res.json()) as { message?: { body: string } | null };
    setInbox(data.message?.body ?? "پیامی یافت نشد.");
    setInboxOpen(true);
  }

  if (boot) {
    return (
      <Card className="border-white/10 bg-[#0f2f2c]/80 text-white shadow-2xl">
        <CardContent className="py-16 text-center text-sm text-emerald-100/80">
          در حال آماده‌سازی نشست امن...
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className="border-white/10 bg-[#0f2f2c]/85 text-white shadow-2xl backdrop-blur">
      <CardHeader className="gap-4">
        <div className="flex items-center justify-between gap-3">
          <Badge variant="secondary" className="bg-emerald-400/15 text-emerald-100">
            ثبت‌نام NIXO
          </Badge>
          <span className="text-xs text-emerald-100/70">بدون تأیید کد، حساب فعال ساخته نمی‌شود</span>
        </div>
        <CardTitle className="text-2xl font-semibold tracking-tight">ساخت حساب جدید</CardTitle>
        <CardDescription className="text-emerald-50/75">
          مسیر اجباری: شماره یا ایمیل → کد تأیید سمت سرور → تکمیل پروفایل. گزینه رد کردن وجود ندارد.
        </CardDescription>
        <ol className="grid grid-cols-3 gap-2 pt-2">
          {STEPS.map((item, index) => {
            const active = item.id === step || (step === "complete" && item.id === "profile");
            const done = index < stepIndex || step === "complete";
            return (
              <li
                key={item.id}
                className={cn(
                  "rounded-xl border px-2 py-2 text-center text-xs",
                  done && "border-emerald-400/40 bg-emerald-400/10 text-emerald-100",
                  active && !done && "border-amber-300/50 bg-amber-300/10 text-amber-100",
                  !active && !done && "border-white/10 text-white/45",
                )}
              >
                <span className="block font-medium">{index + 1}. {item.label}</span>
              </li>
            );
          })}
        </ol>
      </CardHeader>
      <CardContent className="space-y-6">
        {error && (
          <Alert variant="destructive" className="border-red-400/30 bg-red-500/10 text-red-100" role="alert">
            <AlertDescription id="register-error">{error}</AlertDescription>
          </Alert>
        )}

        {step === "start" && (
          <form onSubmit={onStart} className="space-y-5">
            <Tabs value={channel} onValueChange={(v) => setChannel(v as Channel)}>
              <TabsList className="grid h-11 w-full grid-cols-2 bg-black/20">
                <TabsTrigger value="phone" className="gap-1.5">
                  <Smartphone className="size-4" />
                  موبایل
                </TabsTrigger>
                <TabsTrigger value="email" className="gap-1.5">
                  <Mail className="size-4" />
                  ایمیل
                </TabsTrigger>
              </TabsList>
              <TabsContent value="phone" className="mt-4 space-y-2">
                <Label htmlFor="phone">شماره موبایل ایران</Label>
                <Input
                  id="phone"
                  dir="ltr"
                  inputMode="tel"
                  autoComplete="tel"
                  placeholder="09123456789"
                  value={channel === "phone" ? identifier : ""}
                  onChange={(e) => setIdentifier(e.target.value)}
                  className="h-11 bg-black/20 text-left text-base"
                  required={channel === "phone"}
                  aria-required={channel === "phone"}
                  aria-invalid={Boolean(error) && channel === "phone"}
                  aria-describedby={error ? "register-error phone-hint" : "phone-hint"}
                />
                <p id="phone-hint" className="text-xs text-emerald-100/60">کد فقط به همین شماره ارسال می‌شود.</p>
              </TabsContent>
              <TabsContent value="email" className="mt-4 space-y-2">
                <Label htmlFor="email">ایمیل</Label>
                <Input
                  id="email"
                  dir="ltr"
                  type="email"
                  autoComplete="email"
                  placeholder="you@example.com"
                  value={channel === "email" ? identifier : ""}
                  onChange={(e) => setIdentifier(e.target.value)}
                  className="h-11 bg-black/20 text-left text-base"
                  required={channel === "email"}
                  aria-required={channel === "email"}
                  aria-invalid={Boolean(error) && channel === "email"}
                  aria-describedby="email-hint"
                />
                <p id="email-hint" className="text-xs text-emerald-100/60">کد فقط به همین ایمیل ارسال می‌شود.</p>
              </TabsContent>
            </Tabs>

            <input
              tabIndex={-1}
              autoComplete="off"
              aria-hidden="true"
              className="absolute start-[-10000px] h-0 w-0 opacity-0"
              name="website"
              value={honeypot}
              onChange={(e) => setHoneypot(e.target.value)}
            />

            <label className="flex items-start gap-3 rounded-xl border border-white/10 bg-black/15 p-3 text-sm">
              <Checkbox
                checked={humanAcked}
                onCheckedChange={(v) => onAck(v === true)}
                className="mt-0.5 border-white/30"
              />
              <span>
                من ربات نیستم. این تأیید برای جلوگیری از ثبت‌نام خودکار لازم است و جایگزین کد تأیید نمی‌شود.
              </span>
            </label>

            <Button type="submit" size="lg" className="h-11 w-full bg-amber-300 text-[#102824] hover:bg-amber-200" disabled={busy}>
              ارسال کد تأیید
            </Button>
          </form>
        )}

        {step === "verify" && (
          <form onSubmit={onVerify} className="space-y-5">
            <div className="rounded-xl border border-white/10 bg-black/20 p-4 text-sm">
              <p className="text-emerald-50/80">کد به این شناسه ارسال شد:</p>
              <p className="mt-1 font-medium tracking-wide" dir="ltr">
                {masked}
              </p>
              <p className="mt-2 text-xs text-emerald-100/60">
                اعتبار کد: {ttl > 0 ? `${ttl} ثانیه` : "منقضی شده"}
                {remainingAttempts !== null ? ` · تلاش باقی‌مانده: ${remainingAttempts}` : ""}
              </p>
            </div>
            <div className="space-y-3">
              <Label htmlFor="otp">کد یک‌بارمصرف ۶ رقمی</Label>
              <div className="flex justify-center" dir="ltr">
                <InputOTP maxLength={6} value={code} onChange={setCode} disabled={busy} aria-label="کد یک‌بارمصرف ۶ رقمی">
                  <InputOTPGroup>
                    {Array.from({ length: 6 }).map((_, i) => (
                      <InputOTPSlot key={i} index={i} className="size-10 bg-black/30 text-lg" />
                    ))}
                  </InputOTPGroup>
                </InputOTP>
              </div>
            </div>
            <Button type="submit" size="lg" className="h-11 w-full bg-amber-300 text-[#102824] hover:bg-amber-200" disabled={busy || code.length !== 6}>
              تأیید کد و ادامه
            </Button>
            <div className="flex flex-col gap-2 sm:flex-row">
              <Button
                type="button"
                variant="outline"
                className="h-10 flex-1 border-white/15 bg-transparent text-white hover:bg-white/10"
                disabled={busy || cooldown > 0}
                onClick={onResend}
              >
                {cooldown > 0 ? `ارسال مجدد (${cooldown})` : "ارسال مجدد کد"}
              </Button>
              <Button
                type="button"
                variant="ghost"
                className="h-10 flex-1 text-emerald-100 hover:bg-white/10"
                disabled={busy}
                onClick={onReset}
              >
                تغییر شماره یا ایمیل
              </Button>
            </div>
            <Separator className="bg-white/10" />
            <div className="space-y-2">
              {demoInbox ? (
                <>
              <Button
                type="button"
                variant="secondary"
                className="h-10 w-full bg-emerald-400/15 text-emerald-50 hover:bg-emerald-400/25"
                onClick={loadInbox}
                disabled={busy}
              >
                نمایش صندوق آزمایشی پیام
              </Button>
              {inboxOpen && inbox && (
                <pre className="whitespace-pre-wrap rounded-lg bg-black/30 p-3 text-xs leading-6 text-emerald-50">
                  {inbox}
                </pre>
              )}
              <p className="text-xs text-emerald-100/55">
                صندوق آزمایشی فقط در development/testing است. در Production کد فقط از ایمیل یا پیامک واقعی خوانده می‌شود.
              </p>
                </>
              ) : (
              <p className="text-xs text-emerald-100/55">
                کد تأیید به ایمیل یا شمارهٔ واقعی شما از سرور نیکسو ارسال می‌شود. این صفحه کد را نشان نمی‌دهد.
              </p>
              )}
            </div>
          </form>
        )}

        {step === "twostep" && (
          <form onSubmit={onTwoStep} className="space-y-5">
            <div className="rounded-xl border border-amber-300/20 bg-amber-300/10 p-4 text-sm">
              <p className="font-medium">رمز دومرحله‌ای</p>
              <p className="mt-1 text-xs text-emerald-100/70">
                کد یک‌بارمصرف تأیید شد. برای ورود، رمز عبور، کد بازیابی، یا Passkey لازم است. بازیابی با یک عامل ضعیف مالکیت حساب را نمی‌دهد.
              </p>
            </div>
            <div className="space-y-2">
              <Label>رمز عبور</Label>
              <Input
                type="password"
                value={twoStepPassword}
                onChange={(e) => setTwoStepPassword(e.target.value)}
                className="bg-black/30"
              />
            </div>
            <div className="space-y-2">
              <Label>کد بازیابی (اختیاری)</Label>
              <Input value={recovery} onChange={(e) => setRecovery(e.target.value)} className="bg-black/30 font-mono" dir="ltr" />
            </div>
            <Button type="submit" size="lg" className="h-11 w-full bg-amber-300 text-[#102824] hover:bg-amber-200" disabled={busy}>
              ادامه ورود
            </Button>
            {hasPasskeys && (
              <Button type="button" variant="secondary" className="h-10 w-full" disabled={busy} onClick={() => void onPasskeyLogin()}>
                ورود با Passkey
              </Button>
            )}
          </form>
        )}

        {step === "profile" && (
          <form onSubmit={onProfile} className="space-y-5">
            <div className="flex items-start gap-3 rounded-xl border border-emerald-400/20 bg-emerald-400/10 p-4 text-sm">
              <ShieldCheck className="mt-0.5 size-5 shrink-0 text-emerald-200" />
              <div>
                <p className="font-medium">شناسه تأیید شد</p>
                <p className="mt-1 text-emerald-50/75" dir="ltr">
                  {masked}
                </p>
                <p className="mt-2 text-xs text-emerald-100/60">
                  حساب هنوز فعال نیست. پس از ثبت نام نمایشی، وضعیت به فعال تغییر می‌کند.
                </p>
              </div>
            </div>
            <div className="space-y-2">
              <Label htmlFor="name">نام نمایشی</Label>
              <Input
                id="name"
                value={displayName}
                onChange={(e) => setDisplayName(e.target.value)}
                placeholder="مثلاً سارا محمدی"
                className="h-11 bg-black/20"
                minLength={2}
                maxLength={60}
                required
              />
            </div>
            <Button type="submit" size="lg" className="h-11 w-full bg-amber-300 text-[#102824] hover:bg-amber-200" disabled={busy}>
              فعال‌سازی حساب
            </Button>
          </form>
        )}
      </CardContent>
    </Card>
  );
}
