"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

export function AppealsDesk() {
  const [rows, setRows] = useState<{ id: string; kind: string; status: string; createdAt: number; decision: string }[]>([]);
  const [body, setBody] = useState("");
  const [kind, setKind] = useState<"ban" | "suspend" | "content" | "warning">("ban");

  function load() {
    fetch("/api/appeals", { cache: "no-store" })
      .then((r) => r.json())
      .then((d) => d.ok && setRows(d.appeals ?? []))
      .catch(() => undefined);
  }

  useEffect(() => {
    load();
  }, []);

  return (
    <div className="mx-auto max-w-lg p-6">
      <h1 className="text-xl font-semibold">اعتراض به تصمیم ایمنی</h1>
      <p className="mt-2 text-sm text-amber-100/75">
        اگر حسابت محدود یا مسدود شده، توضیح بده. هویت گزارش‌دهنده برای طرف مقابل فاش نمی‌شود. تصمیم نهایی سمت سرور ثبت می‌شود.
      </p>
      <select className="mt-4 w-full rounded-lg bg-black/30 p-2 text-sm" value={kind} onChange={(e) => setKind(e.target.value as typeof kind)}>
        <option value="ban">مسدودسازی</option>
        <option value="suspend">تعلیق</option>
        <option value="content">حذف محتوا</option>
        <option value="warning">هشدار</option>
      </select>
      <Input className="mt-2" placeholder="شرح اعتراض" value={body} onChange={(e) => setBody(e.target.value)} />
      <Button
        className="mt-3"
        onClick={async () => {
          const res = await fetch("/api/appeals", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ kind, body }),
          });
          const data = await res.json();
          if (!data.ok) toast.error(data.error);
          else {
            toast.success("اعتراض ثبت شد.");
            setBody("");
            load();
          }
        }}
      >
        ثبت اعتراض
      </Button>
      <ul className="mt-6 space-y-2 text-sm">
        {rows.map((r) => (
          <li key={r.id} className="rounded-xl border border-white/10 p-3">
            {r.kind} · {r.status}
            {r.decision ? <p className="mt-1 text-xs">{r.decision}</p> : null}
          </li>
        ))}
      </ul>
      <Link href="/app" className="mt-6 inline-block text-sm text-amber-200">
        بازگشت
      </Link>
    </div>
  );
}
