"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Plus } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";

type Contact = {
  id: string;
  nixoUserId: string | null;
  name: string;
  phone: string;
  email: string;
  username: string;
  notes: string;
  custom: Record<string, string>;
  labels: string[];
  group: string;
  favorite: boolean;
  localPhoto: string;
  source: string;
  createdAt: number;
  updatedAt: number;
  lastContactedAt: number;
  nickname: string | null;
  mutedUntil: number | null;
  notifyPreview: boolean;
  notifySound: boolean;
};

type RequestRow = {
  id: string;
  fromUserId: string;
  toUserId: string;
  peer: { displayName: string; username: string | null; id: string } | null;
};

const GROUPS = [
  { id: "", label: "همه" },
  { id: "family", label: "خانواده" },
  { id: "friends", label: "دوستان" },
  { id: "work", label: "کار" },
  { id: "custom", label: "سفارشی" },
];

async function api(action: string, extra: Record<string, unknown> = {}) {
  const res = await fetch("/api/contacts", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ action, ...extra }),
  });
  const data = await res.json();
  return { res, data };
}

const emptyForm = {
  name: "",
  phone: "",
  email: "",
  username: "",
  notes: "",
  group: "",
  labels: "",
  custom: "",
  nickname: "",
};

export function ContactsDesk() {
  const router = useRouter();
  const [q, setQ] = useState("");
  const sort = "name";
  const group = "";
  const [contacts, setContacts] = useState<Contact[]>([]);
  const [duplicates, setDuplicates] = useState<string[][]>([]);
  const [requestsIn, setRequestsIn] = useState<RequestRow[]>([]);
  const [requestsOut, setRequestsOut] = useState<RequestRow[]>([]);
  const [friends, setFriends] = useState<{ id: string; displayName: string; username: string | null }[]>([]);
  const [friendCount, setFriendCount] = useState(0);
  const [invites, setInvites] = useState<{ token: string; expiresAt: number | null; revokedAt: number | null; path: string }[]>([]);
  const [hasMore, setHasMore] = useState(false);
  const [cursor, setCursor] = useState<string | null>(null);
  const [permission, setPermission] = useState("unknown");
  const [syncEnabled, setSyncEnabled] = useState(false);
  const [form, setForm] = useState(emptyForm);
  const [editing, setEditing] = useState<Contact | null>(null);
  const [userLookup, setUserLookup] = useState("");
  const [idLookup, setIdLookup] = useState("");
  const [inviteUrl, setInviteUrl] = useState("");
  const [suggestions, setSuggestions] = useState<{ id: string; username: string | null; displayName: string }[]>([]);
  const [photo, setPhoto] = useState("");
  const [busy, setBusy] = useState(false);
  const [addOpen, setAddOpen] = useState(false);
  const [toolsOpen, setToolsOpen] = useState(false);
  const [menu, setMenu] = useState<{ id: string; x: number; y: number } | null>(null);
  const pressTimer = useRef<number | null>(null);

  const load = useCallback(async () => {
    const params = new URLSearchParams({ q, sort });
    if (group) params.set("group", group);
    const res = await fetch(`/api/contacts?${params}`);
    const data = await res.json();
    if (!data.ok) return;
    setContacts(data.contacts ?? []);
    setDuplicates(data.duplicates ?? []);
    setRequestsIn(data.requestsIn ?? []);
    setRequestsOut(data.requestsOut ?? []);
    setFriends(data.friends ?? []);
    setFriendCount(data.friendCount ?? 0);
    setInvites(data.invites ?? []);
    setHasMore(Boolean(data.hasMore));
    setCursor(data.nextCursor ?? null);
    setPermission(data.permission ?? "unknown");
    setSyncEnabled(Boolean(data.syncEnabled));
  }, [q, sort, group]);

  useEffect(() => {
    const t = window.setTimeout(() => void load(), 0);
    fetch("/api/contacts?action=suggestions")
      .then((r) => r.json())
      .then((d) => setSuggestions(d.suggestions ?? []))
      .catch(() => undefined);
    return () => window.clearTimeout(t);
  }, [load]);

  const alphaGroups = useMemo(() => {
    const sorted = [...contacts].sort((a, b) => (a.nickname || a.name).localeCompare(b.nickname || b.name, "fa"));
    const map = new Map<string, Contact[]>();
    for (const c of sorted) {
      const letter = ((c.nickname || c.name).trim().slice(0, 1) || "#").toLocaleUpperCase("fa-IR");
      const arr = map.get(letter) ?? [];
      arr.push(c);
      map.set(letter, arr);
    }
    return [...map.entries()];
  }, [contacts]);

  async function save() {
    setBusy(true);
    const custom: Record<string, string> = {};
    form.custom.split("\n").forEach((line) => {
      const [k, ...rest] = line.split(":");
      if (k && rest.length) custom[k.trim()] = rest.join(":").trim();
    });
    const { res, data } = await api("save", {
      id: editing?.id,
      name: form.name,
      phone: form.phone,
      email: form.email,
      username: form.username,
      notes: form.notes,
      group: form.group,
      labels: form.labels.split(",").map((s) => s.trim()).filter(Boolean),
      custom,
      nickname: form.nickname || null,
      localPhoto: photo,
      updatedAt: editing?.updatedAt,
      force: false,
    });
    setBusy(false);
    if (res.status === 409) {
      if (confirm("نسخهٔ دیگری از این مخاطب روی دستگاه دیگر جدیدتر است. بازنویسی شود؟")) {
        await api("save", { ...data.contact, id: editing?.id, force: true, notes: form.notes, name: form.name });
      } else return;
    } else if (!res.ok) {
      toast.error(data.error ?? "ذخیره نشد.");
      return;
    }
    toast.success("مخاطب ذخیره شد.");
    setForm(emptyForm);
    setEditing(null);
    setPhoto("");
    setAddOpen(false);
    void load();
  }

  async function openChat(c: Contact, kind?: "voice" | "video") {
    const { res, data } = await api("open-chat", { contactId: c.id });
    if (!res.ok) {
      toast.message(data.error ?? "گفتگو باز نشد.");
      return;
    }
    if (kind && data.thread?.id) {
      await fetch("/api/calls", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ threadId: data.thread.id, kind }),
      });
    }
    router.push("/app");
  }

  async function pickPhoneContacts() {
    const nav = navigator as Navigator & {
      contacts?: { select: (p: string[], o: { multiple: boolean }) => Promise<{ name?: string[]; tel?: string[]; email?: string[] }[]> };
    };
    if (!nav.contacts) {
      await api("permission", { permission: "unknown" });
      toast.message("این مرورگر Contact Picker ندارد. نیکسو بدون مجوز سیستم‌عامل به دفترچه گوشی دسترسی ندارد.");
      return;
    }
    try {
      const picked = await nav.contacts.select(["name", "tel", "email"], { multiple: true });
      const rows = picked.map((p) => ({
        name: p.name?.[0] ?? "",
        phone: p.tel?.[0] ?? "",
        email: p.email?.[0] ?? "",
      }));
      await fetch("/api/privacy", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ contactSyncEnabled: true }),
      });
      const { res, data } = await api("sync-phone", { rows, permission: "limited" });
      if (!res.ok) toast.error(data.error);
      else toast.success(`همگام شد: ${data.imported ?? 0} مخاطب جدید`);
      void load();
    } catch {
      await api("permission", { permission: "deny" });
      toast.message("مجوز مخاطبین رد یا لغو شد. نیکسو دیگر دفترچه گوشی را نمی‌خواند.");
      void load();
    }
  }

  async function makeInvite() {
    const { res, data } = await api("invite", { maxUses: 20, ttlMs: 7 * 24 * 60 * 60_000 });
    if (!res.ok) {
      toast.error(data.error);
      return;
    }
    const url = `${window.location.origin}${data.invite.path}`;
    setInviteUrl(url);
    try {
      if (navigator.share) await navigator.share({ title: "دعوت نیکسو", text: "به نیکسو بیا.", url });
      else await navigator.clipboard.writeText(url);
      toast.success("لینک دعوت آماده است.");
    } catch {
      await navigator.clipboard.writeText(url);
    }
  }

  function edit(c: Contact) {
    setEditing(c);
    setForm({
      name: c.name,
      phone: c.phone,
      email: c.email,
      username: c.username,
      notes: c.notes,
      group: c.group,
      labels: c.labels.join(", "),
      custom: Object.entries(c.custom ?? {})
        .map(([k, v]) => `${k}: ${v}`)
        .join("\n"),
      nickname: c.nickname ?? "",
    });
    setPhoto(c.localPhoto);
    setAddOpen(true);
  }

  const menuContact = menu ? contacts.find((c) => c.id === menu.id) : undefined;

  useEffect(() => {
    const close = () => setMenu(null);
    window.addEventListener("click", close);
    return () => window.removeEventListener("click", close);
  }, []);

  return (
    <div className="relative mx-auto min-h-dvh max-w-3xl bg-[#071614] text-emerald-50">
      <header className="flex items-center gap-3 px-4 pb-2 pt-4">
        <h1 className="flex-1 text-xl font-semibold">مخاطبین</h1>
        <button type="button" className="text-xs text-emerald-100/60" onClick={() => setToolsOpen(true)}>
          بیشتر
        </button>
        <button
          type="button"
          className="grid size-10 place-items-center rounded-full bg-amber-300 text-[#102824]"
          aria-label="افزودن مخاطب"
          onClick={() => {
            setEditing(null);
            setForm(emptyForm);
            setPhoto("");
            setAddOpen(true);
          }}
        >
          <Plus className="size-5" />
        </button>
      </header>
      <div className="px-4 pb-3">
        <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="جستجو" className="h-10 rounded-full bg-white/10" />
      </div>
      <ul className="pb-24">
        {alphaGroups.length === 0 && <li className="px-4 py-16 text-center text-sm text-emerald-100/50">مخاطبی نیست</li>}
        {alphaGroups.map(([letter, rows]) => (
          <li key={letter}>
            <p className="sticky top-0 z-10 bg-[#071614] px-4 py-1 text-[12px] font-semibold text-amber-200/90">{letter}</p>
            {rows.map((c) => (
              <button
                key={c.id}
                type="button"
                className="flex w-full items-center gap-3 px-4 py-2.5 text-right hover:bg-white/5"
                onClick={() => void openChat(c)}
                onContextMenu={(e) => {
                  e.preventDefault();
                  setMenu({ id: c.id, x: e.clientX, y: e.clientY });
                }}
                onTouchStart={(e) => {
                  const t = e.changedTouches[0];
                  if (pressTimer.current) window.clearTimeout(pressTimer.current);
                  pressTimer.current = window.setTimeout(() => {
                    if (t) setMenu({ id: c.id, x: t.clientX, y: t.clientY });
                  }, 480);
                }}
                onTouchEnd={() => {
                  if (pressTimer.current) window.clearTimeout(pressTimer.current);
                }}
                onTouchMove={() => {
                  if (pressTimer.current) window.clearTimeout(pressTimer.current);
                }}
              >
                <span className="grid size-12 shrink-0 place-items-center overflow-hidden rounded-full bg-emerald-900 text-lg">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  {c.localPhoto ? <img src={c.localPhoto} alt="" className="size-full object-cover" /> : (c.nickname || c.name).slice(0, 1)}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[15px] font-medium">{c.nickname || c.name}</span>
                  <span className="mt-0.5 block truncate text-[12px] text-emerald-100/50" dir="ltr">
                    {c.username ? `@${c.username}` : c.phone || c.email || " "}
                  </span>
                </span>
              </button>
            ))}
          </li>
        ))}
      </ul>
      {hasMore && (
        <div className="px-4 pb-8">
          <Button
            type="button"
            variant="secondary"
            className="w-full"
            onClick={async () => {
              const params = new URLSearchParams({ q, sort });
              if (group) params.set("group", group);
              if (cursor) params.set("cursor", cursor);
              const res = await fetch(`/api/contacts?${params}`);
              const data = await res.json();
              setContacts((prev) => [...prev, ...(data.contacts ?? [])]);
              setHasMore(Boolean(data.hasMore));
              setCursor(data.nextCursor ?? null);
            }}
          >
            مخاطبین بیشتر
          </Button>
        </div>
      )}

      {menu && menuContact && (
        <div
          className="fixed z-50 min-w-48 overflow-hidden rounded-2xl border border-white/10 bg-[#122e2a] py-1 text-sm shadow-2xl"
          style={{ left: Math.min(menu.x, window.innerWidth - 200), top: Math.min(menu.y, window.innerHeight - 220) }}
          onClick={(e) => e.stopPropagation()}
        >
          <button type="button" className="block w-full px-4 py-2.5 text-right hover:bg-white/10" onClick={() => { setMenu(null); void openChat(menuContact); }}>
            پیام
          </button>
          {menuContact.nixoUserId && (
            <>
              <button type="button" className="block w-full px-4 py-2.5 text-right hover:bg-white/10" onClick={() => { setMenu(null); void openChat(menuContact, "voice"); }}>
                تماس صوتی
              </button>
              <button type="button" className="block w-full px-4 py-2.5 text-right hover:bg-white/10" onClick={() => { setMenu(null); void openChat(menuContact, "video"); }}>
                تماس تصویری
              </button>
            </>
          )}
          <button type="button" className="block w-full px-4 py-2.5 text-right hover:bg-white/10" onClick={() => { setMenu(null); edit(menuContact); }}>
            ویرایش
          </button>
          <button
            type="button"
            className="block w-full px-4 py-2.5 text-right text-rose-300 hover:bg-white/10"
            onClick={() => {
              setMenu(null);
              if (!confirm("از دفترچهٔ تو حذف شود؟")) return;
              void api("delete", { id: menuContact.id }).then(() => {
                toast.success("حذف شد.");
                void load();
              });
            }}
          >
            حذف
          </button>
        </div>
      )}

      <Dialog
        open={addOpen}
        onOpenChange={(open) => {
          setAddOpen(open);
          if (!open) {
            setEditing(null);
            setForm(emptyForm);
            setPhoto("");
          }
        }}
      >
        <DialogContent className="max-h-[85vh] overflow-y-auto bg-[#122e2a] text-emerald-50 sm:max-w-md">
          <DialogHeader>
            <DialogTitle>{editing ? "ویرایش مخاطب" : "افزودن مخاطب"}</DialogTitle>
          </DialogHeader>
          <div className="grid gap-2">
            <Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="نام" className="h-9 bg-black/20" />
            <Input value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} placeholder="شماره" dir="ltr" className="h-9 bg-black/20" />
            <Input value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} placeholder="ایمیل" dir="ltr" className="h-9 bg-black/20" />
            <Input value={form.username} onChange={(e) => setForm({ ...form, username: e.target.value })} placeholder="@username" dir="ltr" className="h-9 bg-black/20" />
            <Input value={form.nickname} onChange={(e) => setForm({ ...form, nickname: e.target.value })} placeholder="نام مستعار" className="h-9 bg-black/20" />
            <Textarea value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} placeholder="یادداشت خصوصی" className="min-h-16 bg-black/20" />
            <select value={form.group} onChange={(e) => setForm({ ...form, group: e.target.value })} className="h-9 rounded-lg bg-black/20 px-2 text-xs">
              {GROUPS.map((g) => (
                <option key={g.id || "none"} value={g.id}>
                  {g.label}
                </option>
              ))}
            </select>
            <label className="block text-[11px] opacity-70">
              عکس
              <input
                type="file"
                accept="image/*"
                className="mt-1 block text-xs"
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  if (!file) return;
                  const reader = new FileReader();
                  reader.onload = () => setPhoto(String(reader.result ?? "").slice(0, 80_000));
                  reader.readAsDataURL(file);
                }}
              />
            </label>
            <Button type="button" className="bg-amber-300 text-[#102824]" disabled={busy} onClick={() => void save()}>
              ذخیره
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      <Dialog open={toolsOpen} onOpenChange={setToolsOpen}>
        <DialogContent className="max-h-[85vh] overflow-y-auto bg-[#122e2a] text-emerald-50 sm:max-w-md">
          <DialogHeader>
            <DialogTitle>پیدا کردن و پیشنهادها</DialogTitle>
          </DialogHeader>
          {requestsOut.length > 0 && (
            <section className="space-y-2 text-sm">
              <p className="font-medium">درخواست‌های ارسالی</p>
              {requestsOut.map((r) => (
                <div key={r.id} className="flex items-center justify-between text-xs">
                  <span>{r.peer?.displayName ?? "کاربر"}</span>
                  <Button size="sm" variant="secondary" className="h-7" onClick={() => void api("cancel-request", { id: r.id }).then(load)}>
                    لغو
                  </Button>
                </div>
              ))}
            </section>
          )}
          {friends.length > 0 && <p className="text-xs text-emerald-100/50">دوستان: {friendCount}</p>}
          {duplicates.length > 0 && <p className="text-xs text-emerald-100/50">{duplicates.length} گروه تکراری</p>}
          {invites.filter((i) => !i.revokedAt).length > 0 && <p className="text-[11px] opacity-60">{invites.filter((i) => !i.revokedAt).length} دعوت فعال</p>}
          {requestsIn.length > 0 && (
            <section className="space-y-2 text-sm">
              <p className="font-medium">درخواست دوستی</p>
              {requestsIn.map((r) => (
                <div key={r.id} className="flex items-center justify-between gap-2 text-xs">
                  <span>{r.peer?.displayName ?? "کاربر"}</span>
                  <div className="flex gap-1">
                    <Button size="sm" className="h-7 bg-amber-300 text-[#102824]" onClick={() => void api("resolve-request", { id: r.id, resolve: "accept" }).then(load)}>
                      قبول
                    </Button>
                    <Button size="sm" variant="secondary" className="h-7" onClick={() => void api("resolve-request", { id: r.id, resolve: "decline" }).then(load)}>
                      رد
                    </Button>
                  </div>
                </div>
              ))}
            </section>
          )}
          <form
            className="flex gap-2"
            onSubmit={async (e) => {
              e.preventDefault();
              const res = await fetch(`/api/contacts?action=username&q=${encodeURIComponent(userLookup)}`);
              const data = await res.json();
              if (data.user?.username) router.push(`/app/u/${data.user.username}`);
              else toast.message("نتیجه‌ای نیست.");
            }}
          >
            <Input value={userLookup} onChange={(e) => setUserLookup(e.target.value)} placeholder="@username" dir="ltr" className="h-9 bg-black/20" />
            <Button type="submit" size="sm" variant="secondary">
              پیدا کن
            </Button>
          </form>
          <form
            className="flex gap-2"
            onSubmit={async (e) => {
              e.preventDefault();
              const res = await fetch(`/api/contacts?action=discover&q=${encodeURIComponent(idLookup)}`);
              const data = await res.json();
              if (data.user?.username) router.push(`/app/u/${data.user.username}`);
              else toast.message("نتیجه‌ای نیست.");
            }}
          >
            <Input value={idLookup} onChange={(e) => setIdLookup(e.target.value)} placeholder="شماره یا ایمیل" dir="ltr" className="h-9 bg-black/20" />
            <Button type="submit" size="sm" variant="secondary">
              جستجو
            </Button>
          </form>
          <div className="flex flex-wrap gap-2">
            <Button type="button" size="sm" variant="secondary" onClick={() => void pickPhoneContacts()}>
              همگام‌سازی گوشی
            </Button>
            <Button type="button" size="sm" className="bg-amber-300 text-[#102824]" onClick={() => void makeInvite()}>
              دعوت
            </Button>
          </div>
          {inviteUrl && (
            <p className="break-all text-[11px]" dir="ltr">
              {inviteUrl}
            </p>
          )}
          {suggestions.length > 0 && (
            <ul className="space-y-1 text-xs">
              {suggestions.map((s) => (
                <li key={s.id} className="flex items-center justify-between gap-2">
                  <Link className="text-amber-200" href={s.username ? `/app/u/${s.username}` : "/app/contacts"}>
                    {s.displayName}
                  </Link>
                  <button
                    type="button"
                    onClick={() => void api("hide-suggestion", { userId: s.id, mode: "hide" }).then(() => setSuggestions((cur) => cur.filter((x) => x.id !== s.id)))}
                  >
                    پنهان
                  </button>
                </li>
              ))}
            </ul>
          )}
          <p className="text-[11px] text-emerald-100/45">مجوز دفترچه: {permission} · همگام‌سازی {syncEnabled ? "روشن" : "خاموش"}</p>
        </DialogContent>
      </Dialog>
    </div>
  );
}
