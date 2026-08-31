"use client";

import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { SAVED_TAGS } from "@/lib/search-types";

type Item = {
  id: string;
  kind: string;
  body: string;
  linkUrl: string;
  fileName: string;
  fileType: string;
  fileSize: number;
  tag: string;
  pinned: boolean;
  createdAt: number;
  source: { type: string; name: string; id?: string } | null;
};

const KINDS = [
  { id: "all", label: "همه" },
  { id: "text", label: "متن" },
  { id: "message", label: "پیام" },
  { id: "photo", label: "عکس" },
  { id: "video", label: "ویدیو" },
  { id: "file", label: "فایل" },
  { id: "link", label: "لینک" },
  { id: "voice", label: "صوت" },
];

export function SavedPane({ onClose, onJumpChat }: { onClose: () => void; onJumpChat?: (threadId: string, messageId?: string) => void }) {
  const [items, setItems] = useState<Item[]>([]);
  const [q, setQ] = useState("");
  const [kind, setKind] = useState("all");
  const [tag, setTag] = useState("");
  const [selected, setSelected] = useState<string[]>([]);
  const [body, setBody] = useState("");
  const [linkUrl, setLinkUrl] = useState("");
  const [newTag, setNewTag] = useState("Personal");
  const [hasMore, setHasMore] = useState(false);
  const [offset, setOffset] = useState(0);

  function load(nextOffset = 0, seed = q) {
    const params = new URLSearchParams({ q: seed, kind, offset: String(nextOffset) });
    if (tag) params.set("tag", tag);
    fetch(`/api/saved?${params}`, { cache: "no-store" })
      .then((r) => r.json())
      .then((d) => {
        setItems(nextOffset === 0 ? (d.items ?? []) : (prev) => [...prev, ...(d.items ?? [])]);
        setHasMore(Boolean(d.hasMore));
        setOffset(d.nextOffset ?? nextOffset);
      })
      .catch(() => undefined);
  }

  useEffect(() => {
    load(0);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- reload when filters change
  }, [kind, tag]);

  async function saveManual() {
    const isLink = /^https?:\/\//i.test(linkUrl.trim());
    const res = await fetch("/api/saved", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        kind: isLink && !body.trim() ? "link" : "text",
        body,
        linkUrl,
        tag: newTag,
      }),
    });
    const data = await res.json();
    if (!res.ok) {
      toast.error(data.error ?? "ذخیره نشد.");
      return;
    }
    setBody("");
    setLinkUrl("");
    toast.success("در Saved Messages ذخیره شد.");
    load(0);
  }

  async function remove(ids: string[]) {
    if (!confirm("موارد انتخاب‌شده حذف شوند؟")) return;
    await fetch("/api/saved", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "delete", ids }),
    });
    setSelected([]);
    load(0);
  }

  function toggle(id: string) {
    setSelected((s) => (s.includes(id) ? s.filter((x) => x !== id) : [...s, id]));
  }

  return (
    <div className="flex h-full min-h-0 flex-col">
      <header className="flex items-center justify-between border-b border-white/10 px-4 py-3">
        <div>
          <p className="font-medium">پیام‌های ذخیره‌شده</p>
          <p className="text-[11px] text-emerald-100/55">فقط برای این حساب. دیگران نمی‌بینند.</p>
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
            load(0);
          }}
        >
          <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="جستجو در ذخیره‌شده‌ها" className="h-9 bg-black/20" />
          <Button type="submit" size="sm" variant="secondary">
            بجو
          </Button>
        </form>
        <div className="flex flex-wrap gap-1">
          {KINDS.map((k) => (
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
            همه برچسب‌ها
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
        {selected.length > 0 && (
          <div className="flex flex-wrap gap-2 text-[11px]">
            <Button type="button" size="sm" variant="secondary" onClick={() => void remove(selected)}>
              حذف
            </Button>
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
                toast.message("برای هدایت/اشتراک کپی شد.");
              }}
            >
              هدایت / اشتراک
            </Button>
          </div>
        )}
      </div>
      <div className="min-h-0 flex-1 space-y-2 overflow-auto p-3">
        {items.length === 0 && <p className="text-xs text-emerald-100/50">هنوز چیزی ذخیره نکرده‌ای.</p>}
        {items.map((item) => (
          <article key={item.id} className={`rounded-2xl bg-white/5 p-3 text-sm ${selected.includes(item.id) ? "ring-1 ring-amber-300" : ""}`}>
            <div className="flex items-start gap-2">
              <input type="checkbox" checked={selected.includes(item.id)} onChange={() => toggle(item.id)} />
              <div className="min-w-0 flex-1">
                <p className="text-[10px] text-amber-200">
                  {item.pinned ? "پین · " : ""}
                  {item.kind}
                  {item.tag ? ` · ${item.tag}` : ""}
                  {item.source?.name ? ` · از ${item.source.name}` : ""}
                </p>
                <p className="mt-1 whitespace-pre-wrap">{item.body}</p>
                {item.linkUrl && (
                  <a href={item.linkUrl} className="block text-xs text-sky-200 underline" target="_blank" rel="noreferrer">
                    {item.linkUrl}
                  </a>
                )}
                {(item.fileName || item.fileSize > 0) && (
                  <p className="text-[11px] text-emerald-100/60">
                    {item.fileName || "فایل"} · {item.fileType || item.kind} · {item.fileSize} بایت ·{" "}
                    {new Date(item.createdAt).toLocaleString("fa-IR")}
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
                      load(0);
                    }}
                  >
                    {item.pinned ? "برداشتن پین" : "پین"}
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
                        load(0);
                      }}
                    >
                      {t}
                    </button>
                  ))}
                  {item.source?.type === "chat" && onJumpChat && item.source.id && (
                    <button type="button" onClick={() => onJumpChat(item.source!.id!)}>
                      رفتن به گفتگو
                    </button>
                  )}
                  <button type="button" className="text-rose-200" onClick={() => void remove([item.id])}>
                    حذف
                  </button>
                </div>
              </div>
            </div>
          </article>
        ))}
        {hasMore && (
          <Button type="button" variant="secondary" className="w-full" onClick={() => load(offset)}>
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
            ذخیره در Saved Messages
          </Button>
        </div>
      </div>
    </div>
  );
}
