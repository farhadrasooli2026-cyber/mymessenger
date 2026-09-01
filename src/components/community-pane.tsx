"use client";

import { useCallback, useEffect, useState } from "react";
import { Flag, Lock, Megaphone, Search } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Textarea } from "@/components/ui/textarea";
import { MUTE_PRESETS, ROLE_FA, type GroupRole } from "@/lib/group-types";
import { COMMUNITY_PERM_FA, NOTIFY_FA, type CommunityPerms, type NotifyMode } from "@/lib/community-types";

type CInfo = {
  id: string;
  name: string;
  description: string;
  rules: string;
  username: string | null;
  color: string;
  joinMode: string;
  perms: CommunityPerms;
  inviteToken: string | null;
  memberCount: number;
  myRole: GroupRole | null;
  notifyMode: NotifyMode;
  groups: { id: string; name: string; color: string; memberCount: number }[];
  channels: { id: string; name: string; description: string; color: string }[];
  announcements: { id: string; authorName: string; body: string; createdAt: number }[];
  posts: { id: string; channelId: string; authorName: string; kind: string; body: string; createdAt: number }[];
  members: { key: string; kind: string; role: GroupRole; name: string; username: string | null; mutedUntil: number | null }[];
  pendingRequests: { id: string; userId: string; name: string }[];
};

export function CommunityPane({
  communityId,
  userIdHint,
  onLeft,
  onOpenGroup,
}: {
  communityId: string;
  userIdHint: string;
  onLeft: () => void;
  onOpenGroup: (groupId: string) => void;
}) {
  const [community, setCommunity] = useState<CInfo | null>(null);
  const [qr, setQr] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [hits, setHits] = useState<string>("");
  const [announce, setAnnounce] = useState("");
  const [channelName, setChannelName] = useState("");
  const [postDraft, setPostDraft] = useState("");
  const [activeChannel, setActiveChannel] = useState<string | null>(null);
  const [addKey, setAddKey] = useState("");
  const [ownedGroups, setOwnedGroups] = useState<{ id: string; name: string }[]>([]);
  const [deleteStep, setDeleteStep] = useState(0);

  const load = useCallback(async () => {
    const res = await fetch(`/api/communities/${communityId}`, { cache: "no-store" });
    if (!res.ok) return;
    const data = await res.json();
    setCommunity(data.community as CInfo);
  }, [communityId]);

  useEffect(() => {
    fetch(`/api/communities/${communityId}`, { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (d) setCommunity(d.community as CInfo);
      })
      .catch(() => undefined);
    fetch("/api/groups", { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (d) setOwnedGroups((d.groups ?? []).map((g: { id: string; name: string }) => ({ id: g.id, name: g.name })));
      })
      .catch(() => undefined);
  }, [communityId]);

  useEffect(() => {
    const t = window.setInterval(() => void load(), 6000);
    return () => window.clearInterval(t);
  }, [load]);

  const inviteUrl =
    community?.inviteToken && typeof window !== "undefined"
      ? `${window.location.origin}/join/c/${community.inviteToken}`
      : "";

  useEffect(() => {
    if (!inviteUrl) return;
    let cancelled = false;
    import("qrcode")
      .then((QR) => QR.toDataURL(inviteUrl, { width: 220, margin: 1, color: { dark: "#102824", light: "#fef3c7" } }))
      .then((url) => {
        if (!cancelled) setQr(url);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [inviteUrl]);

  if (!community) {
    return <div className="flex flex-1 items-center justify-center text-sm text-emerald-100/60">در حال بارگذاری جامعه…</div>;
  }

  const admin = community.myRole === "owner" || community.myRole === "admin";
  const posts = community.posts.filter((p) => !activeChannel || p.channelId === activeChannel);
  const media = community.posts.filter((p) => p.kind === "photo" || p.kind === "video" || p.kind === "file" || p.kind === "link");

  return (
    <div className="relative flex min-w-0 flex-1 flex-col">
      <header className="flex items-center gap-3 border-b border-white/10 px-4 py-3">
        <span className="grid size-10 place-items-center rounded-2xl text-sm font-semibold text-[#071614]" style={{ background: community.color }}>
          {community.name.slice(0, 1)}
        </span>
        <div className="min-w-0 flex-1">
          <p className="truncate font-medium">{community.name}</p>
          <p className="text-[11px] text-emerald-100/60">
            {community.memberCount} عضو
            {community.username ? ` · @${community.username}` : ""} · {ROLE_FA[community.myRole ?? "member"]}
          </p>
        </div>
      </header>
      <ScrollArea className="flex-1">
        <div className="space-y-5 p-4 pb-24">
          {community.announcements[0] && (
            <section className="rounded-2xl border border-amber-300/30 bg-amber-300/10 p-3">
              <p className="flex items-center gap-1 text-xs text-amber-200">
                <Megaphone className="size-3.5" /> اطلاعیه
              </p>
              <p className="mt-1 text-sm leading-7">{community.announcements[0].body}</p>
            </section>
          )}

          <section>
            <h3 className="text-sm font-medium">کانال‌ها</h3>
            <div className="mt-2 flex flex-wrap gap-2">
              {community.channels.map((ch) => (
                <button
                  key={ch.id}
                  type="button"
                  className={`rounded-xl px-3 py-2 text-xs ${activeChannel === ch.id ? "bg-amber-300 text-[#102824]" : "bg-white/10"}`}
                  onClick={() => setActiveChannel((cur) => (cur === ch.id ? null : ch.id))}
                >
                  {ch.name}
                </button>
              ))}
            </div>
            {admin && (
              <div className="mt-2 flex gap-2">
                <Input value={channelName} onChange={(e) => setChannelName(e.target.value)} placeholder="نام کانال جدید" className="h-9 bg-black/20" />
                <Button
                  type="button"
                  size="sm"
                  variant="secondary"
                  onClick={async () => {
                    const res = await fetch(`/api/communities/${communityId}/spaces`, {
                      method: "POST",
                      headers: { "Content-Type": "application/json" },
                      body: JSON.stringify({ action: "addChannel", name: channelName }),
                    });
                    if (!res.ok) toast.error("کانال اضافه نشد.");
                    else setChannelName("");
                    await load();
                  }}
                >
                  افزودن
                </Button>
              </div>
            )}
            {activeChannel && (
              <form
                className="mt-2 flex gap-2"
                onSubmit={async (e) => {
                  e.preventDefault();
                  const res = await fetch(`/api/communities/${communityId}/posts`, {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ channelId: activeChannel, body: postDraft, kind: /https?:\/\//.test(postDraft) ? "link" : "text" }),
                  });
                  const data = await res.json();
                  if (!res.ok) toast.error(data.error ?? "پست منتشر نشد.");
                  else setPostDraft("");
                  await load();
                }}
              >
                <Input value={postDraft} onChange={(e) => setPostDraft(e.target.value)} placeholder="پست کانال (متن یا لینک)" className="h-10 bg-black/20" />
                <Button type="submit" className="bg-amber-300 text-[#102824]">انتشار</Button>
              </form>
            )}
            <div className="mt-3 space-y-2">
              {posts.slice().reverse().slice(0, 12).map((p) => (
                <article key={p.id} className="rounded-xl bg-white/5 p-3 text-sm">
                  <p className="text-[10px] opacity-60">
                    {p.authorName} · {p.kind}
                  </p>
                  <p className="mt-1 leading-6">{p.body}</p>
                  {(admin || community.myRole === "moderator") && (
                    <button
                      type="button"
                      className="mt-1 text-[10px] text-rose-200"
                      onClick={() =>
                        void fetch(`/api/communities/${communityId}/posts`, {
                          method: "POST",
                          headers: { "Content-Type": "application/json" },
                          body: JSON.stringify({ action: "delete", postId: p.id }),
                        }).then(load)
                      }
                    >
                      حذف
                    </button>
                  )}
                </article>
              ))}
            </div>
          </section>

          <section>
            <h3 className="text-sm font-medium">گروه‌ها</h3>
            <div className="mt-2 space-y-1">
              {community.groups.map((g) => (
                <div key={g.id} className="flex items-center justify-between rounded-xl bg-white/5 px-3 py-2">
                  <button type="button" className="text-right text-sm" onClick={() => onOpenGroup(g.id)}>
                    {g.name} · {g.memberCount} عضو
                  </button>
                  {admin && (
                    <button
                      type="button"
                      className="text-[10px] text-rose-200"
                      onClick={() =>
                        void fetch(`/api/communities/${communityId}/spaces`, {
                          method: "POST",
                          headers: { "Content-Type": "application/json" },
                          body: JSON.stringify({ action: "removeGroup", groupId: g.id }),
                        }).then(load)
                      }
                    >
                      جدا کردن
                    </button>
                  )}
                </div>
              ))}
            </div>
            {admin && (
              <div className="mt-2 flex flex-wrap gap-1">
                {ownedGroups
                  .filter((g) => !community.groups.some((x) => x.id === g.id))
                  .map((g) => (
                    <button
                      key={g.id}
                      type="button"
                      className="rounded bg-white/10 px-2 py-1 text-[11px]"
                      onClick={() =>
                        void fetch(`/api/communities/${communityId}/spaces`, {
                          method: "POST",
                          headers: { "Content-Type": "application/json" },
                          body: JSON.stringify({ action: "addGroup", groupId: g.id }),
                        }).then(load)
                      }
                    >
                      + {g.name}
                    </button>
                  ))}
              </div>
            )}
          </section>

          <section>
            <h3 className="text-sm font-medium">اعضا</h3>
            {admin && (
              <div className="mt-2 flex gap-2">
                <Input value={addKey} onChange={(e) => setAddKey(e.target.value)} placeholder="مخاطب یا @username" className="h-9 bg-black/20" />
                <Button
                  type="button"
                  size="sm"
                  variant="secondary"
                  onClick={async () => {
                    await fetch(`/api/communities/${communityId}/members`, {
                      method: "POST",
                      headers: { "Content-Type": "application/json" },
                      body: JSON.stringify({ action: "add", keys: [addKey.trim()] }),
                    });
                    setAddKey("");
                    await load();
                  }}
                >
                  دعوت
                </Button>
              </div>
            )}
            {community.members.map((m) => (
              <div key={m.key} className="mt-1 flex flex-wrap items-center justify-between gap-1 text-xs">
                <span>
                  {m.name} {m.username ? `@${m.username}` : ""} · {ROLE_FA[m.role]}
                </span>
                {admin && m.key !== userIdHint && (
                  <span className="flex flex-wrap gap-1">
                    {MUTE_PRESETS.map((p) => (
                      <button
                        key={p.id}
                        type="button"
                        className="rounded bg-white/10 px-1"
                        onClick={() =>
                          void fetch(`/api/communities/${communityId}/members`, {
                            method: "POST",
                            headers: { "Content-Type": "application/json" },
                            body: JSON.stringify({ action: "mute", targetKey: m.key, ms: p.ms }),
                          }).then(load)
                        }
                      >
                        {p.label}
                      </button>
                    ))}
                    <button type="button" className="rounded bg-white/10 px-1" onClick={() => void fetch(`/api/communities/${communityId}/members`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "restrict", targetKey: m.key, ms: 86400000 }) }).then(load)}>محدود</button>
                    <button type="button" className="rounded bg-white/10 px-1" onClick={() => void fetch(`/api/communities/${communityId}/members`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "remove", targetKey: m.key }) }).then(load)}>حذف</button>
                    <button type="button" className="rounded bg-rose-500/20 px-1" onClick={() => void fetch(`/api/communities/${communityId}/members`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "ban", targetKey: m.key }) }).then(load)}>بن</button>
                    {community.myRole === "owner" && m.kind === "user" && (
                      <>
                        <button type="button" className="rounded bg-white/10 px-1" onClick={() => void fetch(`/api/communities/${communityId}/members`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "role", targetKey: m.key, role: "admin" }) }).then(load)}>ادمین</button>
                        <button type="button" className="rounded bg-white/10 px-1" onClick={() => void fetch(`/api/communities/${communityId}/members`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "role", targetKey: m.key, role: "moderator" }) }).then(load)}>ناظم</button>
                      </>
                    )}
                  </span>
                )}
              </div>
            ))}
          </section>

          {admin && community.pendingRequests.length > 0 && (
            <section>
              <h3 className="text-sm font-medium">درخواست عضویت</h3>
              {community.pendingRequests.map((r) => (
                <div key={r.id} className="mt-1 flex justify-between text-sm">
                  <span>{r.name}</span>
                  <span className="flex gap-1">
                    <Button type="button" size="sm" onClick={() => void fetch(`/api/communities/${communityId}/requests`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ requestId: r.id, approve: true }) }).then(load)}>تأیید</Button>
                    <Button type="button" size="sm" variant="ghost" onClick={() => void fetch(`/api/communities/${communityId}/requests`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ requestId: r.id, approve: false }) }).then(load)}>رد</Button>
                  </span>
                </div>
              ))}
            </section>
          )}

          <section className="space-y-2">
            <h3 className="text-sm font-medium">اطلاعات جامعه</h3>
            <p className="text-xs leading-6 text-emerald-100/70">{community.description || "بدون توضیحات"}</p>
            {community.rules && <p className="whitespace-pre-wrap text-xs leading-6">{community.rules}</p>}
            {community.inviteToken && (
              <div className="rounded-2xl bg-white/5 p-3">
                <p className="text-sm">لینک دعوت</p>
                <p className="mt-1 break-all text-[11px]" dir="ltr">{inviteUrl}</p>
                {qr && (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={qr} alt="QR جامعه" className="mx-auto mt-2 h-36 w-36 rounded-xl" />
                )}
                {admin && (
                  <div className="mt-2 flex gap-2">
                    <Button type="button" size="sm" variant="secondary" onClick={() => void fetch(`/api/communities/${communityId}/invite`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "new" }) }).then(load)}>لینک جدید</Button>
                    <Button type="button" size="sm" variant="ghost" className="text-rose-200" onClick={() => void fetch(`/api/communities/${communityId}/invite`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "revoke" }) }).then(load)}>باطل کردن</Button>
                  </div>
                )}
              </div>
            )}
            {admin && (
              <>
                <Textarea defaultValue={community.rules} placeholder="قوانین جامعه" className="min-h-20 bg-black/20" onBlur={(e) => void fetch(`/api/communities/${communityId}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ rules: e.target.value }) }).then(load)} />
                <div className="flex gap-2">
                  <Input value={announce} onChange={(e) => setAnnounce(e.target.value)} placeholder="اطلاعیه جدید" className="bg-black/20" />
                  <Button type="button" size="sm" className="bg-amber-300 text-[#102824]" onClick={async () => {
                    const res = await fetch(`/api/communities/${communityId}/announce`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ body: announce }) });
                    if (!res.ok) toast.error("اطلاعیه ثبت نشد.");
                    else setAnnounce("");
                    await load();
                  }}>انتشار</Button>
                </div>
                {(Object.keys(community.perms) as (keyof CommunityPerms)[]).map((k) => (
                  <label key={k} className="flex items-center justify-between text-xs">
                    <span>{COMMUNITY_PERM_FA[k]}</span>
                    <input
                      type="checkbox"
                      checked={community.perms[k]}
                      disabled={community.myRole !== "owner"}
                      onChange={async (e) => {
                        await fetch(`/api/communities/${communityId}`, {
                          method: "PATCH",
                          headers: { "Content-Type": "application/json" },
                          body: JSON.stringify({ perms: { ...community.perms, [k]: e.target.checked } }),
                        });
                        await load();
                      }}
                    />
                  </label>
                ))}
              </>
            )}
            <div className="flex flex-wrap gap-1">
              {(Object.keys(NOTIFY_FA) as NotifyMode[]).map((mode) => (
                <Button
                  key={mode}
                  type="button"
                  size="sm"
                  variant={community.notifyMode === mode ? "default" : "secondary"}
                  onClick={() => void fetch(`/api/communities/${communityId}/members`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "notify", mode }) }).then(load)}
                >
                  {NOTIFY_FA[mode]}
                </Button>
              ))}
            </div>
            <div className="flex gap-2">
              <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="جستجو در گروه، کانال، پست، رسانه" className="h-9 bg-black/20" />
              <Button type="button" size="sm" variant="secondary" onClick={async () => {
                const res = await fetch(`/api/communities/${communityId}/search?q=${encodeURIComponent(search)}`);
                const data = await res.json();
                setHits(`${(data.groups ?? []).length} گروه، ${(data.channels ?? []).length} کانال، ${(data.posts ?? []).length} پست`);
              }}>
                <Search className="size-3.5" />
              </Button>
            </div>
            {hits && <p className="text-xs text-emerald-100/60">{hits}</p>}
            <p className="text-xs">رسانهٔ مشترک: {media.length} مورد در کانال‌ها</p>
            <Button type="button" variant="ghost" className="text-rose-200" onClick={async () => {
              const res = await fetch("/api/reports", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ targetKind: "community", targetKey: communityId, category: "spam" }) });
              toast.message(res.ok ? "گزارش ثبت شد." : "گزارش ارسال نشد.");
            }}>
              <Flag className="ml-1 size-3.5" /> گزارش جامعه
            </Button>
            {community.myRole !== "owner" && (
              <Button type="button" variant="secondary" onClick={async () => {
                if (!confirm("جامعه را ترک می‌کنی؟")) return;
                await fetch(`/api/communities/${communityId}?leave=1`, { method: "DELETE" });
                onLeft();
              }}>ترک جامعه</Button>
            )}
            {community.myRole === "owner" && (
              <div className="rounded-2xl border border-rose-400/30 p-3 text-xs">
                <p>حذف جامعه — مرحله {deleteStep + 1} از ۳</p>
                <Button type="button" className="mt-2 bg-rose-500 text-white" onClick={async () => {
                  if (deleteStep < 2) {
                    setDeleteStep((s) => s + 1);
                    return;
                  }
                  await fetch(`/api/communities/${communityId}`, { method: "DELETE", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ confirm: "DELETE" }) });
                  onLeft();
                }}>
                  {deleteStep === 0 ? "هشدار: برگشت‌ناپذیر است" : deleteStep === 1 ? "تأیید می‌کنم" : "تأیید نهایی و حذف"}
                </Button>
              </div>
            )}
            <p className="flex items-center gap-1 text-[11px] text-emerald-100/50">
              <Lock className="size-3" /> نقش و مجوز روی سرور اعمال می‌شود. پست کانال جامعه برای اعضا روی سرور است؛ گفتگوی گروه همچنان E2EE است.
            </p>
          </section>
        </div>
      </ScrollArea>
    </div>
  );
}
