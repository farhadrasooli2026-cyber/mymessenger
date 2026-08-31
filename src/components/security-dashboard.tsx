"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { toast } from "sonner";
import { NixoMark } from "@/components/nixo-mark";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

type Device = {
  id: string;
  label: string;
  userAgent: string;
  approx: string;
  createdAt: number;
  lastSeenAt: number;
  current: boolean;
};
type EventRow = { id: string; kind: string; title: string; createdAt: number; detail?: string; userAgent?: string };
type CheckItem = { id: string; label: string; ok: boolean; value?: string };
type Dash = {
  checkup: { items: CheckItem[]; suspiciousDevices: { id: string; at: number; detail?: string; label?: string }[] };
  devices: Device[];
  events: EventRow[];
  twoStepEnabled: boolean;
  recoveryLeft: number;
  passkeys: { id: string; name: string; createdAt: number }[];
  backupSet: boolean;
  hasPassword: boolean;
};

function when(ts: number) {
  return new Date(ts).toLocaleString("fa-IR");
}

async function bufToB64url(buf: ArrayBuffer) {
  const bytes = new Uint8Array(buf);
  let s = "";
  bytes.forEach((b) => {
    s += String.fromCharCode(b);
  });
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export function SecurityDashboard() {
  const [dash, setDash] = useState<Dash | null>(null);
  const [password, setPassword] = useState("");
  const [codes, setCodes] = useState<string[] | null>(null);
  const [backup, setBackup] = useState("");
  const [vuln, setVuln] = useState("");
  const [contact, setContact] = useState("");
  const [busy, setBusy] = useState(false);
  const [recovered, setRecovered] = useState(false);

  function load() {
    fetch("/api/security", { cache: "no-store" })
      .then((r) => r.json())
      .then((d) => {
        if (d.ok) setDash(d as Dash);
      })
      .catch(() => undefined);
  }

  useEffect(() => {
    load();
    try {
      if (new URLSearchParams(window.location.search).get("recovered") === "1") setRecovered(true);
    } catch {
      /* ignore */
    }
  }, []);

  async function act(body: Record<string, unknown>) {
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
      if (Array.isArray(data.codes)) setCodes(data.codes as string[]);
      load();
      return data;
    } finally {
      setBusy(false);
    }
  }

  async function registerPasskey() {
    if (!window.PublicKeyCredential) {
      toast.error("این مرورگر Passkey را پشتیبانی نمی‌کند.");
      return;
    }
    const ch = await act({ action: "passkey-challenge", mode: "register" });
    if (!ch?.challenge) return;
    try {
      const cred = (await navigator.credentials.create({
        publicKey: {
          challenge: Uint8Array.from(atob(String(ch.challenge).replace(/-/g, "+").replace(/_/g, "/")), (c) => c.charCodeAt(0)),
          rp: { name: "NIXO", id: location.hostname === "127.0.0.1" ? "127.0.0.1" : location.hostname },
          user: {
            id: crypto.getRandomValues(new Uint8Array(16)),
            name: "nixo-user",
            displayName: "NIXO",
          },
          pubKeyCredParams: [
            { type: "public-key", alg: -7 },
            { type: "public-key", alg: -257 },
          ],
          timeout: 60_000,
          authenticatorSelection: { userVerification: "preferred", residentKey: "preferred" },
        },
      })) as PublicKeyCredential | null;
      if (!cred) return;
      const att = cred.response as AuthenticatorAttestationResponse;
      await act({
        action: "passkey-register",
        challengeId: ch.challengeId,
        credentialId: await bufToB64url(cred.rawId),
        clientDataJSON: await bufToB64url(att.clientDataJSON),
        name: `${dash?.devices.find((d) => d.current)?.label ?? "دستگاه"} Passkey`,
      });
      toast.success("Passkey ثبت شد. تأیید امضای کامل FIDO2 در نسخهٔ production تکمیل می‌شود.");
    } catch {
      toast.error("Passkey روی این میزبان ممکن است کار نکند (مثلاً 127.0.0.1). از localhost یا HTTPS استفاده کنید.");
    }
  }

  if (!dash) return <p className="p-6 text-sm">بارگذاری…</p>;

  return (
    <main className="min-h-dvh bg-[#071614] p-5 text-emerald-50">
      <div className="mx-auto max-w-lg space-y-4">
        <div className="flex items-center gap-2">
          <NixoMark size={36} />
          <div>
            <p className="text-xs text-amber-200">تنظیمات ← امنیت</p>
            <h1 className="text-xl font-semibold">امنیت حساب و E2EE</h1>
          </div>
        </div>
        <p className="text-xs leading-6 text-emerald-100/65">
          نیکسو ادعا نمی‌کند ۱۰۰٪ غیرقابل نفوذ است. هدف: حداکثر امنیت عملی، Defense in Depth، E2EE روی دستگاه، احراز هویت سخت، مجوز سمت سرور، و آزمون مداوم. هیچ برنامه‌ای عکس گرفتن از صفحه با دستگاه دیگر را کامل متوقف نمی‌کند.
        </p>
        <p className="text-xs">
          <Link href="/app/settings/privacy" className="text-amber-200">
            داشبورد حریم خصوصی
          </Link>
          {" · "}
          <Link href="/app/settings/devices" className="text-amber-200">
            دستگاه‌ها
          </Link>
        </p>
        {recovered && (
          <section className="rounded-2xl border border-amber-300/40 bg-amber-300/10 p-4 text-xs leading-6">
            بازیابی موفق. نشست‌های دیگر باطل شدند. این Security Checkup را مرور کنید. Recovery Codeها را در جای امن نگه دارید — هر کد یک‌بارمصرف است. کلید E2EE خودکار به دستگاه جدید نمی‌آید؛ Restore پشتیبان لازم است.
          </section>
        )}

        <section className="rounded-2xl bg-white/5 p-4 text-sm">
          <h2 className="font-medium">Security Checkup</h2>
          <div className="mt-2 space-y-2">
            {dash.checkup.items.map((c) => (
              <p key={c.id} className="text-xs">
                {c.ok ? "✓ " : "⚠️ "}
                {c.label}
                {c.value ? `: ${c.value}` : c.ok ? " فعال است." : " نیاز به توجه دارد."}
              </p>
            ))}
          </div>
        </section>

        <section className="rounded-2xl bg-white/5 p-4 text-sm">
          <h2 className="font-medium">دستگاه‌ها و نشست‌ها</h2>
          <p className="mt-1 text-[11px] leading-5 text-emerald-100/60">
            هر دستگاه کلید E2EE خودش را در حافظهٔ مرورگر نگه می‌دارد. دستگاه ناشناس بدون تأیید وارد محتوای خصوصی نمی‌شود. خروج، نشست را در سرور باطل می‌کند.
          </p>
          <ul className="mt-3 space-y-3">
            {dash.devices.map((d) => (
              <li key={d.id} className="rounded-xl border border-white/10 p-3 text-xs">
                <p className="font-medium">
                  {d.label}
                  {d.current ? " · این دستگاه" : ""}
                </p>
                <p className="mt-1 opacity-70">{d.approx}</p>
                <p className="opacity-60">ورود: {when(d.createdAt)}</p>
                <p className="opacity-60">آخرین فعالیت: {when(d.lastSeenAt)}</p>
                {!d.current && (
                  <Button
                    type="button"
                    variant="ghost"
                    className="mt-2 h-8 px-0 text-amber-200"
                    disabled={busy}
                    onClick={() => void act({ action: "revoke", deviceId: d.id }).then(() => toast.success("دستگاه خارج شد."))}
                  >
                    Log Out / Remove / Revoke
                  </Button>
                )}
              </li>
            ))}
          </ul>
          {dash.devices.length === 0 && <p className="mt-2 text-xs opacity-60">نشست فعالی در فهرست نیست.</p>}
          <Button
            type="button"
            className="mt-3"
            disabled={busy}
            onClick={() => void act({ action: "revoke-others" }).then(() => toast.success("سایر دستگاه‌ها خارج شدند."))}
          >
            خروج از دستگاه‌های دیگر
          </Button>
        </section>

        <section className="rounded-2xl bg-white/5 p-4 text-sm">
          <h2 className="font-medium">رمز دومرحله‌ای</h2>
          <p className="mt-1 text-[11px] leading-5 text-emerald-100/60">
            ورود بعدی: کد یک‌بارمصرف + رمز عبور (یا Passkey یا کد بازیابی). رمز هرگز به‌صورت متن ساده ذخیره نمی‌شود.
          </p>
          <Input
            type="password"
            className="mt-3"
            placeholder="رمز عبور (حداقل ۱۰ نویسه)"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
          <div className="mt-2 flex flex-wrap gap-2">
            {!dash.twoStepEnabled ? (
              <Button type="button" disabled={busy} onClick={() => void act({ action: "twostep-enable", password })}>
                فعال‌سازی
              </Button>
            ) : (
              <Button type="button" variant="secondary" disabled={busy} onClick={() => void act({ action: "twostep-disable", password })}>
                خاموش کردن
              </Button>
            )}
            <Button type="button" variant="secondary" disabled={busy} onClick={() => void act({ action: "recovery-codes", password })}>
              صدور کد بازیابی
            </Button>
          </div>
          {dash.recoveryLeft > 0 && <p className="mt-2 text-[11px]">کد بازیابی باقی‌مانده: {dash.recoveryLeft}</p>}
          {codes && (
            <div className="mt-3 rounded-xl bg-black/30 p-3 text-xs">
              Recovery Codes را در محل امن نگهداری کنید. هر کد فقط یک‌بار قابل استفاده است.
              <ul className="mt-2 grid grid-cols-2 gap-1 font-mono" dir="ltr">
                {codes.map((c) => (
                  <li key={c}>{c}</li>
                ))}
              </ul>
            </div>
          )}
        </section>

        <section className="rounded-2xl bg-white/5 p-4 text-sm">
          <h2 className="font-medium">Passkey</h2>
          <p className="mt-1 text-[11px] leading-5 text-emerald-100/60">
            اثر انگشت، Face ID یا PIN دستگاه — اگر مرورگر WebAuthn را پشتیبانی کند. این برش چالش و شناسهٔ اعتبار را ثبت می‌کند؛ تأیید امضای کامل attestation برای production است.
          </p>
          <ul className="mt-2 space-y-1 text-xs">
            {dash.passkeys.map((p) => (
              <li key={p.id} className="flex items-center justify-between gap-2">
                <span>
                  {p.name} · {when(p.createdAt)}
                </span>
                <button type="button" className="text-amber-200" onClick={() => void act({ action: "passkey-delete", id: p.id })}>
                  حذف
                </button>
              </li>
            ))}
          </ul>
          <Button type="button" className="mt-3" disabled={busy} onClick={() => void registerPasskey()}>
            افزودن Passkey
          </Button>
        </section>

        <section className="rounded-2xl bg-white/5 p-4 text-sm">
          <h2 className="font-medium">پشتیبان E2EE</h2>
          <p className="mt-1 text-[11px] leading-5 text-emerald-100/60">
            کلید نخ‌های خصوصی روی این دستگاه است. اگر کلید پشتیبان بسازید، سرور فقط تأییدگر HMAC را نگه می‌دارد و نمی‌تواند چت را باز کند. بازیابی حساب با یک عامل ضعیف (فقط ایمیل) مالکیت را نمی‌دهد.
          </p>
          <Input className="mt-3" placeholder="عبارت پشتیبان حداقل ۱۶ نویسه" value={backup} onChange={(e) => setBackup(e.target.value)} />
          <div className="mt-2 flex gap-2">
            <Button type="button" disabled={busy} onClick={() => void act({ action: "backup-set", secret: backup })}>
              ذخیرهٔ تأییدگر
            </Button>
            <Button type="button" variant="secondary" disabled={busy} onClick={() => void act({ action: "backup-clear", secret: backup })}>
              حذف
            </Button>
          </div>
          <p className="mt-2 text-[11px]">{dash.backupSet ? "تأییدگر روی سرور هست." : "تأییدگر تنظیم نشده."}</p>
        </section>

        <section className="rounded-2xl bg-white/5 p-4 text-sm">
          <h2 className="font-medium">اطلاع ورود و رویدادها</h2>
          <ul className="mt-2 max-h-56 space-y-2 overflow-auto text-xs">
            {dash.events.map((e) => (
              <li key={e.id}>
                <span className="text-amber-100">{e.title}</span>
                {" · "}
                {when(e.createdAt)}
                {e.detail ? ` — ${e.detail}` : ""}
              </li>
            ))}
          </ul>
        </section>

        <section className="rounded-2xl bg-white/5 p-4 text-sm">
          <h2 className="font-medium">فایل، لینک، اسکرین‌شات</h2>
          <p className="mt-1 text-[11px] leading-6 text-emerald-100/60">
            فایل اجرایی و HTML بدون هشدار باز نمی‌شود. لینک کوتاه‌شده یا Punycode در چت هشدار می‌گیرد. کلیدها در localStorage مرورگر هستند؛ در اپ بومی باید به Keychain / Keystore بروند. محدود کردن اسکرین‌شات فقط جایی است که سیستم‌عامل اجازه بدهد.
          </p>
        </section>

        <section className="rounded-2xl bg-white/5 p-4 text-sm">
          <h2 className="font-medium">گزارش آسیب‌پذیری</h2>
          <p className="mt-1 text-[11px] text-emerald-100/60">مسیر مسئولانه برای گزارش باگ امنیتی. نیکسو را در production بدون آزمون نفوذ، اسکن وابستگی و بازبینی کد منتشر نکنید.</p>
          <textarea
            className="mt-3 h-24 w-full rounded-md bg-black/30 p-2 text-xs"
            placeholder="شرح آسیب‌پذیری"
            value={vuln}
            onChange={(e) => setVuln(e.target.value)}
          />
          <Input className="mt-2" placeholder="راه تماس (اختیاری)" value={contact} onChange={(e) => setContact(e.target.value)} />
          <Button
            type="button"
            className="mt-2"
            disabled={busy}
            onClick={() =>
              void act({ action: "vuln", summary: vuln, contact }).then((d) => {
                if (d?.ok) {
                  toast.success("گزارش ثبت شد.");
                  setVuln("");
                }
              })
            }
          >
            ارسال گزارش
          </Button>
        </section>
      </div>
    </main>
  );
}
