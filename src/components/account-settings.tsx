"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { NixoMark } from "@/components/nixo-mark";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { DELETION_PHRASE } from "@/lib/account-types";
import { wrapBackup, unwrapBackup, generateRecoveryKey } from "@/lib/backup-crypto";
import { applyDeviceVault, collectDeviceVault } from "@/lib/e2ee";
import { defaultAppearance } from "@/lib/appearance-types";

type PolicyRow = { data: string; why: string; keep: string; backup: string; deletable: string };
type Account = {
  channel: string;
  identifierMasked: string;
  accountStatus: string;
  deletionRequestedAt: number | null;
  deletionFinalizeAt: number | null;
  graceDays: number;
  persistence: string;
  twoStep: boolean;
  devices: number;
};
type BackupState = {
  prefs: {
    auto: boolean;
    schedule: "daily" | "weekly" | "monthly";
    includePhotos: boolean;
    includeVideos: boolean;
    includeFiles: boolean;
    includeVoice: boolean;
  };
  hasPassword: boolean;
  hasRecovery: boolean;
  latest: {
    createdAt: number;
    sizeBytes: number;
    status: string;
    error?: string;
    encryption: string;
    location: string;
    include: Record<string, boolean>;
  } | null;
  autoDue?: boolean;
};

function when(ts: number) {
  return new Date(ts).toLocaleString("fa-IR");
}

export function AccountSettings() {
  const router = useRouter();
  const [account, setAccount] = useState<Account | null>(null);
  const [policy, setPolicy] = useState<PolicyRow[]>([]);
  const [backup, setBackup] = useState<BackupState | null>(null);
  const [step, setStep] = useState<"idle" | "warn" | "verify" | "confirm">("idle");
  const [otp, setOtp] = useState("");
  const [challengeId, setChallengeId] = useState("");
  const [inbox, setInbox] = useState<string | null>(null);
  const [phrase, setPhrase] = useState("");
  const [password, setPassword] = useState("");
  const [newId, setNewId] = useState("");
  const [newChannel, setNewChannel] = useState<"phone" | "email">("phone");
  const [changeCode, setChangeCode] = useState("");
  const [changeChallenge, setChangeChallenge] = useState("");
  const [backupPass, setBackupPass] = useState("");
  const [recoveryShown, setRecoveryShown] = useState<string | null>(null);
  const [restoreSecret, setRestoreSecret] = useState("");
  const [restoreChats, setRestoreChats] = useState(true);
  const [restoreSettings, setRestoreSettings] = useState(true);
  const [restorePhotos, setRestorePhotos] = useState(true);
  const [busy, setBusy] = useState(false);

  function load() {
    fetch("/api/account", { cache: "no-store" })
      .then((r) => r.json())
      .then((d) => {
        if (d.account) setAccount(d.account);
        if (d.policy) setPolicy(d.policy);
      })
      .catch(() => undefined);
    fetch("/api/backup", { cache: "no-store" })
      .then((r) => r.json())
      .then((d) => {
        if (d.ok) setBackup(d as BackupState);
      })
      .catch(() => undefined);
  }

  useEffect(() => {
    load();
  }, []);

  async function postAccount(body: Record<string, unknown>) {
    const res = await fetch("/api/account", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const data = await res.json();
    if (!res.ok) {
      toast.error(data.error ?? "انجام نشد.");
      return null;
    }
    return data;
  }

  async function postBackup(body: Record<string, unknown>) {
    const res = await fetch("/api/backup", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const data = await res.json();
    if (!res.ok) {
      toast.error(data.error ?? "Backup Failed");
      return null;
    }
    return data;
  }

  async function sendDeleteOtp() {
    setBusy(true);
    try {
      const data = await postAccount({ action: "delete-otp" });
      if (!data) return;
      setChallengeId(data.challengeId);
      setInbox(typeof data.inbox === "string" ? data.inbox : null);
      setStep("verify");
      toast.message("کد تأیید حذف ارسال شد.");
    } finally {
      setBusy(false);
    }
  }

  async function confirmDelete() {
    setBusy(true);
    try {
      const data = await postAccount({
        action: "delete-confirm",
        phrase,
        code: otp,
        challengeId,
        password: password || undefined,
      });
      if (!data) return;
      toast.message("حساب وارد وضعیت Pending Deletion شد. تا پایان دوره می‌توانید لغو کنید.");
      setStep("idle");
      load();
    } finally {
      setBusy(false);
    }
  }

  async function runBackup() {
    if (!backupPass) {
      toast.error("رمز پشتیبان را وارد کنید.");
      return;
    }
    setBusy(true);
    try {
      const prefs = backup?.prefs;
      const saved = await fetch("/api/saved?export=1", { cache: "no-store" }).then((r) => r.json()).catch(() => null);
      const vault = await collectDeviceVault({ appearance: defaultAppearance() });
      const wrapped = await wrapBackup(backupPass, JSON.stringify({ ...vault, savedBundle: saved?.bundle ?? null }));
      const data = await postBackup({
        action: "upload",
        ...wrapped,
        chats: true,
        settings: true,
        photos: prefs?.includePhotos,
        videos: prefs?.includeVideos,
        files: prefs?.includeFiles,
        voice: prefs?.includeVoice,
      });
      if (data?.backup) toast.success("پشتیبان رمزشده ذخیره شد. سرور متن چت را ندارد.");
      load();
    } catch {
      toast.error("Backup Failed — Network Error یا خطای رمزنگاری روی دستگاه.");
    } finally {
      setBusy(false);
    }
  }

  async function enableSecrets() {
    if (backupPass.trim().length < 10) {
      toast.error("رمز پشتیبان حداقل ۱۰ نویسه.");
      return;
    }
    const key = generateRecoveryKey();
    setBusy(true);
    try {
      const data = await postBackup({ action: "enable", password: backupPass, recoveryKey: key });
      if (!data) return;
      setRecoveryShown(key);
      toast.message("کلید بازیابی را ذخیره کنید. گم کردنش یعنی از دست رفتن امکان Restore.");
      load();
    } finally {
      setBusy(false);
    }
  }

  async function restore() {
    setBusy(true);
    try {
      const data = await postBackup({ action: "restore", secret: restoreSecret });
      if (!data?.wrapped) return;
      const json = await unwrapBackup(restoreSecret, data.wrapped);
      const vault = JSON.parse(json) as Parameters<typeof applyDeviceVault>[0] & { savedBundle?: { items?: unknown[] } };
      if (restoreChats) await applyDeviceVault(vault, { chats: true });
      if (vault.savedBundle) {
        await fetch("/api/saved", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action: "restore-backup", bundle: vault.savedBundle }),
        });
      }
      toast.success("بازیابی روی این دستگاه انجام شد. گروه و کانال با ورود همگام هستند.");
      void restoreSettings;
      void restorePhotos;
      load();
    } catch {
      toast.error("بازیابی ناموفق — رمز نادرست یا پشتیبان ناقص.");
    } finally {
      setBusy(false);
    }
  }

  if (!account || !backup) return <p className="p-6 text-sm">بارگذاری…</p>;

  const pending = account.accountStatus === "pending_deletion";

  return (
    <main className="min-h-dvh bg-[#071614] p-5 text-emerald-50">
      <div className="mx-auto max-w-lg space-y-4">
        <div className="flex items-center gap-2">
          <NixoMark size={36} />
          <div>
            <p className="text-xs text-amber-200">تنظیمات ← حساب</p>
            <h1 className="text-xl font-semibold">ماندگاری حساب و پشتیبان</h1>
          </div>
        </div>
        <p className="text-xs leading-6 text-emerald-100/65">{account.persistence}</p>
        <p className="text-xs">
          <Link href="/app/settings/security" className="text-amber-200">
            امنیت
          </Link>
          {" · "}
          <Link href="/app/settings/privacy" className="text-amber-200">
            حریم خصوصی
          </Link>
        </p>

        {pending && (
          <section className="rounded-2xl border border-amber-300/40 bg-amber-300/10 p-4 text-sm">
            <p className="font-medium">حذف در انتظار است</p>
            <p className="mt-1 text-xs">
              نهایی‌سازی: {account.deletionFinalizeAt ? when(account.deletionFinalizeAt) : "—"} ({account.graceDays} روز
              مهلت). با ورود و تأیید می‌توانید لغو کنید.
            </p>
            <Button
              type="button"
              className="mt-3"
              disabled={busy}
              onClick={() => void postAccount({ action: "delete-cancel" }).then((d) => d && (toast.success("حذف لغو شد."), load()))}
            >
              لغو حذف حساب
            </Button>
          </section>
        )}

        <section className="rounded-2xl bg-white/5 p-4 text-sm">
          <h2 className="font-medium">ورود مجدد و چند دستگاه</h2>
          <p className="mt-1 text-[11px] leading-5 text-emerald-100/60">
            Login → Verification → Authentication → دسترسی. الان {account.devices} نشست فعال. پروفایل، مخاطب، گروه، کانال و
            تنظیمات سمت سرور همگام می‌شوند. متن چت E2EE فقط با پشتیبان رمزشده به دستگاه جدید می‌آید.
          </p>
          <p className="mt-2 text-xs" dir="ltr">
            {account.identifierMasked} · {account.channel}
          </p>
          <Button
            type="button"
            variant="secondary"
            className="mt-3"
            disabled={busy}
            onClick={() =>
              void postAccount({ action: "logout-all" }).then((d) => {
                if (d) {
                  toast.success("همهٔ نشست‌ها باطل شد.");
                  router.replace("/");
                }
              })
            }
          >
            Log Out All Devices
          </Button>
        </section>

        <section className="rounded-2xl bg-white/5 p-4 text-sm">
          <h2 className="font-medium">تغییر شماره یا ایمیل</h2>
          <p className="mt-1 text-[11px] text-emerald-100/60">شناسهٔ جدید حتماً با کد تأیید می‌شود. اگر رمز دومرحله‌ای دارید، همان‌جا لازم است.</p>
          <div className="mt-2 flex gap-3 text-xs">
            <label>
              <input type="radio" checked={newChannel === "phone"} onChange={() => setNewChannel("phone")} /> موبایل
            </label>
            <label>
              <input type="radio" checked={newChannel === "email"} onChange={() => setNewChannel("email")} /> ایمیل
            </label>
          </div>
          <Input className="mt-2" placeholder={newChannel === "phone" ? "09…" : "email"} value={newId} onChange={(e) => setNewId(e.target.value)} />
          <Button
            type="button"
            className="mt-2"
            disabled={busy}
            onClick={() =>
              void postAccount({ action: "change-start", channel: newChannel, identifier: newId }).then((d) => {
                if (!d) return;
                setChangeChallenge(d.challengeId);
                setInbox(d.inbox ?? null);
                toast.success("کد به شناسهٔ جدید ارسال شد.");
              })
            }
          >
            ارسال کد به شناسهٔ جدید
          </Button>
          {changeChallenge && (
            <div className="mt-2 space-y-2">
              <Input placeholder="کد ۶ رقمی" value={changeCode} onChange={(e) => setChangeCode(e.target.value)} dir="ltr" />
              {account.twoStep && (
                <Input type="password" placeholder="رمز دومرحله‌ای" value={password} onChange={(e) => setPassword(e.target.value)} />
              )}
              <Button
                type="button"
                disabled={busy}
                onClick={() =>
                  void postAccount({ action: "change-confirm", code: changeCode, password: password || undefined }).then((d) => {
                    if (d) {
                      toast.success("شناسه به‌روز شد.");
                      load();
                    }
                  })
                }
              >
                تأیید تغییر
              </Button>
            </div>
          )}
        </section>

        <section className="rounded-2xl bg-white/5 p-4 text-sm">
          <h2 className="font-medium">Chats → Backup</h2>
          <p className="mt-1 text-[11px] leading-5 text-emerald-100/60">
            پشتیبان روی دستگاه با AES-GCM و رمز شما پیچیده می‌شود. سرور فقط پاکت رمزشده را در nixo-vault نگه می‌دارد.
          </p>
          {backup.latest ? (
            <ul className="mt-2 space-y-1 text-xs">
              <li>Last Backup: {when(backup.latest.createdAt)}</li>
              <li>Backup Size: {(backup.latest.sizeBytes / 1024).toFixed(1)} KB</li>
              <li>Status: {backup.latest.status}</li>
              <li>Location: {backup.latest.location}</li>
              <li>Encryption: {backup.latest.encryption} · فعال</li>
              {backup.latest.error && <li className="text-amber-200">{backup.latest.error}</li>}
            </ul>
          ) : (
            <p className="mt-2 text-xs opacity-60">هنوز پشتیبانی نیست.</p>
          )}
          <label className="mt-3 flex items-center gap-2 text-xs">
            <input
              type="checkbox"
              checked={backup.prefs.auto}
              onChange={(e) => void postBackup({ action: "prefs", auto: e.target.checked }).then(() => load())}
            />
            Auto Backup
          </label>
          <div className="mt-2 flex gap-3 text-xs">
            {(["daily", "weekly", "monthly"] as const).map((s) => (
              <label key={s}>
                <input
                  type="radio"
                  checked={backup.prefs.schedule === s}
                  onChange={() => void postBackup({ action: "prefs", schedule: s }).then(() => load())}
                />{" "}
                {s === "daily" ? "روزانه" : s === "weekly" ? "هفتگی" : "ماهانه"}
              </label>
            ))}
          </div>
          <div className="mt-2 grid grid-cols-2 gap-2 text-xs">
            {(
              [
                ["includePhotos", "Photos", backup.prefs.includePhotos],
                ["includeVideos", "Videos", backup.prefs.includeVideos],
                ["includeFiles", "Files", backup.prefs.includeFiles],
                ["includeVoice", "Voice", backup.prefs.includeVoice],
              ] as const
            ).map(([k, label, on]) => (
              <label key={k}>
                <input type="checkbox" checked={on} onChange={(e) => void postBackup({ action: "prefs", [k]: e.target.checked }).then(() => load())} /> {label}
              </label>
            ))}
          </div>
          <Input className="mt-3" type="password" placeholder="رمز پشتیبان (فقط نزد شما)" value={backupPass} onChange={(e) => setBackupPass(e.target.value)} />
          <div className="mt-2 flex flex-wrap gap-2">
            <Button type="button" disabled={busy} onClick={() => void enableSecrets()}>
              تنظیم رمز و Recovery Key
            </Button>
            <Button type="button" disabled={busy || !backup.hasPassword} onClick={() => void runBackup()}>
              Backup Now
            </Button>
          </div>
          {recoveryShown && (
            <p className="mt-2 rounded-xl bg-black/30 p-2 font-mono text-xs" dir="ltr">
              {recoveryShown}
            </p>
          )}
          <p className="mt-2 text-[11px] text-amber-200">اگر Recovery Key گم شود، بازیابی پشتیبان ممکن است غیرممکن شود.</p>
          <Input className="mt-3" placeholder="رمز یا Recovery Key برای Restore" value={restoreSecret} onChange={(e) => setRestoreSecret(e.target.value)} />
          <div className="mt-2 flex flex-wrap gap-3 text-xs">
            <label>
              <input type="checkbox" checked={restoreChats} onChange={(e) => setRestoreChats(e.target.checked)} /> Chats
            </label>
            <label>
              <input type="checkbox" checked={restoreSettings} onChange={(e) => setRestoreSettings(e.target.checked)} /> Settings
            </label>
            <label>
              <input type="checkbox" checked={restorePhotos} onChange={(e) => setRestorePhotos(e.target.checked)} /> Photos/Videos/Files
            </label>
          </div>
          <Button type="button" className="mt-2" disabled={busy} onClick={() => void restore()}>
            Restore Backup
          </Button>
          <Button
            type="button"
            variant="secondary"
            className="mt-2"
            disabled={busy || !backup.latest}
            onClick={() => {
              if (!confirm("پشتیبان حذف شود؟")) return;
              void postBackup({ action: "delete" }).then((d) => {
                if (d) {
                  toast.success("Deleted");
                  load();
                }
              });
            }}
          >
            Delete Backup
          </Button>
        </section>

        <section className="rounded-2xl bg-white/5 p-4 text-sm">
          <h2 className="font-medium">چه داده‌ای ذخیره می‌شود</h2>
          <div className="mt-2 space-y-3 text-[11px] leading-5">
            {policy.map((row) => (
              <div key={row.data} className="rounded-xl bg-black/20 p-2">
                <p className="font-medium text-emerald-50">{row.data}</p>
                <p>چرا: {row.why}</p>
                <p>مدت: {row.keep}</p>
                <p>Backup: {row.backup}</p>
                <p>حذف: {row.deletable}</p>
              </div>
            ))}
          </div>
        </section>

        {!pending && (
          <section className="rounded-2xl bg-white/5 p-4 text-sm">
            <h2 className="font-medium">Delete Account</h2>
            {step === "idle" && (
              <Button type="button" variant="secondary" className="mt-2" onClick={() => setStep("warn")}>
                درخواست حذف حساب
              </Button>
            )}
            {step === "warn" && (
              <div className="mt-2 space-y-2 text-xs leading-6">
                <p>
                  پس از تأیید چندمرحله‌ای، حساب {account.graceDays} روز در Pending Deletion می‌ماند. سپس داده‌های قابل حذف پاک
                  می‌شوند؛ سوابق امنیتی حداقلی ممکن است بماند. غیرفعال بودن دلیل حذف نیست — این درخواست شماست.
                </p>
                <div className="flex gap-2">
                  <Button type="button" onClick={() => void sendDeleteOtp()}>
                    ادامه به تأیید
                  </Button>
                  <Button type="button" variant="secondary" onClick={() => setStep("idle")}>
                    Cancel
                  </Button>
                </div>
              </div>
            )}
            {step === "verify" && (
              <div className="mt-2 space-y-2">
                <p className="text-xs">کد به {account.identifierMasked} ارسال شد.</p>
                {inbox && <pre className="whitespace-pre-wrap rounded-lg bg-black/30 p-2 text-[11px]">{inbox}</pre>}
                <Input placeholder="کد ۶ رقمی" value={otp} onChange={(e) => setOtp(e.target.value)} dir="ltr" />
                {account.twoStep && (
                  <Input type="password" placeholder="رمز دومرحله‌ای" value={password} onChange={(e) => setPassword(e.target.value)} />
                )}
                <div className="flex gap-2">
                  <Button type="button" onClick={() => setStep("confirm")}>
                    بعدی
                  </Button>
                  <Button type="button" variant="secondary" onClick={() => setStep("idle")}>
                    Cancel
                  </Button>
                </div>
              </div>
            )}
            {step === "confirm" && (
              <div className="mt-2 space-y-2">
                <p className="text-xs">برای تأیید نهایی بنویسید: {DELETION_PHRASE}</p>
                <Input value={phrase} onChange={(e) => setPhrase(e.target.value)} />
                <div className="flex gap-2">
                  <Button type="button" disabled={busy} onClick={() => void confirmDelete()}>
                    Delete
                  </Button>
                  <Button type="button" variant="secondary" onClick={() => setStep("idle")}>
                    Cancel
                  </Button>
                </div>
              </div>
            )}
          </section>
        )}
      </div>
    </main>
  );
}
