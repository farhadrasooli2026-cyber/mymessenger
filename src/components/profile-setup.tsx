"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { NixoMark } from "@/components/nixo-mark";
import { BackgroundPicker, type BgDraft } from "@/components/background-picker";
import { PhotoPicker, type PhotoValue } from "@/components/photo-picker";
import { ProfilePreviewCard } from "@/components/profile-preview";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Textarea } from "@/components/ui/textarea";
import { USERNAME_HINT, USERNAME_STATUS_LABEL, normalizeUsername } from "@/lib/username";
import type { Visibility } from "@/lib/profile-types";
import { backgroundPreview } from "@/lib/background-style";
import { cn } from "@/lib/utils";

const STEPS = ["نام", "نام کاربری", "عکس", "بیو", "حریم خصوصی", "پس‌زمینه", "پیش‌نمایش"];

const VIS: { id: Visibility; fa: string }[] = [
  { id: "everyone", fa: "همه" },
  { id: "contacts", fa: "مخاطبین من" },
  { id: "nobody", fa: "هیچ‌کس" },
  { id: "selected", fa: "مخاطبین انتخابی" },
];

type Found = { id: string; displayName: string; username: string | null };

export function ProfileSetup() {
  const router = useRouter();
  const [step, setStep] = useState(0);
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [username, setUsername] = useState("");
  const [remoteUser, setRemoteUser] = useState<"free" | "taken" | null>(null);
  const [bio, setBio] = useState("");
  const [photo, setPhoto] = useState<PhotoValue>({ kind: "default" });
  const [privacyPhoto, setPrivacyPhoto] = useState<Visibility>("everyone");
  const [privacyBio, setPrivacyBio] = useState<Visibility>("everyone");
  const [photoAllow, setPhotoAllow] = useState<Found[]>([]);
  const [bioAllow, setBioAllow] = useState<Found[]>([]);
  const [appBackground, setAppBackground] = useState<BgDraft>({ kind: "default" });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const userState = !username
    ? "idle"
    : !normalizeUsername(username)
      ? "invalid"
      : (remoteUser ?? "checking");

  useEffect(() => {
    const n = normalizeUsername(username);
    if (!n) return;
    const t = window.setTimeout(() => {
      fetch(`/api/username?u=${encodeURIComponent(n)}`)
        .then((r) => r.json())
        .then((d) => {
          if (d.reason === "invalid" || d.reason === "reserved") setRemoteUser("taken");
          else setRemoteUser(d.available ? "free" : "taken");
        })
        .catch(() => setRemoteUser("taken"));
    }, 350);
    return () => window.clearTimeout(t);
  }, [username]);

  function next() {
    setError(null);
    if (step === 0 && firstName.trim().length < 1) {
      setError("نام الزامی است.");
      return;
    }
    if (step === 1 && userState !== "free") {
      setError("یک نام کاربری آزاد انتخاب کنید.");
      return;
    }
    setStep((s) => Math.min(STEPS.length - 1, s + 1));
  }

  async function save() {
    setBusy(true);
    setError(null);
    try {
      const payload = {
        firstName: firstName.trim(),
        lastName: lastName.trim(),
        username,
        bio,
        photo:
          photo.kind === "upload"
            ? { kind: "upload" as const, dataUrl: photo.dataUrl }
            : photo.kind === "catalog"
              ? { kind: "catalog" as const, catalogId: photo.catalogId }
              : { kind: "default" as const },
        privacyPhoto,
        privacyBio,
        photoAllowIds: photoAllow.map((p) => p.id),
        bioAllowIds: bioAllow.map((p) => p.id),
        appBackground,
      };
      const res = await fetch("/api/register/profile", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? "ذخیره نشد.");
        return;
      }
      toast.success("پروفایل نیکسو ساخته شد.");
      router.push("/app");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div
      className="min-h-dvh px-4 py-8 text-white"
      style={backgroundPreview(appBackground, appBackground.kind === "upload" ? appBackground.dataUrl : undefined)}
    >
      <div className="mx-auto w-full max-w-lg space-y-6">
        <header className="flex items-center gap-3">
          <NixoMark size={40} />
          <div>
            <p className="text-sm tracking-[0.25em]">NIXO</p>
            <p className="text-lg font-semibold">ساخت پروفایل نیکسو</p>
          </div>
        </header>
        <ol className="grid grid-cols-7 gap-1">
          {STEPS.map((label, i) => (
            <li
              key={label}
              className={cn(
                "rounded-full py-1 text-center text-[10px]",
                i === step ? "bg-amber-300 text-[#102824]" : i < step ? "bg-emerald-400/30" : "bg-white/10 text-white/40",
              )}
            >
              {i + 1}
            </li>
          ))}
        </ol>
        <p className="text-sm text-emerald-100/70">{STEPS[step]}</p>
        {error && <p className="rounded-xl bg-red-500/15 px-3 py-2 text-sm text-red-100">{error}</p>}

        {step === 0 && (
          <div className="space-y-4">
            <div className="space-y-2">
              <Label>نام</Label>
              <Input value={firstName} onChange={(e) => setFirstName(e.target.value)} className="h-11 bg-black/20" maxLength={40} />
              <p className="text-xs text-emerald-100/55">نام در پروفایل و گفتگوها دیده می‌شود.</p>
            </div>
            <div className="space-y-2">
              <Label>نام خانوادگی (اختیاری)</Label>
              <Input value={lastName} onChange={(e) => setLastName(e.target.value)} className="h-11 bg-black/20" maxLength={40} />
              <p className="text-xs text-emerald-100/55">بعداً از تنظیمات قابل تغییر است.</p>
            </div>
          </div>
        )}

        {step === 1 && (
          <div className="space-y-2">
            <Label>نام کاربری</Label>
            <Input dir="ltr" value={username} onChange={(e) => setUsername(e.target.value)} className="h-11 bg-black/20 text-left" placeholder="nixo_user" />
            <p className="text-xs text-emerald-100/55">{USERNAME_HINT}</p>
            {userState === "checking" && <p className="text-xs">{USERNAME_STATUS_LABEL.checking}</p>}
            {userState === "free" && <p className="text-xs text-emerald-300">{USERNAME_STATUS_LABEL.free}</p>}
            {userState === "taken" && <p className="text-xs text-amber-200">{USERNAME_STATUS_LABEL.taken}</p>}
            {userState === "invalid" && <p className="text-xs text-red-200">{USERNAME_STATUS_LABEL.invalid}</p>}
          </div>
        )}

        {step === 2 && <PhotoPicker value={photo} onChange={setPhoto} />}

        {step === 3 && (
          <div className="space-y-3">
            <Label>بیو</Label>
            <Textarea
              value={bio}
              onChange={(e) => setBio(e.target.value.slice(0, 140))}
              placeholder='مثلاً Developer & Gamer'
              className="min-h-28 bg-black/20"
            />
            <p className="text-xs text-emerald-100/55">{bio.length}/140 · افزودن، ویرایش یا حذف بعداً از تنظیمات → پروفایل → بیو</p>
            {bio && (
              <Button type="button" variant="ghost" className="text-amber-200" onClick={() => setBio("")}>
                حذف بیو
              </Button>
            )}
          </div>
        )}

        {step === 4 && (
          <div className="space-y-6">
            <VisibilityBlock title="چه کسانی عکس پروفایل را ببینند؟" value={privacyPhoto} onChange={setPrivacyPhoto} selected={photoAllow} onSelected={setPhotoAllow} />
            <VisibilityBlock title="چه کسانی بیو را ببینند؟" value={privacyBio} onChange={setPrivacyBio} selected={bioAllow} onSelected={setBioAllow} />
          </div>
        )}

        {step === 5 && <BackgroundPicker value={appBackground} onChange={setAppBackground} label="پس‌زمینه هنگام استفاده از نیکسو" />}

        {step === 6 && (
          <div className="space-y-4">
            <ProfilePreviewCard firstName={firstName} lastName={lastName} username={normalizeUsername(username) ?? username} bio={bio} photo={photo} />
            <div className="h-24 overflow-hidden rounded-2xl border border-white/10" style={backgroundPreview(appBackground, appBackground.kind === "upload" ? appBackground.dataUrl : undefined)} />
            <p className="text-xs leading-6 text-emerald-100/60">
              هیچ‌کدام از این اطلاعات دائمی نیستند. بعداً از مسیر تنظیمات → پروفایل همه را می‌توانید عوض کنید.
            </p>
          </div>
        )}

        <div className="flex gap-2">
          {step > 0 && (
            <Button type="button" variant="outline" className="flex-1 border-white/15 bg-transparent text-white" onClick={() => setStep((s) => s - 1)}>
              قبلی
            </Button>
          )}
          {step < STEPS.length - 1 ? (
            <Button type="button" className="flex-1 bg-amber-300 text-[#102824] hover:bg-amber-200" onClick={next}>
              ادامه
            </Button>
          ) : (
            <Button type="button" className="flex-1 bg-amber-300 text-[#102824] hover:bg-amber-200" disabled={busy} onClick={save}>
              ذخیره پروفایل
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}

function VisibilityBlock({
  title,
  value,
  onChange,
  selected,
  onSelected,
}: {
  title: string;
  value: Visibility;
  onChange: (v: Visibility) => void;
  selected: Found[];
  onSelected: (v: Found[]) => void;
}) {
  const [q, setQ] = useState("");
  const [hits, setHits] = useState<Found[]>([]);

  async function search() {
    if (q.trim().length < 2) return;
    const res = await fetch(`/api/users/search?q=${encodeURIComponent(q)}`);
    const data = await res.json();
    setHits(data.users ?? []);
  }

  return (
    <div className="space-y-3 rounded-2xl border border-white/10 p-4">
      <p className="text-sm font-medium">{title}</p>
      <RadioGroup value={value} onValueChange={(v) => onChange(v as Visibility)} className="grid gap-2">
        {VIS.map((opt) => (
          <label key={opt.id} className="flex items-center gap-2 text-sm">
            <RadioGroupItem value={opt.id} />
            {opt.fa}
          </label>
        ))}
      </RadioGroup>
      {value === "selected" && (
        <div className="space-y-2">
          <div className="flex gap-2">
            <Input dir="ltr" value={q} onChange={(e) => setQ(e.target.value)} placeholder="@username" className="bg-black/20" />
            <Button type="button" variant="secondary" onClick={search}>
              جستجو
            </Button>
          </div>
          {hits.map((u) => (
            <button
              key={u.id}
              type="button"
              className="block w-full rounded-lg bg-white/5 px-3 py-2 text-right text-sm"
              onClick={() => {
                if (!selected.some((s) => s.id === u.id)) onSelected([...selected, u]);
              }}
            >
              {u.displayName} <span dir="ltr">@{u.username}</span>
            </button>
          ))}
          <p className="text-xs text-emerald-100/50">{selected.length} نفر انتخاب شده‌اند.</p>
        </div>
      )}
    </div>
  );
}
