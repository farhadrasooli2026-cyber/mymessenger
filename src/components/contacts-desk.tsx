"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { NixoMark } from "@/components/nixo-mark";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { REPORT_CATEGORIES } from "@/lib/chat-copy";

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
};

export function ContactsDesk() {
  const router = useRouter();
  const [q, setQ] = useState("");
  const [sort, setSort] = useState("name");
  const [group, setGroup] = useState("");
  const [tab, setTab] = useState<"all" | "fav" | "recent">("all");
  const [contacts, setContacts] = useState<Contact[]>([]);
  const [favorites, setFavorites] = useState<Contact[]>([]);
  const [recently, setRecently] = useState<Contact[]>([]);
  const [duplicates, setDuplicates] = useState<string[][]>([]);
  const [requestsIn, setRequestsIn] = useState<RequestRow[]>([]);
  const [requestsOut, setRequestsOut] = useState<RequestRow[]>([]);
  const [friends, setFriends] = useState<{ id: string; displayName: string; username: string | null }[]>([]);
  const [hasMore, setHasMore] = useState(false);
  const [cursor, setCursor] = useState<string | null>(null);
  const [permission, setPermission] = useState("unknown");
  const [syncEnabled, setSyncEnabled] = useState(false);
  const [form, setForm] = useState(emptyForm);
  const [editing, setEditing] = useState<Contact | null>(null);
  const [userLookup, setUserLookup] = useState("");
  const [idLookup, setIdLookup] = useState("");
  const [inviteUrl, setInviteUrl] = useState("");
  const [scan, setScan] = useState("");
  const [suggestions, setSuggestions] = useState<{ id: string; username: string | null; displayName: string }[]>([]);
  const [photo, setPhoto] = useState("");
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    const params = new URLSearchParams({ q, sort });
    if (group) params.set("group", group);
    if (tab === "fav") params.set("favorites", "1");
    if (tab === "recent") params.set("recently", "1");
    const res = await fetch(`/api/contacts?${params}`);
    const data = await res.json();
    if (!data.ok) return;
    setContacts(data.contacts ?? []);
    setFavorites(data.favorites ?? []);
    setRecently(data.recently ?? []);
    setDuplicates(data.duplicates ?? []);
    setRequestsIn(data.requestsIn ?? []);
    setRequestsOut(data.requestsOut ?? []);
    setFriends(data.friends ?? []);
    setHasMore(Boolean(data.hasMore));
    setCursor(data.nextCursor ?? null);
    setPermission(data.permission ?? "unknown");
    setSyncEnabled(Boolean(data.syncEnabled));
  }, [q, sort, group, tab]);

  useEffect(() => {
    const t = window.setTimeout(() => void load(), 0);
    fetch("/api/contacts?action=suggestions")
      .then((r) => r.json())
      .then((d) => setSuggestions(d.suggestions ?? []))
      .catch(() => undefined);
    return () => window.clearTimeout(t);
  }, [load]);

  const shown = useMemo(() => {
    if (tab === "fav") return favorites;
    if (tab === "recent") return recently;
    return contacts;
  }, [tab, contacts, favorites, recently]);

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
    });
    setPhoto(c.localPhoto);
  }

  return (
    <div className="mx-auto min-h-dvh max-w-3xl bg-[#071614] px-4 py-6 text-emerald-50">
      <header className="mb-4 flex items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <NixoMark size={36} />
          <div>
            <h1 className="text-lg font-semibold">مخاطبین و افراد</h1>
            <p className="text-[11px] text-emerald-100/60">دفترچه فقط مال توست. دیگران دفترچهٔ تو را نمی‌بینند.</p>
          </div>
        </div>
        <Link href="/app" className="text-xs text-amber-200">
          بازگشت به چت
        </Link>
      </header>

      {requestsOut.length > 0 && (
        <section className="mb-4 rounded-2xl bg-white/5 p-3 text-sm">
          <h2 className="font-medium">درخواست‌های ارسالی</h2>
          {requestsOut.map((r) => (
            <div key={r.id} className="mt-2 flex items-center justify-between text-xs">
              <span>{r.peer?.displayName ?? "کاربر"}</span>
              <Button size="sm" variant="secondary" className="h-7" onClick={() => void api("cancel-request", { id: r.id }).then(load)}>
                لغو
              </Button>
            </div>
          ))}
        </section>
      )}
      {friends.length > 0 && (
        <section className="mb-4 rounded-2xl bg-white/5 p-3 text-sm">
          <h2 className="font-medium">دوستان</h2>
          <ul className="mt-1 text-xs">
            {friends.map((f) => (
              <li key={f.id} className="mt-1 flex items-center justify-between">
                <Link className="text-amber-200" href={f.username ? `/app/u/${f.username}` : "/app/contacts"}>
                  {f.displayName}
                </Link>
                <button type="button" className="text-rose-200" onClick={() => void api("unfriend", { userId: f.id }).then(load)}>
                  حذف دوست
                </button>
              </li>
            ))}
          </ul>
        </section>
      )}
      {requestsIn.length > 0 && (
        <section className="mb-4 rounded-2xl border border-amber-300/20 bg-amber-300/5 p-3 text-sm">
          <h2 className="font-medium">درخواست‌های دوستی</h2>
          {requestsIn.map((r) => (
            <div key={r.id} className="mt-2 flex flex-wrap items-center justify-between gap-2 text-xs">
              <span>{r.peer?.displayName ?? "کاربر"} {r.peer?.username ? `@${r.peer.username}` : ""}</span>
              <div className="flex gap-1">
                <Button size="sm" className="h-7 bg-amber-300 text-[#102824]" onClick={() => void api("resolve-request", { id: r.id, resolve: "accept" }).then(load)}>
                  Accept
                </Button>
                <Button size="sm" variant="secondary" className="h-7" onClick={() => void api("resolve-request", { id: r.id, resolve: "decline" }).then(load)}>
                  Decline
                </Button>
                <Button size="sm" variant="secondary" className="h-7" onClick={() => void api("resolve-request", { id: r.id, resolve: "block" }).then(load)}>
                  Block
                </Button>
                <Button size="sm" variant="secondary" className="h-7" onClick={() => void api("resolve-request", { id: r.id, resolve: "report" }).then(load)}>
                  Report
                </Button>
              </div>
            </div>
          ))}
        </section>
      )}

      <div className="mb-3 flex flex-wrap gap-2 text-xs">
        {(["all", "fav", "recent"] as const).map((t) => (
          <button key={t} type="button" onClick={() => setTab(t)} className={`rounded-full px-3 py-1 ${tab === t ? "bg-amber-300 text-[#102824]" : "bg-white/10"}`}>
            {t === "all" ? "همه" : t === "fav" ? "علاقه‌مندی" : "اخیراً تماس"}
          </button>
        ))}
        {GROUPS.map((g) => (
          <button key={g.id || "x"} type="button" onClick={() => setGroup(g.id)} className={`rounded-full px-3 py-1 ${group === g.id ? "bg-white/20" : "bg-white/5"}`}>
            {g.label}
          </button>
        ))}
      </div>

      <div className="mb-3 flex flex-col gap-2 sm:flex-row">
        <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="جستجو: نام، @username، شماره، ایمیل" className="h-9 bg-black/20" />
        <select value={sort} onChange={(e) => setSort(e.target.value)} className="h-9 rounded-lg bg-black/20 px-2 text-xs">
          <option value="name">نام</option>
          <option value="added">تازه‌اضافه‌شده</option>
          <option value="contacted">اخیراً تماس</option>
          <option value="favorites">علاقه‌مندی</option>
        </select>
      </div>

      <section className="mb-4 rounded-2xl bg-white/5 p-4 text-sm">
        <h2 className="font-medium">{editing ? "ویرایش مخاطب" : "افزودن مخاطب"}</h2>
        <p className="mt-1 text-[11px] opacity-60">نام سفارشی، یادداشت و عکس محلی فقط در حساب تو دیده می‌شود و عکس پروفایل واقعی طرف را عوض نمی‌کند.</p>
        <div className="mt-2 grid gap-2 sm:grid-cols-2">
          <Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="نام" className="h-9 bg-black/20" />
          <Input value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} placeholder="شماره" dir="ltr" className="h-9 bg-black/20" />
          <Input value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} placeholder="ایمیل" dir="ltr" className="h-9 bg-black/20" />
          <Input value={form.username} onChange={(e) => setForm({ ...form, username: e.target.value })} placeholder="@username" dir="ltr" className="h-9 bg-black/20" />
        </div>
        <Textarea value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} placeholder="یادداشت خصوصی" className="mt-2 min-h-16 bg-black/20" />
        <div className="mt-2 grid gap-2 sm:grid-cols-2">
          <select value={form.group} onChange={(e) => setForm({ ...form, group: e.target.value })} className="h-9 rounded-lg bg-black/20 px-2 text-xs">
            {GROUPS.map((g) => (
              <option key={g.id || "none"} value={g.id}>
                دسته: {g.label}
              </option>
            ))}
          </select>
          <Input value={form.labels} onChange={(e) => setForm({ ...form, labels: e.target.value })} placeholder="برچسب‌ها با ویرگول" className="h-9 bg-black/20" />
        </div>
        <Textarea value={form.custom} onChange={(e) => setForm({ ...form, custom: e.target.value })} placeholder="اطلاعات سفارشی (هر خط: کلید: مقدار)" className="mt-2 min-h-14 bg-black/20 text-xs" />
        <label className="mt-2 block text-[11px] opacity-70">
          عکس محلی
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
        <div className="mt-3 flex gap-2">
          <Button type="button" className="bg-amber-300 text-[#102824]" disabled={busy} onClick={() => void save()}>
            ذخیره
          </Button>
          {editing && (
            <Button
              type="button"
              variant="secondary"
              onClick={() => {
                setEditing(null);
                setForm(emptyForm);
                setPhoto("");
              }}
            >
              انصراف
            </Button>
          )}
        </div>
      </section>

      <section className="mb-4 rounded-2xl bg-white/5 p-4 text-sm">
        <h2 className="font-medium">مخاطبین گوشی و همگام‌سازی</h2>
        <p className="mt-1 text-[11px] leading-5 opacity-70">
          مجوز: {permission === "allow" ? "Allow" : permission === "limited" ? "Limited Access" : permission === "deny" ? "Deny" : "نامشخص"}. نیکسو بدون Permission سیستم‌عامل دفترچه را نمی‌خواند. اگر مجوز را از تنظیمات مرورگر برداری، همگام‌سازی متوقف می‌شود.
        </p>
        <div className="mt-2 flex flex-wrap gap-2">
          <Button type="button" size="sm" variant="secondary" onClick={() => void pickPhoneContacts()}>
            خواندن مخاطبین (Picker)
          </Button>
          <Button type="button" size="sm" variant="secondary" onClick={() => void api("permission", { permission: "deny" }).then(load)}>
            لغو مجوز
          </Button>
          <span className="self-center text-[11px] opacity-60">Sync: {syncEnabled ? "روشن" : "خاموش"} — از حریم خصوصی هم قابل تنظیم است.</span>
        </div>
      </section>

      <section className="mb-4 rounded-2xl bg-white/5 p-4 text-sm">
        <h2 className="font-medium">پیدا کردن افراد</h2>
        <form
          className="mt-2 flex gap-2"
          onSubmit={async (e) => {
            e.preventDefault();
            const res = await fetch(`/api/contacts?action=username&q=${encodeURIComponent(userLookup)}`);
            const data = await res.json();
            if (data.user?.username) router.push(`/app/u/${data.user.username}`);
            else toast.message("طبق حریم، نتیجه‌ای نیست.");
          }}
        >
          <Input value={userLookup} onChange={(e) => setUserLookup(e.target.value)} placeholder="@username یکتا" dir="ltr" className="h-9 bg-black/20" />
          <Button type="submit" size="sm" variant="secondary">
            Username
          </Button>
        </form>
        <form
          className="mt-2 flex gap-2"
          onSubmit={async (e) => {
            e.preventDefault();
            const res = await fetch(`/api/contacts?action=discover&q=${encodeURIComponent(idLookup)}`);
            const data = await res.json();
            if (data.user?.username) router.push(`/app/u/${data.user.username}`);
            else toast.message("طبق حریم، نتیجه‌ای نیست.");
          }}
        >
          <Input value={idLookup} onChange={(e) => setIdLookup(e.target.value)} placeholder="شماره یا ایمیل (با حفاظت enumeration)" dir="ltr" className="h-9 bg-black/20" />
          <Button type="submit" size="sm" variant="secondary">
            Discovery
          </Button>
        </form>
        <form
          className="mt-2 flex gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            try {
              const parsed = JSON.parse(scan) as { u?: string };
              if (parsed.u) router.push(`/app/u/${parsed.u}`);
              else if (scan.startsWith("@") || /^[a-z]/.test(scan)) router.push(`/app/u/${scan.replace(/^@/, "")}`);
              else toast.message("QR فقط نام کاربری عمومی دارد، نه شماره.");
            } catch {
              router.push(`/app/u/${scan.replace(/^@/, "")}`);
            }
          }}
        >
          <Input value={scan} onChange={(e) => setScan(e.target.value)} placeholder="اسکن QR: @username یا JSON" dir="ltr" className="h-9 bg-black/20" />
          <Button type="submit" size="sm" variant="secondary">
            باز کردن QR
          </Button>
        </form>
      </section>

      <section className="mb-4 rounded-2xl bg-white/5 p-4 text-sm">
        <h2 className="font-medium">دعوت دوستان</h2>
        <Button type="button" size="sm" className="mt-2 bg-amber-300 text-[#102824]" onClick={() => void makeInvite()}>
          ساخت Invite Link (۷ روز، ۲۰ استفاده)
        </Button>
        {inviteUrl && (
          <p className="mt-2 break-all text-[11px]" dir="ltr">
            {inviteUrl}
          </p>
        )}
      </section>

      {suggestions.length > 0 && (
        <section className="mb-4 rounded-2xl bg-white/5 p-4 text-sm">
          <h2 className="font-medium">پیشنهاد (فقط با اجازهٔ پیدا شدن)</h2>
          <ul className="mt-2 space-y-1 text-xs">
            {suggestions.map((s) => (
              <li key={s.id}>
                <Link className="text-amber-200" href={s.username ? `/app/u/${s.username}` : "/app/contacts"}>
                  {s.displayName} {s.username ? `@${s.username}` : ""}
                </Link>
              </li>
            ))}
          </ul>
        </section>
      )}

      {duplicates.length > 0 && (
        <section className="mb-4 rounded-2xl border border-white/10 p-3 text-xs">
          <h2 className="font-medium">مخاطبین تکراری</h2>
          {duplicates.map((ids, i) => (
            <div key={i} className="mt-2 flex flex-wrap items-center gap-2">
              <span>{ids.length} مورد مشابه</span>
              <Button
                size="sm"
                variant="secondary"
                className="h-7"
                onClick={() => {
                  if (!confirm("این دو مخاطب ادغام شوند؟ حساب نیکسو طرف حذف نمی‌شود.")) return;
                  void api("merge", { keepId: ids[0], dropId: ids[1], confirm: true }).then(() => {
                    toast.success("ادغام شد.");
                    void load();
                  });
                }}
              >
                ادغام با تأیید
              </Button>
            </div>
          ))}
        </section>
      )}

      <ul className="space-y-2">
        {shown.length === 0 && <li className="rounded-2xl bg-white/5 p-6 text-center text-sm opacity-70">مخاطبی در این فهرست نیست.</li>}
        {shown.map((c) => (
          <li key={c.id} className="flex items-start gap-3 rounded-2xl bg-white/5 p-3">
            <div className="grid size-12 shrink-0 place-items-center overflow-hidden rounded-2xl bg-emerald-900 text-lg">
              {c.localPhoto ? <img src={c.localPhoto} alt="" className="size-full object-cover" /> : c.name.slice(0, 1)}
            </div>
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2">
                <p className="truncate font-medium">{c.name}</p>
                {c.favorite && <span className="text-[10px] text-amber-200">★</span>}
              </div>
              {c.username && (
                <Link href={`/app/u/${c.username}`} className="text-[11px] text-amber-200" dir="ltr">
                  @{c.username}
                </Link>
              )}
              <p className="truncate text-[11px] opacity-60" dir="ltr">
                {c.phone} {c.email}
              </p>
              {c.notes && <p className="mt-1 text-[11px] opacity-80">{c.notes}</p>}
              <div className="mt-2 flex flex-wrap gap-1">
                {c.nixoUserId && (
                  <>
                    <Button size="sm" className="h-7 bg-amber-300 text-[#102824]" onClick={() => void openChat(c)}>
                      Message
                    </Button>
                    <Button size="sm" variant="secondary" className="h-7" onClick={() => void openChat(c, "voice")}>
                      Voice Call
                    </Button>
                    <Button size="sm" variant="secondary" className="h-7" onClick={() => void openChat(c, "video")}>
                      Video Call
                    </Button>
                  </>
                )}
                <Button
                  size="sm"
                  variant="secondary"
                  className="h-7"
                  onClick={() => void api("save", { id: c.id, favorite: !c.favorite, name: c.name }).then(load)}
                >
                  Favorite
                </Button>
                <Button size="sm" variant="secondary" className="h-7" onClick={() => edit(c)}>
                  ویرایش
                </Button>
                <Button
                  size="sm"
                  variant="secondary"
                  className="h-7"
                  onClick={() => {
                    if (!confirm("از دفترچهٔ تو حذف شود؟ حساب نیکسو طرف پاک نمی‌شود.")) return;
                    void api("delete", { id: c.id }).then(() => {
                      toast.success("حذف شد.");
                      void load();
                    });
                  }}
                >
                  حذف
                </Button>
                <Button
                  size="sm"
                  variant="secondary"
                  className="h-7"
                  onClick={async () => {
                    const { data } = await api("card", { id: c.id, fields: ["name", "username"] });
                    if (data.vcard) {
                      await navigator.clipboard.writeText(data.vcard);
                      toast.success("کارت مخاطب (فقط فیلدهای مجاز) کپی شد.");
                    }
                  }}
                >
                  کارت
                </Button>
              </div>
            </div>
          </li>
        ))}
      </ul>
      {hasMore && (
        <Button
          type="button"
          variant="secondary"
          className="mt-3 w-full"
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
      )}

      <section className="mt-6 rounded-2xl bg-white/5 p-4 text-xs leading-6 opacity-80">
        <h2 className="font-medium text-sm">ورود و خروج داده</h2>
        <div className="mt-2 flex flex-wrap gap-2">
          <Button
            size="sm"
            variant="secondary"
            onClick={async () => {
              const res = await fetch("/api/contacts?action=export");
              const data = await res.json();
              const blob = new Blob([JSON.stringify(data.contacts ?? [], null, 2)], { type: "application/json" });
              const a = document.createElement("a");
              a.href = URL.createObjectURL(blob);
              a.download = "nixo-contacts.json";
              a.click();
            }}
          >
            Export دفترچهٔ من
          </Button>
          <Button
            size="sm"
            variant="secondary"
            onClick={() => {
              if (!confirm("همهٔ مخاطبین دفترچهٔ تو پاک شود؟ حساب‌های نیکسو حذف نمی‌شوند.")) return;
              void api("clear").then(() => {
                toast.success("دفترچه پاک شد.");
                void load();
              });
            }}
          >
            پاک کردن دفترچهٔ من
          </Button>
          <label className="inline-flex h-8 items-center rounded-lg bg-white/10 px-3">
            Import JSON
            <input
              type="file"
              accept="application/json"
              className="hidden"
              onChange={async (e) => {
                const file = e.target.files?.[0];
                if (!file) return;
                const rows = JSON.parse(await file.text()) as unknown[];
                const { data } = await api("import", { rows });
                toast.success(`${data.added ?? 0} مخاطب وارد شد.`);
                void load();
              }}
            />
          </label>
        </div>
        <p className="mt-2">
          گزارش، Block و لیست مسدودها در{" "}
          <Link href="/app/settings/privacy" className="text-amber-200">
            تنظیمات حریم خصوصی
          </Link>
          . اعلان پیوستن مخاطب شماره را در Lock Screen نشان نمی‌دهد.
        </p>
        <p>
          {REPORT_CATEGORIES.map((c) => c.label).join(" · ")} از صفحهٔ پروفایل فرد قابل ارسال است.
        </p>
      </section>
    </div>
  );
}
