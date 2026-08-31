"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { NixoMark } from "@/components/nixo-mark";
import { Button } from "@/components/ui/button";
import { REPORT_CATEGORIES } from "@/lib/chat-copy";

type Profile = {
  id: string;
  displayName: string;
  username: string | null;
  bio: string;
  photoUrl: string;
  photoHidden?: boolean;
  lastSeenAt: number | null;
  online?: boolean;
  identifierMasked?: string;
  readReceipts?: boolean;
  verified?: boolean;
};

export function PeopleProfile({ username }: { username: string }) {
  const router = useRouter();
  const [profile, setProfile] = useState<Profile | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [groups, setGroups] = useState<{ id: string; name: string }[]>([]);
  const [channels, setChannels] = useState<{ id: string; name: string }[]>([]);
  const [sharedMedia, setSharedMedia] = useState(0);
  const [qr, setQr] = useState("");
  const [reportCat, setReportCat] = useState("spam");

  useEffect(() => {
    fetch(`/api/contacts?action=person&username=${encodeURIComponent(username)}`)
      .then((r) => r.json())
      .then(async (d) => {
        if (!d.ok) {
          setError(d.error ?? "پروفایل در دسترس نیست.");
          return;
        }
        setProfile(d.profile);
        setGroups(d.mutualGroups ?? []);
        setChannels(d.mutualChannels ?? []);
        setSharedMedia(d.sharedMedia ?? 0);
        try {
          const QR = await import("qrcode");
          const url = await QR.toDataURL(JSON.stringify(d.qrPayload), { margin: 1, width: 220 });
          setQr(url);
        } catch {
          setQr("");
        }
      })
      .catch(() => setError("بارگذاری نشد."));
  }, [username]);

  async function chat(kind?: "voice" | "video") {
    if (!profile) return;
    const res = await fetch("/api/contacts", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "open-chat", userId: profile.id }),
    });
    const data = await res.json();
    if (!res.ok) {
      toast.message(data.error ?? "گفتگو باز نشد.");
      return;
    }
    if (kind && data.thread?.id) {
      await fetch("/api/calls", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ threadId: data.thread.id, kind }),
      });
    }
    router.push("/app");
  }

  if (error) {
    return (
      <main className="grid min-h-dvh place-items-center bg-[#071614] p-6 text-emerald-50">
        <div className="max-w-md text-center">
          <NixoMark size={40} className="mx-auto" />
          <p className="mt-4 text-sm text-rose-200">{error}</p>
          <Link href="/app/contacts" className="mt-4 inline-block text-amber-200">
            مخاطبین
          </Link>
        </div>
      </main>
    );
  }

  if (!profile) {
    return (
      <main className="grid min-h-dvh place-items-center bg-[#071614] text-emerald-50">
        <p className="text-sm opacity-70">در حال بارگذاری پروفایل…</p>
      </main>
    );
  }

  return (
    <main className="mx-auto min-h-dvh max-w-lg bg-[#071614] px-4 py-8 text-emerald-50">
      <Link href="/app/contacts" className="text-xs text-amber-200">
        ← مخاطبین
      </Link>
      <div className="mt-4 text-center">
        <img src={profile.photoUrl} alt="" className="mx-auto size-24 rounded-3xl object-cover" />
        <h1 className="mt-3 text-xl font-semibold">
          {profile.displayName}
          {profile.verified ? <span className="mr-1 text-amber-200"> ✓</span> : null}
        </h1>
        {profile.username && (
          <p className="text-sm text-amber-200" dir="ltr">
            @{profile.username}
          </p>
        )}
        {profile.identifierMasked && <p className="text-[11px] opacity-50">{profile.identifierMasked}</p>}
        <p className="mt-2 text-xs opacity-70">
          {profile.online ? "آنلاین" : profile.lastSeenAt ? `آخرین بازدید: ${new Date(profile.lastSeenAt).toLocaleString("fa-IR")}` : "وضعیت طبق حریم پنهان است"}
        </p>
        {profile.bio && <p className="mt-3 text-sm leading-7">{profile.bio}</p>}
      </div>
      <div className="mt-5 grid grid-cols-3 gap-2">
        <Button className="bg-amber-300 text-[#102824]" onClick={() => void chat()}>
          Message
        </Button>
        <Button variant="secondary" onClick={() => void chat("voice")}>
          Voice
        </Button>
        <Button variant="secondary" onClick={() => void chat("video")}>
          Video
        </Button>
      </div>
      <section className="mt-6 rounded-2xl bg-white/5 p-4 text-sm">
        <h2 className="font-medium">رسانه و فضاهای مشترک</h2>
        <p className="mt-1 text-xs opacity-70">رسانهٔ مشترک در چت شما: {sharedMedia} مورد (متن رمزشده نشان داده نمی‌شود).</p>
        <p className="mt-2 text-xs">گروه‌های مشترک (فقط اگر هر دو عضو باشید):</p>
        <ul className="mt-1 text-xs">
          {groups.length === 0 && <li className="opacity-50">موردی نیست یا حریم اجازه نمی‌دهد.</li>}
          {groups.map((g) => (
            <li key={g.id}>{g.name}</li>
          ))}
        </ul>
        <p className="mt-2 text-xs">کانال‌های مشترک:</p>
        <ul className="mt-1 text-xs">
          {channels.length === 0 && <li className="opacity-50">موردی نیست.</li>}
          {channels.map((c) => (
            <li key={c.id}>{c.name}</li>
          ))}
        </ul>
        <p className="mt-3 text-[11px] leading-5 opacity-60">لیست مخاطبین این شخص هرگز نمایش داده نمی‌شود. رسید خواندن طرف: {profile.readReceipts === false ? "طبق تنظیمات پنهان" : "طبق تنظیمات چت"}.</p>
      </section>
      {qr && (
        <section className="mt-4 rounded-2xl bg-white/5 p-4 text-center">
          <h2 className="text-sm font-medium">QR پروفایل</h2>
          <img src={qr} alt="QR" className="mx-auto mt-2 size-40 rounded-xl bg-white p-2" />
          <p className="mt-2 text-[11px] opacity-60">QR فقط نام کاربری عمومی است؛ شماره و ایمیل داخل کد نیست.</p>
        </section>
      )}
      <section className="mt-4 flex flex-wrap gap-2">
        <Button
          size="sm"
          variant="secondary"
          onClick={() =>
            void fetch("/api/contacts", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ action: "block", peerKey: profile.id, blocked: true }),
            }).then(() => toast.success("مسدود شد. پیام، تماس و درخواست محدود می‌شود."))
          }
        >
          Block
        </Button>
        <Button
          size="sm"
          variant="secondary"
          onClick={() =>
            void fetch("/api/contacts", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ action: "block", peerKey: profile.id, blocked: false }),
            }).then(() => toast.success("رفع مسدود. ارتباط فقط تا حد حریم هر دو طرف برمی‌گردد."))
          }
        >
          Unblock
        </Button>
        <select value={reportCat} onChange={(e) => setReportCat(e.target.value)} className="h-8 rounded-lg bg-black/30 px-2 text-xs">
          {REPORT_CATEGORIES.map((c) => (
            <option key={c.id} value={c.id}>
              {c.label}
            </option>
          ))}
        </select>
        <Button
          size="sm"
          variant="secondary"
          onClick={() =>
            void fetch("/api/contacts", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ action: "report", peerKey: profile.id, category: reportCat }),
            }).then(() => toast.success("گزارش برای ایمنی ارسال شد."))
          }
        >
          Report
        </Button>
        <Button
          size="sm"
          variant="secondary"
          onClick={() =>
            void fetch("/api/contacts", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                action: "save",
                name: profile.displayName,
                username: profile.username,
              }),
            }).then(() => toast.success("به دفترچه اضافه شد."))
          }
        >
          افزودن به مخاطبین
        </Button>
      </section>
    </main>
  );
}
