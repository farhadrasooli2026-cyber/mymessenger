"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Bell } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { CATEGORY_FA, NOTIFY_CATEGORIES, type NotifyCategory } from "@/lib/notify-types";

type Item = {
  id: string;
  category: string;
  kind: string;
  title: string;
  body: string;
  senderName: string;
  photoUrl: string | null;
  priority: string;
  e2ee: boolean;
  suppressed: boolean;
  read: boolean;
  createdAt: number;
  target: { type: string; id: string; href?: string };
  pushState: string;
  state?: string;
  collapsedCount?: number;
};

export function NotifyBell({ onOpen }: { onOpen?: (href: string, target?: { type: string; id: string }) => void }) {
  const [open, setOpen] = useState(false);
  const [items, setItems] = useState<Item[]>([]);
  const [counts, setCounts] = useState({ total: 0, messages: 0, mentions: 0, calls: 0, security: 0 });
  const [category, setCategory] = useState<NotifyCategory>("all");
  const [unreadOnly, setUnreadOnly] = useState(false);
  const [mentionsOnly, setMentionsOnly] = useState(false);
  const [securityOnly, setSecurityOnly] = useState(false);
  const [note, setNote] = useState("");
  const [q, setQ] = useState("");
  const [cursor, setCursor] = useState<string | null>(null);
  const [perm, setPerm] = useState("");
  const seenRef = useRef<Set<string>>(new Set());
  const primedRef = useRef(false);
  const prefsRef = useRef<{ sound?: boolean; vibration?: boolean; vibrationPattern?: number[] }>({});

  const load = useCallback(async (nextCursor?: string | null) => {
    const params = new URLSearchParams({ category });
    if (q.trim()) params.set("q", q.trim());
    if (nextCursor) params.set("cursor", nextCursor);
    if (unreadOnly) params.set("unread", "1");
    if (mentionsOnly) params.set("mentions", "1");
    if (securityOnly) params.set("security", "1");
    const res = await fetch(`/api/notify?${params.toString()}`, { cache: "no-store" });
    const data = await res.json();
    if (!res.ok) return;
    const incoming: Item[] = data.items ?? [];
    setItems((prev) => (nextCursor ? [...prev, ...incoming] : incoming));
    setCursor(data.nextCursor ?? null);
    setCounts(data.counts ?? { total: 0, messages: 0, mentions: 0, calls: 0, security: 0 });
    setNote(data.note ?? "");
    prefsRef.current = {
      sound: data.prefs?.soundEnabled !== false,
      vibration: data.prefs?.vibration !== false,
      vibrationPattern: data.vibrationPattern,
    };
    const n = data.counts?.total ?? 0;
    if (data.prefs?.badge !== false && typeof document !== "undefined") {
      document.title = n > 0 ? `NIXO (${n})` : "NIXO نیکسو — اتصال. تبادل. فراتر از مرزها.";
    }
    try {
      if (data.prefs?.badge !== false && n > 0) {
        await (navigator as Navigator & { setAppBadge?: (c: number) => Promise<void> }).setAppBadge?.(n);
      } else {
        await (navigator as Navigator & { clearAppBadge?: () => Promise<void> }).clearAppBadge?.();
      }
    } catch {
      /* badge API optional */
    }
    if (primedRef.current && typeof document !== "undefined" && document.visibilityState === "visible") {
      for (const item of incoming) {
        if (item.read || item.suppressed || seenRef.current.has(item.id)) continue;
        seenRef.current.add(item.id);
        toast.message(item.title, { description: item.body || item.senderName });
        if (prefsRef.current.vibration && navigator.vibrate && prefsRef.current.vibrationPattern?.length) {
          navigator.vibrate(prefsRef.current.vibrationPattern);
        }
      }
    } else if (primedRef.current && typeof Notification !== "undefined" && Notification.permission === "granted") {
      for (const item of incoming) {
        if (item.read || item.suppressed || seenRef.current.has(item.id)) continue;
        seenRef.current.add(item.id);
        try {
          new Notification(item.title, { body: item.body, tag: item.id });
        } catch {
          /* Notification ctor optional */
        }
      }
    } else {
      for (const item of incoming) seenRef.current.add(item.id);
    }
    primedRef.current = true;
  }, [category, q, unreadOnly, mentionsOnly, securityOnly]);

  useEffect(() => {
    const t0 = window.setTimeout(() => void load(), 0);
    const t = window.setInterval(() => void load(), 8000);
    return () => {
      window.clearTimeout(t0);
      window.clearInterval(t);
    };
  }, [load]);

  async function act(action: string, extra?: Record<string, unknown>) {
    await fetch("/api/notify", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action, ...extra }) });
    await load();
  }

  return (
    <>
      <button
        type="button"
        className="relative grid size-9 place-items-center rounded-full bg-black/25"
        onClick={() => setOpen(true)}
        aria-label="Notification Center"
      >
        <Bell className="size-4 text-amber-200" />
        {counts.total > 0 ? (
          <span className="absolute -left-0.5 -top-0.5 min-w-4 rounded-full bg-rose-500 px-1 text-[9px] font-bold text-white">
            {counts.total > 99 ? "99+" : counts.total}
          </span>
        ) : null}
      </button>
      {open && (
        <div className="fixed inset-0 z-50 bg-black/70 p-3" onClick={() => setOpen(false)}>
          <div
            className="mx-auto flex max-h-[92dvh] max-w-lg flex-col overflow-hidden rounded-3xl bg-[#102824] p-4 text-emerald-50"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between">
              <h2 className="text-lg font-semibold">Notification Center</h2>
              <button type="button" className="text-sm text-amber-200" onClick={() => setOpen(false)}>
                بستن
              </button>
            </div>
            <p className="mt-1 text-[11px] text-emerald-100/55">
              خوانده‌نشده: {counts.messages} پیام · {counts.mentions} منشن · {counts.calls} تماس
              {counts.security ? ` · ${counts.security} امنیت` : ""}
            </p>
            <div className="mt-2 flex flex-wrap gap-1">
              {NOTIFY_CATEGORIES.map((c) => (
                <button
                  key={c}
                  type="button"
                  className={`rounded-full px-2 py-0.5 text-[11px] ${category === c ? "bg-amber-300 text-[#102824]" : "bg-white/10"}`}
                  onClick={() => setCategory(c)}
                >
                  {CATEGORY_FA[c]}
                </button>
              ))}
            </div>
            <div className="mt-2 flex flex-wrap gap-1 text-[11px]">
              <button type="button" className={`rounded-full px-2 py-0.5 ${unreadOnly ? "bg-amber-300 text-[#102824]" : "bg-white/10"}`} onClick={() => setUnreadOnly((v) => !v)}>
                فقط خوانده‌نشده
              </button>
              <button type="button" className={`rounded-full px-2 py-0.5 ${mentionsOnly ? "bg-amber-300 text-[#102824]" : "bg-white/10"}`} onClick={() => setMentionsOnly((v) => !v)}>
                منشن
              </button>
              <button type="button" className={`rounded-full px-2 py-0.5 ${securityOnly ? "bg-amber-300 text-[#102824]" : "bg-white/10"}`} onClick={() => setSecurityOnly((v) => !v)}>
                امنیت
              </button>
            </div>
            <div className="mt-2 flex flex-wrap gap-2 text-[11px]">
              <Button type="button" size="xs" variant="secondary" onClick={() => void act("read", { all: true })}>
                Mark All as Read
              </Button>
              <Button
                type="button"
                size="xs"
                variant="ghost"
                className="text-rose-200"
                onClick={async () => {
                  await fetch("/api/notify?all=1", { method: "DELETE" });
                  await load();
                }}
              >
                Clear All Notifications
              </Button>
              <Button
                type="button"
                size="xs"
                variant="secondary"
                onClick={async () => {
                  if (typeof Notification === "undefined") {
                    setPerm("این مرورگر Push وب ندارد؛ اعلان داخل برنامه فعال است.");
                    return;
                  }
                  if (Notification.permission === "denied") {
                    setPerm("اجازهٔ مرورگر رد شده. اعلان فقط داخل برنامه نمایش داده می‌شود.");
                    return;
                  }
                  const next = Notification.permission === "granted" ? "granted" : await Notification.requestPermission();
                  setPerm(next === "granted" ? "اجازه داده شد." : next === "denied" ? "رد شد؛ فقط داخل برنامه." : "منتظر اجازه.");
                  await fetch("/api/notify/push", {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({
                      endpoint: `web:${typeof crypto !== "undefined" && crypto.randomUUID ? crypto.randomUUID() : String(Date.now())}`,
                      platform: "web",
                      permission: next,
                    }),
                  });
                }}
              >
                اجازهٔ مرورگر
              </Button>
            </div>
            <input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              onBlur={() => void load()}
              placeholder="جستجوی اعلان"
              className="mt-2 h-8 w-full rounded-lg bg-black/30 px-2 text-xs"
            />
            {perm ? <p className="mt-1 text-[11px] text-amber-200/80">{perm}</p> : null}
            <div className="mt-2 min-h-0 flex-1 space-y-1 overflow-auto">
              {items.length === 0 ? <p className="py-8 text-center text-xs text-emerald-100/50">اعلانی نیست.</p> : null}
              {items.map((n) => (
                <div key={n.id} className={`rounded-xl px-3 py-2 ${n.read ? "bg-black/20" : "bg-amber-300/10"}`}>
                  <button
                    type="button"
                    className="block w-full text-right"
                    onClick={() => {
                      void (async () => {
                        const res = await fetch(`/api/notify/open?id=${n.id}`, { cache: "no-store" });
                        const data = await res.json().catch(() => null);
                        if (!res.ok) return;
                        onOpen?.(data.href, data.target);
                        setOpen(false);
                        await load();
                      })();
                    }}
                  >
                    <p className="text-sm font-medium">
                      {n.priority === "critical" ? "✦ " : n.priority === "high" ? "⚠ " : ""}
                      {n.title}
                      {n.e2ee ? " · E2EE" : ""}
                      {(n.collapsedCount ?? 1) > 1 ? ` · ${n.collapsedCount}` : ""}
                    </p>
                    <p className="truncate text-xs text-emerald-100/70">{n.body || n.senderName}</p>
                    <p className="text-[10px] text-emerald-100/45">
                      {n.kind} · {new Date(n.createdAt).toLocaleString("fa-IR")}
                      {n.suppressed ? " · بی‌صدا" : ""} · {n.state ?? n.pushState}
                    </p>
                  </button>
                  <div className="mt-1 flex gap-2 text-[10px]">
                    <button type="button" className="text-amber-200" onClick={() => void act("read", { id: n.id })}>
                      Mark as Read
                    </button>
                    <button type="button" className="text-emerald-100/70" onClick={() => void act("unread", { id: n.id })}>
                      Mark as Unread
                    </button>
                    <button type="button" className="text-emerald-100/70" onClick={() => void act("dismiss", { id: n.id })}>
                      پنهان
                    </button>
                    <button
                      type="button"
                      className="text-rose-200"
                      onClick={async () => {
                        await fetch(`/api/notify?id=${n.id}`, { method: "DELETE" });
                        await load();
                      }}
                    >
                      حذف
                    </button>
                  </div>
                </div>
              ))}
              {cursor ? (
                <button type="button" className="w-full py-2 text-xs text-amber-200" onClick={() => void load(cursor)}>
                  بیشتر
                </button>
              ) : null}
            </div>
            <p className="mt-2 text-[10px] leading-5 text-emerald-100/40">{note}</p>
          </div>
        </div>
      )}
    </>
  );
}
