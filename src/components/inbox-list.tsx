"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { Camera, Mic, MoreVertical, Phone, Plus, Search, Sparkles, Video } from "lucide-react";
import { toast } from "sonner";
import { NixoMark } from "@/components/nixo-mark";
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
  lastKind?: string;
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

const PRIMARY_TABS = [
  { id: "all", en: "All", fa: "همه" },
  { id: "unread", en: "Unread", fa: "خوانده‌نشده" },
  { id: "favorites", en: "Favourites", fa: "برگزیده‌ها" },
  { id: "groups", en: "Groups", fa: "گروه‌ها" },
] as const;

async function post(body: Record<string, unknown>) {
  const res = await fetch("/api/inbox", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  const data = await res.json();
  return { res, data };
}

function formatChatTime(ts: number) {
  if (!ts) return "";
  const d = new Date(ts);
  const now = new Date();
  const startToday = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  if (ts >= startToday) {
    return d.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", hour12: false });
  }
  if (ts >= startToday - 86_400_000) return "Yesterday";
  return d.toLocaleDateString("en-GB", { day: "2-digit", month: "short" });
}

function PreviewIcon({ kind }: { kind?: string }) {
  const cls = "size-3.5 shrink-0 text-emerald-100/55";
  if (kind === "voice") return <Mic className={cls} aria-hidden />;
  if (kind === "video" || kind === "video-call") return <Video className={cls} aria-hidden />;
  if (kind === "call") return <Phone className={cls} aria-hidden />;
  if (kind === "photo") return <Camera className={cls} aria-hidden />;
  return null;
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
  onQueryChange,
  onOpen,
  activeKey,
  accountId,
  onOpenAi,
  onCamera,
  onNewChat,
  onNewGroup,
  onSearchSubmit,
}: {
  query: string;
  onQueryChange?: (value: string) => void;
  activeKey?: string | null;
  accountId: string;
  onOpen: (item: InboxItem) => void;
  onOpenAi?: () => void;
  onCamera?: () => void;
  onNewChat?: () => void;
  onNewGroup?: () => void;
  onSearchSubmit?: () => void;
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
  const [headerMenu, setHeaderMenu] = useState(false);
  const [plusMenu, setPlusMenu] = useState(false);
  const [selecting, setSelecting] = useState(false);
  const [picked, setPicked] = useState<string[]>([]);
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
    const close = () => {
      setMenu(null);
      setHeaderMenu(false);
      setPlusMenu(false);
    };
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

  async function bulk(action: string, extra: Record<string, unknown> = {}) {
    if (!picked.length) return;
    const { res, data } = await post({ action: "bulk", keys: picked, bulk: action, ...extra });
    if (!res.ok) toast.error(data.error ?? "انجام نشد.");
    else {
      toast.success(`${data.count ?? picked.length} گفتگو به‌روز شد.`);
      setPicked([]);
      setSelecting(false);
      void load();
    }
  }

  async function readAll() {
    setHeaderMenu(false);
    const { res, data } = await post({ action: "read-all" });
    if (!res.ok) toast.error(data.error ?? "انجام نشد.");
    else {
      toast.success("همه خوانده شد.");
      void load();
    }
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

  function togglePick(key: string) {
    setPicked((cur) => (cur.includes(key) ? cur.filter((k) => k !== key) : [...cur, key]));
  }

  const current = folders.find((f) => f.id === folder);
  const menuItem = menu ? items.find((i) => i.key === menu.key) : undefined;
  const tabFolders = useMemo(() => {
    const custom = folders.filter((f) => !f.builtin);
    const primary = PRIMARY_TABS.map((tab) => folders.find((f) => f.id === tab.id)).filter(Boolean) as Folder[];
    const extras = folders.filter((f) => f.builtin && !PRIMARY_TABS.some((t) => t.id === f.id) && f.id === folder);
    return [...primary, ...extras, ...custom];
  }, [folders, folder]);

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex items-center justify-between px-2 pb-1 pt-2">
        <div className="relative flex items-center gap-0.5">
          <button
            type="button"
            className="grid size-10 place-items-center rounded-full text-emerald-50 hover:bg-white/10"
            aria-label="منوی گفتگوها"
            aria-expanded={headerMenu}
            onClick={(e) => {
              e.stopPropagation();
              setHeaderMenu((v) => !v);
              setPlusMenu(false);
            }}
          >
            <MoreVertical className="size-5" />
          </button>
          <button
            type="button"
            className="flex h-10 items-center gap-1 rounded-full px-2 text-cyan-200 hover:bg-white/10"
            aria-label="Nixo AI"
            onClick={() => onOpenAi?.()}
          >
            <NixoMark size={22} />
            <Sparkles className="size-3.5" />
            <span className="text-[11px] font-semibold tracking-wide">AI</span>
          </button>
          {headerMenu && (
            <div
              className="absolute start-0 top-11 z-40 min-w-56 overflow-hidden rounded-2xl border border-white/10 bg-[#122e2a] py-1 text-sm shadow-2xl"
              onClick={(e) => e.stopPropagation()}
            >
              <MenuRow
                onClick={() => {
                  setHeaderMenu(false);
                  setSelecting(true);
                  setPicked([]);
                }}
              >
                انتخاب گفتگوها
              </MenuRow>
              <MenuRow onClick={() => void readAll()}>علامت‌گذاری همه به‌عنوان خوانده‌شده</MenuRow>
            </div>
          )}
        </div>
        <div className="relative flex items-center gap-1">
          <button
            type="button"
            className="grid size-10 place-items-center rounded-full text-emerald-50 hover:bg-white/10"
            aria-label="دوربین"
            onClick={() => onCamera?.()}
          >
            <Camera className="size-5" />
          </button>
          <button
            type="button"
            className="grid size-10 place-items-center rounded-full bg-emerald-500 text-white shadow-md shadow-emerald-900/40 hover:bg-emerald-400"
            aria-label="گفتگو یا گروه جدید"
            onClick={(e) => {
              e.stopPropagation();
              setPlusMenu((v) => !v);
              setHeaderMenu(false);
            }}
          >
            <Plus className="size-5" />
          </button>
          {plusMenu && (
            <div
              className="absolute end-0 top-11 z-40 min-w-44 overflow-hidden rounded-2xl border border-white/10 bg-[#122e2a] py-1 text-sm shadow-2xl"
              onClick={(e) => e.stopPropagation()}
            >
              <MenuRow
                onClick={() => {
                  setPlusMenu(false);
                  onNewChat?.();
                }}
              >
                گفتگوی جدید
              </MenuRow>
              <MenuRow
                onClick={() => {
                  setPlusMenu(false);
                  onNewGroup?.();
                }}
              >
                گروه جدید
              </MenuRow>
            </div>
          )}
        </div>
      </div>

      <div className="px-3 pb-2 pt-1">
        <label className="flex h-11 items-center gap-2 rounded-xl border border-white/10 bg-black/30 px-3">
          <Search className="size-4 shrink-0 text-emerald-100/45" aria-hidden />
          <Input
            value={query}
            onChange={(e) => onQueryChange?.(e.target.value)}
            placeholder="Ask Nixo AI or Search"
            dir="auto"
            className="h-10 border-0 bg-transparent px-0 text-start text-sm shadow-none focus-visible:ring-0"
            aria-label="Ask Nixo AI or Search"
            onKeyDown={(e) => {
              if (e.key === "Enter") onSearchSubmit?.();
            }}
          />
        </label>
      </div>

      <div className="flex gap-1.5 overflow-x-auto px-3 pb-2">
        {tabFolders.map((f) => {
          const tab = PRIMARY_TABS.find((t) => t.id === f.id);
          return (
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
              {tab ? `${tab.en} · ${tab.fa}` : f.name}
            </button>
          );
        })}
        <button
          type="button"
          className="grid size-8 shrink-0 place-items-center rounded-full bg-white/10 text-emerald-50"
          aria-label="افزودن پوشه جدید"
          onClick={() => openComposer()}
        >
          <Plus className="size-4" />
        </button>
      </div>

      {selecting && (
        <div className="mx-3 mb-2 flex flex-wrap items-center gap-2 rounded-xl bg-emerald-500/15 px-3 py-2 text-[12px]">
          <span className="ms-auto text-emerald-100/70">{picked.length} انتخاب‌شده</span>
          <button type="button" onClick={() => void bulk("mute", { ms: MUTE_CHAT_PRESETS[4]?.ms ?? null })}>
            Mute
          </button>
          <button type="button" onClick={() => void bulk("archive")}>
            بایگانی
          </button>
          <button
            type="button"
            className="text-rose-200"
            onClick={() => {
              if (!confirm("گفتگوهای انتخاب‌شده از فهرست تو حذف شوند؟")) return;
              void bulk("delete", { confirm: true });
            }}
          >
            حذف
          </button>
          <button
            type="button"
            className="text-amber-200"
            onClick={() => {
              setSelecting(false);
              setPicked([]);
            }}
          >
            انصراف
          </button>
        </div>
      )}

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

      <div className="min-h-0 flex-1 overflow-auto pb-24">
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
            <button
              type="button"
              className="flex w-full items-center gap-3 px-3 py-2.5 text-right"
              onClick={() => {
                if (selecting) {
                  togglePick(item.key);
                  return;
                }
                onOpen(item);
              }}
            >
              {selecting && (
                <span
                  className={cn(
                    "grid size-5 shrink-0 place-items-center rounded-full border",
                    picked.includes(item.key) ? "border-emerald-400 bg-emerald-500 text-[10px] text-white" : "border-white/30",
                  )}
                >
                  {picked.includes(item.key) ? "✓" : ""}
                </span>
              )}
              <span className="grid size-12 shrink-0 place-items-center rounded-full text-base font-semibold text-[#071614]" style={{ background: item.color }}>
                {item.name.slice(0, 1)}
              </span>
              <span className="min-w-0 flex-1">
                <span className="flex items-center gap-2">
                  <span className={cn("min-w-0 flex-1 truncate text-[15px]", item.unreadCount || item.markedUnread ? "font-semibold" : "font-medium")}>
                    {item.name}
                  </span>
                  <span className="shrink-0 text-[11px] text-emerald-100/45">{formatChatTime(item.lastAt)}</span>
                </span>
                <span className="mt-0.5 flex items-center gap-2">
                  <span className="flex min-w-0 flex-1 items-center gap-1 truncate text-[13px] text-emerald-100/55">
                    <PreviewIcon kind={item.draft ? undefined : item.lastKind} />
                    <span className="truncate">
                      {item.draft ? "پیش‌نویس: " : ""}
                      {item.lastPreview || "بدون پیام"}
                    </span>
                  </span>
                  {(item.unreadCount > 0 || item.markedUnread) && (
                    <span className="grid min-w-5 place-items-center rounded-full bg-emerald-500 px-1.5 text-[11px] font-semibold text-white">
                      {item.unreadCount || 1}
                    </span>
                  )}
                </span>
              </span>
            </button>
          </div>
        ))}
      </div>
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
