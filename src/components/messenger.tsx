"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { MessageCircle, Phone, Search, Send, Sparkles, Store, UserRound } from "lucide-react";
import { toast } from "sonner";
import { NixoMark } from "@/components/nixo-mark";
import { nixoSpaces } from "@/lib/brand";
import { cn } from "@/lib/utils";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import { BackgroundPicker, type BgDraft } from "@/components/background-picker";
import { ThemeApplicator } from "@/components/theme-applicator";
import { defaultAppearance, type Appearance, type BackgroundSpec, type BubbleStyle, type TextSize } from "@/lib/appearance-types";
import { backgroundPreview } from "@/lib/background-style";

type Thread = {
  id: string;
  peerKey: string;
  peerName: string;
  peerTitle: string;
  color: string;
  lastText: string;
  lastAt: number;
  background?: BackgroundSpec;
};

type Message = {
  id: string;
  sender: "me" | "peer";
  text: string;
  createdAt: number;
};

type Tab = "chats" | "calls" | "spaces" | "shop" | "me";

export function Messenger({
  displayName,
  identifierMasked,
  username,
  photoUrl,
  bio,
  appearance = defaultAppearance(),
}: {
  displayName: string;
  identifierMasked: string;
  username: string | null;
  photoUrl: string;
  bio: string;
  appearance?: Appearance;
}) {
  const router = useRouter();
  const [tab, setTab] = useState<Tab>("chats");
  const [threads, setThreads] = useState<Thread[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const [story, setStory] = useState<{ title: string; body: string; viewed: boolean } | null>(null);
  const [query, setQuery] = useState("");
  const [hits, setHits] = useState<{ id: string; displayName: string; username: string | null }[]>([]);
  const [bgOpen, setBgOpen] = useState(false);
  const [chatBgDraft, setChatBgDraft] = useState<BgDraft>({ kind: "default" });
  const [mobileChat, setMobileChat] = useState(false);
  const endRef = useRef<HTMLDivElement>(null);

  const active = threads.find((t) => t.id === activeId) ?? null;

  const loadThreads = useCallback(async () => {
    const res = await fetch("/api/chats", { cache: "no-store" });
    if (res.status === 401) {
      router.replace("/");
      return [] as Thread[];
    }
    const data = (await res.json()) as { threads: Thread[] };
    const list = data.threads ?? [];
    setThreads(list);
    return list;
  }, [router]);

  useEffect(() => {
    const ac = new AbortController();
    fetch("/api/chats", { cache: "no-store", signal: ac.signal })
      .then((res) => {
        if (res.status === 401) {
          router.replace("/");
          return null;
        }
        return res.json() as Promise<{ threads: Thread[] }>;
      })
      .then((data) => {
        if (!data) return;
        setThreads(data.threads ?? []);
        setActiveId((current) => current ?? data.threads?.[0]?.id ?? null);
      })
      .catch(() => undefined);
    fetch("/api/story", { signal: ac.signal })
      .then((r) => r.json())
      .then((d) => setStory(d.story ?? null))
      .catch(() => undefined);
    return () => ac.abort();
  }, [router]);

  useEffect(() => {
    if (!activeId) return;
    const ac = new AbortController();
    fetch(`/api/chats/${activeId}`, { cache: "no-store", signal: ac.signal })
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => {
        if (data?.messages) setMessages(data.messages);
      })
      .catch(() => undefined);
    return () => ac.abort();
  }, [activeId]);

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages.length]);

  async function onSend(e: React.FormEvent) {
    e.preventDefault();
    if (!activeId || !draft.trim()) return;
    setBusy(true);
    try {
      const res = await fetch(`/api/chats/${activeId}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text: draft }),
      });
      if (!res.ok) {
        toast.error("ارسال انجام نشد.");
        return;
      }
      const data = (await res.json()) as { messages: Message[] };
      setMessages(data.messages);
      setDraft("");
      await loadThreads();
    } finally {
      setBusy(false);
    }
  }

  async function openStory() {
    setStoryOpen(true);
    await fetch("/api/story", { method: "POST" });
    setStory((s) => (s ? { ...s, viewed: true } : s));
  }

  async function logout() {
    await fetch("/api/me", { method: "DELETE" });
    router.replace("/");
  }

  const initials = useMemo(() => displayName.slice(0, 1), [displayName]);

  return (
    <div
      className="flex min-h-dvh text-[var(--nixo-text,#ecfdf5)]"
      style={{
        backgroundColor: "var(--nixo-bg,#071614)",
        ...backgroundPreview(appearance.appBackground),
      }}
    >
      <ThemeApplicator appearance={appearance} />
      <nav className="hidden w-20 flex-col items-center gap-3 border-l border-white/10 bg-[#0b2421] py-4 md:flex">
        <NavBtn icon={MessageCircle} label="گفتگو" active={tab === "chats"} onClick={() => setTab("chats")} />
        <NavBtn icon={Phone} label="تماس" active={tab === "calls"} onClick={() => setTab("calls")} />
        <button type="button" onClick={() => setTab("spaces")} aria-label="فضاها">
          <NixoMark size={44} />
        </button>
        <NavBtn icon={Store} label="فروشگاه" active={tab === "shop"} onClick={() => setTab("shop")} />
        <NavBtn icon={UserRound} label="من" active={tab === "me"} onClick={() => setTab("me")} />
      </nav>
      <aside
        className={cn(
          "flex w-full max-w-full flex-col border-white/10 bg-[#0b2421] md:w-[360px] md:border-l",
          mobileChat && "hidden md:flex",
        )}
      >
        <div className="flex items-center justify-between px-4 py-4">
          <div className="flex items-center gap-2">
            <NixoMark size={34} />
            <div>
              <p className="text-sm font-semibold tracking-[0.22em]">NIXO</p>
              <p className="text-[11px] text-emerald-100/60">نیکسو</p>
            </div>
          </div>
          <button
            type="button"
            onClick={openStory}
            className={cn(
              "grid size-11 place-items-center rounded-full border-2",
              story?.viewed ? "border-white/20" : "border-amber-300",
            )}
            aria-label="استوری نیکسو"
          >
            <Sparkles className="size-4 text-amber-200" />
          </button>
        </div>

        <div className="space-y-2 px-4 pb-3">
          <p className="text-xs text-emerald-100/55">گفتگوهای خصوصی · ساده و مستقیم</p>
          <div className="flex gap-2">
            <Input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="جستجو با @username"
              dir="ltr"
              className="h-9 bg-black/20 text-left text-xs"
            />
            <Button
              type="button"
              size="sm"
              variant="secondary"
              onClick={async () => {
                const res = await fetch(`/api/users/search?q=${encodeURIComponent(query)}`);
                const data = await res.json();
                setHits(data.users ?? []);
              }}
            >
              <Search className="size-3.5" />
            </Button>
          </div>
          {hits.map((hit) => (
            <p key={hit.id} className="rounded-lg bg-white/5 px-2 py-1 text-xs">
              {hit.displayName} <span dir="ltr">@{hit.username}</span>
            </p>
          ))}
        </div>

        <ScrollArea className="flex-1">
          <div className="space-y-1 px-2 pb-24">
            {threads.map((thread) => (
              <button
                key={thread.id}
                type="button"
                onClick={() => {
                  setActiveId(thread.id);
                  setMobileChat(true);
                  setTab("chats");
                }}
                className={cn(
                  "flex w-full items-center gap-3 rounded-2xl px-3 py-3 text-right transition",
                  activeId === thread.id ? "bg-emerald-400/12" : "hover:bg-white/5",
                )}
              >
                <span
                  className="grid size-11 place-items-center rounded-2xl text-sm font-semibold text-[#071614]"
                  style={{ background: thread.color }}
                >
                  {thread.peerName.slice(0, 1)}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="flex items-center justify-between gap-2">
                    <span className="truncate font-medium">{thread.peerName}</span>
                    <span className="text-[10px] text-emerald-100/45">{thread.peerTitle}</span>
                  </span>
                  <span className="mt-0.5 block truncate text-xs text-emerald-100/60">{thread.lastText}</span>
                </span>
              </button>
            ))}
          </div>
        </ScrollArea>
      </aside>

      <section
        className={cn(
          "relative min-w-0 flex-1 flex-col",
          mobileChat ? "flex" : "hidden md:flex",
        )}
      >
        {tab === "chats" && active && (
          <>
            <header className="flex items-center gap-3 border-b border-white/10 px-4 py-3">
              <Button
                type="button"
                variant="ghost"
                className="md:hidden text-white hover:bg-white/10"
                onClick={() => setMobileChat(false)}
              >
                گفتگوها
              </Button>
              <span
                className="grid size-10 place-items-center rounded-2xl text-sm font-semibold text-[#071614]"
                style={{ background: active.color }}
              >
                {active.peerName.slice(0, 1)}
              </span>
              <div className="min-w-0 flex-1">
                <p className="truncate font-medium">{active.peerName}</p>
                <p className="text-[11px] text-[color:var(--nixo-accent,#6ee7b7)]/80">رمزنگاری سرتاسری در مسیر طراحی · {active.peerTitle}</p>
              </div>
              <Button
                type="button"
                variant="ghost"
                className="text-xs text-amber-200 hover:bg-white/10"
                onClick={() => {
                  setChatBgDraft(active.background ?? appearance.chatBackground);
                  setBgOpen(true);
                }}
              >
                پس‌زمینه این چت
              </Button>
            </header>
            <div className="relative flex-1 overflow-hidden">
              <div
                className="pointer-events-none absolute inset-0"
                style={backgroundPreview(active.background ?? appearance.chatBackground)}
              />
              <div className="pointer-events-none absolute inset-0 opacity-[0.07]">
                <svg className="h-full w-full">
                  <line x1="8%" y1="0" x2="92%" y2="100%" stroke="#fbbf24" strokeWidth="8" />
                  <line x1="92%" y1="0" x2="8%" y2="100%" stroke="#34d399" strokeWidth="8" />
                </svg>
              </div>
              <ScrollArea className="h-full">
                <div className="relative space-y-3 px-4 py-5">
                  {messages.map((msg) => (
                    <div
                      key={msg.id}
                      className={cn("flex", msg.sender === "me" ? "justify-start" : "justify-end")}
                    >
                      <p
                        className={cn(
                          "max-w-[80%] px-3",
                          bubbleClass(appearance.bubbleStyle),
                          textClass(appearance.textSize),
                          msg.sender === "me"
                            ? "bg-[var(--nixo-bubble,#fbbf24)] text-[var(--nixo-bubble-text,#102824)]"
                            : "bg-black/35 text-[var(--nixo-text,#ecfdf5)]",
                        )}
                      >
                        {msg.text}
                      </p>
                    </div>
                  ))}
                  <div ref={endRef} />
                </div>
              </ScrollArea>
            </div>
            <form onSubmit={onSend} className="flex gap-2 border-t border-white/10 p-3">
              <Input
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                placeholder="پیام به نیکسو..."
                className="h-11 flex-1 border-white/10 bg-black/20"
                maxLength={2000}
              />
              <Button
                type="submit"
                size="lg"
                className="h-11 bg-amber-300 text-[#102824] hover:bg-amber-200"
                disabled={busy || !draft.trim()}
              >
                <Send className="size-4" />
                ارسال
              </Button>
            </form>
          </>
        )}

        {tab === "calls" && <Panel title="تماس" body="تماس صوتی و تصویری با معماری Zero Trust طراحی می‌شود؛ در این برش، مسیر اصلی گفتگوی خصوصی است تا کارهای روزمره پشت منو قایم نشود." />}
        {tab === "shop" && <Panel title="فروشگاه و پرداخت" body="فروشگاه، پرداخت و کیف پول بخشی از نیکسو خواهند بود، جدا از هستهٔ گفتگو و با کمترین دسترسی." />}
        {tab === "spaces" && (
          <div className="flex-1 overflow-auto p-5">
            <h2 className="text-xl font-semibold">فضاهای نیکسو</h2>
            <p className="mt-2 max-w-2xl text-sm leading-7 text-emerald-100/70">
              همهٔ سرویس‌ها در یک هویت جمع می‌شوند. الان گفتگوی خصوصی و استوری زنده‌اند؛ بقیه روی همین مسیر ساخته می‌شوند.
            </p>
            <div className="mt-5 grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
              {nixoSpaces.map((space) => (
                <article
                  key={space.id}
                  className="rounded-2xl border border-white/10 bg-white/5 p-4"
                >
                  <div className="flex items-center justify-between gap-2">
                    <h3 className="font-medium">{space.title}</h3>
                    <span className={cn("text-[10px]", space.live ? "text-amber-200" : "text-emerald-100/40")}>
                      {space.live ? "فعال" : "روی نقشه"}
                    </span>
                  </div>
                  <p className="mt-2 text-xs leading-6 text-emerald-100/65">{space.detail}</p>
                </article>
              ))}
            </div>
          </div>
        )}
        {tab === "me" && (
          <div className="flex-1 space-y-4 p-5">
            <div className="flex items-center gap-3">
              <Avatar className="size-14">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={photoUrl} alt="" className="size-14 rounded-full object-cover" />
                <AvatarFallback className="bg-amber-300 text-[#102824]">{initials}</AvatarFallback>
              </Avatar>
              <div>
                <p className="text-lg font-medium">{displayName}</p>
                {username && (
                  <p className="text-xs text-amber-200" dir="ltr">
                    @{username}
                  </p>
                )}
                <p className="text-xs text-emerald-100/60" dir="ltr">
                  {identifierMasked}
                </p>
              </div>
            </div>
            {bio && <p className="text-sm text-emerald-50/80">{bio}</p>}
            <Link
              href="/app/settings/profile"
              className="inline-flex h-10 items-center justify-center rounded-lg bg-amber-300 px-4 text-sm font-medium text-[#102824]"
            >
              تنظیمات → پروفایل
            </Link>
            <Link href="/app/settings/appearance" className="block text-sm text-amber-200">
              تنظیمات → ظاهر → پس‌زمینه
            </Link>
            <Link href="/app/settings/chat-appearance" className="block text-sm text-amber-200">
              تنظیمات → ظاهر گفتگو → پس‌زمینه چت
            </Link>
            <p className="max-w-xl text-sm leading-7 text-emerald-100/70">
              نام، نام خانوادگی، نام کاربری، بیو و عکس پروفایل از همین مسیر قابل تغییرند و دائمی نیستند.
            </p>
            <Button type="button" variant="outline" className="border-white/15 bg-transparent text-white hover:bg-white/10" onClick={logout}>
              خروج
            </Button>
          </div>
        )}
      </section>

      <nav className="fixed inset-x-0 bottom-0 z-20 grid grid-cols-5 border-t border-white/10 bg-[#0b2421]/95 pb-[env(safe-area-inset-bottom)] md:hidden">
        <NavBtn icon={MessageCircle} label="گفتگو" active={tab === "chats"} onClick={() => { setTab("chats"); setMobileChat(false); }} />
        <NavBtn icon={Phone} label="تماس" active={tab === "calls"} onClick={() => { setTab("calls"); setMobileChat(true); }} />
        <button type="button" className="-mt-4 grid place-items-center" onClick={() => { setTab("spaces"); setMobileChat(true); }} aria-label="فضاهای نیکسو">
          <NixoMark size={52} />
        </button>
        <NavBtn icon={Store} label="فروشگاه" active={tab === "shop"} onClick={() => { setTab("shop"); setMobileChat(true); }} />
        <NavBtn icon={UserRound} label="من" active={tab === "me"} onClick={() => { setTab("me"); setMobileChat(true); }} />
      </nav>

      {storyOpen && story && (
        <div className="fixed inset-0 z-40 grid place-items-center bg-black/70 p-4" onClick={() => setStoryOpen(false)}>
          <article
            className="w-full max-w-md rounded-3xl border border-amber-300/30 bg-[#102824] p-6 shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <p className="text-xs tracking-[0.2em] text-amber-200">STORY</p>
            <h2 className="mt-2 text-2xl font-semibold">{story.title}</h2>
            <p className="mt-4 text-sm leading-8 text-emerald-50/85">{story.body}</p>
            <Button className="mt-6 h-11 w-full bg-amber-300 text-[#102824] hover:bg-amber-200" onClick={() => setStoryOpen(false)}>
              بستن
            </Button>
          </article>
        </div>
      )}
      {bgOpen && active && (
        <div className="fixed inset-0 z-40 grid place-items-center bg-black/70 p-4" onClick={() => setBgOpen(false)}>
          <div className="max-h-[90dvh] w-full max-w-lg overflow-auto rounded-3xl bg-[#102824] p-5" onClick={(e) => e.stopPropagation()}>
            <BackgroundPicker value={chatBgDraft} onChange={setChatBgDraft} label={`پس‌زمینه گفتگو با ${active.peerName}`} />
            <div className="mt-4 flex gap-2">
              <Button type="button" variant="ghost" className="flex-1 text-white" onClick={() => setBgOpen(false)}>انصراف</Button>
              <Button
                type="button"
                className="flex-1 bg-amber-300 text-[#102824]"
                onClick={async () => {
                  const res = await fetch(`/api/chats/${active.id}/appearance`, {
                    method: "PATCH",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ background: chatBgDraft }),
                  });
                  if (!res.ok) {
                    toast.error("پس‌زمینه ذخیره نشد.");
                    return;
                  }
                  const data = await res.json();
                  setThreads((list) => list.map((t) => (t.id === active.id ? { ...t, background: data.background } : t)));
                  setBgOpen(false);
                }}
              >
                اعمال
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function NavBtn({
  icon: Icon,
  label,
  active,
  onClick,
}: {
  icon: typeof MessageCircle;
  label: string;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "flex flex-col items-center gap-1 py-2 text-[10px]",
        active ? "text-amber-200" : "text-emerald-100/55",
      )}
    >
      <Icon className="size-5" />
      {label}
    </button>
  );
}

function bubbleClass(style: BubbleStyle) {
  if (style === "classic") return "rounded-md py-2";
  if (style === "minimal") return "rounded-none border border-white/20 py-2";
  if (style === "compact") return "rounded-lg py-1";
  return "rounded-2xl py-2";
}

function textClass(size: TextSize) {
  if (size === "small") return "text-xs leading-5";
  if (size === "large") return "text-base leading-7";
  if (size === "xl") return "text-lg leading-8";
  return "text-sm leading-7";
}

function Panel({ title, body }: { title: string; body: string }) {
  return (
    <div className="flex flex-1 items-center justify-center p-8">
      <div className="max-w-md rounded-3xl border border-white/10 bg-white/5 p-6 text-center">
        <NixoMark size={48} className="mx-auto" />
        <h2 className="mt-4 text-xl font-semibold">{title}</h2>
        <p className="mt-3 text-sm leading-8 text-emerald-100/70">{body}</p>
      </div>
    </div>
  );
}
