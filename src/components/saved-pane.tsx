"use client";

import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { SAVED_TAGS, SAVED_VIEWS } from "@/lib/saved-types";

type Item = {
  id: string;
  kind: string;
  body: string;
  notes: string;
  linkUrl: string;
  linkHost: string;
  fileName: string;
  fileType: string;
  fileSize: number;
  hasMedia: boolean;
  mediaUrl: string;
  tag: string;
  tags: string[];
  folderId: string | null;
  bookmarked: boolean;
  favorite: boolean;
  pinned: boolean;
  createdAt: number;
  source: { type: string; name: string; id?: string; messageId?: string } | null;
  original: { canOpen: boolean; status: string; label: string };
  inTrash: boolean;
  copyrightNote: string;
};

type Folder = { id: string; name: string; icon: string; builtin: boolean };

async function post(body: Record<string, unknown>) {
  const res = await fetch("/api/saved", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  const data = await res.json();
  return { res, data };
}

export function SavedPane({ onClose, onJumpChat }: { onClose: () => void; onJumpChat?: (threadId: string, messageId?: string) => void }) {
  const [items, setItems] = useState<Item[]>([]);
  const [folders, setFolders] = useState<Folder[]>([]);
  const [q, setQ] = useState("");
  const [kind, setKind] = useState("all");
  const [tag, setTag] = useState("");
  const [folder, setFolder] = useState("");
  const [chatId, setChatId] = useState("");
  const [fromDate, setFromDate] = useState("");
  const [toDate, setToDate] = useState("");
  const [sort, setSort] = useState("newest");
  const [selected, setSelected] = useState<string[]>([]);
  const [body, setBody] = useState("");
  const [linkUrl, setLinkUrl] = useState("");
  const [newTag, setNewTag] = useState("Personal");
  const [folderName, setFolderName] = useState("");
  const [hasMore, setHasMore] = useState(false);
  const [offset, setOffset] = useState(0);
  const [busy, setBusy] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [storageBytes, setStorageBytes] = useState(0);
  const accountHint = "session";

  const load = useCallback(
    async (nextOffset = 0) => {
      setBusy(true);
      setError(null);
      try {
        const params = new URLSearchParams({ q, kind, sort, offset: String(nextOffset) });
        if (tag) params.set("tag", tag);
        if (folder) params.set("folder", folder);
        if (chatId) params.set("chatId", chatId);
        if (fromDate) params.set("fromDate", String(new Date(fromDate).getTime()));
        if (toDate) params.set("toDate", String(new Date(toDate).getTime() + 86_400_000));
        if (kind === "trash") params.set("trash", "1");
        const res = await fetch(`/api/saved?${params}`, { cache: "no-store" });
        const d = await res.json();
        if (!res.ok) {
          setError(d.error ?? "بارگذاری نشد.");
          return;
        }
        setItems(nextOffset === 0 ? (d.items ?? []) : (prev) => [...prev, ...(d.items ?? [])]);
        setFolders(d.folders ?? []);
        setHasMore(Boolean(d.hasMore));
        setOffset(d.nextOffset ?? nextOffset);
        setStorageBytes(d.storageBytes ?? 0);
        try {
          if (nextOffset === 0) {
            sessionStorage.setItem(`nixo-saved:${accountHint}`, JSON.stringify({ items: d.items ?? [], at: Date.now() }));
          }
        } catch {
          /* ignore */
        }
      } catch {
        setError("Network Error");
        try {
          const raw = sessionStorage.getItem(`nixo-saved:${accountHint}`);
          if (raw) setItems((JSON.parse(raw) as { items: Item[] }).items ?? []);
        } catch {
          /* ignore */
        }
      } finally {
        setBusy(false);
      }
    },
    [q, kind, sort, tag, folder, chatId, fromDate, toDate, accountHint],
  );

  useEffect(() => {
    const t = window.setTimeout(() => void load(0), 0);
    return () => window.clearTimeout(t);
  }, [load]);

  async function saveManual() {
    const isLink = /^https?:\/\//i.test(linkUrl.trim());
    const { res, data } = await post({
      kind: isLink && !body.trim() ? "link" : "text",
      body,
      linkUrl,
      tag: newTag,
    });
    if (!res.ok) {
      toast.error(data.error ?? "ذخیره نشد.");
      return;
    }
    setBody("");
    setLinkUrl("");
    toast.success("در Saved Messages ذخیره شد. مالکیت محتوا منتقل نمی‌شود.");
    void load(0);
  }

  async function remove(ids: string[], permanent = false) {
    if (permanent && !confirm("حذف دائمی؟ قابل بازیابی نخواهد بود.")) return;
    if (!permanent && !confirm("به سطل ۱۴روزه برود؟ پیام اصلی چت پاک نمی‌شود.")) return;
    await post({ action: "delete", ids, permanent });
    setSelected([]);
    void load(0);
  }

  function toggle(id: string) {
    setSelected((s) => (s.includes(id) ? s.filter((x) => x !== id) : [...s, id]));
  }

  return (
    <div className="flex h-full min-h-0 flex-col">
      <header className="flex items-center justify-between border-b border-white/10 px-4 py-3">
        <div>
          <p className="font-medium">Saved Messages</p>
          <p className="text-[11px] text-emerald-100/55">فقط این حساب · در جستجوی عمومی نیکسو نیست · {(storageBytes / 1024).toFixed(1)} KB</p>
        </div>
        <Button type="button" variant="ghost" className="text-white" onClick={onClose}>
          بستن
        </Button>
      </header>
      <div className="space-y-2 border-b border-white/10 p-3">
        <form
          className="flex gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            void load(0);
          }}
        >
          <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="جستجوی متن، نام فایل یا تگ" className="h-9 bg-black/20" />
          <Button type="submit" size="sm" variant="secondary">
            بجو
          </Button>
        </form>
        <div className="flex flex-wrap gap-1">
          {SAVED_VIEWS.map((k) => (
            <button
              key={k.id}
              type="button"
              className={`rounded-full px-2 py-0.5 text-[10px] ${kind === k.id ? "bg-amber-300 text-[#102824]" : "bg-white/10"}`}
              onClick={() => setKind(k.id)}
            >
              {k.label}
            </button>
          ))}
        </div>
        <div className="flex flex-wrap gap-1">
          <button type="button" className={`rounded-full px-2 py-0.5 text-[10px] ${!tag ? "bg-amber-300 text-[#102824]" : "bg-white/10"}`} onClick={() => setTag("")}>
            همه تگ‌ها
          </button>
          {SAVED_TAGS.map((t) => (
            <button
              key={t}
              type="button"
              className={`rounded-full px-2 py-0.5 text-[10px] ${tag === t ? "bg-amber-300 text-[#102824]" : "bg-white/10"}`}
              onClick={() => setTag(t)}
            >
              {t}
            </button>
          ))}
        </div>
        <div className="flex flex-wrap gap-1">
          <button type="button" className={`rounded-full px-2 py-0.5 text-[10px] ${!folder ? "bg-amber-300 text-[#102824]" : "bg-white/10"}`} onClick={() => setFolder("")}>
            همه پوشه‌ها
          </button>
          {folders.map((f) => (
            <button
              key={f.id}
              type="button"
              className={`rounded-full px-2 py-0.5 text-[10px] ${folder === f.id ? "bg-amber-300 text-[#102824]" : "bg-white/10"}`}
              onClick={() => setFolder(f.id)}
            >
              {f.icon} {f.name}
            </button>
          ))}
          {folder && folders.some((f) => f.id === folder && !f.builtin) && (
            <>
              <button
                type="button"
                className="rounded-full bg-white/10 px-2 py-0.5 text-[10px]"
                onClick={async () => {
                  const name = window.prompt("Folder Rename");
                  if (!name) return;
                  const { res, data } = await post({ action: "folder-save", id: folder, name });
                  if (!res.ok) toast.error(data.error);
                  else void load(0);
                }}
              >
                Rename
              </button>
              <button
                type="button"
                className="rounded-full bg-rose-300/20 px-2 py-0.5 text-[10px]"
                onClick={async () => {
                  if (!confirm("فقط پوشه حذف شود؟ Saved Messageها می‌مانند.")) return;
                  await post({ action: "folder-delete", id: folder });
                  setFolder("");
                  void load(0);
                }}
              >
                Delete Folder
              </button>
            </>
          )}
        </div>
        <div className="flex flex-wrap gap-2 text-[11px]">
          <select className="h-8 rounded bg-black/30 px-1" value={sort} onChange={(e) => setSort(e.target.value)}>
            <option value="newest">Newest</option>
            <option value="oldest">Oldest</option>
            <option value="saved">Recently Saved</option>
            <option value="type">File Type</option>
            <option value="chat">Chat</option>
          </select>
          <Input value={chatId} onChange={(e) => setChatId(e.target.value)} placeholder="Chat ID" className="h-8 w-28 bg-black/20 text-[11px]" dir="ltr" />
          <input type="date" className="h-8 rounded bg-black/30 px-1 text-[11px]" value={fromDate} onChange={(e) => setFromDate(e.target.value)} />
          <input type="date" className="h-8 rounded bg-black/30 px-1 text-[11px]" value={toDate} onChange={(e) => setToDate(e.target.value)} />
          <button type="button" className="rounded bg-white/10 px-2" onClick={() => void load(0)}>
            Refresh
          </button>
          <button
            type="button"
            className="rounded bg-white/10 px-2"
            onClick={() => {
              try {
                sessionStorage.removeItem(`nixo-saved:${accountHint}`);
                toast.success("کش پاک شد. دادهٔ اصلی ماند.");
              } catch {
                /* ignore */
              }
            }}
          >
            Cache Cleanup
          </button>
        </div>
        <div className="flex flex-wrap gap-2">
          <Input value={folderName} onChange={(e) => setFolderName(e.target.value)} placeholder="Custom Bookmark Folder" className="h-8 bg-black/20" />
          <Button
            type="button"
            size="sm"
            variant="secondary"
            className="h-8"
            onClick={async () => {
              const { res, data } = await post({ action: "folder-save", name: folderName });
              if (!res.ok) toast.error(data.error);
              else {
                setFolderName("");
                void load(0);
              }
            }}
          >
            Create Folder
          </Button>
        </div>
        {selected.length > 0 && (
          <div className="flex flex-wrap gap-2 text-[11px]">
            <Button type="button" size="sm" variant="secondary" onClick={() => void remove(selected)}>
              Bulk Delete
            </Button>
            <select
              className="h-8 rounded bg-black/30"
              onChange={(e) => {
                if (!e.target.value) return;
                void post({ action: "bulk-move", ids: selected, folderId: e.target.value }).then(() => load(0));
              }}
            >
              <option value="">Bulk Move</option>
              {folders.map((f) => (
                <option key={f.id} value={f.id}>
                  {f.name}
                </option>
              ))}
            </select>
            <Button
              type="button"
              size="sm"
              variant="secondary"
              onClick={() => {
                const text = items
                  .filter((i) => selected.includes(i.id))
                  .map((i) => i.body || i.linkUrl || i.fileName)
                  .join("\n");
                void navigator.clipboard.writeText(text);
                toast.message("برای هدایت/اشتراک کپی شد. حق نشر محتوا مال مؤلف اصلی است.");
              }}
            >
              Forward / Share
            </Button>
          </div>
        )}
      </div>
      <div className="min-h-0 flex-1 space-y-2 overflow-auto p-3">
        {busy && <p className="text-xs text-amber-200">Loading…</p>}
        {error && (
          <p className="text-xs text-rose-200">
            {error}{" "}
            <button type="button" className="text-amber-200" onClick={() => void load(0)}>
              Retry
            </button>
          </p>
        )}
        {!busy && items.length === 0 && <p className="text-xs text-emerald-100/50">No saved messages yet</p>}
        {items.map((item) => (
          <article key={item.id} className={`rounded-2xl bg-white/5 p-3 text-sm ${selected.includes(item.id) ? "ring-1 ring-amber-300" : ""}`}>
            <div className="flex items-start gap-2">
              <input type="checkbox" checked={selected.includes(item.id)} onChange={() => toggle(item.id)} />
              <div className="min-w-0 flex-1">
                <p className="text-[10px] text-amber-200">
                  {item.pinned ? "Pin · " : ""}
                  {item.favorite ? "★ " : ""}
                  {item.bookmarked ? "Bookmark · " : ""}
                  {item.kind}
                  {item.tag ? ` · ${item.tag}` : ""}
                  {item.source?.name ? ` · از ${item.source.name}` : ""}
                  {item.original.status === "deleted" ? " · Original deleted" : ""}
                  {item.original.status === "no-permission" ? " · بدون دسترسی به اصل" : ""}
                </p>
                <p className="mt-1 whitespace-pre-wrap">{item.body}</p>
                {item.notes && <p className="mt-1 text-[11px] text-emerald-100/70">یادداشت: {item.notes}</p>}
                {item.linkUrl && (
                  <a href={item.linkUrl} className="block text-xs text-sky-200 underline" target="_blank" rel="noreferrer noopener">
                    {item.linkHost || item.linkUrl} (پیش‌نمایش بدون اجرای محتوا)
                  </a>
                )}
                {item.hasMedia && item.kind === "photo" && (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={item.mediaUrl} alt="" className="mt-2 max-h-40 rounded-lg" />
                )}
                {item.hasMedia && item.kind === "video" && <video src={item.mediaUrl} controls className="mt-2 max-h-48 w-full rounded-lg" />}
                {item.hasMedia && (item.kind === "voice" || item.kind === "audio") && <audio src={item.mediaUrl} controls className="mt-2 w-full" />}
                {(item.fileName || item.fileSize > 0) && (
                  <p className="text-[11px] text-emerald-100/60">
                    {item.fileName || "فایل"} · {item.fileType || item.kind} · {item.fileSize} بایت
                  </p>
                )}
                <p className="text-[10px] text-emerald-100/40">{new Date(item.createdAt).toLocaleString("fa-IR")}</p>
                <div className="mt-2 flex flex-wrap gap-2 text-[11px]">
                  <button
                    type="button"
                    onClick={async () => {
                      await fetch(`/api/saved/${item.id}`, {
                        method: "PATCH",
                        headers: { "Content-Type": "application/json" },
                        body: JSON.stringify({ pinned: !item.pinned }),
                      });
                      void load(0);
                    }}
                  >
                    {item.pinned ? "Unpin" : "Pin"}
                  </button>
                  <button
                    type="button"
                    onClick={async () => {
                      await fetch(`/api/saved/${item.id}`, {
                        method: "PATCH",
                        headers: { "Content-Type": "application/json" },
                        body: JSON.stringify({ favorite: !item.favorite, bookmarked: true }),
                      });
                      void load(0);
                    }}
                  >
                    {item.favorite ? "Unfavorite" : "Favorite"}
                  </button>
                  <button
                    type="button"
                    onClick={async () => {
                      await fetch(`/api/saved/${item.id}`, {
                        method: "PATCH",
                        headers: { "Content-Type": "application/json" },
                        body: JSON.stringify({ bookmarked: !item.bookmarked }),
                      });
                      void load(0);
                    }}
                  >
                    {item.bookmarked ? "Remove Bookmark" : "Bookmark"}
                  </button>
                  {SAVED_TAGS.map((t) => (
                    <button
                      key={t}
                      type="button"
                      className={item.tag === t ? "text-amber-200" : "opacity-60"}
                      onClick={async () => {
                        await fetch(`/api/saved/${item.id}`, {
                          method: "PATCH",
                          headers: { "Content-Type": "application/json" },
                          body: JSON.stringify({ tag: t }),
                        });
                        void load(0);
                      }}
                    >
                      {t}
                    </button>
                  ))}
                  <button
                    type="button"
                    onClick={async () => {
                      const notes = window.prompt("Note خصوصی", item.notes);
                      if (notes == null) return;
                      await fetch(`/api/saved/${item.id}`, {
                        method: "PATCH",
                        headers: { "Content-Type": "application/json" },
                        body: JSON.stringify({ notes }),
                      });
                      void load(0);
                    }}
                  >
                    {item.notes ? "Edit Note" : "Note"}
                  </button>
                  {item.notes && (
                    <button
                      type="button"
                      onClick={async () => {
                        await fetch(`/api/saved/${item.id}`, {
                          method: "PATCH",
                          headers: { "Content-Type": "application/json" },
                          body: JSON.stringify({ notes: "" }),
                        });
                        void load(0);
                      }}
                    >
                      Delete Note
                    </button>
                  )}
                  {item.hasMedia && (
                    <a href={item.mediaUrl} download={item.fileName || "saved"} className="text-amber-200">
                      Download
                    </a>
                  )}
                  {item.original.canOpen && item.source?.type === "chat" && onJumpChat && item.source.id && (
                    <button type="button" onClick={() => onJumpChat(item.source!.id!, item.source!.messageId)}>
                      Open Original
                    </button>
                  )}
                  {item.inTrash && (
                    <button
                      type="button"
                      onClick={async () => {
                        await fetch(`/api/saved/${item.id}`, {
                          method: "PATCH",
                          headers: { "Content-Type": "application/json" },
                          body: JSON.stringify({ action: "restore" }),
                        });
                        void load(0);
                      }}
                    >
                      Restore
                    </button>
                  )}
                  <button
                    type="button"
                    onClick={async () => {
                      await fetch(`/api/saved/${item.id}`, {
                        method: "PATCH",
                        headers: { "Content-Type": "application/json" },
                        body: JSON.stringify({ action: "report", category: "other" }),
                      });
                      toast.message("گزارش ثبت شد.");
                    }}
                  >
                    Report
                  </button>
                  <button type="button" className="text-rose-200" onClick={() => void remove([item.id], item.inTrash)}>
                    {item.inTrash ? "Permanent Delete" : "Unsave"}
                  </button>
                </div>
              </div>
            </div>
          </article>
        ))}
        {hasMore && (
          <Button type="button" variant="secondary" className="w-full" onClick={() => void load(offset)}>
            بیشتر
          </Button>
        )}
      </div>
      <div className="space-y-2 border-t border-white/10 p-3">
        <Textarea value={body} onChange={(e) => setBody(e.target.value)} placeholder="متن برای ذخیرهٔ شخصی" className="min-h-16 bg-black/20" />
        <Input value={linkUrl} onChange={(e) => setLinkUrl(e.target.value)} placeholder="لینک https://" dir="ltr" className="h-9 bg-black/20 text-left text-xs" />
        <div className="flex items-center gap-2">
          <select className="rounded bg-black/30 px-2 py-1 text-xs" value={newTag} onChange={(e) => setNewTag(e.target.value)}>
            {SAVED_TAGS.map((t) => (
              <option key={t} value={t}>
                {t}
              </option>
            ))}
          </select>
          <Button type="button" className="flex-1 bg-amber-300 text-[#102824]" onClick={() => void saveManual()}>
            Save Message
          </Button>
        </div>
        <button
          type="button"
          className="text-[10px] text-rose-200"
          onClick={async () => {
            const phrase = window.prompt("برای حذف همه بنویس: حذف همه");
            if (!phrase) return;
            const { res, data } = await post({ action: "delete-all", confirm: phrase });
            if (!res.ok) toast.error(data.error);
            else void load(0);
          }}
        >
          Delete All Saved Messages
        </button>
      </div>
    </div>
  );
}
