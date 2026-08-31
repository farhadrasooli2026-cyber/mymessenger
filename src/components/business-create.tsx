"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { NixoMark } from "@/components/nixo-mark";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { BUSINESS_CATEGORIES, DEFAULT_HOURS, WEEKDAYS, type DayHours } from "@/lib/business-types";

const STEPS = ["نام", "دسته", "لوگو", "توضیح", "تماس", "ساعات", "موقعیت", "ساخت"] as const;

function fileDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result));
    r.onerror = () => reject(new Error("read"));
    r.readAsDataURL(file);
  });
}

export function BusinessCreate() {
  const router = useRouter();
  const [step, setStep] = useState(0);
  const [name, setName] = useState("");
  const [username, setUsername] = useState("");
  const [category, setCategory] = useState("services");
  const [photoDataUrl, setPhotoDataUrl] = useState("");
  const [description, setDescription] = useState("");
  const [website, setWebsite] = useState("");
  const [phone, setPhone] = useState("");
  const [email, setEmail] = useState("");
  const [address, setAddress] = useState("");
  const [lat, setLat] = useState("");
  const [lng, setLng] = useState("");
  const [hours, setHours] = useState<DayHours[]>(DEFAULT_HOURS.map((h) => ({ ...h })));
  const [busy, setBusy] = useState(false);

  async function submit() {
    setBusy(true);
    try {
      const res = await fetch("/api/business", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "create",
          name,
          username,
          category,
          description,
          website,
          phone,
          email,
          address,
          lat: lat ? Number(lat) : null,
          lng: lng ? Number(lng) : null,
          hours,
          photoDataUrl: photoDataUrl || undefined,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        toast.error(data.error ?? "ساخت کسب‌وکار انجام نشد.");
        return;
      }
      toast.success("حساب Business روی همین حساب نیکسو ساخته شد.");
      router.push(`/app/settings/business`);
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="min-h-dvh bg-[#071614] p-5 text-emerald-50">
      <div className="mx-auto max-w-lg space-y-4">
        <div className="flex items-center gap-2">
          <NixoMark size={36} />
          <div>
            <p className="text-xs text-amber-200">NIXO Business</p>
            <h1 className="text-xl font-semibold">تبدیل همین حساب</h1>
          </div>
        </div>
        <p className="text-xs leading-6 text-emerald-100/65">
          حساب جدا نمی‌سازی. همین پروفایل شخصی به Business تبدیل می‌شود. نشان تأیید با پرداخت خریدنی نیست.
        </p>
        <ol className="flex flex-wrap gap-1 text-[10px] text-emerald-100/50">
          {STEPS.map((s, i) => (
            <li key={s} className={i === step ? "text-amber-200" : ""}>
              {i + 1}. {s}
            </li>
          ))}
        </ol>
        {step === 0 && (
          <div className="space-y-2">
            <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Business Name" />
            <Input dir="ltr" value={username} onChange={(e) => setUsername(e.target.value)} placeholder="@nixo_store" />
          </div>
        )}
        {step === 1 && (
          <div className="grid grid-cols-2 gap-2">
            {BUSINESS_CATEGORIES.map((c) => (
              <button
                key={c.id}
                type="button"
                className={`rounded-xl border p-3 text-sm ${category === c.id ? "border-amber-300 bg-amber-300/10" : "border-white/10"}`}
                onClick={() => setCategory(c.id)}
              >
                {c.label}
              </button>
            ))}
          </div>
        )}
        {step === 2 && (
          <Input
            type="file"
            accept="image/*"
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) void fileDataUrl(f).then(setPhotoDataUrl);
            }}
          />
        )}
        {step === 3 && <Textarea value={description} onChange={(e) => setDescription(e.target.value)} placeholder="توضیح کامل کسب‌وکار" rows={6} />}
        {step === 4 && (
          <div className="space-y-2">
            <Input dir="ltr" value={website} onChange={(e) => setWebsite(e.target.value)} placeholder="https://example.com" />
            <Input value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="تلفن" />
            <Input dir="ltr" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="email@business" />
          </div>
        )}
        {step === 5 && (
          <div className="space-y-2">
            {WEEKDAYS.map((w) => {
              const row = hours.find((h) => h.day === w.d)!;
              return (
                <div key={w.d} className="flex items-center gap-2 text-xs">
                  <span className="w-20">{w.en}</span>
                  <label className="flex items-center gap-1">
                    <input
                      type="checkbox"
                      checked={row.closed}
                      onChange={(e) =>
                        setHours(hours.map((h) => (h.day === w.d ? { ...h, closed: e.target.checked } : h)))
                      }
                    />
                    Closed
                  </label>
                  {!row.closed && (
                    <>
                      <Input className="h-8 w-24" dir="ltr" value={row.open} onChange={(e) => setHours(hours.map((h) => (h.day === w.d ? { ...h, open: e.target.value } : h)))} />
                      <span>—</span>
                      <Input className="h-8 w-24" dir="ltr" value={row.close} onChange={(e) => setHours(hours.map((h) => (h.day === w.d ? { ...h, close: e.target.value } : h)))} />
                    </>
                  )}
                </div>
              );
            })}
          </div>
        )}
        {step === 6 && (
          <div className="space-y-2">
            <Input value={address} onChange={(e) => setAddress(e.target.value)} placeholder="آدرس (اختیاری)" />
            <div className="flex gap-2">
              <Input dir="ltr" value={lat} onChange={(e) => setLat(e.target.value)} placeholder="lat" />
              <Input dir="ltr" value={lng} onChange={(e) => setLng(e.target.value)} placeholder="lng" />
            </div>
          </div>
        )}
        {step === 7 && (
          <p className="text-sm leading-7">
            {name} · @{username.replace(/^@/, "")} · {category}
            <br />
            حساب شخصی جدا نمی‌ماند؛ Business روی همین ورود است.
          </p>
        )}
        <div className="flex gap-2">
          {step > 0 && (
            <Button type="button" variant="outline" onClick={() => setStep(step - 1)}>
              قبلی
            </Button>
          )}
          {step < 7 ? (
            <Button type="button" className="bg-amber-300 text-[#102824]" onClick={() => setStep(step + 1)}>
              بعدی
            </Button>
          ) : (
            <Button type="button" disabled={busy} className="bg-amber-300 text-[#102824]" onClick={() => void submit()}>
              Create
            </Button>
          )}
        </div>
        <Link href="/app/business" className="block text-xs text-amber-200">
          Directory کسب‌وکار
        </Link>
      </div>
    </main>
  );
}
