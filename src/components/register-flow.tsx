"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2, Mail, ShieldCheck } from "lucide-react";
import { toast } from "sonner";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { InputOTP, InputOTPGroup, InputOTPSlot } from "@/components/ui/input-otp";
import { Label } from "@/components/ui/label";
import { NixoHeroLogo } from "@/components/nixo-mark";
import { CountryCodeSelect } from "@/components/country-code-select";
import { normalizeEmail, normalizePhoneWithCountry, toEnglishDigits } from "@/lib/identifiers";
import { cn } from "@/lib/utils";

type Step = "start" | "verify" | "profile" | "complete" | "twostep" | "device" | "recover";
type Method = "otp" | "password";
type IdMode = "phone" | "email";

type SessionPayload = {
  ok: boolean;
  step: Step;
  channel?: IdMode;
  masked?: string;
  ttlSeconds?: number;
  user?: {
    identifierMasked: string;
    displayName: string | null;
    status: string;
  } | null;
};

const inputClass =
  "h-12 rounded-2xl border-sky-400/30 bg-[#050a12] text-white placeholder:text-slate-500 focus-visible:border-cyan-400/70 focus-visible:ring-cyan-400/30";
const primaryBtn =
  "h-12 w-full rounded-2xl bg-gradient-to-l from-cyan-400 to-blue-500 text-sm font-medium text-white shadow-[0_0_22px_rgba(56,189,248,0.32)] hover:from-cyan-300 hover:to-blue-400 disabled:pointer-events-none disabled:opacity-60";
const ghostBtn =
  "h-12 w-full rounded-2xl border border-sky-400/25 bg-[#070d18] text-sm text-slate-100 hover:bg-white/5";

export function RegisterFlow() {
  const router = useRouter();
  const [boot, setBoot] = useState(true);
  const [step, setStep] = useState<Step>("start");
  const [authMode, setAuthMode] = useState<"login" | "register">("login");
  const [method, setMethod] = useState<Method>("otp");
  const [idMode, setIdMode] = useState<IdMode>("phone");
  const [countryIso, setCountryIso] = useState("TR");
  const [identifier, setIdentifier] = useState("");
  const [password, setPassword] = useState("");
  const [humanToken, setHumanToken] = useState("");
  const [honeypot, setHoneypot] = useState("");
  const [masked, setMasked] = useState("");
  const [code, setCode] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [cooldown, setCooldown] = useState(0);
  const [ttl, setTtl] = useState(0);
  const [inbox, setInbox] = useState<string | null>(null);
  const [inboxOpen, setInboxOpen] = useState(false);
  const [twoStepPassword, setTwoStepPassword] = useState("");
  const [recovery, setRecovery] = useState("");
  const [hasPasskeys, setHasPasskeys] = useState(false);
  const [demoInbox, setDemoInbox] = useState(false);

  async function loadChallenge() {
    const res = await fetch("/api/register/challenge", { cache: "no-store", signal: AbortSignal.timeout(20_000) });
    const data = (await res.json()) as { ok: boolean; token?: string };
    if (data.ok && data.token) {
      setHumanToken(data.token);
      window.setTimeout(() => {
        void fetch("/api/register/ack", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ token: data.token }),
        });
      }, 1700);
      return data.token;
    }
    return "";
  }

  async function ensureHuman(token: string) {
    let current = token;
    if (!current) current = (await loadChallenge()) || "";
    if (!current) return "";
    const ack = async () =>
      fetch("/api/register/ack", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token: current }),
      });
    let res = await ack();
    if (!res.ok) {
      await new Promise((r) => setTimeout(r, 1700));
      res = await ack();
    }
    if (!res.ok) {
      current = (await loadChallenge()) || "";
      if (!current) return "";
      await new Promise((r) => setTimeout(r, 1700));
      res = await fetch("/api/register/ack", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token: current }),
      });
    }
    return res.ok ? current : "";
  }

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const sessionRes = await fetch("/api/register/session", { cache: "no-store", signal: AbortSignal.timeout(20_000) });
        let session: SessionPayload & { hasPasskeys?: boolean; demoInbox?: boolean };
        try {
          session = (await sessionRes.json()) as SessionPayload & { hasPasskeys?: boolean; demoInbox?: boolean };
        } catch {
          if (!cancelled) setError("ارتباط با سرور برقرار نشد. صفحه را تازه کنید.");
          return;
        }
        if (!sessionRes.ok) {
          if (!cancelled) setError("ارتباط با سرور برقرار نشد. صفحه را تازه کنید.");
          return;
        }
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
        if (session.step === "verify") {
          setStep("verify");
          if (session.channel === "email" || session.channel === "phone") setIdMode(session.channel);
          if (session.masked) setMasked(session.masked);
          if (typeof session.ttlSeconds === "number") setTtl(session.ttlSeconds);
        } else if (session.step === "twostep") {
          setStep("twostep");
          if (session.hasPasskeys) setHasPasskeys(true);
        } else {
          setStep("start");
          setIdMode("phone");
        }
        if (session.hasPasskeys) setHasPasskeys(true);
        if (session.user) {
          setMasked(session.user.identifierMasked);
          if (session.user.displayName) setDisplayName(session.user.displayName);
        }
        if (!cancelled) setBoot(false);
        if (!cancelled && session.step === "start") void loadChallenge();
      } catch {
        if (!cancelled) {
          setError("ارتباط با سرور برقرار نشد. صفحه را تازه کنید.");
          setBoot(false);
        }
      }
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

  async function parseError(res: Response) {
    const data = (await res.json()) as { error?: string; remainingAttempts?: number; reason?: string };
    if (data.reason === "no_account") return "حسابی با این شناسه نیست. ثبت‌نام کنید.";
    if (data.reason === "destination") {
      return idMode === "email" ? "ایمیل واردشده معتبر نیست." : "شماره موبایل معتبر نیست.";
    }
    if (data.reason === "rate_limit") return "تعداد درخواست‌ها زیاد است. کمی بعد دوباره تلاش کنید.";
    if (data.reason === "timeout" || data.reason === "network") {
      return "ارتباط با سرویس ارسال برقرار نشد. دوباره تلاش کنید.";
    }
    return data.error ?? "خطایی رخ داد.";
  }

  async function onStart(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      const token = await ensureHuman(humanToken);
      if (!token) {
        setError("تأیید امنیتی انجام نشد. دوباره تلاش کنید.");
        return;
      }
      setHumanToken(token);
      if (idMode === "phone") {
        if (!normalizePhoneWithCountry(countryIso, identifier)) {
          setError("شماره موبایل برای کشور انتخاب‌شده معتبر نیست.");
          return;
        }
      } else if (!normalizeEmail(identifier)) {
        setError("ایمیل واردشده معتبر نیست.");
        return;
      }
      const res = await fetch("/api/register/start", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          channel: idMode,
          identifier,
          countryIso: idMode === "phone" ? countryIso : undefined,
          humanToken: token,
          website: honeypot,
          intent: authMode,
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
        channel?: IdMode;
      };
      setMasked(data.masked);
      if (data.channel) setIdMode(data.channel);
      setCooldown(data.cooldownSeconds);
      setTtl(data.ttlSeconds);
      setCode("");
      setInbox(null);
      setStep("verify");
      toast.success("کد تأیید ارسال شد.");
    } finally {
      setBusy(false);
    }
  }

  async function onPassword(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      const token = await ensureHuman(humanToken);
      if (!token) {
        setError("تأیید امنیتی انجام نشد. دوباره تلاش کنید.");
        return;
      }
      setHumanToken(token);
      const res = await fetch("/api/register/password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          identifier,
          password,
          channel: idMode,
          countryIso: idMode === "phone" ? countryIso : undefined,
          humanToken: token,
          website: honeypot,
        }),
      });
      if (!res.ok) {
        setError(await parseError(res));
        await loadChallenge();
        return;
      }
      const data = (await res.json()) as { next?: string; hasPasskeys?: boolean };
      if (data.next === "twostep") {
        setHasPasskeys(Boolean(data.hasPasskeys));
        setStep("twostep");
        toast.message("عامل دوم لازم است.");
        return;
      }
      if (data.next === "/device") {
        toast.message("New login detected from a new device. منتظر تأیید دستگاه مورد اعتماد بمانید.");
        router.push("/device");
        return;
      }
      toast.success("ورود تکمیل شد.");
      router.push(typeof data.next === "string" ? data.next : "/app");
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
    setPassword("");
    setMasked("");
    await loadChallenge();
  }

  function switchToEmail() {
    if (step !== "start") void onReset();
    setIdMode("email");
    setIdentifier("");
    setPassword("");
    setError(null);
    setMasked("");
  }

  function switchToPhone() {
    if (step !== "start") void onReset();
    setIdMode("phone");
    setIdentifier("");
    setPassword("");
    setError(null);
    setMasked("");
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

  const shell = (inner: React.ReactNode) => (
    <div
      className="relative w-full overflow-hidden rounded-[2rem] border border-sky-400/30 bg-[#070d18]/80 p-6 text-white shadow-[0_0_48px_rgba(34,211,238,0.14)] backdrop-blur-xl sm:p-8"
      dir="rtl"
    >
      {inner}
    </div>
  );

  if (boot) {
    return shell(
      <div className="py-16 text-center text-sm text-slate-300">در حال آماده‌سازی نشست امن...</div>,
    );
  }

  return shell(
    <div className="space-y-6">
      <NixoHeroLogo />
      {step === "start" && (
        <p className="text-center text-sm text-slate-200">
          {authMode === "register" ? "ساخت حساب نیکسو" : "با حساب خود وارد شوید"}
        </p>
      )}

      {error && (
        <Alert variant="destructive" className="border-red-400/30 bg-red-500/10 text-red-100" role="alert">
          <AlertDescription id="register-error">{error}</AlertDescription>
        </Alert>
      )}

      {step === "start" && (
        <>
          <div className="grid grid-cols-2 gap-2">
            <button
              type="button"
              className={cn(
                "h-11 rounded-2xl text-sm transition",
                method === "otp"
                  ? "border border-cyan-400/80 bg-cyan-400/10 text-white shadow-[0_0_16px_rgba(34,211,238,0.28)]"
                  : "border border-white/5 bg-[#0a1220] text-slate-400",
              )}
              onClick={() => {
                setMethod("otp");
                setError(null);
              }}
            >
              تأیید با کد
            </button>
            <button
              type="button"
              className={cn(
                "h-11 rounded-2xl text-sm transition",
                method === "password"
                  ? "border border-cyan-400/80 bg-cyan-400/10 text-white shadow-[0_0_16px_rgba(34,211,238,0.28)]"
                  : "border border-white/5 bg-[#0a1220] text-slate-400",
              )}
              onClick={() => {
                setMethod("password");
                setError(null);
              }}
            >
              ورود با رمز عبور
            </button>
          </div>

          {method === "otp" ? (
            <form onSubmit={onStart} className="space-y-5">
              <p className="text-center text-sm font-medium text-cyan-100">
                {idMode === "email" ? "ورود با ایمیل" : "ورود با شماره موبایل"}
              </p>
              {idMode === "email" ? (
                <div className="relative">
                  <Mail className="pointer-events-none absolute top-1/2 end-3 size-4 -translate-y-1/2 text-cyan-300/80" />
                  <Input
                    id="login-identifier"
                    dir="ltr"
                    autoComplete="email"
                    inputMode="email"
                    type="email"
                    placeholder="آدرس ایمیل"
                    value={identifier}
                    onChange={(e) => setIdentifier(e.target.value)}
                    className={cn(inputClass, "pe-11 text-left")}
                    required
                    aria-invalid={Boolean(error)}
                    aria-describedby={error ? "register-error" : undefined}
                  />
                </div>
              ) : (
                <div className="flex items-stretch gap-2">
                  <CountryCodeSelect iso={countryIso} onChange={setCountryIso} disabled={busy} />
                  <Input
                    id="login-identifier"
                    dir="ltr"
                    autoComplete="tel-national"
                    inputMode="numeric"
                    type="tel"
                    placeholder="شماره موبایل"
                    value={identifier}
                    onChange={(e) => setIdentifier(e.target.value)}
                    className={cn(inputClass, "min-w-0 flex-1 text-left")}
                    required
                    aria-invalid={Boolean(error)}
                    aria-describedby={error ? "register-error" : undefined}
                  />
                </div>
              )}
              <Honeypot value={honeypot} onChange={setHoneypot} />
              <Button type="submit" className={primaryBtn} disabled={busy}>
                {busy ? (
                  <span className="inline-flex items-center gap-2">
                    <Loader2 className="size-4 animate-spin" />
                    در حال ارسال...
                  </span>
                ) : (
                  "ارسال کد"
                )}
              </Button>
            </form>
          ) : (
            <form onSubmit={onPassword} className="space-y-5">
              <p className="text-center text-sm font-medium text-cyan-100">
                {idMode === "email" ? "ورود با ایمیل" : "ورود با شماره موبایل"}
              </p>
              {idMode === "email" ? (
                <div className="relative">
                  <Mail className="pointer-events-none absolute top-1/2 end-3 size-4 -translate-y-1/2 text-cyan-300/80" />
                  <Input
                    id="login-identifier"
                    dir="ltr"
                    autoComplete="email"
                    inputMode="email"
                    type="email"
                    placeholder="آدرس ایمیل"
                    value={identifier}
                    onChange={(e) => setIdentifier(e.target.value)}
                    className={cn(inputClass, "pe-11 text-left")}
                    required
                  />
                </div>
              ) : (
                <div className="flex items-stretch gap-2">
                  <CountryCodeSelect iso={countryIso} onChange={setCountryIso} disabled={busy} />
                  <Input
                    id="login-identifier"
                    dir="ltr"
                    autoComplete="tel-national"
                    inputMode="numeric"
                    type="tel"
                    placeholder="شماره موبایل"
                    value={identifier}
                    onChange={(e) => setIdentifier(e.target.value)}
                    className={cn(inputClass, "min-w-0 flex-1 text-left")}
                    required
                  />
                </div>
              )}
              <Input
                type="password"
                autoComplete="current-password"
                placeholder="رمز عبور"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className={inputClass}
                required
              />
              <Honeypot value={honeypot} onChange={setHoneypot} />
              <Button type="submit" className={primaryBtn} disabled={busy}>
                {busy ? (
                  <span className="inline-flex items-center gap-2">
                    <Loader2 className="size-4 animate-spin" />
                    در حال ورود...
                  </span>
                ) : (
                  "ورود"
                )}
              </Button>
            </form>
          )}

          <div className="space-y-3">
            <p className="text-center text-xs text-slate-500">یا</p>
            {idMode === "phone" ? (
              <Button type="button" className={ghostBtn} disabled={busy} onClick={switchToEmail}>
                تغییر به ورود با ایمیل
              </Button>
            ) : (
              <Button type="button" className={ghostBtn} disabled={busy} onClick={switchToPhone}>
                تغییر به ورود با شماره
              </Button>
            )}
            <p className="pt-2 text-center text-sm text-slate-300">
              {authMode === "login" ? (
                <>
                  حساب کاربری ندارید؟{" "}
                  <button
                    type="button"
                    className="text-cyan-300 hover:underline"
                    onClick={() => {
                      setAuthMode("register");
                      setMethod("otp");
                      setError(null);
                    }}
                  >
                    ثبت‌نام کنید
                  </button>
                </>
              ) : (
                <>
                  قبلاً حساب دارید؟{" "}
                  <button
                    type="button"
                    className="text-cyan-300 hover:underline"
                    onClick={() => {
                      setAuthMode("login");
                      setError(null);
                    }}
                  >
                    وارد شوید
                  </button>
                </>
              )}
            </p>
          </div>
        </>
      )}

      {step === "verify" && (
        <form onSubmit={onVerify} className="space-y-5">
          <p className="text-center text-lg font-medium text-white">کد تأیید</p>
          <div className="flex justify-center" dir="ltr">
            <InputOTP
              maxLength={6}
              value={code}
              onChange={(v) => setCode(toEnglishDigits(v).replace(/\D/g, "").slice(0, 6))}
              disabled={busy}
              inputMode="numeric"
              autoComplete="one-time-code"
              aria-label="کد یک‌بارمصرف ۶ رقمی"
            >
              <InputOTPGroup>
                {Array.from({ length: 6 }).map((_, i) => (
                  <InputOTPSlot key={i} index={i} className="size-10 border-sky-400/30 bg-black/40 text-lg" />
                ))}
              </InputOTPGroup>
            </InputOTP>
          </div>
          <Button type="submit" className={primaryBtn} disabled={busy || code.length !== 6}>
            {busy ? (
              <span className="inline-flex items-center gap-2">
                <Loader2 className="size-4 animate-spin" />
                در حال تأیید...
              </span>
            ) : (
              "تأیید کد"
            )}
          </Button>
          <Button type="button" className={ghostBtn} disabled={busy || cooldown > 0} onClick={onResend}>
            {cooldown > 0 ? `ارسال مجدد (${cooldown})` : "ارسال مجدد کد"}
          </Button>
          <p className="text-center text-xs text-slate-400">
            {idMode === "email" ? "کد به ایمیل شما ارسال شد" : "کد به شماره شما ارسال شد"}
            {masked ? (
              <span className="mt-1 block tracking-wide text-slate-500" dir="ltr">
                {masked}
              </span>
            ) : null}
          </p>
          <Button type="button" className={ghostBtn} disabled={busy} onClick={idMode === "phone" ? switchToEmail : switchToPhone}>
            {idMode === "phone" ? "تغییر به ورود با ایمیل" : "تغییر به ورود با شماره"}
          </Button>
          {demoInbox ? (
            <div className="space-y-2">
              <Button type="button" className={ghostBtn} onClick={loadInbox} disabled={busy}>
                نمایش صندوق آزمایشی پیام
              </Button>
              {inboxOpen && inbox && (
                <pre className="whitespace-pre-wrap rounded-2xl bg-black/40 p-3 text-xs leading-6 text-slate-200">
                  {inbox}
                </pre>
              )}
            </div>
          ) : null}
        </form>
      )}

      {step === "twostep" && (
        <form onSubmit={onTwoStep} className="space-y-5">
          <div className="rounded-2xl border border-sky-400/20 bg-cyan-400/5 p-4 text-sm">
            <p className="font-medium">رمز دومرحله‌ای</p>
            <p className="mt-1 text-xs text-slate-400">
              برای ورود، رمز عبور، کد بازیابی، یا Passkey لازم است.
            </p>
          </div>
          <div className="space-y-2">
            <Label>رمز عبور</Label>
            <Input
              type="password"
              value={twoStepPassword}
              onChange={(e) => setTwoStepPassword(e.target.value)}
              className={inputClass}
            />
          </div>
          <div className="space-y-2">
            <Label>کد بازیابی (اختیاری)</Label>
            <Input value={recovery} onChange={(e) => setRecovery(e.target.value)} className={cn(inputClass, "font-mono")} dir="ltr" />
          </div>
          <Button type="submit" className={primaryBtn} disabled={busy}>
            {busy ? "در حال ورود..." : "ادامه ورود"}
          </Button>
          {hasPasskeys && (
            <Button type="button" className={ghostBtn} disabled={busy} onClick={() => void onPasskeyLogin()}>
              ورود با Passkey
            </Button>
          )}
          <Button type="button" className={ghostBtn} disabled={busy} onClick={idMode === "email" ? switchToPhone : switchToEmail}>
            {idMode === "email" ? "تغییر با شماره" : "تغییر با ایمیل"}
          </Button>
        </form>
      )}

      {step === "profile" && (
        <form onSubmit={onProfile} className="space-y-5">
          <div className="flex items-start gap-3 rounded-2xl border border-sky-400/20 bg-cyan-400/5 p-4 text-sm">
            <ShieldCheck className="mt-0.5 size-5 shrink-0 text-cyan-200" />
            <div>
              <p className="font-medium">شناسه تأیید شد</p>
              <p className="mt-1 text-slate-300" dir="ltr">
                {masked}
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
              className={inputClass}
              minLength={2}
              maxLength={60}
              required
            />
          </div>
          <Button type="submit" className={primaryBtn} disabled={busy}>
            فعال‌سازی حساب
          </Button>
        </form>
      )}
    </div>,
  );
}

function Honeypot({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  return (
    <input
      tabIndex={-1}
      autoComplete="off"
      aria-hidden="true"
      className="absolute start-[-10000px] h-0 w-0 opacity-0"
      name="website"
      value={value}
      onChange={(e) => onChange(e.target.value)}
    />
  );
}
