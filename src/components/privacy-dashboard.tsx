"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { toast } from "sonner";
import { NixoMark } from "@/components/nixo-mark";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

type Person = { id: string; name: string; username: string | null };
type CheckItem = { id: string; label: string; value: string; warn: boolean };
type Settings = Record<string, unknown>;

const V3 = [
  { id: "everyone", label: "همه" },
  { id: "contacts", label: "مخاطبین" },
  { id: "nobody", label: "هیچ‌کس" },
] as const;
const V4 = [...V3, { id: "selected", label: "انتخاب‌شده" }] as const;

function Radios({
  value,
  options,
  onChange,
}: {
  value: string;
  options: readonly { id: string; label: string }[];
  onChange: (id: string) => void;
}) {
  return (
    <div className="mt-1 flex flex-wrap gap-3 text-xs">
      {options.map((o) => (
        <label key={o.id} className="flex items-center gap-1">
          <input type="radio" checked={value === o.id} onChange={() => onChange(o.id)} />
          {o.label}
        </label>
      ))}
    </div>
  );
}

function Allow({
  people,
  ids,
  onToggle,
}: {
  people: Person[];
  ids: string[];
  onToggle: (next: string[]) => void;
}) {
  if (people.length === 0) return <p className="mt-1 text-[11px] opacity-50">کاربر دیگری در این محیط نیست (Always Allow / انتخاب‌شده).</p>;
  return (
    <div className="mt-1 max-h-28 space-y-1 overflow-auto text-[11px]">
      {people.map((p) => (
        <label key={p.id} className="flex items-center gap-2">
          <input
            type="checkbox"
            checked={ids.includes(p.id)}
            onChange={() => onToggle(ids.includes(p.id) ? ids.filter((x) => x !== p.id) : [...ids, p.id])}
          />
          {p.name} {p.username ? `@${p.username}` : ""}
        </label>
      ))}
    </div>
  );
}

export function PrivacyDashboard() {
  const [settings, setSettings] = useState<Settings | null>(null);
  const [checkup, setCheckup] = useState<CheckItem[]>([]);
  const [people, setPeople] = useState<Person[]>([]);
  const [blocked, setBlocked] = useState<string[]>([]);
  const [blockKey, setBlockKey] = useState("");
  const [findQ, setFindQ] = useState("");

  function load() {
    fetch("/api/privacy", { cache: "no-store" })
      .then((r) => r.json())
      .then((d) => {
        setSettings(d.settings ?? null);
        setCheckup(d.checkup ?? []);
        setPeople(d.people ?? []);
        setBlocked(d.blocked ?? []);
      })
      .catch(() => undefined);
  }

  useEffect(() => {
    load();
  }, []);

  async function save(patch: Record<string, unknown>) {
    const res = await fetch("/api/privacy", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(patch),
    });
    const data = await res.json();
    if (!res.ok) {
      toast.error(data.error ?? "ذخیره نشد.");
      return;
    }
    if (data.settings) setSettings(data.settings);
    if (data.checkup) setCheckup(data.checkup);
    toast.success("حریم خصوصی روی سرور ذخیره شد.");
  }

  if (!settings) return <p className="p-6 text-sm">بارگذاری…</p>;

  const str = (k: string) => String(settings[k] ?? "");
  const bool = (k: string) => Boolean(settings[k]);
  const list = (k: string) => (Array.isArray(settings[k]) ? (settings[k] as string[]) : []);

  return (
    <main className="min-h-dvh bg-[#071614] p-5 text-emerald-50">
      <div className="mx-auto max-w-lg space-y-4">
        <div className="flex items-center gap-2">
          <NixoMark size={36} />
          <div>
            <p className="text-xs text-amber-200">تنظیمات ← حریم خصوصی</p>
            <h1 className="text-xl font-semibold">داشبورد حریم خصوصی</h1>
          </div>
        </div>
        <p className="text-xs leading-6 text-emerald-100/65">
          این تنظیمات روی سرور اعمال می‌شوند. دستکاری فرانت‌اند یا API جعلی آن‌ها را دور نمی‌زند. نیکسو ادعا نمی‌کند عکس صفحه با دستگاه دیگر را ۱۰۰٪ متوقف کند. دوربین، میکروفون و گالری فقط با مجوز سیستم‌عامل باز می‌شوند.{" "}
          <Link href="/app/settings/security" className="text-amber-200">
            داشبورد امنیت
          </Link>
        </p>

        <section className="rounded-2xl bg-white/5 p-4 text-sm">
          <h2 className="font-medium">Privacy Checkup</h2>
          <div className="mt-2 space-y-2">
            {checkup.map((c) => (
              <p key={c.id} className="text-xs">
                {c.warn ? "⚠️ " : "✓ "}
                {c.label}: {c.value === "everyone" ? "برای همه قابل مشاهده است." : c.value}
              </p>
            ))}
          </div>
        </section>

        <section className="rounded-2xl bg-white/5 p-4 text-sm">
          <h2 className="font-medium">شماره تلفن</h2>
          <Radios value={str("privacyPhone")} options={V3} onChange={(id) => void save({ privacyPhone: id })} />
          <p className="mt-2 text-xs opacity-70">پیدا شدن با شماره</p>
          <Radios value={str("privacyFindPhone")} options={V3} onChange={(id) => void save({ privacyFindPhone: id })} />
          <Allow people={people} ids={list("findPhoneAllowIds")} onToggle={(next) => void save({ findPhoneAllowIds: next })} />
        </section>

        <section className="rounded-2xl bg-white/5 p-4 text-sm">
          <h2 className="font-medium">پیدا شدن با Username</h2>
          <p className="text-[11px] opacity-60">Everyone / Contacts / Nobody / استثنا. روی سرور اعمال می‌شود.</p>
          <Radios value={str("privacyFindUsername")} options={V3} onChange={(id) => void save({ privacyFindUsername: id })} />
          <Allow people={people} ids={list("findUsernameAllowIds")} onToggle={(next) => void save({ findUsernameAllowIds: next })} />
        </section>

        <section className="rounded-2xl bg-white/5 p-4 text-sm">
          <h2 className="font-medium">ایمیل</h2>
          <p className="text-[11px] opacity-60">پیش‌فرض: هیچ‌کس.</p>
          <Radios value={str("privacyEmail")} options={V3} onChange={(id) => void save({ privacyEmail: id })} />
        </section>

        <section className="rounded-2xl bg-white/5 p-4 text-sm">
          <h2 className="font-medium">عکس پروفایل</h2>
          <Radios value={str("privacyPhoto")} options={V4} onChange={(id) => void save({ privacyPhoto: id })} />
          <Allow people={people} ids={list("photoAllowIds")} onToggle={(next) => void save({ photoAllowIds: next })} />
          <p className="mt-3 text-xs">بیو</p>
          <Radios value={str("privacyBio")} options={V4} onChange={(id) => void save({ privacyBio: id })} />
          <Allow people={people} ids={list("bioAllowIds")} onToggle={(next) => void save({ bioAllowIds: next })} />
        </section>

        <section className="rounded-2xl bg-white/5 p-4 text-sm">
          <h2 className="font-medium">آخرین بازدید و آنلاین</h2>
          <Radios value={str("privacyLastSeen")} options={V4} onChange={(id) => void save({ privacyLastSeen: id })} />
          <p className="mt-1 text-[11px] opacity-60">Always Allow / استثنا</p>
          <Allow people={people} ids={list("lastSeenAllowIds")} onToggle={(next) => void save({ lastSeenAllowIds: next })} />
          <p className="mt-3 text-xs">آنلاین</p>
          <Radios value={str("privacyOnline")} options={V4} onChange={(id) => void save({ privacyOnline: id })} />
        </section>

        <section className="rounded-2xl bg-white/5 p-4 text-sm">
          <h2 className="font-medium">رسید خواندن، تایپ، ضبط</h2>
          <label className="mt-2 flex items-center gap-2 text-xs">
            <input type="checkbox" checked={bool("readReceipts")} onChange={(e) => void save({ readReceipts: e.target.checked })} />
            Read Receipts روشن (اگر هر دو طرف خاموش کنند، دیده نمی‌شود)
          </label>
          <label className="mt-2 flex items-center gap-2 text-xs">
            <input type="checkbox" checked={bool("showTyping")} onChange={(e) => void save({ showTyping: e.target.checked })} />
            نمایش Typing…
          </label>
          <label className="mt-2 flex items-center gap-2 text-xs">
            <input type="checkbox" checked={bool("showVoiceRecording")} onChange={(e) => void save({ showVoiceRecording: e.target.checked })} />
            نمایش ضبط پیام صوتی
          </label>
        </section>

        <section className="rounded-2xl bg-white/5 p-4 text-sm">
          <h2 className="font-medium">پیام و تماس</h2>
          <p className="text-xs">چه کسانی پیام مستقیم بفرستند</p>
          <Radios value={str("privacyMessages")} options={V4} onChange={(id) => void save({ privacyMessages: id })} />
          <Allow people={people} ids={list("messageAllowIds")} onToggle={(next) => void save({ messageAllowIds: next })} />
          <p className="mt-3 text-xs">تماس</p>
          <Radios value={str("callPrivacy")} options={V4} onChange={(id) => void save({ callPrivacy: id })} />
        </section>

        <section className="rounded-2xl bg-white/5 p-4 text-sm">
          <h2 className="font-medium">گروه، جامعه، کانال</h2>
          <p className="text-xs">افزودن به گروه</p>
          <Radios value={str("privacyGroups")} options={V4} onChange={(id) => void save({ privacyGroups: id })} />
          <p className="mt-2 text-xs">دعوت به جامعه</p>
          <Radios value={str("privacyCommunities")} options={V4} onChange={(id) => void save({ privacyCommunities: id })} />
          <p className="mt-2 text-xs">دعوت کانال</p>
          <Radios value={str("privacyChannels")} options={V4} onChange={(id) => void save({ privacyChannels: id })} />
        </section>

        <section className="rounded-2xl bg-white/5 p-4 text-sm">
          <h2 className="font-medium">استوری و ظاهر</h2>
          <p className="text-xs">حریم پیش‌فرض استوری: {str("defaultStoryPrivacy")}</p>
          <Link href="/app/settings/story" className="mt-1 inline-block text-xs text-amber-200">
            Settings → Privacy → Stories
          </Link>
          <p className="mt-2 text-[11px] opacity-70">وضعیت کوتاه و استوری از Online / Last Seen جدا هستند.</p>
          <p className="mt-2 text-[11px] opacity-70">پس‌زمینه و تم ظاهر فقط برای تو در پروفایل عمومی نیست.</p>
        </section>

        <section className="rounded-2xl bg-white/5 p-4 text-sm">
          <h2 className="font-medium">Forward / Save / Share</h2>
          <label className="mt-2 flex items-center gap-2 text-xs">
            <input type="checkbox" checked={bool("restrictForward")} onChange={(e) => void save({ restrictForward: e.target.checked })} />
            محدودیت هدایت
          </label>
          <label className="mt-2 flex items-center gap-2 text-xs">
            <input type="checkbox" checked={bool("restrictSave")} onChange={(e) => void save({ restrictSave: e.target.checked })} />
            محدودیت ذخیره
          </label>
          <label className="mt-2 flex items-center gap-2 text-xs">
            <input type="checkbox" checked={bool("restrictShare")} onChange={(e) => void save({ restrictShare: e.target.checked })} />
            محدودیت اشتراک
          </label>
        </section>

        <section className="rounded-2xl bg-white/5 p-4 text-sm">
          <h2 className="font-medium">مسدودشده‌ها</h2>
          <p className="text-[11px] opacity-60">Settings → Privacy → Blocked Users. پیام، تماس، استوری و تعامل محدود می‌شود.</p>
          <div className="mt-2 flex gap-2">
            <Input value={blockKey} onChange={(e) => setBlockKey(e.target.value)} placeholder="شناسه یا کاربر" className="h-9 bg-black/20" />
            <Button
              type="button"
              size="sm"
              variant="secondary"
              onClick={async () => {
                const res = await fetch("/api/privacy", {
                  method: "POST",
                  headers: { "Content-Type": "application/json" },
                  body: JSON.stringify({ action: "block", peerKey: blockKey, blocked: true }),
                });
                if (res.ok) {
                  setBlockKey("");
                  load();
                  toast.success("مسدود شد.");
                }
              }}
            >
              Block
            </Button>
          </div>
          {blocked.map((id) => (
            <div key={id} className="mt-1 flex items-center justify-between text-xs">
              <span dir="ltr">{id.slice(0, 12)}…</span>
              <button
                type="button"
                className="text-amber-200"
                onClick={async () => {
                  await fetch("/api/privacy", {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ action: "block", peerKey: id, blocked: false }),
                  });
                  load();
                }}
              >
                Unblock
              </button>
            </div>
          ))}
        </section>

        <section className="rounded-2xl bg-white/5 p-4 text-sm">
          <h2 className="font-medium">مخاطبین گوشی</h2>
          <p className="mt-1 text-[11px] leading-5 opacity-70">
            دفترچهٔ نیکسو در{" "}
            <a href="/app/contacts" className="text-amber-200">
              مخاطبین و افراد
            </a>
            است. هش همگام‌سازی شمارهٔ دیگران را در اختیار کاربران دیگر نمی‌گذارد.
          </p>
          <label className="mt-2 flex items-center gap-2 text-xs">
            <input type="checkbox" checked={bool("contactSyncEnabled")} onChange={(e) => void save({ contactSyncEnabled: e.target.checked })} />
            Contact Sync (فقط با اجازه تو؛ هش شماره نه خود شماره)
          </label>
          <p className="mt-1 text-[11px] opacity-60">همگام‌سازی‌شده: {String(settings.syncedCount ?? 0)}</p>
          <Button
            type="button"
            size="sm"
            variant="secondary"
            className="mt-2"
            onClick={async () => {
              await fetch("/api/privacy", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "contacts-clear" }) });
              load();
              toast.success("هش مخاطب‌ها حذف شد.");
            }}
          >
            حذف Contact Sync
          </Button>
        </section>

        <section className="rounded-2xl bg-white/5 p-4 text-sm">
          <h2 className="font-medium">موقعیت، دوربین، میکروفون، گالری</h2>
          <label className="mt-2 flex items-center gap-2 text-xs">
            <input type="checkbox" checked={bool("locationEnabled")} onChange={(e) => void save({ locationEnabled: e.target.checked })} />
            اجازهٔ موقعیت (بدون این، موقعیت ذخیره یا ارسال نمی‌شود)
          </label>
          <p className="mt-2 text-[11px] leading-5 opacity-70">
            Camera / Microphone / Photos فقط وقتی مرورگر مجوز بدهد. نیکسو بدون Permission سیستم‌عامل به آن‌ها دسترسی نمی‌گیرد.
          </p>
        </section>

        <section className="rounded-2xl bg-white/5 p-4 text-sm">
          <h2 className="font-medium">پیدا کردن با شماره یا ایمیل</h2>
          <form
            className="mt-2 flex gap-2"
            onSubmit={async (e) => {
              e.preventDefault();
              const res = await fetch(`/api/privacy?find=${encodeURIComponent(findQ)}`);
              const data = await res.json();
              if (data.user) toast.success(`پیدا شد: ${data.user.displayName}`);
              else toast.message("طبق حریم، نتیجه‌ای نیست.");
            }}
          >
            <Input value={findQ} onChange={(e) => setFindQ(e.target.value)} placeholder="09… یا email" className="h-9 bg-black/20" />
            <Button type="submit" size="sm" variant="secondary">
              بجو
            </Button>
          </form>
        </section>

        <section className="rounded-2xl bg-white/5 p-4 text-sm">
          <h2 className="font-medium">Connected Apps</h2>
          <p className="text-[11px] leading-5 opacity-70">
            مسیر: Settings → Privacy & Security → Connected Apps. مجوز Mini App از آنجا لغو می‌شود و توکن باطل می‌گردد.
          </p>
          <Link href="/app/settings/apps" className="mt-2 inline-block text-xs text-amber-200">
            فهرست برنامه‌های متصل
          </Link>
        </section>

        <section className="rounded-2xl bg-white/5 p-4 text-sm">
          <h2 className="font-medium">حذف داده و حداقل داده</h2>
          <p className="text-[11px] leading-5 opacity-70">
            حساب به‌خاطر ورود نکردن حذف نمی‌شود. حذف کامل فقط از مسیر تنظیمات ← حساب با چند مرحله تأیید و دورهٔ بازیابی است.
          </p>
          <Link href="/app/settings/account" className="mt-2 inline-block text-xs text-amber-200">
            Settings → Account → Delete Account
          </Link>
        </section>

        <Link href="/app" className="inline-block text-sm text-amber-200">
          بازگشت به نیکسو
        </Link>
      </div>
    </main>
  );
}
