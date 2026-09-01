"use client";

import { useCallback, useEffect, useRef, useState } from "react";
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
  dm: "Private",
  group: "Groups",
  channel: "Channels",
  community: "Groups",
  bot: "Bots",
  business: "Business",
};

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
  const [select, setSelect] = useState(false);
  const [picked, setPicked] = useState<string[]>([]);
  const [composer, setComposer] = useState(false);
  const [editId, setEditId] = useState<string | null>(null);
  const [fname, setFname] = useState("");
  const [ficon, setFicon] = useState("📁");
  const [ftypes, setFtypes] = useState<string[]>(["dm"]);
  const [funread, setFunread] = useState(false);
  const [ffav, setFfav] = useState(false);
  const [fmuted, setFmuted] = useState(false);
  const [fexclude, setFexclude] = useState("");
  const [sort, setSort] = useState("recent");
  const [scopeAll, setScopeAll] = useState(false);
  const [moveFolder, setMoveFolder] = useState("");
  const startX = useRef(0);

  const load = useCallback(async () => {
    setBusy(true);
    setError(null);
    try {
      const scope = scopeAll && query.trim() ? "all" : "folder";
      const res = await fetch(
        `/api/inbox?folder=${encodeURIComponent(folder)}&q=${encodeURIComponent(query)}&scope=${scope}`,
        { cache: "no-store" },
      );
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? "بارگذاری نشد.");
        return;
      }
      setFolders(data.folders ?? []);
      setItems(data.items ?? []);
      if (data.prefs?.sort) setSort(data.prefs.sort);
      try {
        sessionStorage.setItem(`nixo-inbox:${accountId}`, JSON.stringify({ folders: data.folders, items: data.items, at: Date.now() }));
      } catch {
        /* private cache is session-bound */
      }
    } catch {
      setError("Network Error");
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
  }, [folder, query, scopeAll, accountId]);

  useEffect(() => {
    const t = window.setTimeout(() => void load(), 0);
    return () => window.clearTimeout(t);
  }, [load]);

  async function act(key: string, action: string, extra: Record<string, unknown> = {}) {
    const { res, data } = await post({ key, action, ...extra });
    if (!res.ok) toast.error(data.error ?? "انجام نشد.");
    else void load();
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

  const customFolders = folders.filter((f) => !f.builtin);
  const current = folders.find((f) => f.id === folder);

  return (
    <div className="space-y-2 px-2 pb-24">
      <div className="flex gap-1 overflow-x-auto pb-1">
        {folders.map((f, idx) => (
          <div key={f.id} className="flex shrink-0 items-center">
            <button
              type="button"
              onClick={() => setFolder(f.id)}
              onDoubleClick={() => {
                if (!f.builtin) openComposer(f);
              }}
              className={cn("rounded-full px-2 py-1 text-[11px]", folder === f.id ? "bg-amber-300 text-[#102824]" : "bg-white/10")}
            >
              {f.icon} {f.name}
            </button>
            <button
              type="button"
              className="px-0.5 text-[10px] text-emerald-100/40"
              aria-label="جابه‌جایی پوشه به چپ"
              onClick={() => {
                const ids = folders.map((x) => x.id);
                if (idx === 0) return;
                [ids[idx - 1], ids[idx]] = [ids[idx]!, ids[idx - 1]!];
                void post({ action: "folder-reorder", ids }).then(load);
              }}
            >
              ‹
            </button>
          </div>
        ))}
        <button type="button" className="shrink-0 rounded-full bg-white/10 px-2 py-1 text-[11px]" onClick={() => openComposer()}>
          + Folder
        </button>
      </div>
      <div className="flex flex-wrap items-center gap-1 text-[11px]">
        <select
          value={sort}
          className="h-7 rounded-lg bg-black/30 px-1"
          onChange={(e) => {
            const v = e.target.value;
            setSort(v);
            void post({ action: "prefs", sort: v }).then(load);
          }}
        >
          <option value="recent">Recent Activity</option>
          <option value="unread">Unread</option>
          <option value="name">Name</option>
          <option value="favorites">Favorites</option>
        </select>
        <label className="flex items-center gap-1">
          <input type="checkbox" checked={scopeAll} onChange={(e) => setScopeAll(e.target.checked)} />
          Search Across Folders
        </label>
        <button type="button" className="rounded bg-white/10 px-2 py-1" onClick={() => setSelect((s) => !s)}>
          {select ? "لغو انتخاب" : "چندتایی"}
        </button>
        <button type="button" className="rounded bg-white/10 px-2 py-1" onClick={() => void load()}>
          Refresh
        </button>
        {current && !current.builtin && (
          <>
            <button type="button" className="rounded bg-white/10 px-2 py-1" onClick={() => openComposer(current)}>
              Edit Folder
            </button>
            <button
              type="button"
              className="rounded bg-rose-300/20 px-2 py-1"
              onClick={() => {
                if (!confirm("فقط پوشه حذف شود؟ گفتگوها باقی می‌مانند.")) return;
                void post({ action: "folder-delete", id: current.id }).then(() => {
                  setFolder("all");
                  void load();
                });
              }}
            >
              Delete Folder
            </button>
          </>
        )}
      </div>
      {composer && (
        <form
          className="rounded-2xl bg-white/5 p-3 text-xs"
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
              toast.success(editId ? "پوشه به‌روز شد." : "پوشه ساخته شد.");
              setComposer(false);
              void load();
            }
          }}
        >
          <p className="font-medium">{editId ? "Folder Edit" : "Create Folder"}</p>
          <Input value={fname} onChange={(e) => setFname(e.target.value)} placeholder="Folder Name" className="mt-2 h-8 bg-black/20" />
          <div className="mt-2 flex flex-wrap gap-1">
            {FOLDER_ICONS.map((ic) => (
              <button key={ic} type="button" className={cn("size-8 rounded-lg", ficon === ic ? "bg-amber-300/40" : "bg-white/10")} onClick={() => setFicon(ic)}>
                {ic}
              </button>
            ))}
          </div>
          <p className="mt-2 text-emerald-100/55">Include Rules</p>
          <div className="mt-1 flex flex-wrap gap-2">
            {INBOX_KINDS.map((k) => (
              <label key={k} className="flex items-center gap-1">
                <input type="checkbox" checked={ftypes.includes(k)} onChange={(e) => setFtypes((t) => (e.target.checked ? [...t, k] : t.filter((x) => x !== k)))} />
                {KIND_LABEL[k] ?? k}
              </label>
            ))}
            <label className="flex items-center gap-1">
              <input type="checkbox" checked={funread} onChange={(e) => setFunread(e.target.checked)} />
              Unread Chats
            </label>
            <label className="flex items-center gap-1">
              <input type="checkbox" checked={ffav} onChange={(e) => setFfav(e.target.checked)} />
              Favorites
            </label>
            <label className="flex items-center gap-1">
              <input type="checkbox" checked={fmuted} onChange={(e) => setFmuted(e.target.checked)} />
              Folder Notifications off
            </label>
          </div>
          <Input
            value={fexclude}
            onChange={(e) => setFexclude(e.target.value)}
            placeholder="Exclude: کلید گفتگو با ویرگول"
            className="mt-2 h-8 bg-black/20"
          />
          <div className="mt-2 flex gap-2">
            <Button type="submit" size="sm" className="h-8 bg-amber-300 text-[#102824]">
              Save
            </Button>
            <Button type="button" size="sm" variant="secondary" className="h-8" onClick={() => setComposer(false)}>
              انصراف
            </Button>
          </div>
        </form>
      )}
      {select && picked.length > 0 && (
        <div className="flex flex-wrap gap-1 text-[11px]">
          {["read", "unread", "archive", "mute"].map((a) => (
            <button
              key={a}
              type="button"
              className="rounded bg-amber-300/20 px-2 py-1"
              onClick={() => void post({ action: "bulk", bulk: a, keys: picked, ms: 60 * 60_000 }).then(load)}
            >
              {a}
            </button>
          ))}
          <select className="h-7 rounded bg-black/30" value={moveFolder} onChange={(e) => setMoveFolder(e.target.value)}>
            <option value="">Move to Folder</option>
            {customFolders.map((f) => (
              <option key={f.id} value={f.id}>
                {f.name}
              </option>
            ))}
          </select>
          {moveFolder && (
            <button
              type="button"
              className="rounded bg-amber-300/20 px-2 py-1"
              onClick={() => void post({ action: "bulk", bulk: "move", keys: picked, folderId: moveFolder }).then(load)}
            >
              انتقال
            </button>
          )}
          <button
            type="button"
            className="rounded bg-rose-300/20 px-2 py-1"
            onClick={() => {
              if (!confirm("چت‌های انتخاب‌شده از فهرست تو حذف شوند؟ حساب طرف پاک نمی‌شود.")) return;
              void post({ action: "bulk", bulk: "delete", keys: picked, confirm: true }).then(load);
            }}
          >
            Delete
          </button>
        </div>
      )}
      {busy && <p className="px-3 py-6 text-center text-xs text-amber-200">Loading…</p>}
      {error && (
        <div className="px-3 text-center text-xs text-rose-200">
          {error}
          <button type="button" className="mr-2 text-amber-200" onClick={() => void load()}>
            Retry
          </button>
        </div>
      )}
      {!busy && items.length === 0 && <p className="px-3 py-8 text-center text-sm text-emerald-100/55">No chats in this folder</p>}
      {items.map((item) => (
        <div
          key={item.key}
          className={cn("relative overflow-hidden rounded-2xl", activeKey === item.key ? "bg-emerald-400/12" : "hover:bg-white/5")}
          onTouchStart={(e) => {
            startX.current = e.changedTouches[0]?.clientX ?? 0;
          }}
          onTouchEnd={(e) => {
            const dx = (e.changedTouches[0]?.clientX ?? 0) - startX.current;
            if (dx > 64) void act(item.key, item.unreadCount || item.markedUnread ? "read" : "unread");
            if (dx < -64) void act(item.key, item.archived ? "unarchive" : "archive");
          }}
        >
          <div className="flex w-full items-center gap-3 px-3 py-3">
            {select && (
              <input
                type="checkbox"
                checked={picked.includes(item.key)}
                onChange={(e) => setPicked((p) => (e.target.checked ? [...p, item.key] : p.filter((k) => k !== item.key)))}
              />
            )}
            <button type="button" className="flex min-w-0 flex-1 items-center gap-3 text-right" onClick={() => onOpen(item)}>
              <span className="grid size-11 place-items-center rounded-2xl text-sm font-semibold text-[#071614]" style={{ background: item.color }}>
                {item.name.slice(0, 1)}
              </span>
              <span className="min-w-0 flex-1">
                <span className="flex items-center justify-between gap-2">
                  <span className="truncate font-medium">
                    {item.pinned ? "📌 " : ""}
                    {item.favorite ? "★ " : ""}
                    {item.muted ? "🔇 " : ""}
                    {item.name}
                    {item.e2ee ? <span className="mr-1 text-[10px] text-amber-200">E2EE</span> : null}
                    {item.kind === "dm" ? <span className="mr-1 text-[10px] text-emerald-200/70">🔒</span> : null}
                    {item.replyFlag ? <span className="mr-1 text-[10px] text-sky-200">↩</span> : null}
                  </span>
                  <span className="shrink-0 text-[10px] text-emerald-100/45">{clock(item.lastAt)}</span>
                </span>
                <span className="mt-0.5 block truncate text-xs text-emerald-100/60">
                  {item.draft ? <span className="text-amber-200">Draft · </span> : null}
                  {item.lastPreview}
                  {item.labels.length ? <span className="mr-1 text-amber-100/50"> · {item.labels.join(" ")}</span> : null}
                </span>
              </span>
              {(item.unreadCount > 0 || item.markedUnread) && (
                <span className="grid min-w-5 place-items-center rounded-full bg-amber-300 px-1 text-[10px] text-[#102824]">{item.unreadCount || 1}</span>
              )}
              {item.mentionCount > 0 && <span className="text-[10px] text-sky-200">@{item.mentionCount}</span>}
            </button>
          </div>
          <div className="flex flex-wrap gap-1 px-3 pb-2 text-[10px]">
            <button type="button" onClick={() => void act(item.key, item.unreadCount || item.markedUnread ? "read" : "unread")}>
              {item.unreadCount || item.markedUnread ? "Mark Read" : "Unread"}
            </button>
            <button type="button" onClick={() => void act(item.key, item.pinned ? "unpin" : "pin")}>
              {item.pinned ? "Unpin" : "Pin"}
            </button>
            <button type="button" onClick={() => void act(item.key, item.archived ? "unarchive" : "archive")}>
              {item.archived ? "Unarchive" : "Archive"}
            </button>
            <button type="button" onClick={() => void act(item.key, "favorite", { on: !item.favorite })}>
              Favorite
            </button>
            {MUTE_CHAT_PRESETS.map((p) => (
              <button key={p.id} type="button" onClick={() => void act(item.key, "mute", { ms: p.ms })}>
                Mute {p.label}
              </button>
            ))}
            <button type="button" onClick={() => void act(item.key, "unmute")}>
              Unmute
            </button>
            <button
              type="button"
              onClick={() => {
                const notes = window.prompt("یادداشت خصوصی این چت (فقط برای تو)", item.notes);
                if (notes == null) return;
                void act(item.key, "notes", { notes });
              }}
            >
              Note
            </button>
            <button
              type="button"
              onClick={() => {
                const labels = window.prompt("برچسب‌ها با ویرگول", item.labels.join(","));
                if (labels == null) return;
                void act(item.key, "labels", { labels: labels.split(",").map((s) => s.trim()).filter(Boolean) });
              }}
            >
              Label
            </button>
            <button
              type="button"
              onClick={() => {
                if (!confirm("پیام‌های این گفتگو برای تو پاک شود؟ طرف مقابل پیام‌هایش را نگه می‌دارد.")) return;
                void act(item.key, "clear", { confirm: true });
              }}
            >
              Clear Chat
            </button>
            <button
              type="button"
              onClick={() => {
                if (!confirm("از فهرست تو حذف شود؟ حساب و چت طرف پاک نمی‌شود.")) return;
                void act(item.key, "delete");
              }}
            >
              Delete
            </button>
          </div>
        </div>
      ))}
    </div>
  );
}
