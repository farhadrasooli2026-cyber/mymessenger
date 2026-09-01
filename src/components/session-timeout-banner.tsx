"use client";

import { useEffect, useRef, useState } from "react";
import { useA11y } from "@/components/a11y-provider";

export function SessionTimeoutBanner({ idleMs }: { idleMs: number }) {
  const { prefs, announce } = useA11y();
  const [remain, setRemain] = useState<number | null>(null);
  const last = useRef(0);

  useEffect(() => {
    last.current = Date.now();
    if (!prefs.timeoutWarnings || idleMs <= 0) return;
    last.current = Date.now();
    const bump = () => {
      last.current = Date.now();
      setRemain(null);
    };
    const events = ["keydown", "pointerdown", "mousemove", "touchstart"];
    events.forEach((e) => window.addEventListener(e, bump, { passive: true }));
    const t = window.setInterval(() => {
      const elapsed = Date.now() - last.current;
      const warnAt = idleMs * 0.8;
      if (elapsed >= warnAt) {
        const left = Math.max(0, idleMs - elapsed);
        setRemain(left);
        if (left > 0 && left < 35_000) announce("نشست به‌زودی منقضی می‌شود. برای تمدید کلیدی بزنید.", true);
      }
    }, 5000);
    return () => {
      events.forEach((e) => window.removeEventListener(e, bump));
      window.clearInterval(t);
    };
  }, [announce, idleMs, prefs.timeoutWarnings]);

  if (remain === null) return null;
  const sec = Math.ceil(remain / 1000);
  return (
    <div role="status" className="fixed inset-x-0 bottom-16 z-40 mx-auto max-w-md rounded-xl bg-amber-300 px-4 py-3 text-sm text-[#102824] md:bottom-4">
      <p className="flex items-center gap-2">
        <span aria-hidden="true">⚠</span>
        نشست تا {sec} ثانیه دیگر بی‌فعال می‌ماند. برای تمدید حرکت کنید یا کلیدی بزنید.
      </p>
    </div>
  );
}
