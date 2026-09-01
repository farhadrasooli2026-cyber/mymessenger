"use client";

import { useEffect, useState } from "react";

export function StatusBoard() {
  const [data, setData] = useState<{ ok?: boolean; mode?: string; site?: string; degraded?: boolean; error?: string } | null>(null);

  useEffect(() => {
    fetch("/api/status", { cache: "no-store" })
      .then((r) => r.json())
      .then(setData)
      .catch(() => setData({ error: "خوانده نشد" }));
  }, []);

  if (!data) return <p className="mt-6 text-sm text-amber-100/70">در حال بررسی…</p>;
  if (data.error) return <p className="mt-6 text-sm text-rose-200">{data.error}</p>;

  return (
    <div className="mt-6 space-y-2 rounded-2xl border border-white/10 bg-white/5 p-4 text-sm">
      <p>سامانه: {data.ok ? "در دسترس" : "اختلال"}</p>
      <p>حالت: {data.mode === "maintenance" ? "نگهداری" : data.mode === "read_only" ? "فقط خواندنی" : "عادی"}</p>
      <p>سایت: {data.site === "replica" ? "Replica" : "اصلی"}</p>
      <p>{data.degraded ? "وضعیت کاهش‌یافته اعلام شده است." : "اختلال گسترده‌ای گزارش نشده."}</p>
    </div>
  );
}
