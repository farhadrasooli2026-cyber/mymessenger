"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { NixoMark } from "@/components/nixo-mark";
import { Button } from "@/components/ui/button";

type Device = {
  name: string;
  os: string;
  deviceTypeFa: string;
  appVersion: string;
  approx: string;
  pending: boolean;
  trusted: boolean;
  status: string;
};

export function DeviceGate() {
  const router = useRouter();
  const [device, setDevice] = useState<Device | null>(null);
  const [msg, setMsg] = useState("در انتظار تأیید دستگاه مورد اعتماد…");

  useEffect(() => {
    let stop = false;
    function tick() {
      fetch("/api/devices", { cache: "no-store" })
        .then((r) => r.json())
        .then((d) => {
          if (stop) return;
          if (!d.ok) {
            setMsg(d.error ?? "نشست نامعتبر است.");
            return;
          }
          if (d.device) setDevice(d.device as Device);
          if (d.approved) {
            fetch("/api/devices", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ action: "activate" }),
            })
              .then((r) => r.json())
              .then((res) => {
                if (res.ok) router.replace(res.next || "/app");
              })
              .catch(() => undefined);
          }
        })
        .catch(() => undefined);
    }
    tick();
    const id = window.setInterval(tick, 2500);
    return () => {
      stop = true;
      window.clearInterval(id);
    };
  }, [router]);

  return (
    <main className="flex min-h-dvh items-center justify-center bg-[#071614] p-6 text-emerald-50">
      <div className="w-full max-w-md space-y-4 rounded-3xl border border-white/10 bg-[#0f2f2c] p-6">
        <NixoMark size={44} />
        <h1 className="text-xl font-semibold">تأیید دستگاه جدید</h1>
        <p className="text-sm leading-7 text-emerald-100/75">{msg}</p>
        {device && (
          <ul className="text-xs leading-6 text-emerald-100/70">
            <li>{device.name} · {device.deviceTypeFa} · {device.os}</li>
            <li>نسخه: {device.appVersion}</li>
            <li>{device.approx}</li>
          </ul>
        )}
        <p className="text-xs leading-6 text-amber-100/80">
          بدون تأیید دستگاه مورد اعتماد، کلیدهای E2EE و محتوای خصوصی در اختیار این دستگاه قرار نمی‌گیرد. از گوشی یا لپ‌تاپ قبلی وارد Settings → Devices شوید و Confirm New Device را بزنید. اگر همهٔ دستگاه‌ها را از دست داده‌اید، از بازیابی حساب استفاده کنید — Verification دور زده نمی‌شود.
        </p>
        <Button type="button" variant="secondary" onClick={() => router.replace("/recover")}>
          بازیابی حساب
        </Button>
      </div>
    </main>
  );
}
