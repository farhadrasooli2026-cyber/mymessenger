"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { toast } from "sonner";
import { NixoMark } from "@/components/nixo-mark";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

type ConsentKey = "analytics" | "contactSync" | "location" | "marketing";
type Dash = {
  score: number;
  totpEnabled: boolean;
  twoStepEnabled: boolean;
  hasPassword: boolean;
  screenshotProtect: boolean;
  consents: Record<ConsentKey, boolean>;
  loginHistory: { id: string; kind: string; title: string; createdAt: number; detail?: string }[];
  metrics: { activeSessions: number; suspicious24h: number; failedLogins: number };
  mutedCount: number;
  blockedCount: number;
  restrictedCount: number;
};
type Privacy = {
  checkup: { id: string; label: string; value: string; warn: boolean }[];
  muted: string[];
  restricted: string[];
  blocked: string[];
};

const CONSENT_LABEL: Record<ConsentKey, string> = {
  analytics: "تحلیل محصول (اختیاری — پیش‌فرض خاموش)",
  contactSync: "همگام مخاطب با هش",
  location: "موقعیت تقریبی",
  marketing: "پیام‌های محصول",
};

function when(ts: number) {
  return new Date(ts).toLocaleString("fa-IR");
}

export function PrivacySecurityCenter() {
  const [dash, setDash] = useState<Dash | null>(null);
  const [privacy, setPrivacy] = useState<Privacy | null>(null);
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [code, setCode] = useState("");
  const [secret, setSecret] = useState("");
  const [otpauth, setOtpauth] = useState("");
  const [exportToken, setExportToken] = useState("");
  const [peer, setPeer] = useState("");
  const [busy, setBusy] = useState(false);

  function load() {
    fetch("/api/security", { cache: "no-store" })
      .then((r) => r.json())
      .then((d) => {
        if (d.ok) setDash(d as Dash);
      })
      .catch(() => undefined);
    fetch("/api/privacy", { cache: "no-store" })
      .then((r) => r.json())
      .then((d) => {
        if (d.ok) setPrivacy({ checkup: d.checkup ?? [], muted: d.muted ?? [], restricted: d.restricted ?? [], blocked: d.blocked ?? [] });
      })
      .catch(() => undefined);
  }

  useEffect(() => {
    load();
  }, []);

  async function sec(body: Record<string, unknown>) {
    setBusy(true);
    try {
      const res = await fetch("/api/security", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = await res.json();
      if (!res.ok) {
        toast.error(data.error ?? "انجام نشد.");
        return data;
      }
      load();
      return data;
    } finally {
      setBusy(false);
    }
  }

  async function priv(body: Record<string, unknown>) {
    const res = await fetch("/api/privacy", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const data = await res.json();
    if (!res.ok) toast.error(data.error ?? "انجام نشد.");
    else load();
    return data;
  }

  if (!dash || !privacy) return <p className="p-6 text-sm">بارگذاری…</p>;

  return (
    <main className="min-h-dvh bg-[#071614] p-5 text-emerald-50">
      <div className="mx-auto max-w-lg space-y-4">
        <div className="flex items-center gap-2">
          <NixoMark size={36} />
          <div>
            <p className="text-xs text-amber-200">تنظیمات ← مرکز حریم خصوصی و امنیت</p>
            <h1 className="text-xl font-semibold">مرکز حریم خصوصی و امنیت</h1>
          </div>
        </div>
        <p className="text-xs leading-6 text-emerald-100/65">
          مجوزها روی سرور اعمال می‌شوند. تغییر شناسه، توکن، کوکی یا بدنهٔ درخواست حساب دیگری را باز نمی‌کند. نیکسو ادعا نمی‌کند غیرقابل نفوذ است.
        </p>

        <section className="rounded-2xl bg-white/5 p-4 text-sm">
          <h2 className="font-medium">امتیاز امنیت حساب</h2>
          <p className="mt-2 text-3xl font-semibold text-amber-200">{dash.score}</p>
          <p className="mt-1 text-[11px] opacity-70">
            نشست فعال: {dash.metrics.activeSessions} · مشکوک ۲۴س: {dash.metrics.suspicious24h} · هشدار ورود: {dash.metrics.failedLogins}
          </p>
        </section>

        <section className="rounded-2xl bg-white/5 p-4 text-sm">
          <h2 className="font-medium">داشبوردها</h2>
          <div className="mt-2 grid gap-2 text-xs">
            <Link href="/app/settings/privacy" className="text-amber-200">
              داشبورد حریم خصوصی — عکس، شماره، Last Seen، پیام، تماس، گروه
            </Link>
            <Link href="/app/settings/security" className="text-amber-200">
              داشبورد امنیت — ۲FA، Passkey، نشست، گزارش آسیب‌پذیری
            </Link>
            <Link href="/app/settings/devices" className="text-amber-200">
              دستگاه‌ها و نشست‌ها — خروج از راه دور
            </Link>
            <Link href="/app/settings/account" className="text-amber-200">
              حساب — حذف با مهلت ۱۴روزه، پشتیبان، تغییر شناسه
            </Link>
          </div>
        </section>

        <section className="rounded-2xl bg-white/5 p-4 text-sm">
          <h2 className="font-medium">Privacy Checkup</h2>
          <div className="mt-2 space-y-1">
            {privacy.checkup.map((c) => (
              <p key={c.id} className="text-xs">
                {c.warn ? "⚠️ " : "✓ "}
                {c.label}: {c.value}
              </p>
            ))}
          </div>
        </section>

        <section className="rounded-2xl bg-white/5 p-4 text-sm">
          <h2 className="font-medium">تغییر رمز</h2>
          <p className="mt-1 text-[11px] opacity-70">حداقل ۱۰ نویسه. رمز هرگز به‌صورت متن ساده ذخیره نمی‌شود. تأیید با رمز فعلی.</p>
          <Input type="password" className="mt-2" placeholder="رمز فعلی" value={current} onChange={(e) => setCurrent(e.target.value)} />
          <Input type="password" className="mt-2" placeholder="رمز جدید" value={next} onChange={(e) => setNext(e.target.value)} />
          <Button
            type="button"
            className="mt-2"
            disabled={busy}
            onClick={() =>
              void sec({ action: "password-change", current, next }).then((d) => {
                if (d?.ok) {
                  toast.success("رمز تغییر کرد.");
                  setCurrent("");
                  setNext("");
                }
              })
            }
          >
            ذخیره رمز
          </Button>
        </section>

        <section className="rounded-2xl bg-white/5 p-4 text-sm">
          <h2 className="font-medium">Authenticator (TOTP)</h2>
          <p className="mt-1 text-[11px] opacity-70">
            {dash.totpEnabled ? "فعال است." : "غیرفعال."} فعال‌سازی فقط پس از تأیید کد معتبر است. Backup Code از داشبورد امنیت صادر می‌شود.
          </p>
          {!dash.totpEnabled && (
            <Button
              type="button"
              className="mt-2"
              disabled={busy}
              onClick={() =>
                void sec({ action: "totp-begin" }).then((d) => {
                  if (d?.secret) {
                    setSecret(d.secret);
                    setOtpauth(d.otpauth ?? "");
                    toast.message("رمز را در برنامهٔ Authenticator اسکن یا وارد کنید.");
                  }
                })
              }
            >
              شروع تنظیم
            </Button>
          )}
          {secret && (
            <p className="mt-2 break-all font-mono text-[11px]" dir="ltr">
              {secret}
            </p>
          )}
          {otpauth && (
            <p className="mt-1 break-all text-[10px] opacity-60" dir="ltr">
              {otpauth}
            </p>
          )}
          <Input className="mt-2" placeholder="کد ۶ رقمی" value={code} onChange={(e) => setCode(e.target.value)} />
          {!dash.totpEnabled ? (
            <Button type="button" className="mt-2" disabled={busy} onClick={() => void sec({ action: "totp-confirm", code })}>
              تأیید و فعال‌سازی
            </Button>
          ) : (
            <Button
              type="button"
              variant="secondary"
              className="mt-2"
              disabled={busy}
              onClick={() => void sec({ action: "totp-disable", password: current, code })}
            >
              خاموش کردن (رمز یا کد)
            </Button>
          )}
        </section>

        <section className="rounded-2xl bg-white/5 p-4 text-sm">
          <h2 className="font-medium">رضایت داده</h2>
          <p className="mt-1 text-[11px] opacity-70">پیش‌فرض خاموش است. فقط دادهٔ ضروری حساب نگه داشته می‌شود. تحلیل محصول جدا از شمارنده‌های امنیت/پایداری است؛ Opt-out متن پیام را به نیکسو نمی‌دهد چون متن اصلاً جمع نمی‌شود.</p>
          {(Object.keys(CONSENT_LABEL) as ConsentKey[]).map((key) => (
            <label key={key} className="mt-2 flex items-center gap-2 text-xs">
              <input
                type="checkbox"
                checked={Boolean(dash.consents[key])}
                onChange={(e) => void sec({ action: "consents", [key]: e.target.checked })}
              />
              {CONSENT_LABEL[key]}
            </label>
          ))}
          <label className="mt-3 flex items-center gap-2 text-xs">
            <input
              type="checkbox"
              checked={dash.screenshotProtect}
              onChange={(e) => void sec({ action: "screenshot", on: e.target.checked })}
            />
            هشدار اسکرین‌شات در مرورگرهایی که پشتیبانی می‌کنند (تضمین همهٔ دستگاه‌ها نیست)
          </label>
        </section>

        <section className="rounded-2xl bg-white/5 p-4 text-sm">
          <h2 className="font-medium">خروجی داده</h2>
          <p className="mt-1 text-[11px] opacity-70">فقط صاحب حساب. لینک ۱۵ دقیقه، یک‌بارمصرف، بدون رمز و توکن داخل فایل.</p>
          <Button
            type="button"
            className="mt-2"
            disabled={busy}
            onClick={() =>
              void sec({ action: "privacy-export" }).then((d) => {
                if (d?.token) {
                  setExportToken(d.token);
                  toast.success("لینک موقت ساخته شد.");
                }
              })
            }
          >
            ساخت خروجی
          </Button>
          {exportToken && (
            <Button
              type="button"
              variant="secondary"
              className="mt-2"
              onClick={() => {
                void fetch(`/api/security?exportToken=${encodeURIComponent(exportToken)}`)
                  .then((r) => r.json())
                  .then((d) => {
                    if (!d.ok) {
                      toast.error(d.error ?? "منقضی است.");
                      return;
                    }
                    const blob = new Blob([JSON.stringify(d.export, null, 2)], { type: "application/json" });
                    const a = document.createElement("a");
                    a.href = URL.createObjectURL(blob);
                    a.download = "nixo-privacy-export.json";
                    a.click();
                    setExportToken("");
                    toast.success("دانلود شد و لینک باطل گردید.");
                  });
              }}
            >
              دانلود و ابطال لینک
            </Button>
          )}
        </section>

        <section className="rounded-2xl bg-white/5 p-4 text-sm">
          <h2 className="font-medium">مسدود، بی‌صدا، محدود</h2>
          <p className="mt-1 text-[11px] opacity-70">
            مسدود {dash.blockedCount} · بی‌صدا {dash.mutedCount} · محدود {dash.restrictedCount}
          </p>
          <Input className="mt-2" placeholder="شناسه کاربر" value={peer} onChange={(e) => setPeer(e.target.value)} />
          <div className="mt-2 flex flex-wrap gap-2">
            <Button type="button" size="sm" onClick={() => void priv({ action: "block", peerKey: peer, blocked: true })}>
              Block
            </Button>
            <Button type="button" size="sm" variant="secondary" onClick={() => void priv({ action: "mute", peerKey: peer, muted: true })}>
              Mute
            </Button>
            <Button type="button" size="sm" variant="secondary" onClick={() => void priv({ action: "restrict", peerKey: peer, restricted: true })}>
              Restrict
            </Button>
          </div>
          {privacy.muted.map((id) => (
            <div key={`m-${id}`} className="mt-1 flex justify-between text-[11px]">
              <span dir="ltr">mute {id.slice(0, 10)}…</span>
              <button type="button" className="text-amber-200" onClick={() => void priv({ action: "mute", peerKey: id, muted: false })}>
                Unmute
              </button>
            </div>
          ))}
          {privacy.restricted.map((id) => (
            <div key={`r-${id}`} className="mt-1 flex justify-between text-[11px]">
              <span dir="ltr">restrict {id.slice(0, 10)}…</span>
              <button type="button" className="text-amber-200" onClick={() => void priv({ action: "restrict", peerKey: id, restricted: false })}>
                برداشتن محدودیت
              </button>
            </div>
          ))}
        </section>

        <section className="rounded-2xl bg-white/5 p-4 text-sm">
          <h2 className="font-medium">تاریخچه ورود</h2>
          <ul className="mt-2 max-h-48 space-y-2 overflow-auto text-xs">
            {dash.loginHistory.map((e) => (
              <li key={e.id}>
                {e.title} · {when(e.createdAt)}
                {e.detail ? ` — ${e.detail}` : ""}
              </li>
            ))}
          </ul>
          {dash.loginHistory.length === 0 && <p className="mt-2 text-xs opacity-60">رویدادی نیست.</p>}
        </section>

        <p className="text-[11px] leading-5 opacity-60">
          بازیابی رمز از مسیر امن /recover با OTP و توکن منقضی. رسانهٔ خصوصی URL مستقیم بدون نشست ندارد. ارتباط در production باید HTTPS باشد. کوکی نشست HttpOnly و SameSite=Lax است.
        </p>
        <Link href="/app" className="inline-block text-sm text-amber-200">
          بازگشت به نیکسو
        </Link>
      </div>
    </main>
  );
}
