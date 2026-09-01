"use client";

import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";

type ServiceHealth = "up" | "degraded" | "down";

type Dash = {
  process: { cpuPct: number; memMb: number; heapMb: number; load: number; cores: number; freeMemMb: number; totalMemMb: number; storeBytes: number | null };
  health: {
    database: string;
    ready: boolean;
    heartbeat: { ok: boolean; at: number; independent: boolean };
    services: Record<string, ServiceHealth>;
    history: { at: number; cpuPct: number; memMb: number; diskMb: number }[];
  };
  api: {
    requests: number;
    errors: number;
    timeouts: number;
    slow: number;
    avgMs: number;
    errorRate: number;
    throughputPerMin: number;
    availability: number;
    slaTarget: number;
    slaMet: boolean;
    status: Record<string, number>;
    bytesIn: number;
    bytesOut: number;
  };
  capacity: { users: number; storageBytes: number; storeBytes: number | null; projectedStoreMb7d: number };
  domain: {
    users: { total: number; dau: number; mau: number; newUsers: number; retention7d: number | null; sessions: number };
    messaging: { threads: number; envelopes: number; note: string };
    calls: { total: number; failed: number; rttMs: number; jitterMs: number; loss: number; bitrateKbps: number };
    stories: { total: number; views: number };
    notify: { records: number; push: number; failed: number; deadLetters: number };
    search: { queries: number; errors: number; latencyMs: number; zeroResultRate: number; cacheHits: number };
    storage: { objects: number; bytes: number; uploads: number; uploadFail: number; downloads: number; downloadFail: number };
    groups: { total: number };
    channels: { total: number; posts: number };
    auth: { loginFails: number; permissionDenies: number; incidents: number };
    queues: { search: number; vault: number; push: number; media: number };
  };
  logs: { id: string; at: number; level: string; service: string; message: string; traceId: string }[];
  errors: { fingerprint: string; service: string; sample: string; count: number; lastAt: number }[];
  alerts: { id: string; severity: string; title: string; at: number; count: number; ack: boolean; resolved: boolean; suppressed: boolean; escalated: boolean }[];
  incidents: { id: string; title: string; status: string; ownerId: string | null; createdAt: number; timeline: { at: number; action: string }[] }[];
  backups: { id: string; createdAt: number; bytes: number; verifiedAt: number | null }[];
  dependencies: { from: string; to: string }[];
  privacy: { storesPlaintextMessages: boolean; storesCallMedia: boolean; storesFileBytes: boolean; piiInMetrics: boolean };
};

const HEALTH_FA: Record<ServiceHealth, string> = { up: "سالم", degraded: "تضعیف", down: "قطع" };

export function MonitorDesk() {
  const [dash, setDash] = useState<Dash | null>(null);
  const [denied, setDenied] = useState("");
  const [service, setService] = useState<string>("api");
  const [busy, setBusy] = useState(false);

  const load = useCallback(() => {
    fetch("/api/monitor", { cache: "no-store" })
      .then((r) => r.json())
      .then((d) => {
        if (d.ok) {
          setDash(d);
          setDenied("");
        } else setDenied(d.error ?? "دسترسی پایش نداری.");
      })
      .catch(() => setDenied("بارگذاری پایش ناموفق بود."));
  }, []);

  useEffect(() => {
    load();
    const t = setInterval(load, 12_000);
    return () => clearInterval(t);
  }, [load]);

  async function act(body: Record<string, unknown>) {
    setBusy(true);
    try {
      const res = await fetch("/api/monitor", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = await res.json();
      if (!data.ok) {
        toast.error(data.error ?? "خطا");
        return;
      }
      toast.success("انجام شد.");
      load();
    } finally {
      setBusy(false);
    }
  }

  if (denied) {
    return <p className="mt-4 text-sm text-amber-100/70">{denied}</p>;
  }
  if (!dash) {
    return <p className="mt-4 text-sm text-amber-100/70">در حال بارگذاری پایش…</p>;
  }

  const svc = dash.health.services[service] ?? "up";

  return (
    <div className="mt-4 space-y-4">
      <p className="text-xs text-amber-100/65">
        متریک‌ها تجمعی و بدون متن پیام، رسانه، فایل خصوصی، رمز و توکن هستند. لاگ‌ها فقط برای نقش مجاز است.
      </p>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Stat label="CPU" value={`${dash.process.cpuPct}%`} />
        <Stat label="حافظه" value={`${dash.process.memMb} MB`} />
        <Stat label="دیسک Store" value={`${Math.round((dash.process.storeBytes ?? 0) / 1024 / 1024)} MB`} />
        <Stat label="شبکه (ورودی/خروجی)" value={`${dash.api.bytesIn} / ${dash.api.bytesOut} B`} />
        <Stat label="درخواست‌ها" value={String(dash.api.requests)} />
        <Stat label="تأخیر میانگین" value={`${dash.api.avgMs} ms`} />
        <Stat label="نرخ خطا" value={`${dash.api.errorRate}%`} />
        <Stat label="در دسترس بودن" value={`${dash.api.availability}%`} />
        <Stat label="DAU / MAU" value={`${dash.domain.users.dau} / ${dash.domain.users.mau}`} />
        <Stat label="کاربران جدید" value={String(dash.domain.users.newUsers)} />
        <Stat label="نگه‌داشت ۷روز" value={dash.domain.users.retention7d == null ? "—" : `${dash.domain.users.retention7d}%`} />
        <Stat label="ظرفیت ۷روز (پیش‌بینی Store)" value={`${dash.capacity.projectedStoreMb7d} MB`} />
      </div>

      <section className="rounded-2xl border border-white/10 bg-white/5 p-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-sm font-medium">سلامت سرویس‌ها</h2>
          <p className="text-[11px] text-amber-100/60">
            پایگاه {dash.health.database} · آماده {dash.health.ready ? "بله" : "خیر"} · ضربان مستقل{" "}
            {dash.health.heartbeat.independent ? "فعال" : "خاموش"}
          </p>
        </div>
        <div className="mt-3 flex flex-wrap gap-1">
          {Object.entries(dash.health.services).map(([name, h]) => (
            <Button key={name} size="xs" variant={service === name ? "default" : "outline"} onClick={() => setService(name)}>
              {name} · {HEALTH_FA[h]}
            </Button>
          ))}
        </div>
        <p className="mt-3 text-sm">
          سرویس انتخاب‌شده: <span className="font-medium">{service}</span> — {HEALTH_FA[svc]}
        </p>
        <p className="mt-1 text-xs text-amber-100/60">وابستگی‌ها: {dash.dependencies.filter((d) => d.from === service || d.to === service).map((d) => `${d.from}→${d.to}`).join(" · ") || "—"}</p>
      </section>

      <section className="grid gap-3 lg:grid-cols-2">
        <div className="rounded-2xl border border-white/10 bg-white/5 p-3 text-xs">
          <h3 className="text-sm font-medium">API و صف</h3>
          <p className="mt-2">کند: {dash.api.slow} · Timeout: {dash.api.timeouts} · Throughput/دقیقه: {dash.api.throughputPerMin}</p>
          <p>کد وضعیت: {Object.entries(dash.api.status).map(([c, n]) => `${c}:${n}`).join(" · ") || "—"}</p>
          <p>
            جستجو صف {dash.domain.queues.search} · Vault {dash.domain.queues.vault} · Push {dash.domain.queues.push} · رسانه{" "}
            {dash.domain.queues.media}
          </p>
          <p>SLA هدف {dash.api.slaTarget}% · {dash.api.slaMet ? "برقرار" : "خارج از هدف"}</p>
        </div>
        <div className="rounded-2xl border border-white/10 bg-white/5 p-3 text-xs">
          <h3 className="text-sm font-medium">دامنه (تجمعی)</h3>
          <p>پیام‌ها: {dash.domain.messaging.envelopes} پاکت — {dash.domain.messaging.note}</p>
          <p>
            تماس: {dash.domain.calls.total} · شکست {dash.domain.calls.failed} · RTT {dash.domain.calls.rttMs} · Jitter{" "}
            {dash.domain.calls.jitterMs} · Loss {dash.domain.calls.loss} · Bitrate {dash.domain.calls.bitrateKbps}
          </p>
          <p>استوری {dash.domain.stories.total} · بازدید {dash.domain.stories.views}</p>
          <p>
            اعلان {dash.domain.notify.records} · Push {dash.domain.notify.push} · شکست {dash.domain.notify.failed} · Dead letter{" "}
            {dash.domain.notify.deadLetters}
          </p>
          <p>
            جستجو {dash.domain.search.queries} · خطا {dash.domain.search.errors} · صفرنتیجه {dash.domain.search.zeroResultRate}% ·
            Cache {dash.domain.search.cacheHits}
          </p>
          <p>
            فایل {dash.domain.storage.objects} · آپلود {dash.domain.storage.uploads}/{dash.domain.storage.uploadFail} · دانلود{" "}
            {dash.domain.storage.downloads}/{dash.domain.storage.downloadFail}
          </p>
          <p>
            گروه {dash.domain.groups.total} · کانال {dash.domain.channels.total} · پست {dash.domain.channels.posts}
          </p>
          <p>
            ورود ناموفق {dash.domain.auth.loginFails} · رد مجوز {dash.domain.auth.permissionDenies} · حادثه امنیتی{" "}
            {dash.domain.auth.incidents}
          </p>
        </div>
      </section>

      <section className="rounded-2xl border border-white/10 bg-white/5 p-3">
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-medium">هشدارها و حوادث</h3>
          <Button size="xs" variant="outline" disabled={busy} onClick={() => void act({ action: "recover" })}>
            بازیابی پایش
          </Button>
        </div>
        {dash.alerts.length === 0 && <p className="mt-2 text-xs text-amber-100/60">هشدار بازی نیست.</p>}
        {dash.alerts.map((a) => (
          <div key={a.id} className="mt-2 flex flex-wrap items-center justify-between gap-2 text-xs">
            <span>
              [{a.severity}] {a.title} ×{a.count}
              {a.escalated ? " · تشدید" : ""}
              {a.suppressed ? " · سرکوب" : ""}
              {a.resolved ? " · حل‌شده" : ""}
            </span>
            <span className="flex gap-1">
              {!a.ack && (
                <Button size="xs" variant="outline" disabled={busy} onClick={() => void act({ action: "ack", id: a.id })}>
                  رسید
                </Button>
              )}
              {!a.resolved && (
                <Button size="xs" disabled={busy} onClick={() => void act({ action: "resolve", id: a.id })}>
                  حل شد
                </Button>
              )}
            </span>
          </div>
        ))}
        <div className="mt-4 space-y-2">
          {dash.incidents.map((i) => (
            <div key={i.id} className="rounded-xl border border-white/10 p-2 text-xs">
              <p>
                {i.title} · {i.status}
              </p>
              <p className="text-amber-100/55">خط زمان: {i.timeline.slice(0, 4).map((t) => t.action).join(" ← ") || "—"}</p>
              <div className="mt-2 flex flex-wrap gap-1">
                {(["investigating", "mitigating", "resolved", "closed"] as const).map((st) => (
                  <Button key={st} size="xs" variant="ghost" disabled={busy} onClick={() => void act({ action: "incident", id: i.id, status: st })}>
                    {st}
                  </Button>
                ))}
              </div>
            </div>
          ))}
        </div>
      </section>

      <section className="grid gap-3 lg:grid-cols-2">
        <div className="rounded-2xl border border-white/10 bg-white/5 p-3">
          <h3 className="text-sm font-medium">خطاهای گروه‌بندی‌شده</h3>
          {dash.errors.length === 0 && <p className="mt-2 text-xs text-amber-100/60">خطای ثبت‌شده نیست.</p>}
          {dash.errors.map((e) => (
            <p key={e.fingerprint} className="mt-2 text-xs">
              {e.service} · {e.count}× · {e.sample}
            </p>
          ))}
        </div>
        <div className="rounded-2xl border border-white/10 bg-white/5 p-3">
          <h3 className="text-sm font-medium">لاگ ساختاری</h3>
          {dash.logs.length === 0 && <p className="mt-2 text-xs text-amber-100/60">لاگی نیست.</p>}
          {dash.logs.slice(0, 12).map((l) => (
            <p key={l.id} className="mt-1 text-[11px] text-amber-100/80">
              {l.level} {l.service} {l.message}
              {l.traceId ? ` · ${l.traceId.slice(0, 8)}` : ""}
            </p>
          ))}
        </div>
      </section>

      <section className="rounded-2xl border border-white/10 bg-white/5 p-3 text-xs">
        <h3 className="text-sm font-medium">پشتیبان و حریم</h3>
        {dash.backups.length === 0 && <p className="mt-2 text-amber-100/60">اسنپ‌شات محلی یافت نشد.</p>}
        {dash.backups.map((b) => (
          <p key={b.id} className="mt-1">
            {b.id.slice(0, 8)} · {new Date(b.createdAt).toLocaleString("fa-IR")} · {b.bytes} B · تأیید {b.verifiedAt ? "شده" : "نشده"}
          </p>
        ))}
        <p className="mt-3 text-amber-100/70">
          حریم پایش: پیام خام {dash.privacy.storesPlaintextMessages ? "بله" : "خیر"} · رسانه تماس {dash.privacy.storesCallMedia ? "بله" : "خیر"} ·
          بایت فایل {dash.privacy.storesFileBytes ? "بله" : "خیر"} · PII در متریک {dash.privacy.piiInMetrics ? "بله" : "خیر"}
        </p>
      </section>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-2xl border border-white/10 bg-white/5 p-3">
      <p className="text-[11px] text-amber-100/60">{label}</p>
      <p className="text-lg font-semibold">{value}</p>
    </div>
  );
}
