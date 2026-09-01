"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { toast } from "sonner";
import { NixoMark } from "@/components/nixo-mark";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { MonitorDesk } from "@/components/monitor-desk";
import { DrDesk } from "@/components/dr-desk";
import { PerfDesk } from "@/components/perf-desk";
import { DeployDesk } from "@/components/deploy-desk";
import { I18nDesk } from "@/components/i18n-desk";
import { ADMIN_CONFIRM, STAFF_ROLE_FA, type StaffRole } from "@/lib/admin-types";

type Dash = {
  role: StaffRole;
  impersonateUserId: string | null;
  metrics: Record<string, number>;
  alerts: { id: string; severity: string; title: string; createdAt: number; ack: boolean }[];
  sessions: { id: string; current: boolean; createdAt: number; userAgent: string; ipHint: string }[];
};

const TABS = ["داشبورد", "پایش", "بازیابی", "عملکرد", "انتشار", "زبان", "کاربران", "گزارش‌ها", "صف", "پرونده", "اعتراض", "حسابرسی"] as const;

export function AdminDesk() {
  const [me, setMe] = useState<{ staff: boolean; authed: boolean; role: StaffRole | null; impersonateUserId: string | null } | null>(null);
  const [password, setPassword] = useState("");
  const [totp, setTotp] = useState("");
  const [tab, setTab] = useState<(typeof TABS)[number]>("داشبورد");
  const [dash, setDash] = useState<Dash | null>(null);
  const [q, setQ] = useState("");
  const [users, setUsers] = useState<{ id: string; username: string | null; displayName: string | null; accountStatus: string }[]>([]);
  const [picked, setPicked] = useState<string>("");
  const [profile, setProfile] = useState<Record<string, unknown> | null>(null);
  const [reports, setReports] = useState<Record<string, unknown>[]>([]);
  const [cases, setCases] = useState<Record<string, unknown>[]>([]);
  const [appeals, setAppeals] = useState<Record<string, unknown>[]>([]);
  const [audit, setAudit] = useState<{ integrity: boolean; audit: Record<string, unknown>[] } | null>(null);
  const [reason, setReason] = useState("");
  const [confirm, setConfirm] = useState("");
  const [busy, setBusy] = useState(false);

  const loadMe = useCallback(() => {
    fetch("/api/admin/moderation?view=me", { cache: "no-store" })
      .then((r) => r.json())
      .then((d) => {
        if (d.ok) setMe(d);
      })
      .catch(() => undefined);
  }, []);

  useEffect(() => {
    loadMe();
  }, [loadMe]);

  async function act(body: Record<string, unknown>) {
    setBusy(true);
    try {
      const res = await fetch("/api/admin/moderation", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = await res.json();
      if (!data.ok) {
        toast.error(data.error ?? "خطا");
        return data;
      }
      toast.success("انجام شد.");
      return data;
    } finally {
      setBusy(false);
    }
  }

  async function login() {
    const data = await act({ action: "login", password, totp });
    if (data?.ok) {
      setPassword("");
      loadMe();
    }
  }

  useEffect(() => {
    if (!me?.authed) return;
    if (tab === "داشبورد") {
      fetch("/api/admin/moderation?view=dashboard", { cache: "no-store" })
        .then((r) => r.json())
        .then((d) => d.ok && setDash(d))
        .catch(() => undefined);
    }
    if (tab === "گزارش‌ها" || tab === "صف") {
      fetch("/api/admin/moderation?view=reports", { cache: "no-store" })
        .then((r) => r.json())
        .then((d) => d.ok && setReports(d.reports ?? []))
        .catch(() => undefined);
    }
    if (tab === "پرونده") {
      fetch("/api/admin/moderation?view=cases", { cache: "no-store" })
        .then((r) => r.json())
        .then((d) => d.ok && setCases(d.cases ?? []))
        .catch(() => undefined);
    }
    if (tab === "اعتراض") {
      fetch("/api/admin/moderation?view=appeals", { cache: "no-store" })
        .then((r) => r.json())
        .then((d) => d.ok && setAppeals(d.appeals ?? []))
        .catch(() => undefined);
    }
    if (tab === "حسابرسی") {
      fetch("/api/admin/moderation?view=audit", { cache: "no-store" })
        .then((r) => r.json())
        .then((d) => d.ok && setAudit({ integrity: d.integrity, audit: d.audit ?? [] }))
        .catch(() => undefined);
    }
  }, [me?.authed, tab]);

  async function search() {
    const res = await fetch(`/api/admin/moderation?view=users&q=${encodeURIComponent(q)}`, { cache: "no-store" });
    const data = await res.json();
    if (data.ok) setUsers(data.users ?? []);
    else toast.error(data.error);
  }

  async function openUser(id: string) {
    setPicked(id);
    const res = await fetch(`/api/admin/moderation?view=user&id=${encodeURIComponent(id)}`, { cache: "no-store" });
    const data = await res.json();
    if (data.ok) setProfile(data);
    else toast.error(data.error);
  }

  if (!me) {
    return <p className="p-6 text-sm text-amber-100/70">در حال بررسی دسترسی…</p>;
  }

  if (!me.staff) {
    return (
      <div className="mx-auto max-w-lg p-6">
        <NixoMark />
        <h1 className="mt-4 text-xl font-semibold">پنل مدیریت نیکسو</h1>
        <p className="mt-2 text-sm text-amber-100/80">این مسیر فقط برای نقش‌های ایمنی نیکسو است. حساب معمولی دسترسی ندارد.</p>
        <Link href="/app" className="mt-4 inline-block text-sm text-amber-200">
          بازگشت به برنامه
        </Link>
      </div>
    );
  }

  if (!me.authed) {
    return (
      <div className="mx-auto max-w-md p-6">
        <NixoMark />
        <h1 className="mt-4 text-xl font-semibold">ورود مستقل ادمین</h1>
        <p className="mt-2 text-sm text-amber-100/75">نشست برنامه کافی نیست. رمز حساب و در صورت فعال بودن کد ۲FA را وارد کن. نشست ادمین ۸ ساعت اعتبار دارد و HttpOnly است.</p>
        <Input className="mt-4" type="password" placeholder="رمز حساب" value={password} onChange={(e) => setPassword(e.target.value)} />
        <Input className="mt-2" placeholder="کد Authenticator (در صورت نیاز)" value={totp} onChange={(e) => setTotp(e.target.value)} />
        <Button className="mt-3" disabled={busy} onClick={() => void login()}>
          ورود به پنل
        </Button>
      </div>
    );
  }

  const userCard = profile && typeof profile.user === "object" ? (profile.user as Record<string, unknown>) : null;

  return (
    <div className="mx-auto max-w-5xl p-4 pb-16">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold">مرکز مدیریت و نظارت نیکسو</h1>
          <p className="text-xs text-amber-100/70">
            نقش: {me.role ? STAFF_ROLE_FA[me.role] : "—"} · رمز، توکن نشست و کلید هرگز اینجا نمایش داده نمی‌شود.
          </p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" onClick={() => void act({ action: "logout-others" })}>
            خروج نشست‌های دیگر
          </Button>
          <Button variant="ghost" onClick={() => void act({ action: "logout" }).then(() => loadMe())}>
            خروج ادمین
          </Button>
        </div>
      </div>
      {me.impersonateUserId && (
        <div className="mt-3 rounded-xl border border-amber-400/40 bg-amber-400/10 p-3 text-sm">
          در حال مشاهدهٔ محدود حساب {me.impersonateUserId.slice(0, 8)} هستی. عملیات حساس قفل است.
          <Button className="ms-2" size="sm" onClick={() => void act({ action: "impersonate-stop" }).then(() => loadMe())}>
            پایان مشاهده
          </Button>
        </div>
      )}
      <div className="mt-4 flex flex-wrap gap-1" role="tablist" aria-label="بخش‌های ادمین">
        {TABS.map((t) => (
          <Button key={t} size="sm" variant={tab === t ? "default" : "ghost"} role="tab" aria-selected={tab === t} onClick={() => setTab(t)}>
            {t}
          </Button>
        ))}
      </div>

      {tab === "داشبورد" && dash && (
        <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {Object.entries(dash.metrics).map(([k, v]) => (
            <div key={k} className="rounded-2xl border border-white/10 bg-white/5 p-3">
              <p className="text-[11px] text-amber-100/60">{k}</p>
              <p className="text-lg font-semibold">{v}</p>
              <span className="sr-only">مقدار {k} برابر {v}</span>
            </div>
          ))}
          <div className="sm:col-span-2 rounded-2xl border border-white/10 bg-white/5 p-3">
            <p className="text-sm font-medium">هشدارها</p>
            {dash.alerts.length === 0 && <p className="mt-2 text-xs text-amber-100/60">هشداری نیست.</p>}
            {dash.alerts.map((a) => (
              <div key={a.id} className="mt-2 flex items-center justify-between text-xs">
                <span>
                  [{a.severity}] {a.title}
                </span>
                {!a.ack && (
                  <Button size="xs" variant="outline" onClick={() => void act({ action: "alert-ack", id: a.id })}>
                    رسید
                  </Button>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {tab === "پایش" && <MonitorDesk />}

      {tab === "بازیابی" && <DrDesk />}

      {tab === "عملکرد" && <PerfDesk />}

      {tab === "انتشار" && <DeployDesk />}

      {tab === "زبان" && <I18nDesk />}

      {tab === "کاربران" && (
        <div className="mt-4 space-y-3">
          <div className="flex gap-2">
            <Input placeholder="نام کاربری یا شناسه" value={q} onChange={(e) => setQ(e.target.value)} />
            <Button onClick={() => void search()}>جستجو</Button>
          </div>
          <ul className="space-y-1 text-sm">
            {users.map((u) => (
              <li key={u.id}>
                <button type="button" className="text-amber-200" onClick={() => void openUser(u.id)}>
                  @{u.username ?? u.id.slice(0, 8)} · {u.accountStatus}
                </button>
              </li>
            ))}
          </ul>
          {userCard && (
            <div className="rounded-2xl border border-white/10 bg-white/5 p-4 text-sm">
              <p>
                @{String(userCard.username ?? "")} · وضعیت {String(userCard.accountStatus)}
              </p>
              <p className="mt-1 text-xs text-amber-100/60">رمز و توکن در این نما نیست. دستگاه‌ها بدون مقدار نشست.</p>
              <Input className="mt-3" placeholder="دلیل اقدام" value={reason} onChange={(e) => setReason(e.target.value)} />
              <Input className="mt-2" type="password" placeholder="رمز ادمین" value={password} onChange={(e) => setPassword(e.target.value)} />
              <Input className="mt-2" placeholder={`عبارت تأیید (${ADMIN_CONFIRM.ban} / ${ADMIN_CONFIRM.suspend} / ${ADMIN_CONFIRM.impersonate})`} value={confirm} onChange={(e) => setConfirm(e.target.value)} />
              <div className="mt-3 flex flex-wrap gap-2">
                <Button size="sm" variant="outline" onClick={() => void act({ action: "warn", targetId: picked, reason })}>
                  هشدار
                </Button>
                <Button size="sm" variant="outline" onClick={() => void act({ action: "restrict", targetId: picked, reason, password, confirm: ADMIN_CONFIRM.suspend })}>
                  محدودیت
                </Button>
                <Button size="sm" variant="outline" onClick={() => void act({ action: "suspend", targetId: picked, reason, password, confirm: ADMIN_CONFIRM.suspend })}>
                  تعلیق
                </Button>
                <Button size="sm" variant="destructive" onClick={() => void act({ action: "ban", targetId: picked, reason, password, confirm, permanent: true })}>
                  مسدود
                </Button>
                <Button size="sm" onClick={() => void act({ action: "unban", targetId: picked, password, confirm: ADMIN_CONFIRM.ban })}>
                  رفع مسدود
                </Button>
                <Button size="sm" variant="outline" onClick={() => void act({ action: "revoke", targetId: picked })}>
                  ابطال نشست‌ها
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => void act({ action: "impersonate", targetId: picked, password, confirm }).then((d) => d?.ok && loadMe())}
                >
                  مشاهده محدود
                </Button>
              </div>
            </div>
          )}
        </div>
      )}

      {(tab === "گزارش‌ها" || tab === "صف") && (
        <div className="mt-4 space-y-2">
          {reports.length === 0 && <p className="text-sm text-amber-100/60">گزارش بازی نیست.</p>}
          {reports.map((r) => (
            <div key={String(r.id)} className="rounded-xl border border-white/10 bg-white/5 p-3 text-sm">
              <p>
                {String(r.targetKind)} · {String(r.category)} · {String(r.status)} · اولویت {String(r.priority)}
              </p>
              <p className="text-xs text-amber-100/60">شناسه گزارش {String(r.id)} · گزارش‌دهنده {String(r.reporter ?? "مخفی")}</p>
              <div className="mt-2 flex flex-wrap gap-2">
                <Button size="xs" variant="outline" onClick={() => void act({ action: "report-update", id: r.id, status: "reviewing" })}>
                  در حال بررسی
                </Button>
                <Button size="xs" variant="outline" onClick={() => void act({ action: "report-update", id: r.id, note: "یادداشت داخلی" })}>
                  یادداشت
                </Button>
                <Button
                  size="xs"
                  onClick={() =>
                    void act({
                      action: "content-action",
                      id: r.id,
                      kind: r.targetKind === "story" ? "story" : r.targetKind === "group" ? "group" : "profile",
                      targetId: r.targetKey,
                      contentAction: "remove",
                      reason: "خلاف سیاست",
                    })
                  }
                >
                  حذف محتوا
                </Button>
              </div>
            </div>
          ))}
        </div>
      )}

      {tab === "پرونده" && (
        <div className="mt-4 space-y-2">
          <Button size="sm" onClick={() => void act({ action: "case-update", title: "پرونده جدید" })}>
            پرونده تازه
          </Button>
          {cases.map((c) => (
            <p key={String(c.id)} className="rounded-xl border border-white/10 bg-white/5 p-3 text-sm">
              {String(c.title)} · {String(c.status)} · {String(c.reports)} گزارش
            </p>
          ))}
        </div>
      )}

      {tab === "اعتراض" && (
        <div className="mt-4 space-y-2">
          {appeals.map((a) => (
            <div key={String(a.id)} className="rounded-xl border border-white/10 bg-white/5 p-3 text-sm">
              {String(a.kind)} · {String(a.status)}
              <div className="mt-2 flex gap-2">
                <Button size="xs" onClick={() => void act({ action: "appeal-decide", id: a.id, status: "accepted", decision: "پذیرفته شد" })}>
                  پذیرش
                </Button>
                <Button size="xs" variant="outline" onClick={() => void act({ action: "appeal-decide", id: a.id, status: "rejected", decision: "رد شد" })}>
                  رد
                </Button>
              </div>
            </div>
          ))}
        </div>
      )}

      {tab === "حسابرسی" && (
        <div className="mt-4">
          <p className="text-xs">{audit?.integrity ? "زنجیرهٔ حسابرسی سالم است." : "یکپارچگی حسابرسی نیاز به بررسی دارد."}</p>
          <ul className="mt-2 space-y-1 text-xs">
            {(audit?.audit ?? []).map((a) => (
              <li key={String(a.id)}>
                {new Date(Number(a.createdAt)).toLocaleString("fa-IR")} · {String(a.actorRole)} · {String(a.action)} · {String(a.result)}
              </li>
            ))}
          </ul>
          <Button className="mt-3" variant="outline" onClick={() => void act({ action: "recover" })}>
            بازیابی ایندکس moderation
          </Button>
        </div>
      )}
    </div>
  );
}
