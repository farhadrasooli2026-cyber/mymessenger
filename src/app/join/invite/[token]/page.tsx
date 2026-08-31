"use client";

import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { NixoMark } from "@/components/nixo-mark";

export default function JoinInvitePage() {
  const params = useParams<{ token: string }>();
  const router = useRouter();
  const token = params.token;
  const [name, setName] = useState<string | null>(null);
  const [username, setUsername] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetch(`/api/contacts/invite/${token}`)
      .then((r) => r.json())
      .then((d) => {
        if (!d.ok) setError(d.error ?? "لینک نامعتبر است.");
        else {
          setName(d.inviter?.displayName ?? "کاربر نیکسو");
          setUsername(d.inviter?.username ?? null);
        }
      })
      .catch(() => setError("بارگذاری نشد."));
  }, [token]);

  async function accept() {
    const res = await fetch(`/api/contacts/invite/${token}`, { method: "POST" });
    const data = await res.json();
    if (res.status === 401) {
      router.replace(`/?invite=${encodeURIComponent(token)}`);
      return;
    }
    if (!res.ok) {
      setError(data.error ?? "پذیرش انجام نشد.");
      return;
    }
    router.replace(data.username ? `/app/u/${data.username}` : "/app/contacts");
  }

  return (
    <main className="grid min-h-dvh place-items-center bg-[#071614] p-6 text-emerald-50">
      <div className="w-full max-w-md rounded-3xl border border-white/10 bg-[#102824] p-6 text-center">
        <NixoMark size={48} className="mx-auto" />
        <h1 className="mt-4 text-xl font-semibold">دعوت به نیکسو</h1>
        {error && <p className="mt-3 text-sm text-rose-200">{error}</p>}
        {name && (
          <>
            <p className="mt-3 text-sm leading-7">
              {name}
              {username ? ` (@${username})` : ""} تو را به نیکسو دعوت کرده است. لینک فقط برای ثبت‌نام و افزودن مخاطب است؛ شماره تلفن در این صفحه نشان داده نمی‌شود.
            </p>
            <Button type="button" className="mt-5 h-11 w-full bg-amber-300 text-[#102824]" onClick={() => void accept()}>
              پذیرش دعوت
            </Button>
          </>
        )}
      </div>
    </main>
  );
}
