"use client";

import { useEffect, useState } from "react";
import { remainingMs } from "@/lib/disappear";

export function ExpiryBadge({
  createdAt,
  expireFrom,
  disappearAfterMs,
  expiresAt,
  viewedAt,
  viewOnce,
}: {
  createdAt: number;
  expireFrom?: "send" | "view" | null;
  disappearAfterMs?: number | null;
  expiresAt?: number | null;
  viewedAt?: number | null;
  viewOnce?: boolean;
}) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(t);
  }, []);
  const left = remainingMs(
    { createdAt, expireFrom, disappearAfterMs, expiresAt, viewedAt, viewOnce },
    now,
  );
  if (viewOnce && !viewedAt) return <span className="text-[10px] text-amber-200">یک‌بارمصرف</span>;
  if (left === null) return disappearAfterMs ? <span className="text-[10px] opacity-70">محو پس از مشاهده</span> : null;
  if (left === 0) return <span className="text-[10px] opacity-55">منقضی</span>;
  const s = Math.ceil(left / 1000);
  const label = s < 60 ? `${s}ث` : s < 3600 ? `${Math.ceil(s / 60)}د` : `${Math.ceil(s / 3600)}س`;
  return <span className="text-[10px] tabular-nums opacity-70">محو {label}</span>;
}
