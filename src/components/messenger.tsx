"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Ban, Flag, Lock, MessageCircle, Phone, Search, Send, Sparkles, Store, UserRound } from "lucide-react";
import { toast } from "sonner";
import { NixoMark } from "@/components/nixo-mark";
import { nixoSpaces } from "@/lib/brand";
import { cn } from "@/lib/utils";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Textarea } from "@/components/ui/textarea";
import { BackgroundPicker, type BgDraft } from "@/components/background-picker";
import { ThemeApplicator } from "@/components/theme-applicator";
import { defaultAppearance, type Appearance, type BackgroundSpec, type BubbleStyle, type TextSize } from "@/lib/appearance-types";
import { backgroundPreview } from "@/lib/background-style";
import { nixoLocalReply, REPORT_CATEGORIES, SEED_PEERS, type ReportCategory } from "@/lib/chat-copy";
import {
  decryptText,
  encryptText,
  loadLocalMessages,
  loadOrCreateIdentity,
  loadOrCreateThreadKey,
  saveLocalMessages,
  type CipherEnvelope,
  type LocalChatMessage,
} from "@/lib/e2ee";
import { VoiceComposer } from "@/components/voice-composer";
import { VoicePlayer } from "@/components/voice-player";
import { setVoiceSaveAllowed } from "@/lib/voice";

type Thread = {
  id: string;
  peerKey: string;
  peerName: string;
  peerTitle: string;
  color: string;
  lastKind?: "text" | "voice" | null;
  lastEnc: "e2ee-v1" | "purged" | null;
  lastCiphertext: string | null;
  lastNonce: string | null;
  lastAt: number;
  updatedAt?: number;
  lastPreview?: string;
  background?: BackgroundSpec;
  blocked: boolean;
  blockedByMe: boolean;
  messagesAllowed: boolean;
  callsAllowed: boolean;
  interactionsAllowed: boolean;
};

type Message = {
  id: string;
  sender: "me" | "peer";
  text: string;
  createdAt: number;
  locked?: boolean;
  local?: boolean;
  kind?: "text" | "voice";
  ciphertext?: string;
  nonce?: string;
  enc?: string;
  durationMs?: number | null;
  viewOnce?: boolean;
  expired?: boolean;
  forwarded?: boolean;
  disappearAfterMs?: number | null;
};

type Tab = "chats" | "calls" | "spaces" | "shop" | "me";

type WireMsg = {
  id: string;
  sender: "me" | "peer";
  createdAt: number;
  enc: string;
  ciphertext: string;
  nonce: string;
  kind?: "text" | "voice";
  durationMs?: number | null;
  viewOnce?: boolean;
  expired?: boolean;
  forwarded?: boolean;
  disappearAfterMs?: number | null;
};

async function mapRemote(threadId: string, raws: WireMsg[]): Promise<Message[]> {
  const key = await loadOrCreateThreadKey(threadId);
  const remote: Message[] = [];
  for (const raw of raws) {
    if (raw.kind === "voice") {
      remote.push({
        id: raw.id,
        sender: raw.sender,
        createdAt: raw.createdAt,
        text: "",
        kind: "voice",
        enc: raw.enc,
        ciphertext: raw.ciphertext,
        nonce: raw.nonce,
        durationMs: raw.durationMs,
        viewOnce: raw.viewOnce,
        expired: raw.expired || raw.enc !== "e2ee-v1",
        forwarded: raw.forwarded,
        disappearAfterMs: raw.disappearAfterMs,
      });
      continue;
    }
    if (raw.enc !== "e2ee-v1") {
      remote.push({
        id: raw.id,
        sender: raw.sender,
        createdAt: raw.createdAt,
        text: "•••• این پیام روی این دستگاه قابل خواندن نیست.",
        locked: true,
      });
      continue;
    }
    try {
      const text = await decryptText(key, { enc: "e2ee-v1", ciphertext: raw.ciphertext, nonce: raw.nonce });
      remote.push({ id: raw.id, sender: raw.sender, createdAt: raw.createdAt, text, kind: "text" });
    } catch {
      remote.push({
        id: raw.id,
        sender: raw.sender,
        createdAt: raw.createdAt,
        text: "•••• کلید این دستگاه برای این پیام موجود نیست.",
        locked: true,
      });
    }
  }
  return remote;
}

async function decryptEnvelope(threadId: string, envelope: CipherEnvelope | null): Promise<string | null> {
  if (!envelope?.ciphertext || !envelope.nonce || envelope.enc !== "e2ee-v1") return null;
  try {
    const key = await loadOrCreateThreadKey(threadId);
    return await decryptText(key, envelope);
  } catch {
    return null;
  }
}

async function ensureIntros(thread: Thread): Promise<LocalChatMessage[]> {
  const key = await loadOrCreateThreadKey(thread.id);
  const existing = await loadLocalMessages(thread.id, key);
  if (existing.length > 0) return existing;
  const seed = SEED_PEERS.find((p) => p.peerKey === thread.peerKey);
  if (!seed) return [];
  const intros: LocalChatMessage[] = seed.messages.map((text, i) => ({
    id: `local-${thread.id}-${i}`,
    sender: "peer",
    text,
    createdAt: thread.lastAt - (seed.messages.length - i) * 12_000,
    local: true,
  }));
  await saveLocalMessages(thread.id, key, intros);
  return intros;
}

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
  const [storyOpen, setStoryOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [hits, setHits] = useState<{ id: string; displayName: string; username: string | null }[]>([]);
  const [bgOpen, setBgOpen] = useState(false);
  const [chatBgDraft, setChatBgDraft] = useState<BgDraft>({ kind: "default" });
  const [mobileChat, setMobileChat] = useState(false);
  const [safetyOpen, setSafetyOpen] = useState(false);
  const [reportOpen, setReportOpen] = useState(false);
  const [reportTarget, setReportTarget] = useState<"chat" | "user">("chat");
  const [reportCategory, setReportCategory] = useState<ReportCategory>("spam");
  const [reportDetails, setReportDetails] = useState("");
  const [blockedList, setBlockedList] = useState<{ peerKey: string; peerName: string; threadId: string | null }[]>([]);
  const [voiceRec, setVoiceRec] = useState(false);
  const [saveVoice, setSaveVoice] = useState(true);
  const endRef = useRef<HTMLDivElement>(null);

  const active = threads.find((t) => t.id === activeId) ?? null;

  const decorateThreads = useCallback(async (list: Thread[]) => {
    const next = await Promise.all(
      list.map(async (thread) => {
        const preview = await decryptEnvelope(
          thread.id,
          thread.lastCiphertext && thread.lastNonce && thread.lastEnc === "e2ee-v1"
            ? { enc: "e2ee-v1", ciphertext: thread.lastCiphertext, nonce: thread.lastNonce }
            : null,
        );
        return {
          ...thread,
          lastPreview:
            thread.lastKind === "voice"
              ? "پیام صوتی"
              : preview ?? (thread.lastCiphertext ? "•••• پیام رمزنگاری‌شده" : "گفتگوی خصوصی"),
        };
      }),
    );
    setThreads(next);
    return next;
  }, []);

  const loadThreads = useCallback(async () => {
    const res = await fetch("/api/chats", { cache: "no-store" });
    if (res.status === 401) {
      router.replace("/");
      return [] as Thread[];
    }
    const data = (await res.json()) as { threads: Thread[] };
    return decorateThreads(data.threads ?? []);
  }, [router, decorateThreads]);

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
        return decorateThreads(data.threads ?? []).then((list) => {
          setActiveId((current) => current ?? list[0]?.id ?? null);
        });
      })
      .catch(() => undefined);
    fetch("/api/story", { signal: ac.signal })
      .then((r) => r.json())
      .then((d) => setStory(d.story ?? null))
      .catch(() => undefined);
    loadOrCreateIdentity()
      .then((identity) =>
        fetch("/api/crypto/keys", {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ publicKey: identity.publicJwk }),
        }),
      )
      .catch(() => undefined);
    return () => ac.abort();
  }, [router, decorateThreads]);

  useEffect(() => {
    if (!activeId) return;
    const ac = new AbortController();
    const threadId = activeId;
    fetch(`/api/chats/${threadId}`, { cache: "no-store", signal: ac.signal })
      .then((res) => (res.ok ? res.json() : null))
      .then(async (data) => {
        if (!data) return;
        const threadMeta = data.thread as Thread;
        const remote = await mapRemote(threadId, data.messages as WireMsg[]);
        const local = await ensureIntros({
          ...threadMeta,
          id: threadId,
          peerKey: threadMeta.peerKey,
          lastAt: threadMeta.updatedAt ?? Date.now(),
        } as Thread);
        const merged = [...local.map((m) => ({ ...m, local: true as const })), ...remote].sort((a, b) => a.createdAt - b.createdAt);
        setMessages(merged);
        setThreads((list) =>
          list.map((t) =>
            t.id === threadId
              ? {
                  ...t,
                  blocked: data.blocked,
                  blockedByMe: data.blockedByMe,
                  messagesAllowed: data.messagesAllowed,
                  callsAllowed: data.callsAllowed,
                  interactionsAllowed: data.interactionsAllowed,
                }
              : t,
          ),
        );
      })
      .catch(() => undefined);
    return () => ac.abort();
  }, [activeId]);

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages.length]);

  async function onSend(e: React.FormEvent) {
    e.preventDefault();
    if (!activeId || !draft.trim() || !active?.messagesAllowed) return;
    setBusy(true);
    try {
      const key = await loadOrCreateThreadKey(activeId);
      const envelope = await encryptText(key, draft.trim());
      const res = await fetch(`/api/chats/${activeId}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(envelope),
      });
      if (res.status === 403) {
        toast.error("پیام، تماس و تعامل با این شخص محدود شده است.");
        await loadThreads();
        return;
      }
      if (!res.ok) {
        toast.error("ارسال انجام نشد.");
        return;
      }
      const data = (await res.json()) as { messages: WireMsg[] };
      const remote = await mapRemote(activeId, data.messages);
      let local = await loadLocalMessages(activeId, key);
      if (active.peerKey === "nixo") {
        const reply: LocalChatMessage = {
          id: `local-reply-${Date.now()}`,
          sender: "peer",
          text: nixoLocalReply(draft.trim()),
          createdAt: Date.now() + 1,
          local: true,
        };
        local = [...local, reply];
        await saveLocalMessages(activeId, key, local);
      }
      setMessages([...local.map((m) => ({ ...m, local: true as const })), ...remote].sort((a, b) => a.createdAt - b.createdAt));
      setDraft("");
      await loadThreads();
    } finally {
      setBusy(false);
    }
  }

  async function toggleBlock(blocked: boolean) {
    if (!active) return;
    const res = await fetch(`/api/chats/${active.id}/block`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ blocked }),
    });
    if (!res.ok) {
      toast.error("تغییر مسدودسازی انجام نشد.");
      return;
    }
    toast.success(blocked ? "این شخص مسدود شد." : "مسدودسازی برداشته شد.");
    setSafetyOpen(false);
    await loadThreads();
  }

  async function submitReport() {
    if (!active) return;
    const res = await fetch("/api/reports", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        targetKind: reportTarget,
        targetKey: reportTarget === "chat" ? active.id : active.peerKey,
        threadId: active.id,
        category: reportCategory,
        details: reportDetails,
      }),
    });
    if (!res.ok) {
      toast.error("گزارش ثبت نشد.");
      return;
    }
    toast.success("گزارش ثبت شد. نیکسو متن پیام را برای گزارش نمی‌گیرد.");
    setReportOpen(false);
    setReportDetails("");
    setSafetyOpen(false);
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

  useEffect(() => {
    if (tab !== "me") return;
    fetch("/api/blocks")
      .then((r) => r.json())
      .then((d) => setBlockedList(d.blocked ?? []))
      .catch(() => undefined);
  }, [tab, threads]);

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
          <p className="text-xs text-emerald-100/55">گفتگوهای خصوصی · رمز روی دستگاه تو</p>
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
                    <span className="truncate font-medium">
                      {thread.peerName}
                      {thread.blockedByMe ? <span className="mr-2 text-[10px] text-rose-300">مسدود</span> : null}
                    </span>
                    <span className="text-[10px] text-emerald-100/45">{thread.peerTitle}</span>
                  </span>
                  <span className="mt-0.5 block truncate text-xs text-emerald-100/60">
                    {thread.lastPreview ?? "گفتگوی خصوصی"}
                  </span>
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
        {active && (
          <div className={cn("relative min-w-0 flex-1 flex-col", tab === "chats" ? "flex" : "hidden")}
          >
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
                <p className="flex items-center gap-1 text-[11px] text-[color:var(--nixo-accent,#6ee7b7)]/80">
                  <Lock className="size-3" />
                  رمزنگاری سرتاسری روی این دستگاه · {active.peerTitle}
                </p>
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
              <Button
                type="button"
                variant="ghost"
                className="text-white hover:bg-white/10"
                onClick={() => setSafetyOpen((v) => !v)}
              >
                ایمنی
              </Button>
            </header>
            {safetyOpen && (
              <div className="flex flex-wrap gap-2 border-b border-white/10 bg-black/25 px-4 py-2">
                {active.blockedByMe ? (
                  <Button type="button" size="sm" variant="secondary" onClick={() => toggleBlock(false)}>
                    رفع مسدودسازی
                  </Button>
                ) : (
                  <Button type="button" size="sm" variant="secondary" onClick={() => toggleBlock(true)}>
                    <Ban className="size-3.5" />
                    مسدود کردن
                  </Button>
                )}
                <Button
                  type="button"
                  size="sm"
                  variant="secondary"
                  onClick={() => {
                    setReportTarget("user");
                    setReportOpen(true);
                  }}
                >
                  <Flag className="size-3.5" />
                  گزارش کاربر
                </Button>
                <Button
                  type="button"
                  size="sm"
                  variant="secondary"
                  onClick={() => {
                    setReportTarget("chat");
                    setReportOpen(true);
                  }}
                >
                  <Flag className="size-3.5" />
                  گزارش گفتگو
                </Button>
              </div>
            )}
            {active.blocked && (
              <p className="border-b border-rose-400/20 bg-rose-500/10 px-4 py-2 text-xs leading-6 text-rose-100">
                پیام‌ها، تماس‌ها و تعاملات با این شخص محدود شده‌اند.
              </p>
            )}
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
                      <div
                        className={cn(
                          "max-w-[80%]",
                          bubbleClass(appearance.bubbleStyle),
                          textClass(appearance.textSize),
                          msg.locked
                            ? "bg-black/50 text-emerald-100/55"
                            : msg.sender === "me"
                              ? "bg-[var(--nixo-bubble,#fbbf24)] text-[var(--nixo-bubble-text,#102824)]"
                              : "bg-black/35 text-[var(--nixo-text,#ecfdf5)]",
                        )}
                      >
                        {msg.kind === "voice" ? (
                          <VoicePlayer
                            msg={{
                              id: msg.id,
                              sender: msg.sender,
                              createdAt: msg.createdAt,
                              enc: msg.enc ?? "e2ee-v1",
                              ciphertext: msg.ciphertext ?? "",
                              nonce: msg.nonce ?? "",
                              durationMs: msg.durationMs,
                              viewOnce: msg.viewOnce,
                              expired: msg.expired,
                              forwarded: msg.forwarded,
                              disappearAfterMs: msg.disappearAfterMs,
                            }}
                            threadId={active.id}
                            threads={threads}
                            onGone={async () => {
                              const res = await fetch(`/api/chats/${active.id}`, { cache: "no-store" });
                              if (!res.ok) return;
                              const data = (await res.json()) as { messages: WireMsg[] };
                              const remote = await mapRemote(active.id, data.messages);
                              const key = await loadOrCreateThreadKey(active.id);
                              const local = await loadLocalMessages(active.id, key);
                              setMessages(
                                [...local.map((m) => ({ ...m, local: true as const })), ...remote].sort(
                                  (a, b) => a.createdAt - b.createdAt,
                                ),
                              );
                            }}
                          />
                        ) : (
                          <p className="px-3">{msg.text}</p>
                        )}
                      </div>
                    </div>
                  ))}
                  <div ref={endRef} />
                </div>
              </ScrollArea>
            </div>
            <VoiceComposer
              threadId={active.id}
              disabled={!active.messagesAllowed || busy}
              onRecordingChange={setVoiceRec}
              onSent={async () => {
                const res = await fetch(`/api/chats/${active.id}`, { cache: "no-store" });
                if (!res.ok) return;
                const data = (await res.json()) as { messages: WireMsg[] };
                const remote = await mapRemote(active.id, data.messages);
                const key = await loadOrCreateThreadKey(active.id);
                let local = await loadLocalMessages(active.id, key);
                if (active.peerKey === "nixo") {
                  const reply: LocalChatMessage = {
                    id: `local-reply-${Date.now()}`,
                    sender: "peer",
                    text: nixoLocalReply("پیام صوتی"),
                    createdAt: Date.now() + 1,
                    local: true,
                  };
                  local = [...local, reply];
                  await saveLocalMessages(active.id, key, local);
                }
                setMessages([...local.map((m) => ({ ...m, local: true as const })), ...remote].sort((a, b) => a.createdAt - b.createdAt));
                await loadThreads();
              }}
            >
              <form onSubmit={onSend} className="flex gap-2">
                <Input
                  value={draft}
                  onChange={(e) => setDraft(e.target.value)}
                  placeholder={active.messagesAllowed ? "پیام رمزنگاری‌شده بنویس..." : "ارسال پیام محدود شده است"}
                  className="h-11 flex-1 border-white/10 bg-black/20"
                  maxLength={2000}
                  disabled={!active.messagesAllowed}
                />
                <Button
                  type="submit"
                  size="lg"
                  className="h-11 bg-amber-300 text-[#102824] hover:bg-amber-200"
                  disabled={busy || !draft.trim() || !active.messagesAllowed}
                >
                  <Send className="size-4" />
                  ارسال
                </Button>
              </form>
            </VoiceComposer>
          </div>
        )}

        {tab === "calls" && (
          <Panel
            title="تماس"
            body={
              active && !active.callsAllowed
                ? "تماس با این شخص محدود شده است؛ مسدودسازی پیام، تماس و تعامل را با هم قطع می‌کند. تماس صوتی و تصویری کامل در بخش جداگانهٔ نیکسو پیاده می‌شود."
                : "تماس صوتی و تصویری با معماری Zero Trust در بخش جداگانه پیاده می‌شود. در این برش، اگر کسی را مسدود کنی تماس هم بسته می‌ماند."
            }
          />
        )}
        {tab === "shop" && <Panel title="فروشگاه و پرداخت" body="فروشگاه، پرداخت و کیف پول بخشی از نیکسو خواهند بود، جدا از هستهٔ گفتگو و با کمترین دسترسی." />}
        {tab === "spaces" && (
          <div className="flex-1 overflow-auto p-5">
            <h2 className="text-xl font-semibold">فضاهای نیکسو</h2>
            <p className="mt-2 max-w-2xl text-sm leading-7 text-emerald-100/70">
              همهٔ سرویس‌ها در یک هویت جمع می‌شوند. گفتگوی خصوصی، پیام صوتی، مسدودسازی، گزارش و E2EE زنده‌اند. مدیا، تماس و گروه روی نقشه می‌مانند.
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
            <button
              type="button"
              className="block text-sm text-amber-200"
              onClick={() => {
                const next = !saveVoice;
                setSaveVoice(next);
                setVoiceSaveAllowed(next);
              }}
            >
              ذخیرهٔ پیام صوتی روی دستگاه: {saveVoice ? "مجاز" : "غیرفعال"}
            </button>
            {voiceRec && tab === "me" && (
              <p className="text-xs text-amber-200">ضبط صوتی در پس‌زمینهٔ همین برنامه ادامه دارد.</p>
            )}
            <div className="max-w-xl rounded-2xl border border-white/10 bg-white/5 p-4">
              <p className="flex items-center gap-2 text-sm font-medium">
                <Lock className="size-4 text-amber-200" />
                امنیت چت نیکسو
              </p>
              <p className="mt-2 text-xs leading-6 text-emerald-100/70">
                پیام‌های خصوصی با AES-GCM روی این دستگاه رمز می‌شوند و سرور فقط پاکت رمزنگاری‌شده را نگه می‌دارد. کلید نخ در همین مرورگر است؛ همگام‌سازی چنددستگاهی و بسته‌های ویس/مدیا در بخش جداگانه می‌آید. نیکسو تضمین نمی‌کند هرگز قابل نفوذ نباشد.
              </p>
            </div>
            <div className="max-w-xl rounded-2xl border border-white/10 bg-white/5 p-4">
              <p className="text-sm font-medium">مسدودشده‌ها</p>
              {blockedList.length === 0 ? (
                <p className="mt-2 text-xs text-emerald-100/55">کسی را مسدود نکرده‌ای.</p>
              ) : (
                <ul className="mt-2 space-y-2">
                  {blockedList.map((row) => (
                    <li key={row.peerKey} className="flex items-center justify-between text-sm">
                      <span>{row.peerName}</span>
                      {row.threadId && (
                        <Button
                          type="button"
                          size="sm"
                          variant="ghost"
                          className="text-amber-200"
                          onClick={async () => {
                            await fetch(`/api/chats/${row.threadId}/block`, {
                              method: "POST",
                              headers: { "Content-Type": "application/json" },
                              body: JSON.stringify({ blocked: false }),
                            });
                            await loadThreads();
                          }}
                        >
                          رفع مسدودسازی
                        </Button>
                      )}
                    </li>
                  ))}
                </ul>
              )}
            </div>
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
      {reportOpen && active && (
        <div className="fixed inset-0 z-40 grid place-items-center bg-black/70 p-4" onClick={() => setReportOpen(false)}>
          <div className="w-full max-w-md rounded-3xl bg-[#102824] p-5" onClick={(e) => e.stopPropagation()}>
            <h2 className="text-lg font-semibold">گزارش {reportTarget === "chat" ? "گفتگو" : "کاربر"}</h2>
            <p className="mt-1 text-xs text-emerald-100/60">دسته‌بندی را انتخاب کن. متن پیام برای گزارش به سرور فرستاده نمی‌شود.</p>
            <div className="mt-4 space-y-2">
              {REPORT_CATEGORIES.map((cat) => (
                <label key={cat.id} className="flex items-center gap-2 rounded-xl bg-white/5 px-3 py-2 text-sm">
                  <input
                    type="radio"
                    name="report-cat"
                    checked={reportCategory === cat.id}
                    onChange={() => setReportCategory(cat.id)}
                  />
                  {cat.label}
                </label>
              ))}
            </div>
            <Textarea
              value={reportDetails}
              onChange={(e) => setReportDetails(e.target.value)}
              placeholder="توضیح اختیاری"
              className="mt-3 min-h-20 bg-black/20"
              maxLength={500}
            />
            <div className="mt-4 flex gap-2">
              <Button type="button" variant="ghost" className="flex-1 text-white" onClick={() => setReportOpen(false)}>
                انصراف
              </Button>
              <Button type="button" className="flex-1 bg-amber-300 text-[#102824]" onClick={submitReport}>
                ثبت گزارش
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
