"use client";

import { useCallback, useEffect, useState } from "react";
import { Bell } from "lucide-react";
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
};

export function NotifyBell({ onOpen }: { onOpen?: (href: string) => void }) {
  const [open, setOpen] = useState(false);
  const [items, setItems] = useState<Item[]>([]);
  const [counts, setCounts] = useState({ total: 0, messages: 0, mentions: 0, calls: 0, security: 0 });
  const [category, setCategory] = useState<NotifyCategory>("all");
  const [note, setNote] = useState("");

  const load = useCallback(async () => {
    const res = await fetch(`/api/notify?category=${category}`, { cache: "no-store" });
    const data = await res.json();
    if (!res.ok) return;
    setItems(data.items ?? []);
    setCounts(data.counts ?? { total: 0, messages: 0, mentions: 0, calls: 0, security: 0 });
    setNote(data.note ?? "");
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
  }, [category]);

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
              {NOTIFY_CATEGORIES.filter((c) => !["stories", "bots", "ai"].includes(c)).map((c) => (
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
                  if (typeof Notification !== "undefined" && Notification.permission === "default") {
                    await Notification.requestPermission();
                  }
                }}
              >
                اجازهٔ مرورگر
              </Button>
            </div>
            <div className="mt-2 min-h-0 flex-1 space-y-1 overflow-auto">
              {items.length === 0 ? <p className="py-8 text-center text-xs text-emerald-100/50">اعلانی نیست.</p> : null}
              {items.map((n) => (
                <div key={n.id} className={`rounded-xl px-3 py-2 ${n.read ? "bg-black/20" : "bg-amber-300/10"}`}>
                  <button
                    type="button"
                    className="block w-full text-right"
                    onClick={() => {
                      void act("read", { id: n.id });
                      if (n.target.href) onOpen?.(n.target.href);
                      setOpen(false);
                    }}
                  >
                    <p className="text-sm font-medium">
                      {n.priority === "high" ? "⚠ " : ""}
                      {n.title}
                      {n.e2ee ? " · E2EE" : ""}
                    </p>
                    <p className="truncate text-xs text-emerald-100/70">{n.body || n.senderName}</p>
                    <p className="text-[10px] text-emerald-100/45">
                      {n.kind} · {new Date(n.createdAt).toLocaleString("fa-IR")}
                      {n.suppressed ? " · بی‌صدا" : ""} · {n.pushState === "push_unsupported" ? "در برنامه" : n.pushState}
                    </p>
                  </button>
                  <div className="mt-1 flex gap-2 text-[10px]">
                    <button type="button" className="text-amber-200" onClick={() => void act("read", { id: n.id })}>
                      Mark as Read
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
            </div>
            <p className="mt-2 text-[10px] leading-5 text-emerald-100/40">{note}</p>
          </div>
        </div>
      )}
    </>
  );
}
