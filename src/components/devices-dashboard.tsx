"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { toast } from "sonner";
import { NixoMark } from "@/components/nixo-mark";
import { Button } from "@/components/ui/button";

type Device = {
  id: string;
  name: string;
  label: string;
  deviceTypeFa: string;
  os: string;
  appVersion: string;
  approx: string;
  lastSeenAt: number;
  current: boolean;
  trusted: boolean;
  pending: boolean;
  unknown: boolean;
  status: "active" | "inactive" | "revoked";
};

function when(ts: number) {
  return new Date(ts).toLocaleString("fa-IR");
}

export function DevicesDashboard() {
  const [devices, setDevices] = useState<Device[]>([]);
  const [pending, setPending] = useState<Device[]>([]);
  const [trusted, setTrusted] = useState<Device[]>([]);
  const [busy, setBusy] = useState(false);

  function load() {
    fetch("/api/devices", { cache: "no-store" })
      .then((r) => r.json())
      .then((d) => {
        if (!d.ok || d.wait) return;
        setDevices(d.devices ?? []);
        setPending(d.pending ?? []);
        setTrusted(d.trusted ?? []);
      })
      .catch(() => undefined);
  }

  useEffect(() => {
    load();
  }, []);

  async function act(body: Record<string, unknown>, okMsg: string) {
    setBusy(true);
    try {
      const res = await fetch("/api/devices", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = await res.json();
      if (!res.ok) {
        toast.error(data.error ?? "انجام نشد.");
        return;
      }
      toast.success(okMsg);
      load();
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
            <p className="text-xs text-amber-200">تنظیمات ← دستگاه‌ها</p>
            <h1 className="text-xl font-semibold">Devices</h1>
          </div>
        </div>
        <p className="text-xs leading-6 text-emerald-100/65">
          موقعیت فقط تقریبی و بدون GPS است. دستگاه جدید بدون تأیید، به کلیدهای E2EE دسترسی ندارد. Session منقضی، باطل یا جعلی رد می‌شود.
        </p>
        <p className="text-xs">
          <Link href="/app/settings/security" className="text-amber-200">امنیت</Link>
          {" · "}
          <Link href="/app/settings/account" className="text-amber-200">حساب</Link>
          {" · "}
          <Link href="/recover" className="text-amber-200">بازیابی</Link>
        </p>

        {pending.length > 0 && (
          <section className="rounded-2xl border border-amber-300/40 bg-amber-300/10 p-4 text-sm">
            <h2 className="font-medium">New Device — تأیید لازم</h2>
            {pending.map((d) => (
              <div key={d.id} className="mt-3 rounded-xl bg-black/20 p-3 text-xs">
                <p className="font-medium">{d.name} · Unknown Device</p>
                <p>{d.deviceTypeFa} · {d.os} · {d.appVersion}</p>
                <p>{d.approx}</p>
                <p>Last Active: {when(d.lastSeenAt)}</p>
                <div className="mt-2 flex flex-wrap gap-2">
                  <Button type="button" disabled={busy} onClick={() => void act({ action: "approve", deviceId: d.id }, "دستگاه Trusted شد.")}>
                    Confirm New Device
                  </Button>
                  <Button type="button" variant="secondary" disabled={busy} onClick={() => void act({ action: "remove", deviceId: d.id }, "Remove + Revoke + Security Alert")}>
                    Remove / Log Out
                  </Button>
                </div>
              </div>
            ))}
          </section>
        )}

        <section className="rounded-2xl bg-white/5 p-4 text-sm">
          <h2 className="font-medium">Trusted Devices</h2>
          <ul className="mt-2 space-y-3">
            {trusted.map((d) => (
              <li key={d.id} className="rounded-xl border border-white/10 p-3 text-xs">
                <p className="font-medium">
                  {d.name}
                  {d.current ? " · This Device" : ""}
                  {d.status === "inactive" ? " · Inactive" : " · Active"}
                </p>
                <p>{d.deviceTypeFa} · {d.os} · نسخه {d.appVersion}</p>
                <p>{d.approx}</p>
                <p>Last Active: {when(d.lastSeenAt)}</p>
                {!d.current && (
                  <Button type="button" variant="ghost" className="mt-1 h-8 px-0 text-amber-200" disabled={busy} onClick={() => void act({ action: "logout", deviceId: d.id }, "Log Out شد.")}>
                    Log Out
                  </Button>
                )}
              </li>
            ))}
          </ul>
        </section>

        <section className="rounded-2xl bg-white/5 p-4 text-sm">
          <h2 className="font-medium">همهٔ نشست‌ها</h2>
          <ul className="mt-2 space-y-3">
            {devices.map((d) => (
              <li key={d.id} className="rounded-xl border border-white/10 p-3 text-xs">
                <p className="font-medium">
                  {d.name} {d.current ? "· This Device" : ""} {d.unknown ? "· Unknown Device" : ""} {d.trusted ? "· Trusted" : ""}
                </p>
                <p>نوع: {d.deviceTypeFa} · سیستم: {d.os} · {d.appVersion}</p>
                <p>{d.approx}</p>
                <p>Last Active: {when(d.lastSeenAt)} · {d.status === "active" ? "Active" : "Inactive"}</p>
                {!d.current && (
                  <div className="mt-2 flex gap-2">
                    <Button type="button" size="sm" variant="secondary" disabled={busy} onClick={() => void act({ action: "logout", deviceId: d.id }, "خروج انجام شد.")}>Log Out</Button>
                    <Button type="button" size="sm" variant="secondary" disabled={busy} onClick={() => void act({ action: "remove", deviceId: d.id }, "دستگاه حذف و نشست باطل شد.")}>Remove Device</Button>
                  </div>
                )}
              </li>
            ))}
          </ul>
          <Button type="button" className="mt-3" disabled={busy} onClick={() => void act({ action: "logout-others" }, "سایر نشست‌ها Revoke شدند.")}>
            Log Out All Other Devices
          </Button>
        </section>
      </div>
    </main>
  );
}
