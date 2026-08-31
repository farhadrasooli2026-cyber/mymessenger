"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { toast } from "sonner";
import { NixoMark } from "@/components/nixo-mark";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  ALL_BIZ_PERMS,
  BIZ_PERM_FA,
  INBOX_LABELS,
  ORDER_STATUSES,
  WEEKDAYS,
  emptyStaffPerms,
  type BizPerms,
  type DayHours,
} from "@/lib/business-types";

const TABS = [
  "Profile",
  "Hours",
  "Products",
  "Services",
  "Inbox",
  "Auto Reply",
  "Admins",
  "Payments",
  "Analytics",
  "Verification",
  "Security",
] as const;

type Tab = (typeof TABS)[number];

type Dash = {
  business: {
    id: string;
    name: string;
    username: string;
    description: string;
    website: string;
    phone: string;
    email: string;
    address: string;
    hours: DayHours[];
    welcome: string;
    away: string;
    autoReply: string;
    verified: boolean;
    verification: string;
    open: boolean;
    botId: string | null;
    channelId: string | null;
  };
  role: string;
  perms: BizPerms;
  staff: { userId: string; role: string; name: string; perms: BizPerms }[];
  products: { id: string; kind: string; name: string; price: number; currency: string; stock: number | null }[];
  replies: { command: string; text: string }[];
  stats: {
    profileViews: number;
    messageCount: number;
    customerCount: number;
    productViews: number;
    orders: number;
    revenue: number;
    paymentNote: string;
  } | null;
};

type Thread = {
  id: string;
  unread: boolean;
  important: boolean;
  archived: boolean;
  spam: boolean;
  label: string | null;
  customer: { displayName: string; username: string | null };
};

export function BusinessDesk() {
  const [list, setList] = useState<{ id: string; name: string; role: string }[]>([]);
  const [id, setId] = useState("");
  const [tab, setTab] = useState<Tab>("Profile");
  const [dash, setDash] = useState<Dash | null>(null);
  const [filter, setFilter] = useState("customers");
  const [threads, setThreads] = useState<Thread[]>([]);
  const [threadId, setThreadId] = useState("");
  const [msgs, setMsgs] = useState<{ id: string; from: string; text: string }[]>([]);
  const [reply, setReply] = useState("");
  const [pname, setPname] = useState("");
  const [pdesc, setPdesc] = useState("");
  const [pprice, setPprice] = useState("10");
  const [pcode, setPcode] = useState("");
  const [stock, setStock] = useState("5");
  const [cmd, setCmd] = useState("price");
  const [cmdText, setCmdText] = useState("قیمت محصول را از کاتالوگ ببینید.");
  const [adminUser, setAdminUser] = useState("");
  const [docs, setDocs] = useState("");
  const [story, setStory] = useState("");
  const [botId, setBotId] = useState("");
  const [channelId, setChannelId] = useState("");
  const [orders, setOrders] = useState<{ id: string; status: string; total: number; customer: { displayName: string } }[]>([]);
  const [aiOut, setAiOut] = useState("");

  function loadDash(bizId: string) {
    fetch(`/api/business?view=dashboard&businessId=${bizId}`, { cache: "no-store" })
      .then((r) => r.json())
      .then((d) => {
        if (d.ok) setDash(d as Dash);
      })
      .catch(() => undefined);
  }

  function loadInbox(bizId: string, f: string) {
    fetch(`/api/business?view=inbox&businessId=${bizId}&filter=${f}`, { cache: "no-store" })
      .then((r) => r.json())
      .then((d) => {
        if (d.ok) setThreads(d.threads ?? []);
        else toast.error(d.error);
      })
      .catch(() => undefined);
  }

  useEffect(() => {
    fetch("/api/business?mine=1", { cache: "no-store" })
      .then((r) => r.json())
      .then((d) => {
        const rows = (d.businesses ?? []) as { id: string; name: string; role: string }[];
        setList(rows);
        if (rows[0]) {
          setId(rows[0].id);
          loadDash(rows[0].id);
        }
      })
      .catch(() => undefined);
  }, []);

  useEffect(() => {
    if (!id || tab !== "Inbox") return;
    loadInbox(id, filter);
  }, [id, tab, filter]);

  async function post(body: Record<string, unknown>) {
    const res = await fetch("/api/business", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...body, businessId: id }),
    });
    const data = await res.json();
    if (!res.ok) toast.error(data.error ?? "خطا");
    else toast.success("ذخیره شد.");
    loadDash(id);
    return data;
  }

  if (list.length === 0) {
    return (
      <main className="min-h-dvh bg-[#071614] p-5 text-emerald-50">
        <div className="mx-auto max-w-lg space-y-3">
          <NixoMark size={36} />
          <h1 className="text-xl font-semibold">Settings → Business</h1>
          <p className="text-sm leading-7">هنوز Business نساختی. همین حساب را تبدیل کن — ورود جدا لازم نیست.</p>
          <Link href="/app/business/create" className="inline-flex h-9 items-center rounded-lg bg-amber-300 px-3 text-sm font-medium text-[#102824]">
            Create Business Account
          </Link>
        </div>
      </main>
    );
  }

  const b = dash?.business;

  return (
    <main className="min-h-dvh bg-[#071614] p-5 text-emerald-50">
      <div className="mx-auto max-w-2xl space-y-4">
        <div className="flex items-center gap-2">
          <NixoMark size={36} />
          <div>
            <p className="text-xs text-amber-200">Settings → Business</p>
            <h1 className="text-xl font-semibold">{b?.name ?? "داشبورد"}</h1>
          </div>
        </div>
        <p className="text-[11px] leading-6 text-emerald-100/60">
          نقش: {dash?.role}. مجوزها روی سرور چک می‌شوند؛ دستکاری این صفحه دسترسی اضافه نمی‌دهد. مشتری فقط نام نمایشی را می‌بیند نه شماره.
        </p>
        <div className="flex flex-wrap gap-1">
          {TABS.map((t) => (
            <button
              key={t}
              type="button"
              className={`rounded-full px-2 py-1 text-[11px] ${tab === t ? "bg-amber-300 text-[#102824]" : "bg-white/10"}`}
              onClick={() => setTab(t)}
            >
              {t}
            </button>
          ))}
        </div>

        {tab === "Profile" && b && (
          <form
            className="space-y-2"
            onSubmit={(e) => {
              e.preventDefault();
              const fd = new FormData(e.currentTarget);
              void post({
                action: "update",
                name: String(fd.get("name") ?? ""),
                username: String(fd.get("username") ?? ""),
                description: String(fd.get("description") ?? ""),
                website: String(fd.get("website") ?? ""),
                phone: String(fd.get("phone") ?? ""),
                email: String(fd.get("email") ?? ""),
                address: String(fd.get("address") ?? ""),
              });
            }}
          >
            <Input name="name" defaultValue={b.name} />
            <Input name="username" dir="ltr" defaultValue={b.username} />
            <Textarea name="description" defaultValue={b.description} rows={4} />
            <Input name="website" dir="ltr" defaultValue={b.website} placeholder="https://" />
            <Input name="phone" defaultValue={b.phone} />
            <Input name="email" defaultValue={b.email} />
            <Input name="address" defaultValue={b.address} />
            <Button type="submit" className="bg-amber-300 text-[#102824]">ذخیره پروفایل</Button>
            <div className="flex gap-2">
              <Input value={story} onChange={(e) => setStory(e.target.value)} placeholder="استوری محصول / تخفیف / اعلام" />
              <Button type="button" onClick={() => void post({ action: "story", body: story })}>
                Story
              </Button>
            </div>
            <p className="text-xs">وضعیت الان: {b.open ? "🟢 Open" : "🔴 Closed"}</p>
            <Link href={`/app/business/b/${b.id}`} className="block text-xs text-amber-200">مشاهده پروفایل عمومی</Link>
          </form>
        )}

        {tab === "Hours" && b && (
          <div className="space-y-2">
            {WEEKDAYS.map((w) => {
              const row = b.hours.find((h) => h.day === w.d)!;
              return (
                <div key={w.d} className="flex items-center gap-2 text-xs">
                  <span className="w-20">{w.en}</span>
                  <label className="flex gap-1">
                    <input
                      type="checkbox"
                      checked={row.closed}
                      onChange={(e) => {
                        const hours = b.hours.map((h) => (h.day === w.d ? { ...h, closed: e.target.checked } : h));
                        setDash({ ...dash!, business: { ...b, hours } });
                      }}
                    />
                    Closed
                  </label>
                  <Input className="h-8 w-24" dir="ltr" value={row.open} onChange={(e) => setDash({ ...dash!, business: { ...b, hours: b.hours.map((h) => (h.day === w.d ? { ...h, open: e.target.value } : h)) } })} />
                  <Input className="h-8 w-24" dir="ltr" value={row.close} onChange={(e) => setDash({ ...dash!, business: { ...b, hours: b.hours.map((h) => (h.day === w.d ? { ...h, close: e.target.value } : h)) } })} />
                </div>
              );
            })}
            <Button type="button" onClick={() => void post({ action: "hours", hours: b.hours })}>
              ذخیره ساعات
            </Button>
          </div>
        )}

        {(tab === "Products" || tab === "Services") && (
          <div className="space-y-3">
            <Input value={pname} onChange={(e) => setPname(e.target.value)} placeholder={tab === "Services" ? "Haircut / Consultation" : "نام محصول"} />
            <Textarea value={pdesc} onChange={(e) => setPdesc(e.target.value)} placeholder="توضیح" />
            <div className="flex gap-2">
              <Input value={pprice} onChange={(e) => setPprice(e.target.value)} placeholder="قیمت" />
              <Input value={pcode} onChange={(e) => setPcode(e.target.value)} placeholder="کد" />
              {tab === "Products" && <Input value={stock} onChange={(e) => setStock(e.target.value)} placeholder="موجودی" />}
            </div>
            <Button
              type="button"
              onClick={() =>
                void post({
                  action: "product",
                  kind: tab === "Services" ? "service" : "product",
                  name: pname,
                  description: pdesc,
                  price: Number(pprice),
                  code: pcode,
                  stock: tab === "Services" ? null : Number(stock),
                })
              }
            >
              افزودن
            </Button>
            <ul className="space-y-1 text-sm">
              {(dash?.products ?? [])
                .filter((p) => (tab === "Services" ? p.kind === "service" : p.kind === "product"))
                .map((p) => (
                  <li key={p.id}>
                    {p.name} · {p.price} {p.currency}
                  </li>
                ))}
            </ul>
            {tab === "Products" && (
              <div className="space-y-2">
                <h2 className="text-sm">سفارش‌ها</h2>
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => {
                    fetch(`/api/business?view=orders&businessId=${id}`, { cache: "no-store" })
                      .then((r) => r.json())
                      .then((d) => {
                        if (d.ok) setOrders(d.orders ?? []);
                        else toast.error(d.error);
                      });
                  }}
                >
                  بارگذاری سفارش
                </Button>
                <ul className="space-y-2 text-xs">
                  {orders.map((o) => (
                    <li key={o.id} className="rounded-lg border border-white/10 p-2">
                      {o.id} · {o.customer.displayName} · {o.total} · {o.status}
                      <div className="mt-1 flex flex-wrap gap-1">
                        {ORDER_STATUSES.map((s) => (
                          <button key={s} type="button" className="rounded bg-white/10 px-2 py-0.5" onClick={() => void post({ action: "orderStatus", orderId: o.id, status: s })}>
                            {s}
                          </button>
                        ))}
                      </div>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        )}

        {tab === "Inbox" && (
          <div className="space-y-3">
            <div className="flex flex-wrap gap-1 text-[11px]">
              {["unread", "read", "important", "archived", "spam", "customers"].map((f) => (
                <button key={f} type="button" className={`rounded-full px-2 py-1 ${filter === f ? "bg-amber-300 text-[#102824]" : "bg-white/10"}`} onClick={() => setFilter(f)}>
                  {f}
                </button>
              ))}
            </div>
            <ul className="space-y-1">
              {threads.map((t) => (
                <li key={t.id}>
                  <button
                    type="button"
                    className="w-full rounded-lg border border-white/10 p-2 text-right text-sm"
                    onClick={() => {
                      setThreadId(t.id);
                      fetch(`/api/business?view=thread&threadId=${t.id}`, { cache: "no-store" })
                        .then((r) => r.json())
                        .then((d) => {
                          if (d.ok) setMsgs(d.messages ?? []);
                          else toast.error(d.error);
                        });
                    }}
                  >
                    {t.customer.displayName} {t.customer.username ? `@${t.customer.username}` : ""} {t.unread ? "· خوانده‌نشده" : ""} {t.label ? `· ${t.label}` : ""}
                  </button>
                </li>
              ))}
            </ul>
            {threadId && (
              <div className="space-y-2 rounded-xl border border-white/10 p-3">
                {msgs.map((m) => (
                  <p key={m.id} className="text-sm">
                    <span className="text-amber-200">{m.from}:</span> {m.text}
                  </p>
                ))}
                <Input value={reply} onChange={(e) => setReply(e.target.value)} placeholder="پاسخ پشتیبان" />
                <Button type="button" onClick={() => void post({ action: "staffReply", threadId, text: reply }).then(() => setReply(""))}>
                  ارسال
                </Button>
                <div className="flex flex-wrap gap-1">
                  {INBOX_LABELS.map((l) => (
                    <button key={l} type="button" className="rounded bg-white/10 px-2 py-0.5 text-[11px]" onClick={() => void post({ action: "thread", threadId, label: l })}>
                      {l}
                    </button>
                  ))}
                  <button type="button" className="rounded bg-white/10 px-2 py-0.5 text-[11px]" onClick={() => void post({ action: "thread", threadId, important: true })}>
                    Important
                  </button>
                  <button type="button" className="rounded bg-white/10 px-2 py-0.5 text-[11px]" onClick={() => void post({ action: "thread", threadId, archived: true })}>
                    Archive
                  </button>
                  <button type="button" className="rounded bg-white/10 px-2 py-0.5 text-[11px]" onClick={() => void post({ action: "thread", threadId, spam: true })}>
                    Spam
                  </button>
                </div>
              </div>
            )}
          </div>
        )}

        {tab === "Auto Reply" && b && (
          <form
            className="space-y-2"
            onSubmit={(e) => {
              e.preventDefault();
              const fd = new FormData(e.currentTarget);
              void post({
                action: "update",
                welcome: String(fd.get("welcome") ?? ""),
                away: String(fd.get("away") ?? ""),
                autoReply: String(fd.get("autoReply") ?? ""),
              });
            }}
          >
            <label className="text-xs">Welcome Message</label>
            <Textarea name="welcome" defaultValue={b.welcome} />
            <label className="text-xs">Away Message</label>
            <Textarea name="away" defaultValue={b.away} />
            <label className="text-xs">Auto Reply</label>
            <Textarea name="autoReply" defaultValue={b.autoReply} />
            <Button type="submit">ذخیره پاسخ‌ها</Button>
            <div className="flex gap-2">
              <Input value={cmd} onChange={(e) => setCmd(e.target.value)} placeholder="/price" />
              <Input value={cmdText} onChange={(e) => setCmdText(e.target.value)} placeholder="متن آماده" />
              <Button type="button" onClick={() => void post({ action: "quickReply", command: cmd, text: cmdText })}>
                Quick Reply
              </Button>
            </div>
            <ul className="text-xs">
              {(dash?.replies ?? []).map((r) => (
                <li key={r.command}>
                  /{r.command} → {r.text}
                </li>
              ))}
            </ul>
            <Button
              type="button"
              variant="outline"
              onClick={() => {
                void fetch("/api/business", {
                  method: "POST",
                  headers: { "Content-Type": "application/json" },
                  body: JSON.stringify({ action: "ai", businessId: id, task: "ad", text: b.description }),
                })
                  .then((r) => r.json())
                  .then((d) => setAiOut(d.text ?? d.error ?? ""));
              }}
            >
              تولید متن تبلیغاتی با AI
            </Button>
            {aiOut && <p className="text-xs leading-6">{aiOut}</p>}
          </form>
        )}

        {tab === "Admins" && (
          <div className="space-y-2">
            <p className="text-xs">فقط Owner ادمین اضافه می‌کند. هر مجوز جدا روی سرور اعمال می‌شود.</p>
            <Input value={adminUser} onChange={(e) => setAdminUser(e.target.value)} placeholder="@username ادمین" />
            <Button
              type="button"
              onClick={() => void post({ action: "staff", username: adminUser, perms: emptyStaffPerms() })}
            >
              افزودن با مجوز خواندن/پاسخ
            </Button>
            <ul className="space-y-2 text-xs">
              {(dash?.staff ?? []).map((s) => (
                <li key={s.userId} className="rounded-lg border border-white/10 p-2">
                  {s.name} · {s.role}
                  <p>{ALL_BIZ_PERMS.filter((k) => s.perms[k]).map((k) => BIZ_PERM_FA[k]).join("، ")}</p>
                </li>
              ))}
            </ul>
          </div>
        )}

        {tab === "Payments" && (
          <div className="space-y-2 text-sm leading-7">
            <p>Payment Request، Invoice، Order Payment و Refund از مسیر رسمی NIXO Pay می‌آیند و هنوز فعال نیستند.</p>
            <Button type="button" onClick={() => void post({ action: "pay" })}>
              تست Payment
            </Button>
          </div>
        )}

        {tab === "Analytics" && (
          <div className="space-y-2 text-sm">
            {!dash?.stats && <p className="text-xs">اجازهٔ آمار نداری یا هنوز بارگذاری نشده.</p>}
            {dash?.stats && (
              <ul className="space-y-1">
                <li>Profile Views: {dash.stats.profileViews}</li>
                <li>Message Count: {dash.stats.messageCount}</li>
                <li>Customer Count: {dash.stats.customerCount}</li>
                <li>Product Views: {dash.stats.productViews}</li>
                <li>Orders: {dash.stats.orders}</li>
                <li>Revenue (ثبت‌شده، بدون تسویه Pay): {dash.stats.revenue}</li>
              </ul>
            )}
            <p className="text-xs text-emerald-100/50">{dash?.stats?.paymentNote}</p>
          </div>
        )}

        {tab === "Verification" && b && (
          <div className="space-y-2">
            <p className="text-sm">
              وضعیت: {b.verified ? "Verified Business ✓" : b.verification === "pending" ? "در انتظار بررسی نیکسو" : b.verification === "rejected" ? "رد شده" : "بدون نشان"}
            </p>
            <p className="text-xs leading-6 text-emerald-100/65">
              نشان تأیید یعنی نیکسو مدارک را بررسی کرده است. خرید اشتراک یا دستکاری فرانت نشان جعلی نمی‌سازد.
            </p>
            <Textarea value={docs} onChange={(e) => setDocs(e.target.value)} placeholder="شرح مدارک ثبت شرکت / شناسه کسب‌وکار" />
            <Button type="button" onClick={() => void post({ action: "verify", documents: docs })}>
              درخواست بررسی
            </Button>
          </div>
        )}

        {tab === "Security" && (
          <div className="space-y-2 text-sm leading-7">
            <p>جلوگیری از کلاهبرداری: گزارش Scam / Fake Shop / Fraud از پروفایل عمومی. لینک مخرب و تخفیف جعلی را از همان مسیر گزارش کن.</p>
            <Input value={botId} onChange={(e) => setBotId(e.target.value)} placeholder="شناسه ربات برای FAQ / سفارش" />
            <Button type="button" onClick={() => void post({ action: "attachBot", botId })}>
              اتصال Bot
            </Button>
            <Input value={channelId} onChange={(e) => setChannelId(e.target.value)} placeholder="شناسه کانال رسمی" />
            <Button type="button" onClick={() => void post({ action: "attachChannel", channelId })}>
              اتصال Channel
            </Button>
          </div>
        )}

        <Link href="/app" className="block text-xs text-amber-200">
          بازگشت
        </Link>
      </div>
    </main>
  );
}
