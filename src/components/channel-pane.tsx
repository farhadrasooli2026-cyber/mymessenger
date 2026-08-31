"use client";

import { useCallback, useEffect, useState } from "react";
import { Flag, Lock, Pin, Radio, Search } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Textarea } from "@/components/ui/textarea";
import { CHANNEL_PERM_FA, formatSubscribers, type ChannelAdminPerms } from "@/lib/channel-types";
import { ROLE_FA } from "@/lib/group-types";

const REACTS = ["❤️", "👍", "😂", "😮", "😢", "🔥"];

type Post = {
  id: string;
  kind: string;
  body: string;
  caption: string;
  status: string;
  scheduledAt: number | null;
  publishedAt: number | null;
  editedAt: number | null;
  reactions: { emoji: string; keys: string[] }[];
  comments: { id: string; authorName: string; body: string }[];
  poll?: { question: string; options: string[]; votes: { indexes: number[] }[] };
  album: string[];
  authorName: string;
};

type Ch = {
  id: string;
  name: string;
  description: string;
  username: string | null;
  color: string;
  visibility: string;
  verified: boolean;
  commentsEnabled: boolean;
  allowForward: boolean;
  discussionGroupId: string | null;
  subscriberCount: number;
  myRole: "owner" | "admin" | "moderator" | null;
  subscribed: boolean;
  notify: "on" | "off" | "important";
  inviteToken: string | null;
  inviteMaxUses: number | null;
  inviteExpiresAt: number | null;
  adminPerms: ChannelAdminPerms;
  pinIds: string[];
  staff: { userId: string; role: string; name: string }[];
  subscribers: { userId: string; name: string; username: string | null }[];
  posts: Post[];
};

export function ChannelPane({
  channelId,
  userIdHint,
  onLeft,
  onOpenGroup,
}: {
  channelId: string;
  userIdHint: string;
  onLeft: () => void;
  onOpenGroup: (id: string) => void;
}) {
  const [channel, setChannel] = useState<Ch | null>(null);
  const [qr, setQr] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  const [caption, setCaption] = useState("");
  const [kind, setKind] = useState("text");
  const [comment, setComment] = useState("");
  const [search, setSearch] = useState("");
  const [inviteKey, setInviteKey] = useState("");
  const [deleteStep, setDeleteStep] = useState(0);
  const [groups, setGroups] = useState<{ id: string; name: string }[]>([]);
  const [pollQ, setPollQ] = useState("");
  const [pollOpts, setPollOpts] = useState("بله\nخیر");

  const load = useCallback(async () => {
    const res = await fetch(`/api/channels/${channelId}`, { cache: "no-store" });
    if (!res.ok) return;
    const data = await res.json();
    setChannel(data.channel as Ch);
  }, [channelId]);

  useEffect(() => {
    fetch(`/api/channels/${channelId}`, { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (d) setChannel(d.channel as Ch);
      })
      .catch(() => undefined);
    fetch("/api/groups", { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (d) setGroups((d.groups ?? []).map((g: { id: string; name: string }) => ({ id: g.id, name: g.name })));
      })
      .catch(() => undefined);
  }, [channelId]);

  useEffect(() => {
    const t = window.setInterval(() => void load(), 5000);
    return () => window.clearInterval(t);
  }, [load]);

  const inviteUrl =
    channel?.inviteToken && typeof window !== "undefined" ? `${window.location.origin}/join/ch/${channel.inviteToken}` : "";

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

  if (!channel) {
    return <div className="flex flex-1 items-center justify-center text-sm text-emerald-100/60">در حال بارگذاری کانال…</div>;
  }

  const staff = Boolean(channel.myRole);
  const visible = channel.posts.filter((p) => (search.trim().length >= 2 ? `${p.body} ${p.caption} ${p.kind}`.includes(search) : true));
  const published = visible.filter((p) => p.status === "published");
  const pins = published.filter((p) => channel.pinIds.includes(p.id));
  const media = published.filter((p) => ["photo", "video", "file", "link", "voice"].includes(p.kind));

  async function act(body: Record<string, unknown>) {
    const res = await fetch(`/api/channels/${channelId}/posts`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const data = await res.json();
    if (!res.ok) toast.error(data.error ?? "انجام نشد.");
    await load();
  }

  return (
    <div className="relative flex min-w-0 flex-1 flex-col">
      <header className="border-b border-white/10 px-4 py-3">
        <div className="flex items-center gap-3">
          <span className="grid size-12 place-items-center rounded-2xl text-lg font-semibold text-[#071614]" style={{ background: channel.color }}>
            {channel.name.slice(0, 1)}
          </span>
          <div className="min-w-0 flex-1">
            <p className="truncate font-medium">
              {channel.name}
              {channel.verified ? <span className="mr-1 text-amber-200">✓</span> : null}
            </p>
            <p className="text-[11px] text-emerald-100/60">
              {channel.username ? `@${channel.username} · ` : ""}
              {formatSubscribers(channel.subscriberCount)} دنبال‌کننده · {channel.visibility === "public" ? "عمومی" : "خصوصی"}
            </p>
          </div>
          {channel.subscribed ? (
            <Button type="button" variant="secondary" onClick={async () => {
              const res = await fetch(`/api/channels/${channelId}/members`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "unsubscribe" }) });
              if (!res.ok) toast.error("خروج انجام نشد.");
              else onLeft();
            }}>
              {channel.myRole === "owner" ? "مشترک" : "لغو دنبال"}
            </Button>
          ) : (
            <Button type="button" className="bg-amber-300 text-[#102824]" onClick={() => void fetch(`/api/channels/${channelId}/members`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "subscribe" }) }).then(load)}>
              دنبال کردن
            </Button>
          )}
        </div>
        <p className="mt-2 text-xs leading-6 text-emerald-100/70">{channel.description}</p>
      </header>
      <ScrollArea className="flex-1">
        <div className="space-y-4 p-4 pb-28">
          {pins.length > 0 && (
            <div className="rounded-2xl border border-amber-300/30 bg-amber-300/10 p-3 text-sm">
              {pins.map((p) => (
                <p key={p.id} className="flex items-center gap-1">
                  <Pin className="size-3" />
                  {p.body || p.caption || p.poll?.question}
                </p>
              ))}
            </div>
          )}

          {staff && (
            <form
              className="space-y-2 rounded-2xl bg-white/5 p-3"
              onSubmit={(e) => {
                e.preventDefault();
                void act({
                  kind,
                  body: kind === "poll" ? pollQ : draft,
                  caption,
                  poll: kind === "poll" ? { question: pollQ, options: pollOpts.split("\n").filter(Boolean), anonymous: true, multiple: false } : undefined,
                  album: kind === "album" ? draft.split("\n") : undefined,
                });
                setDraft("");
                setCaption("");
              }}
            >
              <div className="flex flex-wrap gap-1 text-[11px]">
                {["text", "photo", "video", "voice", "file", "link", "poll", "album"].map((k) => (
                  <button key={k} type="button" className={`rounded px-2 py-1 ${kind === k ? "bg-amber-300 text-[#102824]" : "bg-black/30"}`} onClick={() => setKind(k)}>
                    {k}
                  </button>
                ))}
              </div>
              {kind === "poll" ? (
                <>
                  <Input value={pollQ} onChange={(e) => setPollQ(e.target.value)} placeholder="سؤال نظرسنجی" className="bg-black/20" />
                  <Textarea value={pollOpts} onChange={(e) => setPollOpts(e.target.value)} className="min-h-16 bg-black/20" />
                </>
              ) : (
                <Textarea value={draft} onChange={(e) => setDraft(e.target.value)} placeholder={kind === "album" ? "هر خط یک آیتم آلبوم" : "متن پست"} className="min-h-20 bg-black/20" />
              )}
              {kind === "photo" || kind === "video" ? (
                <Input value={caption} onChange={(e) => setCaption(e.target.value)} placeholder="کپشن" className="bg-black/20" />
              ) : null}
              <div className="flex flex-wrap gap-2">
                <Button type="submit" className="bg-amber-300 text-[#102824]">انتشار</Button>
                <Button type="button" variant="secondary" onClick={() => void act({ kind, body: draft, caption, status: "draft" })}>پیش‌نویس</Button>
                <Button type="button" variant="secondary" onClick={() => void act({ kind, body: draft, caption, status: "scheduled", scheduledAt: Date.now() + 86400000 })}>
                  زمان‌بندی فردا
                </Button>
              </div>
            </form>
          )}

          {visible
            .filter((p) => staff || p.status === "published")
            .map((p) => (
              <article key={p.id} className="rounded-2xl bg-white/5 p-3 text-sm">
                <p className="text-[10px] opacity-60">
                  {p.authorName} · {p.kind}
                  {p.status !== "published" ? ` · ${p.status === "draft" ? "پیش‌نویس" : "زمان‌بندی"}` : ""}
                  {p.editedAt ? " · ویرایش‌شده" : ""}
                </p>
                {p.kind === "poll" && p.poll ? (
                  <div className="mt-2 space-y-1">
                    <p className="font-medium">{p.poll.question}</p>
                    {p.poll.options.map((opt, i) => (
                      <button key={i} type="button" className="block w-full rounded bg-black/20 px-2 py-1 text-right" onClick={() => void act({ action: "vote", postId: p.id, indexes: [i] })}>
                        {opt} · {p.poll!.votes.filter((v) => v.indexes.includes(i)).length}
                      </button>
                    ))}
                  </div>
                ) : p.kind === "album" ? (
                  <ul className="mt-2 list-disc pr-4">{p.album.map((item) => <li key={item}>{item}</li>)}</ul>
                ) : (
                  <p className="mt-1 leading-7">{p.body}</p>
                )}
                {p.caption && <p className="mt-1 text-xs text-emerald-100/70">{p.caption}</p>}
                <div className="mt-2 flex flex-wrap gap-2 text-[11px]">
                  {REACTS.map((e) => (
                    <button key={e} type="button" onClick={() => void act({ action: "react", postId: p.id, emoji: e })}>
                      {e}
                      {p.reactions.find((r) => r.emoji === e)?.keys.length || ""}
                    </button>
                  ))}
                  {staff && (
                    <>
                      <button type="button" onClick={() => void act({ action: channel.pinIds.includes(p.id) ? "unpin" : "pin", postId: p.id })}>پین</button>
                      <button type="button" onClick={() => {
                        const body = window.prompt("ویرایش متن", p.body);
                        if (body == null) return;
                        void act({ action: "edit", postId: p.id, body });
                      }}>ویرایش</button>
                      <button type="button" className="text-rose-200" onClick={() => void act({ action: "delete", postId: p.id })}>حذف</button>
                    </>
                  )}
                  {channel.allowForward && (
                    <button type="button" onClick={() => {
                      void navigator.clipboard.writeText(`${channel.username ? `@${channel.username}` : channel.name}: ${p.body || p.caption}`);
                      toast.message("کپی شد. هدایت طبق تنظیم کانال مجاز است.");
                    }}>هدایت</button>
                  )}
                </div>
                {channel.commentsEnabled && channel.subscribed && (
                  <div className="mt-2 space-y-1">
                    {p.comments.slice(-4).map((c) => (
                      <p key={c.id} className="text-[11px] opacity-80">
                        {c.authorName}: {c.body}
                      </p>
                    ))}
                    <form
                      className="flex gap-1"
                      onSubmit={(e) => {
                        e.preventDefault();
                        void act({ action: "comment", postId: p.id, body: comment });
                        setComment("");
                      }}
                    >
                      <Input value={comment} onChange={(e) => setComment(e.target.value)} placeholder="نظر…" className="h-8 bg-black/20 text-xs" />
                      <Button type="submit" size="sm" variant="secondary">ارسال</Button>
                    </form>
                  </div>
                )}
              </article>
            ))}

          <section className="space-y-2 text-xs">
            <h3 className="text-sm font-medium">رسانه و اطلاعات</h3>
            <p>رسانه: {media.length} مورد (عکس، ویدیو، فایل، لینک، صوت)</p>
            <div className="flex gap-2">
              <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="جستجو در پست‌ها" className="h-9 bg-black/20" />
              <Search className="mt-2 size-4 opacity-50" />
            </div>
            {(["on", "off", "important"] as const).map((mode) => (
              <Button key={mode} type="button" size="sm" variant={channel.notify === mode ? "default" : "secondary"} onClick={() => void fetch(`/api/channels/${channelId}/members`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "notify", notify: mode }) }).then(load)}>
                اعلان {mode === "on" ? "روشن" : mode === "off" ? "خاموش" : "مهم"}
              </Button>
            ))}
            {channel.discussionGroupId && (
              <Button type="button" variant="secondary" onClick={() => onOpenGroup(channel.discussionGroupId!)}>گروه بحث</Button>
            )}
            {staff && (
              <>
                {channel.inviteToken && (
                  <div className="rounded-2xl bg-white/5 p-3">
                    <p>لینک دعوت</p>
                    <p className="mt-1 break-all" dir="ltr">{inviteUrl}</p>
                    {qr && (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={qr} alt="QR کانال" className="mx-auto mt-2 h-36 w-36 rounded-xl" />
                    )}
                    <div className="mt-2 flex flex-wrap gap-1">
                      <Button type="button" size="sm" variant="secondary" onClick={() => void fetch(`/api/channels/${channelId}/invite`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "new", maxUses: 50, expiresInMs: 7 * 86400000 }) }).then(load)}>لینک جدید (۵۰ بار / ۷ روز)</Button>
                      <Button type="button" size="sm" variant="ghost" className="text-rose-200" onClick={() => void fetch(`/api/channels/${channelId}/invite`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "revoke" }) }).then(load)}>باطل</Button>
                    </div>
                  </div>
                )}
                <div className="flex gap-2">
                  <Input value={inviteKey} onChange={(e) => setInviteKey(e.target.value)} placeholder="@username دعوت مستقیم" className="bg-black/20" />
                  <Button type="button" size="sm" variant="secondary" onClick={() => void fetch(`/api/channels/${channelId}/members`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "invite", keys: [inviteKey] }) }).then(load)}>دعوت</Button>
                </div>
                <label className="flex items-center justify-between">
                  نظرات
                  <input type="checkbox" checked={channel.commentsEnabled} onChange={(e) => void fetch(`/api/channels/${channelId}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ commentsEnabled: e.target.checked }) }).then(load)} />
                </label>
                <label className="flex items-center justify-between">
                  اجازهٔ هدایت
                  <input type="checkbox" checked={channel.allowForward} onChange={(e) => void fetch(`/api/channels/${channelId}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ allowForward: e.target.checked }) }).then(load)} />
                </label>
                {channel.myRole === "owner" && (
                  <>
                    <p>گروه بحث</p>
                    <div className="flex flex-wrap gap-1">
                      {groups.map((g) => (
                        <button key={g.id} type="button" className="rounded bg-white/10 px-2 py-1" onClick={() => void fetch(`/api/channels/${channelId}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ discussionGroupId: g.id }) }).then(load)}>
                          {g.name}
                        </button>
                      ))}
                    </div>
                    {(Object.keys(channel.adminPerms) as (keyof ChannelAdminPerms)[]).map((k) => (
                      <label key={k} className="flex items-center justify-between">
                        <span>{CHANNEL_PERM_FA[k]}</span>
                        <input type="checkbox" checked={channel.adminPerms[k]} onChange={(e) => void fetch(`/api/channels/${channelId}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ adminPerms: { ...channel.adminPerms, [k]: e.target.checked } }) }).then(load)} />
                      </label>
                    ))}
                  </>
                )}
                {channel.subscribers.map((s) => (
                  <div key={s.userId} className="flex justify-between">
                    <span>{s.name} {s.username ? `@${s.username}` : ""}</span>
                    {s.userId !== userIdHint && (
                      <span className="flex gap-1">
                        <button type="button" onClick={() => void fetch(`/api/channels/${channelId}/members`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "staff", targetId: s.userId, role: "admin" }) }).then(load)}>ادمین</button>
                        <button type="button" onClick={() => void fetch(`/api/channels/${channelId}/members`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "staff", targetId: s.userId, role: "moderator" }) }).then(load)}>ناظم</button>
                        <button type="button" onClick={() => void fetch(`/api/channels/${channelId}/members`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "remove", targetId: s.userId }) }).then(load)}>حذف</button>
                        <button type="button" className="text-rose-200" onClick={() => void fetch(`/api/channels/${channelId}/members`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "ban", targetId: s.userId }) }).then(load)}>بن</button>
                      </span>
                    )}
                  </div>
                ))}
                {channel.staff.map((s) => (
                  <p key={s.userId}>{s.name} · {ROLE_FA[s.role as "owner"] ?? s.role}</p>
                ))}
              </>
            )}
            {!channel.verified && <p className="text-emerald-100/50">نشان تأیید رسمی وقتی سامانهٔ هویت صفحات آماده شود کنار نام می‌آید. از فرانت‌اند قابل جعل نیست.</p>}
            <Button type="button" variant="ghost" className="text-rose-200" onClick={async () => {
              const res = await fetch("/api/reports", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ targetKind: "channel", targetKey: channelId, category: "spam" }) });
              toast.message(res.ok ? "گزارش ثبت شد." : "گزارش ارسال نشد.");
            }}>
              <Flag className="ml-1 size-3.5" /> گزارش کانال
            </Button>
            {channel.myRole === "owner" && (
              <div className="rounded-2xl border border-rose-400/30 p-3">
                <p>حذف کانال — مرحله {deleteStep + 1} از ۳</p>
                <Button type="button" className="mt-2 bg-rose-500 text-white" onClick={async () => {
                  if (deleteStep < 2) {
                    setDeleteStep((s) => s + 1);
                    return;
                  }
                  await fetch(`/api/channels/${channelId}`, { method: "DELETE" });
                  onLeft();
                }}>
                  {deleteStep === 0 ? "هشدار: برگشت‌ناپذیر است" : deleteStep === 1 ? "تأیید می‌کنم" : "تأیید نهایی و حذف"}
                </Button>
              </div>
            )}
            <p className="flex items-center gap-1 text-[11px] text-emerald-100/50">
              <Lock className="size-3" /> انتشار کانال روی سرور است تا همهٔ دنبال‌کننده‌ها ببینند. نقش ادمین سمت سرور چک می‌شود.
            </p>
            <Radio className="size-3 opacity-40" />
          </section>
        </div>
      </ScrollArea>
    </div>
  );
}
