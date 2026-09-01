"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { toast } from "sonner";
import { NixoMark } from "@/components/nixo-mark";
import { Button } from "@/components/ui/button";
import { MINI_SCOPE_FA, MINI_SENSITIVE, type MiniScope } from "@/lib/bot-types";

type AppCard = {
  id: string;
  title: string;
  category: string;
  description: string;
  version: string;
  status: string;
  verified: boolean;
  developer: { name: string; username: string; verified: boolean };
  requestedScopes: MiniScope[];
  scopeLabels: string[];
  privacyUrl: string;
  termsUrl: string;
  rating: number;
  reviewCount: number;
  installed: boolean;
  favorite: boolean;
  iconDataUrl: string | null;
  paymentHint: boolean;
  webUrlHost: string | null;
};

type ProfilePack = {
  ok: boolean;
  app: AppCard;
  reviews: { id: string; stars: number; body: string; createdAt: number; mine: boolean }[];
  grant: { scopes: MiniScope[]; installed: boolean; favorite: boolean };
};

type SessionPack = {
  html: string;
  webUrl: string | null;
  mini: AppCard;
  grant: { scopes: MiniScope[]; profile: boolean };
  init: { user: unknown; hash: string; auth_date: number; sessionId: string };
  maintenance: boolean;
  iframeAllow: string;
};

export function MiniAppFrame({ miniId }: { miniId: string }) {
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const [profile, setProfile] = useState<ProfilePack | null>(null);
  const [session, setSession] = useState<SessionPack | null>(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState("");
  const [kind, setKind] = useState<"profile" | "network" | "permission" | "webview" | "api" | "">("");
  const [pendingScope, setPendingScope] = useState<MiniScope | null>(null);
  const [stars, setStars] = useState(5);
  const [review, setReview] = useState("");
  const [checks, setChecks] = useState<Partial<Record<MiniScope, boolean>>>({});

  const loadProfile = useCallback(async () => {
    setLoading(true);
    setKind("");
    try {
      const res = await fetch(`/api/mini?profile=1&id=${encodeURIComponent(miniId)}`, { cache: "no-store" });
      const data = await res.json();
      if (!res.ok) {
        setErr(data.error ?? "بارگذاری نشد.");
        setKind(res.status === 403 ? "permission" : "network");
        setProfile(null);
        return;
      }
      setProfile(data as ProfilePack);
      const next: Partial<Record<MiniScope, boolean>> = {};
      for (const s of data.app.requestedScopes as MiniScope[]) next[s] = (data.grant.scopes as MiniScope[]).includes(s);
      setChecks(next);
      setErr("");
    } catch {
      setErr("شبکه قطع است. Mini App بدون دسترسی غیرمجاز به دادهٔ نیکسو آفلاین می‌ماند.");
      setKind("network");
    } finally {
      setLoading(false);
    }
  }, [miniId]);

  async function openSession() {
    setLoading(true);
    setKind("");
    try {
      const res = await fetch(`/api/mini?id=${encodeURIComponent(miniId)}`, { cache: "no-store" });
      const data = await res.json();
      if (!res.ok) {
        setErr(data.error ?? "باز نشد.");
        setKind(res.status === 403 ? "permission" : "webview");
        setSession(null);
        return;
      }
      setSession(data as SessionPack);
      setErr("");
    } catch {
      setErr("خطای شبکه هنگام باز کردن WebView.");
      setKind("network");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    const t = window.setTimeout(() => void loadProfile(), 0);
    return () => window.clearTimeout(t);
  }, [loadProfile]);

  useEffect(() => {
    function onMsg(ev: MessageEvent) {
      const data = ev.data;
      if (!data || typeof data !== "object") return;
      if (data.type === "nixo-request-profile") setPendingScope("profile");
      if (data.type === "nixo-request-scope" && typeof data.scope === "string") setPendingScope(data.scope as MiniScope);
      if (data.type === "nixo-bridge" && typeof data.op === "string") {
        void fetch("/api/mini", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action: "bridge", miniId, op: data.op, extra: data.extra ?? {} }),
        })
          .then((r) => r.json())
          .then((out) => {
            iframeRef.current?.contentWindow?.postMessage({ type: "nixo-bridge-result", op: data.op, result: out }, "*");
            if (!out.ok) toast.error(out.error ?? "API رد شد.");
          })
          .catch(() => {
            setKind("api");
            toast.error("API در دسترس نیست.");
          });
      }
    }
    window.addEventListener("message", onMsg);
    return () => window.removeEventListener("message", onMsg);
  }, [miniId]);

  useEffect(() => {
    if (!session || !iframeRef.current?.contentWindow) return;
    iframeRef.current.contentWindow.postMessage(
      { type: "nixo-init", user: session.init.user, hash: session.init.hash, auth_date: session.init.auth_date },
      "*",
    );
  }, [session]);

  async function post(body: Record<string, unknown>, okMsg?: string) {
    const res = await fetch("/api/mini", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ miniId, ...body }),
    });
    const data = await res.json();
    if (!res.ok) {
      toast.error(data.error ?? "انجام نشد.");
      if (body.action === "scopes") setKind("permission");
      return false;
    }
    if (okMsg) toast.success(okMsg);
    return true;
  }

  async function saveScopes(next: Partial<Record<MiniScope, boolean>>) {
    const ok = await post({ action: "scopes", scopes: next }, "مجوز به‌روز شد.");
    if (ok) {
      await loadProfile();
      if (session) await openSession();
    }
  }

  const app = profile?.app;

  return (
    <main className="flex min-h-dvh flex-col bg-[#071614] text-emerald-50">
      <header className="flex items-center gap-2 border-b border-white/10 p-3">
        <NixoMark size={28} />
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-medium">{app?.title ?? "Mini App"}</p>
          <p className="text-[11px] text-amber-200">
            {app?.verified ? "تأییدشده نیکسو · " : ""}@{app?.developer.username ?? "—"} · سندباکس
          </p>
        </div>
        <Link href="/app/apps" className="text-xs text-amber-200">
          بستن
        </Link>
      </header>

      {loading && <p className="px-3 py-4 text-sm">در حال بارگذاری Mini App…</p>}
      {err && (
        <p className="px-3 py-2 text-sm text-red-200" role="alert">
          {kind === "permission" ? "مجوز یا وضعیت App اجازهٔ اجرا نمی‌دهد. " : ""}
          {err}
        </p>
      )}

      {app && (
        <section className="space-y-2 px-3 py-3 text-xs leading-5">
          <p className="opacity-80">{app.description}</p>
          <p>
            نسخه‌ {app.version} · وضعیت {app.status} · امتیاز {app.rating || "—"} ({app.reviewCount} نظر)
          </p>
          {app.privacyUrl ? (
            <a href={app.privacyUrl} className="text-amber-200" target="_blank" rel="noreferrer">
              Privacy Policy
            </a>
          ) : null}
          {app.termsUrl ? (
            <a href={app.termsUrl} className="ms-3 text-amber-200" target="_blank" rel="noreferrer">
              Terms
            </a>
          ) : null}
          <p className="text-emerald-100/65">
            Mini App به رمز عبور، OTP، کلید خصوصی، چت E2EE و کارت پرداخت دسترسی ندارد. JavaScript سندباکس به API نیکسو وصل نمی‌شود؛ فقط والد با نشست شما درخواست می‌فرستد.
          </p>
          <div className="flex flex-wrap gap-2">
            <Button type="button" size="xs" variant="secondary" onClick={() => void post({ action: "favorite" }).then(() => loadProfile())}>
              {app.favorite ? "حذف Favorite" : "Favorite"}
            </Button>
            <Button type="button" size="xs" variant="secondary" onClick={() => void post({ action: "install" }).then(() => loadProfile())}>
              {app.installed ? "Remove از لیست" : "افزودن به لیست"}
            </Button>
            <Button type="button" size="xs" variant="secondary" onClick={() => void post({ action: "clear-data" }, "دادهٔ محلی پاک شد.").then(() => { setSession(null); void loadProfile(); })}>
              پاک کردن دادهٔ محلی
            </Button>
            <Button type="button" size="xs" variant="secondary" onClick={() => void post({ action: "disconnect" }, "اتصال قطع شد.").then(() => { setSession(null); void loadProfile(); })}>
              قطع اتصال
            </Button>
            <Button
              type="button"
              size="xs"
              variant="secondary"
              onClick={() => void post({ action: "report", category: "abuse", details: "گزارش از Mini App" }, "گزارش ثبت شد.")}
            >
              گزارش
            </Button>
          </div>
          <div className="rounded-2xl border border-white/10 p-3">
            <p className="font-medium">مجوزهای درخواستی (کمینه)</p>
            <ul className="mt-2 space-y-1">
              {app.requestedScopes.map((s) => (
                <li key={s} className="flex items-center justify-between gap-2">
                  <label className="flex items-center gap-2">
                    <input
                      type="checkbox"
                      checked={Boolean(checks[s])}
                      onChange={(e) => setChecks((c) => ({ ...c, [s]: e.target.checked }))}
                    />
                    {MINI_SCOPE_FA[s]}
                    {MINI_SENSITIVE.includes(s) ? " · حساس" : ""}
                  </label>
                </li>
              ))}
            </ul>
            <Button type="button" size="sm" className="mt-2 bg-amber-300 text-[#102824]" onClick={() => void saveScopes(checks)}>
              ذخیره مجوزها
            </Button>
          </div>
          {!session && (
            <Button type="button" className="w-full bg-amber-300 text-[#102824]" onClick={() => void openSession()}>
              اجرا در سندباکس
            </Button>
          )}
        </section>
      )}

      {pendingScope && (
        <div className="mx-3 rounded-2xl border border-amber-300/40 bg-amber-300/10 p-3 text-sm">
          <p>
            این Mini App برای «{MINI_SCOPE_FA[pendingScope] ?? pendingScope}» اجازه می‌خواهد. رد کردن قابل دور زدن از iframe نیست.
          </p>
          <div className="mt-2 flex gap-2">
            <Button
              type="button"
              size="sm"
              className="bg-amber-300 text-[#102824]"
              onClick={() => {
                void saveScopes({ [pendingScope]: true });
                setPendingScope(null);
              }}
            >
              Allow
            </Button>
            <Button type="button" size="sm" variant="secondary" onClick={() => setPendingScope(null)}>
              Deny
            </Button>
          </div>
        </div>
      )}

      {session?.maintenance && (
        <p className="mx-3 rounded-xl bg-white/10 p-3 text-sm">این App در حالت Maintenance است. اجرای سندباکس محدود نمایش داده می‌شود.</p>
      )}

      {session && (
        <iframe
          ref={iframeRef}
          title={session.mini.title}
          sandbox="allow-scripts allow-forms"
          allow={session.iframeAllow || undefined}
          referrerPolicy="no-referrer"
          className="mx-3 mt-2 min-h-[420px] flex-1 rounded-2xl border border-white/10 bg-black"
          src={session.webUrl ?? undefined}
          srcDoc={session.webUrl ? undefined : session.html}
        />
      )}

      {app?.paymentHint && (
        <div className="p-3">
          <Button
            type="button"
            variant="secondary"
            className="w-full"
            onClick={() => void post({ action: "bridge", op: "pay" })}
          >
            پرداخت از مسیر رسمی NIXO Pay (کارت به App داده نمی‌شود)
          </Button>
        </div>
      )}

      {profile && (
        <section className="space-y-2 p-3 text-xs">
          <h2 className="text-sm font-medium">نظر و امتیاز</h2>
          <div className="flex gap-2">
            <select className="h-8 rounded-lg bg-black/30" value={stars} onChange={(e) => setStars(Number(e.target.value))} aria-label="امتیاز">
              {[1, 2, 3, 4, 5].map((n) => (
                <option key={n} value={n}>
                  {n}
                </option>
              ))}
            </select>
            <input
              className="h-8 flex-1 rounded-lg bg-black/30 px-2"
              value={review}
              onChange={(e) => setReview(e.target.value)}
              placeholder="نظر (بدون لینک هرزنامه)"
            />
            <Button type="button" size="sm" onClick={() => void post({ action: "review", stars, body: review }, "ثبت شد.").then(() => loadProfile())}>
              ثبت
            </Button>
          </div>
          <ul className="space-y-1 opacity-80">
            {profile.reviews.map((r) => (
              <li key={r.id}>
                {"★".repeat(r.stars)} {r.body}
              </li>
            ))}
          </ul>
        </section>
      )}
    </main>
  );
}
