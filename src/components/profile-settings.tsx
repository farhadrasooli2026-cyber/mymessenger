"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { toast } from "sonner";
import { NixoMark } from "@/components/nixo-mark";
import { PhotoPicker, type PhotoValue } from "@/components/photo-picker";
import { ProfilePreviewCard } from "@/components/profile-preview";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { USERNAME_HINT, USERNAME_STATUS_LABEL } from "@/lib/username";

type User = {
  firstName: string;
  lastName: string;
  username: string | null;
  bio: string;
  photoUrl: string;
  photoKind: "default" | "upload" | "catalog";
};

export function ProfileSettings({ initial }: { initial: User }) {
  const [firstName, setFirstName] = useState(initial.firstName);
  const [lastName, setLastName] = useState(initial.lastName);
  const [username, setUsername] = useState(initial.username ?? "");
  const [bio, setBio] = useState(initial.bio);
  const [photo, setPhoto] = useState<PhotoValue>(
    initial.photoKind === "upload"
      ? { kind: "upload", dataUrl: initial.photoUrl }
      : initial.photoKind === "catalog"
        ? { kind: "catalog", catalogId: "", previewUrl: initial.photoUrl }
        : { kind: "default" },
  );
  const [remoteUser, setRemoteUser] = useState<"free" | "taken" | "invalid" | null>(null);
  const [busy, setBusy] = useState(false);

  const userState =
    !username || username === initial.username
      ? "idle"
      : (remoteUser ?? "checking");

  useEffect(() => {
    if (!username || username === initial.username) return;
    const t = window.setTimeout(() => {
      fetch(`/api/username?u=${encodeURIComponent(username)}`)
        .then((r) => r.json())
        .then((d) => {
          if (!d.ok && d.reason === "invalid") setRemoteUser("invalid");
          else setRemoteUser(d.available ? "free" : "taken");
        });
    }, 350);
    return () => window.clearTimeout(t);
  }, [username, initial.username]);

  async function save(partial?: Record<string, unknown>) {
    setBusy(true);
    try {
      const body = partial ?? {
        firstName,
        lastName,
        username,
        bio,
        photo:
          photo.kind === "upload"
            ? { kind: "upload", dataUrl: photo.dataUrl }
            : photo.kind === "catalog" && photo.catalogId
              ? { kind: "catalog", catalogId: photo.catalogId }
              : photo.kind === "default"
                ? { kind: "default" }
                : undefined,
      };
      const res = await fetch("/api/profile", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = await res.json();
      if (!res.ok) {
        toast.error(data.error ?? "ذخیره نشد.");
        return;
      }
      toast.success("پروفایل به‌روز شد.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="min-h-dvh bg-[#071614] px-4 py-8 text-white">
      <div className="mx-auto w-full max-w-lg space-y-6">
        <header className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <NixoMark size={36} />
            <div>
              <p className="text-xs text-emerald-100/60">تنظیمات → پروفایل</p>
              <p className="text-lg font-semibold">ویرایش پروفایل</p>
            </div>
          </div>
          <Link href="/app" className="text-sm text-amber-200">
            بازگشت
          </Link>
        </header>

        <section className="space-y-2">
          <h2 className="font-medium">عکس پروفایل</h2>
          <PhotoPicker value={photo} onChange={setPhoto} />
          <Button type="button" className="bg-amber-300 text-[#102824] hover:bg-amber-200" disabled={busy} onClick={() => save()}>
            ذخیره عکس
          </Button>
        </section>

        <section className="space-y-3">
          <Label>نام</Label>
          <Input value={firstName} onChange={(e) => setFirstName(e.target.value)} className="h-11 bg-black/20" />
          <Label>نام خانوادگی</Label>
          <Input value={lastName} onChange={(e) => setLastName(e.target.value)} className="h-11 bg-black/20" />
          <Button type="button" variant="secondary" disabled={busy} onClick={() => save({ firstName, lastName })}>
            ذخیره نام
          </Button>
        </section>

        <section className="space-y-2">
          <Label>نام کاربری</Label>
          <Input dir="ltr" value={username} onChange={(e) => setUsername(e.target.value)} className="h-11 bg-black/20 text-left" />
          <p className="text-xs text-emerald-100/55">{USERNAME_HINT} تغییر با محدودیت ضد سوءاستفاده انجام می‌شود.</p>
          {userState === "free" && <p className="text-xs text-emerald-300">{USERNAME_STATUS_LABEL.free}</p>}
          {userState === "taken" && <p className="text-xs text-amber-200">{USERNAME_STATUS_LABEL.taken}</p>}
          {userState === "invalid" && <p className="text-xs text-red-200">{USERNAME_STATUS_LABEL.invalid}</p>}
          <Button type="button" variant="secondary" disabled={busy || (userState !== "idle" && userState !== "free")} onClick={() => save({ username })}>
            ذخیره نام کاربری
          </Button>
        </section>

        <section className="space-y-2">
          <Label>بیو</Label>
          <Textarea value={bio} onChange={(e) => setBio(e.target.value.slice(0, 140))} className="min-h-28 bg-black/20" />
          <div className="flex gap-2">
            <Button type="button" variant="secondary" disabled={busy} onClick={() => save({ bio })}>
              {bio ? "ویرایش بیو" : "افزودن بیو"}
            </Button>
            <Button
              type="button"
              variant="ghost"
              className="text-amber-200"
              disabled={busy}
              onClick={() => {
                setBio("");
                void save({ bio: "" });
              }}
            >
              حذف بیو
            </Button>
          </div>
        </section>

        <ProfilePreviewCard firstName={firstName} lastName={lastName} username={username} bio={bio} photo={photo} />
      </div>
    </div>
  );
}
