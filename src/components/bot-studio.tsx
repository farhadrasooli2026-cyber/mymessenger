"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { toast } from "sonner";
import { NixoMark } from "@/components/nixo-mark";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { BOT_PERM_FA, DEFAULT_BOT_PERMS, MINI_CATEGORIES, type BotApiPerms } from "@/lib/bot-types";

type Dash = {
  bot: {
    id: string;
    name: string;
    username: string;
    description: string;
    startMessage: string;
    commands: { command: string; description: string }[];
    perms: BotApiPerms;
    tokenHint: string;
    tokenRevoked: boolean;
    webhookUrl: string | null;
    webhookLastStatus: string | null;
    status: string;
  };
  miniApps: { id: string; title: string; category: string }[];
  logs: { id: string; at: number; kind: string; summary: string }[];
  chats: number;
  usage: number;
};

export function BotStudio({ botId }: { botId?: string }) {
  const [name, setName] = useState("");
  const [username, setUsername] = useState("");
  const [description, setDescription] = useState("");
  const [token, setToken] = useState<string | null>(null);
  const [dash, setDash] = useState<Dash | null>(null);
  const [webhook, setWebhook] = useState("");
  const [hookSecret, setHookSecret] = useState<string | null>(null);
  const [groupId, setGroupId] = useState("");
  const [channelId, setChannelId] = useState("");
  const [busy, setBusy] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);

  function load() {
    if (!botId) return;
    fetch(`/api/bots/${botId}`, { cache: "no-store" })
      .then((r) => r.json())
      .then((d) => {
        if (d.ok) {
          setDash(d as Dash);
          setWebhook(d.bot.webhookUrl ?? "");
        }
      })
      .catch(() => undefined);
  }

  useEffect(() => {
    load();
  }, [botId]);

  async function create(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    try {
      const res = await fetch("/api/bots", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, username, description }),
      });
      const data = await res.json();
      if (!res.ok) {
        toast.error(data.error ?? "ساخته نشد.");
        return;
      }
      setToken(data.token);
      toast.success("ربات ساخته شد. توکن را کپی کنید.");
      window.location.href = `/app/bots/${data.bot.id}`;
    } finally {
      setBusy(false);
    }
  }

  async function act(body: Record<string, unknown>, okMsg: string) {
    if (!botId) return;
    setBusy(true);
    try {
      const res = await fetch(`/api/bots/${botId}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = await res.json();
      if (!res.ok) {
        toast.error(data.error ?? "انجام نشد.");
        return;
      }
      if (data.token) setToken(data.token);
      if (data.secret) setHookSecret(data.secret);
      toast.success(okMsg);
      load();
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="min-h-dvh bg-[#071614] p-5 text-emerald-50">
      <div className="mx-auto max-w-lg space-y-4">
        <div className="flex items-center gap-2">
          <NixoMark size={36} />
          <div>
            <p className="text-xs text-amber-200">Developer Dashboard</p>
            <h1 className="text-xl font-semibold">{dash ? `Bot · @${dash.bot.username}` : "Create Bot"}</h1>
          </div>
        </div>
        <p className="text-xs">
          <Link href="/app/bots" className="text-amber-200">Directory</Link>
          {" · "}
          <Link href="/app/settings/bots" className="text-amber-200">ربات‌های من</Link>
        </p>
        {token && (
          <section className="rounded-2xl border border-amber-300/40 bg-amber-300/10 p-4 text-xs leading-6">
            <p>توکن اختصاصی (Secret). در Frontend نگذارید. Revocable / Rotatable.</p>
            <pre className="mt-2 overflow-auto rounded-lg bg-black/40 p-2" dir="ltr">{token}</pre>
          </section>
        )}
        {hookSecret && (
          <p className="text-xs">Webhook secret برای HMAC: <span dir="ltr">{hookSecret}</span></p>
        )}

        {!botId && (
          <form onSubmit={create} className="space-y-3 rounded-2xl bg-white/5 p-4 text-sm">
            <p className="text-xs opacity-70">Create Bot → Name → Username → Description → Create</p>
            <Input required placeholder="Bot Name" value={name} onChange={(e) => setName(e.target.value)} />
            <Input required placeholder="Username مثل nixo_shop" value={username} onChange={(e) => setUsername(e.target.value)} dir="ltr" />
            <Input required placeholder="Description" value={description} onChange={(e) => setDescription(e.target.value)} />
            <Button type="submit" disabled={busy} className="w-full bg-amber-300 text-[#102824]">Create</Button>
          </form>
        )}

        {dash && (
          <>
            <section className="rounded-2xl bg-white/5 p-4 text-xs leading-6">
              <p>وضعیت: {dash.bot.status} · گفتگوهای فعال: {dash.chats} · رخداد فنی: {dash.usage}</p>
              <p>Token: {dash.bot.tokenHint} {dash.bot.tokenRevoked ? "· باطل" : ""}</p>
              <p>Webhook: {dash.bot.webhookLastStatus ?? "تنظیم نشده"}</p>
              <div className="mt-2 flex flex-wrap gap-2">
                <Button type="button" size="sm" disabled={busy} onClick={() => void act({ action: "rotate-token" }, "توکن جدید. قبلی Invalid است.")}>Rotate Token</Button>
                <Button type="button" size="sm" variant="secondary" disabled={busy} onClick={() => void act({ action: "revoke-token" }, "Old Token → Invalid")}>Revoke Token</Button>
              </div>
            </section>
            <section className="rounded-2xl bg-white/5 p-4 text-sm space-y-2">
              <h2 className="font-medium">Webhooks</h2>
              <p className="text-[11px] opacity-70">فقط HTTPS + HMAC Signature + Rate Limit. متن خصوصی کاربر در لاگ نیست.</p>
              <Input dir="ltr" placeholder="https://example.com/nixo-hook" value={webhook} onChange={(e) => setWebhook(e.target.value)} />
              <Button type="button" size="sm" disabled={busy} onClick={() => void act({ action: "webhook", url: webhook }, "Webhook ذخیره شد.")}>ذخیره Webhook</Button>
            </section>
            <section className="rounded-2xl bg-white/5 p-4 text-sm">
              <h2 className="font-medium">Permissions (سمت سرور)</h2>
              <p className="mt-1 text-[11px] opacity-70">مخاطبین، چت خصوصی، گالری، میکروفون، دوربین و موقعیت هرگز از API روشن نمی‌شوند.</p>
              <ul className="mt-2 space-y-1 text-xs">
                {(Object.keys(DEFAULT_BOT_PERMS) as (keyof BotApiPerms)[]).map((k) => (
                  <li key={k} className="flex items-center justify-between gap-2">
                    <span>{BOT_PERM_FA[k]}</span>
                    <button
                      type="button"
                      className="text-amber-200"
                      disabled={["readContacts", "readPrivateChats", "gallery", "microphone", "camera", "location"].includes(k)}
                      onClick={() => void act({ action: "perms", perms: { [k]: !dash.bot.perms[k] } }, "مجوز به‌روز شد.")}
                    >
                      {dash.bot.perms[k] ? "روشن" : "خاموش"}
                    </button>
                  </li>
                ))}
              </ul>
            </section>
            <section className="rounded-2xl bg-white/5 p-4 text-sm space-y-2">
              <h2 className="font-medium">گروه / کانال</h2>
              <Input placeholder="شناسه گروه" value={groupId} onChange={(e) => setGroupId(e.target.value)} />
              <Button type="button" size="sm" disabled={busy} onClick={() => void act({ action: "add-group", groupId, canSend: true, canModerate: false }, "با مجوز مشخص به گروه اضافه شد.")}>افزودن به گروه</Button>
              <Input placeholder="شناسه کانال" value={channelId} onChange={(e) => setChannelId(e.target.value)} />
              <Button type="button" size="sm" disabled={busy} onClick={() => void act({ action: "add-channel", channelId, canPost: true, canModerate: false }, "با مجوز پست به کانال اضافه شد.")}>افزودن به کانال</Button>
            </section>
            <section className="rounded-2xl bg-white/5 p-4 text-sm space-y-2">
              <h2 className="font-medium">Mini App</h2>
              <Button
                type="button"
                size="sm"
                disabled={busy}
                onClick={() =>
                  void act(
                    { action: "mini", title: "فرم نیکسو", category: MINI_CATEGORIES[3].id, description: "فرم داخل سندباکس", paymentHint: true },
                    "مینی‌اپ ثبت شد.",
                  )
                }
              >
                ثبت Mini App نمونه
              </Button>
              <ul className="text-xs">
                {dash.miniApps.map((m) => (
                  <li key={m.id}>
                    <Link href={`/app/mini/${m.id}`} className="text-amber-200">{m.title}</Link>
                  </li>
                ))}
              </ul>
            </section>
            <section className="rounded-2xl bg-white/5 p-4 text-sm">
              <h2 className="font-medium">Logs</h2>
              <ul className="mt-2 max-h-48 space-y-1 overflow-auto text-[11px] opacity-80">
                {dash.logs.map((l) => (
                  <li key={l.id}>{l.kind}: {l.summary}</li>
                ))}
              </ul>
            </section>
            <section className="rounded-2xl border border-red-300/30 p-4 text-sm">
              <h2 className="font-medium">Disable / Delete</h2>
              <label className="mt-2 flex items-center gap-2 text-xs">
                <input type="checkbox" checked={confirmDelete} onChange={(e) => setConfirmDelete(e.target.checked)} />
                تأیید می‌کنم توکن باطل و ربات از Directory خارج شود.
              </label>
              <div className="mt-2 flex gap-2">
                <Button type="button" variant="secondary" disabled={busy || !confirmDelete} onClick={() => void act({ action: "status", status: "disabled", confirm: true }, "غیرفعال شد.")}>Disable</Button>
                <Button type="button" variant="destructive" disabled={busy || !confirmDelete} onClick={() => void act({ action: "status", status: "deleted", confirm: true }, "حذف شد.")}>Delete</Button>
              </div>
            </section>
          </>
        )}
      </div>
    </main>
  );
}
