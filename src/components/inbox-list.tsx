"use client";

import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { MUTE_CHAT_PRESETS } from "@/lib/notify-types";
import { FOLDER_ICONS, INBOX_KINDS } from "@/lib/inbox-types";
import { cn } from "@/lib/utils";

export type InboxItem = {
  key: string;
  kind: string;
  targetId: string;
  name: string;
  title: string;
  color: string;
  lastAt: number;
  lastPreview: string;
  unreadCount: number;
  mentionCount: number;
  replyFlag: boolean;
  pinned: boolean;
  archived: boolean;
  muted: boolean;
  favorite: boolean;
  draft: string;
  notes: string;
  labels: string[];
  e2ee: boolean;
  markedUnread: boolean;
  navId?: string;
};

type Folder = {
  id: string;
  name: string;
  icon: string;
  builtin: string | null;
  includeTypes?: string[];
  includeIds?: string[];
  excludeIds?: string[];
  unreadOnly?: boolean;
  favoritesOnly?: boolean;
  muted?: boolean;
  updatedAt?: number;
};

async function post(body: Record<string, unknown>) {
  const res = await fetch("/api/inbox", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  const data = await res.json();
  return { res, data };
}

function clock(ts: number) {
  if (!ts) return "";
  return new Date(ts).toLocaleTimeString("fa-IR", { hour: "2-digit", minute: "2-digit" });
}

const KIND_LABEL: Record<string, string> = {
  dm: "خصوصی",
  group: "گروه",
  channel: "کانال",
  community: "جامعه",
  bot: "ربات",
  business: "کسب‌وکار",
};

type MenuState = { key: string; x: number; y: number } | null;

export function InboxList({
  query,
  onOpen,
  activeKey,
  accountId,
}: {
  query: string;
  activeKey?: string | null;
  accountId: string;
  onOpen: (item: InboxItem) => void;
}) {
  const [folder, setFolder] = useState("all");
  const [folders, setFolders] = useState<Folder[]>([]);
  const [items, setItems] = useState<InboxItem[]>([]);
  const [busy, setBusy] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [composer, setComposer] = useState(false);
  const [editId, setEditId] = useState<string | null>(null);
  const [fname, setFname] = useState("");
  const [ficon, setFicon] = useState("📁");
  const [ftypes, setFtypes] = useState<string[]>(["dm"]);
  const [funread, setFunread] = useState(false);
  const [ffav, setFfav] = useState(false);
  const [fmuted, setFmuted] = useState(false);
  const [fexclude, setFexclude] = useState("");
  const [menu, setMenu] = useState<MenuState>(null);
  const pressTimer = useRef<number | null>(null);
  const startX = useRef(0);

  const load = useCallback(async () => {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(
        `/api/inbox?folder=${encodeURIComponent(folder)}&q=${encodeURIComponent(query)}&scope=folder`,
        { cache: "no-store" },
      );
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? "بارگذاری نشد.");
        return;
      }
      setFolders(data.folders ?? []);
      setItems(data.items ?? []);
      try {
        sessionStorage.setItem(`nixo-inbox:${accountId}`, JSON.stringify({ folders: data.folders, items: data.items, at: Date.now() }));
      } catch {
        /* private cache is session-bound */
      }
    } catch {
      setError("اتصال برقرار نشد.");
      try {
        const raw = sessionStorage.getItem(`nixo-inbox:${accountId}`);
        if (raw) {
          const cached = JSON.parse(raw) as { folders: Folder[]; items: InboxItem[] };
          setFolders(cached.folders ?? []);
          setItems(cached.items ?? []);
        }
      } catch {
        /* ignore */
      }
    } finally {
      setBusy(false);
    }
  }, [folder, query, accountId]);

  useEffect(() => {
    const t = window.setTimeout(() => void load(), 0);
    return () => window.clearTimeout(t);
  }, [load]);

  useEffect(() => {
    const close = () => setMenu(null);
    window.addEventListener("click", close);
    window.addEventListener("scroll", close, true);
    return () => {
      window.removeEventListener("click", close);
      window.removeEventListener("scroll", close, true);
    };
  }, []);

  async function act(key: string, action: string, extra: Record<string, unknown> = {}) {
    setMenu(null);
    const { res, data } = await post({ key, action, ...extra });
    if (!res.ok) toast.error(data.error ?? "انجام نشد.");
    else void load();
  }

  function openMenu(item: InboxItem, clientX: number, clientY: number) {
    const pad = 12;
    const w = 220;
    const h = 360;
    const x = Math.min(Math.max(pad, clientX - w + 8), window.innerWidth - w - pad);
    const y = Math.min(Math.max(pad, clientY), window.innerHeight - h - pad);
    setMenu({ key: item.key, x, y });
  }

  function openComposer(existing?: Folder) {
    if (existing && !existing.builtin) {
      setEditId(existing.id);
      setFname(existing.name);
      setFicon(existing.icon);
      setFtypes(existing.includeTypes?.length ? existing.includeTypes : ["dm"]);
      setFunread(Boolean(existing.unreadOnly));
      setFfav(Boolean(existing.favoritesOnly));
      setFmuted(Boolean(existing.muted));
      setFexclude((existing.excludeIds ?? []).join(","));
    } else {
      setEditId(null);
      setFname("");
      setFicon("📁");
      setFtypes(["dm"]);
      setFunread(false);
      setFfav(false);
      setFmuted(false);
      setFexclude("");
    }
    setComposer(true);
  }

  const current = folders.find((f) => f.id === folder);
  const menuItem = menu ? items.find((i) => i.key === menu.key) : undefined;

  return (
    <div className="space-y-1 px-1 pb-24">
      <div className="flex gap-1 overflow-x-auto px-2 pb-2">
        {folders.map((f) => (
          <button
            key={f.id}
            type="button"
            onClick={() => setFolder(f.id)}
            onDoubleClick={() => {
              if (!f.builtin) openComposer(f);
            }}
            className={cn(
              "shrink-0 rounded-full px-3 py-1.5 text-[12px]",
              folder === f.id ? "bg-amber-300 text-[#102824]" : "bg-white/10 text-emerald-50",
            )}
          >
            {f.name}
          </button>
        ))}
        <button type="button" className="shrink-0 rounded-full bg-white/10 px-3 py-1.5 text-[12px]" onClick={() => openComposer()}>
          +
        </button>
      </div>
      {current && !current.builtin && (
        <div className="flex gap-2 px-3 text-[11px] text-emerald-100/55">
          <button type="button" onClick={() => openComposer(current)}>
            ویرایش پوشه
          </button>
          <button
            type="button"
            className="text-rose-200/80"
            onClick={() => {
              if (!confirm("فقط پوشه حذف شود؟ گفتگوها باقی می‌مانند.")) return;
              void post({ action: "folder-delete", id: current.id }).then(() => {
                setFolder("all");
                void load();
              });
            }}
          >
            حذف پوشه
          </button>
        </div>
      )}
      {composer && (
        <form
          className="mx-2 rounded-2xl bg-white/5 p-3 text-xs"
          onSubmit={async (e) => {
            e.preventDefault();
            const { res, data } = await post({
              action: "folder-save",
              id: editId ?? undefined,
              name: fname,
              icon: ficon,
              includeTypes: ftypes,
              unreadOnly: funread,
              favoritesOnly: ffav,
              muted: fmuted,
              excludeIds: fexclude
                .split(",")
                .map((s) => s.trim())
                .filter(Boolean),
              force: true,
            });
            if (!res.ok) toast.error(data.error);
            else {
              setComposer(false);
              void load();
            }
          }}
        >
          <p className="font-medium">{editId ? "ویرایش پوشه" : "پوشهٔ جدید"}</p>
          <Input value={fname} onChange={(e) => setFname(e.target.value)} placeholder="نام پوشه" className="mt-2 h-8 bg-black/20" />
          <div className="mt-2 flex flex-wrap gap-1">
            {FOLDER_ICONS.map((ic) => (
              <button key={ic} type="button" className={cn("size-8 rounded-lg", ficon === ic ? "bg-amber-300/40" : "bg-white/10")} onClick={() => setFicon(ic)}>
                {ic}
              </button>
            ))}
          </div>
          <div className="mt-2 flex flex-wrap gap-2">
            {INBOX_KINDS.map((k) => (
              <label key={k} className="flex items-center gap-1">
                <input type="checkbox" checked={ftypes.includes(k)} onChange={(e) => setFtypes((t) => (e.target.checked ? [...t, k] : t.filter((x) => x !== k)))} />
                {KIND_LABEL[k] ?? k}
              </label>
            ))}
          </div>
          <div className="mt-2 flex gap-2">
            <Button type="submit" size="sm" className="h-8 bg-amber-300 text-[#102824]">
              ذخیره
            </Button>
            <Button type="button" size="sm" variant="secondary" className="h-8" onClick={() => setComposer(false)}>
              انصراف
            </Button>
          </div>
        </form>
      )}
      {busy && <p className="px-3 py-8 text-center text-sm text-emerald-100/50">در حال بارگذاری…</p>}
      {error && (
        <div className="px-3 py-4 text-center text-sm text-rose-200">
          {error}
          <button type="button" className="mr-2 text-amber-200" onClick={() => void load()}>
            تلاش دوباره
          </button>
        </div>
      )}
      {!busy && items.length === 0 && <p className="px-3 py-12 text-center text-sm text-emerald-100/50">هنوز گفتگویی نیست</p>}
      {items.map((item) => (
        <div
          key={item.key}
          className={cn("relative", activeKey === item.key ? "bg-emerald-400/10" : "hover:bg-white/5")}
          onContextMenu={(e) => {
            e.preventDefault();
            openMenu(item, e.clientX, e.clientY);
          }}
          onTouchStart={(e) => {
            startX.current = e.changedTouches[0]?.clientX ?? 0;
            const touch = e.changedTouches[0];
            if (pressTimer.current) window.clearTimeout(pressTimer.current);
            pressTimer.current = window.setTimeout(() => {
              if (touch) openMenu(item, touch.clientX, touch.clientY);
            }, 480);
          }}
          onTouchEnd={(e) => {
            if (pressTimer.current) window.clearTimeout(pressTimer.current);
            const dx = (e.changedTouches[0]?.clientX ?? 0) - startX.current;
            if (dx > 72) void act(item.key, item.unreadCount || item.markedUnread ? "read" : "unread");
            if (dx < -72) void act(item.key, item.archived ? "unarchive" : "archive");
          }}
          onTouchMove={() => {
            if (pressTimer.current) window.clearTimeout(pressTimer.current);
          }}
        >
          <button type="button" className="flex w-full items-center gap-3 px-3 py-2.5 text-right" onClick={() => onOpen(item)}>
            <span className="grid size-12 shrink-0 place-items-center rounded-full text-base font-semibold text-[#071614]" style={{ background: item.color }}>
              {item.name.slice(0, 1)}
            </span>
            <span className="min-w-0 flex-1">
              <span className="flex items-center justify-between gap-2">
                <span className={cn("truncate text-[15px]", item.unreadCount || item.markedUnread ? "font-semibold" : "font-medium")}>{item.name}</span>
                <span className="shrink-0 text-[11px] text-emerald-100/45">{clock(item.lastAt)}</span>
              </span>
              <span className="mt-0.5 flex items-center gap-2">
                <span className="min-w-0 flex-1 truncate text-[13px] text-emerald-100/55">
                  {item.draft ? "پیش‌نویس: " : ""}
                  {item.lastPreview || "بدون پیام"}
                </span>
                {(item.unreadCount > 0 || item.markedUnread) && (
                  <span className="grid min-w-5 place-items-center rounded-full bg-amber-300 px-1.5 text-[11px] font-semibold text-[#102824]">
                    {item.unreadCount || 1}
                  </span>
                )}
              </span>
            </span>
          </button>
        </div>
      ))}
      {menu && menuItem && (
        <div
          className="fixed z-50 min-w-52 overflow-hidden rounded-2xl border border-white/10 bg-[#122e2a] py-1 text-sm shadow-2xl"
          style={{ left: menu.x, top: menu.y }}
          onClick={(e) => e.stopPropagation()}
        >
          <MenuRow
            onClick={() => void act(menuItem.key, menuItem.unreadCount || menuItem.markedUnread ? "read" : "unread")}
          >
            {menuItem.unreadCount || menuItem.markedUnread ? "علامت خوانده‌شده" : "علامت نخوانده"}
          </MenuRow>
          <MenuRow onClick={() => void act(menuItem.key, menuItem.pinned ? "unpin" : "pin")}>
            {menuItem.pinned ? "برداشتن سنجاق" : "سنجاق کردن"}
          </MenuRow>
          <MenuRow onClick={() => void act(menuItem.key, menuItem.archived ? "unarchive" : "archive")}>
            {menuItem.archived ? "خروج از بایگانی" : "بایگانی"}
          </MenuRow>
          {MUTE_CHAT_PRESETS.map((p) => (
            <MenuRow key={p.id} onClick={() => void act(menuItem.key, "mute", { ms: p.ms })}>
              بی‌صدا {p.id === "1h" ? "۱ ساعت" : p.id === "8h" ? "۸ ساعت" : p.id === "1d" ? "۱ روز" : p.id === "1w" ? "۱ هفته" : "برای همیشه"}
            </MenuRow>
          ))}
          {menuItem.muted && <MenuRow onClick={() => void act(menuItem.key, "unmute")}>باصدا کردن</MenuRow>}
          <MenuRow
            onClick={() => {
              if (!confirm("پیام‌های این گفتگو برای تو پاک شود؟")) return;
              void act(menuItem.key, "clear", { confirm: true });
            }}
          >
            پاک کردن گفتگو
          </MenuRow>
          <MenuRow
            danger
            onClick={() => {
              if (!confirm("از فهرست تو حذف شود؟")) return;
              void act(menuItem.key, "delete");
            }}
          >
            حذف
          </MenuRow>
        </div>
      )}
    </div>
  );
}

function MenuRow({ children, onClick, danger }: { children: ReactNode; onClick: () => void; danger?: boolean }) {
  return (
    <button
      type="button"
      className={cn("block w-full px-4 py-2.5 text-right hover:bg-white/10", danger ? "text-rose-300" : "text-emerald-50")}
      onClick={onClick}
    >
      {children}
    </button>
  );
}
