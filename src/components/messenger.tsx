"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Ban, Flag, Globe, Lock, MessageCircle, Phone, Plus, Radio, Search, Send, Sparkles, Store, Timer, UserRound, Users, Video } from "lucide-react";
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
import { MediaDock } from "@/components/media-dock";
import { MediaBubble } from "@/components/media-bubble";
import { setVoiceSaveAllowed } from "@/lib/voice";
import { defaultAuto, saveAutoSettings, setAutoSaveGallery, type AutoMode } from "@/lib/media";
import { DisappearPicker, msFromChoice, type TimerChoice } from "@/components/disappear-picker";
import { ExpiryBadge } from "@/components/expiry-badge";
import { ViewOnceShield } from "@/components/view-once-shield";
import { labelDisappear, systemCaptureText, systemDisappearText } from "@/lib/disappear";
import { CallStage, type LiveCall } from "@/components/call-stage";
import { CallsTab, type HistoryCall } from "@/components/calls-tab";
import { GroupCreate } from "@/components/group-create";
import { GroupPane } from "@/components/group-pane";
import { CommunityCreate } from "@/components/community-create";
import { CommunityPane } from "@/components/community-pane";
import { ChannelCreate } from "@/components/channel-create";
import { ChannelPane } from "@/components/channel-pane";
import { StoryComposer } from "@/components/story-composer";
import { StoryViewer, type StoryItem } from "@/components/story-viewer";

type StoryRing = {
  ownerId: string;
  name: string;
  username: string | null;
  muted: boolean;
  viewedAll: boolean;
  status: { preset: string; text: string } | null;
  items: StoryItem[];
};

type Thread = {
  id: string;
  peerKey: string;
  peerName: string;
  peerTitle: string;
  color: string;
  lastKind?: "text" | "voice" | "photo" | "video" | "file" | "system" | null;
  lastEnc: "e2ee-v1" | "purged" | null;
  lastCiphertext: string | null;
  lastNonce: string | null;
  lastAt: number;
  updatedAt?: number;
  lastPreview?: string;
  background?: BackgroundSpec;
  disappearAfterMs?: number | null;
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
  kind?: "text" | "voice" | "photo" | "video" | "file" | "system";
  ciphertext?: string;
  nonce?: string;
  enc?: string;
  durationMs?: number | null;
  viewOnce?: boolean;
  expired?: boolean;
  forwarded?: boolean;
  disappearAfterMs?: number | null;
  expireFrom?: "send" | "view" | null;
  expiresAt?: number | null;
  viewedAt?: number | null;
  blobId?: string | null;
  chunkCount?: number | null;
  byteLength?: number | null;
  systemEvent?: { type: "disappear"; ms: number | null } | { type: "capture"; messageId: string } | null;
};

type Tab = "chats" | "calls" | "spaces" | "shop" | "me";

type WireMsg = {
  id: string;
  sender: "me" | "peer";
  createdAt: number;
  enc: string;
  ciphertext: string;
  nonce: string;
  kind?: "text" | "voice" | "photo" | "video" | "file" | "system";
  durationMs?: number | null;
  viewOnce?: boolean;
  expired?: boolean;
  forwarded?: boolean;
  disappearAfterMs?: number | null;
  expireFrom?: "send" | "view" | null;
  expiresAt?: number | null;
  viewedAt?: number | null;
  blobId?: string | null;
  chunkCount?: number | null;
  byteLength?: number | null;
  systemEvent?: { type: "disappear"; ms: number | null } | { type: "capture"; messageId: string } | null;
};

async function mapRemote(threadId: string, raws: WireMsg[]): Promise<Message[]> {
  const key = await loadOrCreateThreadKey(threadId);
  const remote: Message[] = [];
  for (const raw of raws) {
    if (raw.kind === "system") {
      remote.push({
        id: raw.id,
        sender: raw.sender,
        createdAt: raw.createdAt,
        text:
          raw.systemEvent?.type === "disappear"
            ? systemDisappearText(raw.systemEvent.ms)
            : raw.systemEvent?.type === "capture"
              ? systemCaptureText()
              : "رویداد سیستم",
        kind: "system",
        systemEvent: raw.systemEvent,
      });
      continue;
    }
    if (raw.kind === "photo" || raw.kind === "video" || raw.kind === "file") {
      remote.push({
        id: raw.id,
        sender: raw.sender,
        createdAt: raw.createdAt,
        text: "",
        kind: raw.kind,
        enc: raw.enc,
        ciphertext: raw.ciphertext,
        nonce: raw.nonce,
        viewOnce: raw.viewOnce,
        expired: raw.expired || raw.enc !== "e2ee-v1",
        forwarded: raw.forwarded,
        blobId: raw.blobId,
        chunkCount: raw.chunkCount,
        byteLength: raw.byteLength,
        disappearAfterMs: raw.disappearAfterMs,
        expireFrom: raw.expireFrom,
        expiresAt: raw.expiresAt,
        viewedAt: raw.viewedAt,
      });
      continue;
    }
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
        expireFrom: raw.expireFrom,
        expiresAt: raw.expiresAt,
        viewedAt: raw.viewedAt,
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
      remote.push({
        id: raw.id,
        sender: raw.sender,
        createdAt: raw.createdAt,
        text,
        kind: "text",
        disappearAfterMs: raw.disappearAfterMs,
        expireFrom: raw.expireFrom,
        expiresAt: raw.expiresAt,
        viewedAt: raw.viewedAt,
        expired: raw.expired,
      });
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
  userId,
  displayName,
  identifierMasked,
  username,
  photoUrl,
  bio,
  appearance = defaultAppearance(),
}: {
  userId: string;
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
  const [storyRings, setStoryRings] = useState<StoryRing[]>([]);
  const [storyComposer, setStoryComposer] = useState(false);
  const [viewingRing, setViewingRing] = useState<StoryRing | null>(null);
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
  const [sharedOpen, setSharedOpen] = useState(false);
  const [sharedItems, setSharedItems] = useState<Message[]>([]);
  const [viewer, setViewer] = useState<{
    url: string;
    kind: string;
    name?: string;
    viewOnce?: boolean;
    threadId?: string;
    messageId?: string;
  } | null>(null);
  const [autoMedia, setAutoMedia] = useState(defaultAuto());
  const [gallerySave, setGallerySave] = useState(false);
  const [textTimer, setTextTimer] = useState<TimerChoice>("inherit");
  const [customMs, setCustomMs] = useState(120_000);
  const [timerOpen, setTimerOpen] = useState(false);
  const [peerSheet, setPeerSheet] = useState(false);
  const [liveCall, setLiveCall] = useState<LiveCall | null>(null);
  const [callMin, setCallMin] = useState(false);
  const [callHistory, setCallHistory] = useState<HistoryCall[]>([]);
  const [callFilter, setCallFilter] = useState("all");
  const [lowDataCalls, setLowDataCalls] = useState(false);
  const [hideCallLock, setHideCallLock] = useState(false);
  const [callPrivacy, setCallPrivacy] = useState<"everyone" | "contacts" | "nobody" | "selected">("everyone");
  const [groups, setGroups] = useState<{ id: string; name: string; color: string; memberCount: number; updatedAt: number }[]>([]);
  const [activeGroupId, setActiveGroupId] = useState<string | null>(null);
  const [createGroup, setCreateGroup] = useState(false);
  const [communities, setCommunities] = useState<{ id: string; name: string; color: string; memberCount: number }[]>([]);
  const [activeCommunityId, setActiveCommunityId] = useState<string | null>(null);
  const [createCommunity, setCreateCommunity] = useState(false);
  const [pubChannels, setPubChannels] = useState<{ id: string; name: string; color: string; subscriberCount: number; username: string | null }[]>([]);
  const [activeChannelId, setActiveChannelId] = useState<string | null>(null);
  const [createChannel, setCreateChannel] = useState(false);
  const [channelHits, setChannelHits] = useState<{ id: string; name: string; username: string | null; subscriberCount: number }[]>([]);
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
              : thread.lastKind === "photo"
                ? "عکس"
                : thread.lastKind === "video"
                  ? "ویدیو"
                  : thread.lastKind === "file"
                    ? "فایل"
                    : thread.lastKind === "system"
                      ? "تنظیم پیام ناپدیدشونده"
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

  const loadGroups = useCallback(async () => {
    const res = await fetch("/api/groups", { cache: "no-store" });
    if (!res.ok) return;
    const data = (await res.json()) as {
      groups?: { id: string; name: string; color: string; memberCount: number; updatedAt: number }[];
    };
    setGroups(data.groups ?? []);
  }, []);

  const loadCommunities = useCallback(async () => {
    const res = await fetch("/api/communities", { cache: "no-store" });
    if (!res.ok) return;
    const data = (await res.json()) as {
      communities?: { id: string; name: string; color: string; memberCount: number }[];
    };
    setCommunities(data.communities ?? []);
  }, []);

  const loadChannels = useCallback(async () => {
    const res = await fetch("/api/channels", { cache: "no-store" });
    if (!res.ok) return;
    const data = (await res.json()) as {
      channels?: { id: string; name: string; color: string; subscriberCount: number; username: string | null }[];
    };
    setPubChannels(data.channels ?? []);
  }, []);

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
    fetch("/api/stories", { cache: "no-store", signal: ac.signal })
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (d?.rings) setStoryRings(d.rings as StoryRing[]);
      })
      .catch(() => undefined);
    fetch("/api/groups", { cache: "no-store", signal: ac.signal })
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => {
        if (!data) return;
        setGroups(data.groups ?? []);
      })
      .catch(() => undefined);
    fetch("/api/communities", { cache: "no-store", signal: ac.signal })
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => {
        if (!data) return;
        setCommunities(data.communities ?? []);
      })
      .catch(() => undefined);
    fetch("/api/channels", { cache: "no-store", signal: ac.signal })
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => {
        if (!data) return;
        setPubChannels(data.channels ?? []);
      })
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
    const t = window.setInterval(() => {
      void fetch("/api/calls?live=1", { cache: "no-store" })
        .then((r) => (r.ok ? r.json() : null))
        .then((data) => {
          if (!data) return;
          setLowDataCalls(Boolean(data.lowDataCalls));
          setHideCallLock(Boolean(data.hideCallOnLockScreen));
          if (data.callPrivacy) setCallPrivacy(data.callPrivacy);
          const incoming = data.call as LiveCall | null;
          setLiveCall((cur) => {
            if (cur && (cur.status === "active" || cur.direction === "out")) return cur;
            if (incoming && incoming.status === "ringing") return incoming;
            if (cur && cur.direction === "in" && cur.status === "ringing" && !incoming) return null;
            return cur;
          });
        })
        .catch(() => undefined);
    }, 2500);
    return () => window.clearInterval(t);
  }, []);

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
                  disappearAfterMs: (data.thread as Thread).disappearAfterMs ?? t.disappearAfterMs,
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

  useEffect(() => {
    if (!activeId) return;
    const tick = window.setInterval(() => {
      void fetch(`/api/chats/${activeId}`, { cache: "no-store" })
        .then((res) => (res.ok ? res.json() : null))
        .then(async (data) => {
          if (!data) return;
          const remote = await mapRemote(activeId, data.messages as WireMsg[]);
          const key = await loadOrCreateThreadKey(activeId);
          const local = await loadLocalMessages(activeId, key);
          setMessages([...local.map((m) => ({ ...m, local: true as const })), ...remote].sort((a, b) => a.createdAt - b.createdAt));
        })
        .catch(() => undefined);
    }, 2500);
    return () => window.clearInterval(tick);
  }, [activeId]);

  useEffect(() => {
    if (tab !== "calls") return;
    void fetch(`/api/calls?filter=${encodeURIComponent(callFilter)}`, { cache: "no-store" })
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => {
        if (data?.calls) setCallHistory(data.calls as HistoryCall[]);
      })
      .catch(() => undefined);
  }, [tab, callFilter]);

  async function onSend(e: React.FormEvent) {
    e.preventDefault();
    if (!activeId || !draft.trim() || !active?.messagesAllowed) return;
    setBusy(true);
    try {
      const key = await loadOrCreateThreadKey(activeId);
      const envelope = await encryptText(key, draft.trim());
      const disappearAfterMs = msFromChoice(textTimer, customMs);
      const body: Record<string, unknown> = { ...envelope };
      if (disappearAfterMs !== undefined) body.disappearAfterMs = disappearAfterMs;
      const res = await fetch(`/api/chats/${activeId}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
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

  async function startCall(threadId: string, kind: "voice" | "video") {
    const thread = threads.find((t) => t.id === threadId);
    if (thread && !thread.callsAllowed) {
      toast.error("تماس با این شخص محدود شده است.");
      return;
    }
    const res = await fetch("/api/calls", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ threadId, kind }),
    });
    const data = await res.json();
    if (!res.ok) {
      toast.error(data.error ?? "تماس شروع نشد.");
      return;
    }
    setCallMin(false);
    setLiveCall(data.call as LiveCall);
    if ("Notification" in window && Notification.permission === "default") void Notification.requestPermission();
  }

  async function refreshCalls() {
    const res = await fetch(`/api/calls?filter=${encodeURIComponent(callFilter)}`, { cache: "no-store" });
    if (!res.ok) return;
    const data = (await res.json()) as { calls: HistoryCall[] };
    setCallHistory(data.calls ?? []);
  }

  async function sendBusyMessage(threadId: string) {
    const key = await loadOrCreateThreadKey(threadId);
    const envelope = await encryptText(key, "الان نمی‌توانم پاسخ بدهم.");
    await fetch(`/api/chats/${threadId}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(envelope),
    });
    setActiveId(threadId);
    setTab("chats");
    setMobileChat(true);
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

  function refreshStories() {
    fetch("/api/stories", { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (d?.rings) setStoryRings(d.rings as StoryRing[]);
      })
      .catch(() => undefined);
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

        <div className="flex gap-3 overflow-x-auto px-4 pb-3">
          <button type="button" className="shrink-0 text-center" onClick={() => setStoryComposer(true)}>
            <span className="grid size-14 place-items-center rounded-full border-2 border-dashed border-amber-300/70 bg-black/20">
              <Plus className="size-5 text-amber-200" />
            </span>
            <span className="mt-1 block w-14 truncate text-[10px]">افزودن</span>
          </button>
          {storyRings.map((ring) => (
            <button
              key={ring.ownerId}
              type="button"
              className="shrink-0 text-center"
              onClick={() => setViewingRing(ring)}
            >
              <span
                className={cn(
                  "grid size-14 place-items-center rounded-full border-2 text-xs",
                  ring.viewedAll ? "border-white/20" : "border-amber-300",
                  ring.muted && "opacity-50",
                )}
              >
                {ring.name.slice(0, 1)}
              </span>
              <span className="mt-1 block w-14 truncate text-[10px]">
                {ring.ownerId === userId ? "استوری من" : ring.name}
              </span>
              {ring.status?.text || ring.status?.preset ? (
                <span className="block w-14 truncate text-[9px] text-emerald-100/50">
                  {ring.status.text || ring.status.preset}
                </span>
              ) : null}
            </button>
          ))}
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
                const ch = await fetch(`/api/channels?q=${encodeURIComponent(query)}`);
                const found = await ch.json();
                setChannelHits(found.channels ?? []);
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
          {channelHits.map((hit) => (
            <button
              key={hit.id}
              type="button"
              className="block w-full rounded-lg bg-white/5 px-2 py-1 text-right text-xs"
              onClick={() => {
                setActiveChannelId(hit.id);
                setActiveCommunityId(null);
                setActiveGroupId(null);
                setTab("chats");
                setMobileChat(true);
              }}
            >
              کانال {hit.name} {hit.username ? `@${hit.username}` : ""}
            </button>
          ))}
          <Button
            type="button"
            className="h-9 w-full bg-amber-300 text-[#102824]"
            onClick={() => setCreateGroup(true)}
          >
            <Users className="ml-1 size-3.5" />
            ایجاد گروه
          </Button>
          <Button
            type="button"
            variant="secondary"
            className="h-9 w-full"
            onClick={() => setCreateCommunity(true)}
          >
            <Globe className="ml-1 size-3.5" />
            ایجاد جامعه
          </Button>
          <Button
            type="button"
            variant="secondary"
            className="h-9 w-full"
            onClick={() => setCreateChannel(true)}
          >
            <Radio className="ml-1 size-3.5" />
            ایجاد کانال
          </Button>
        </div>

        <ScrollArea className="flex-1">
          <div className="space-y-1 px-2 pb-24">
            {pubChannels.map((ch) => (
              <button
                key={ch.id}
                type="button"
                onClick={() => {
                  setActiveChannelId(ch.id);
                  setActiveCommunityId(null);
                  setActiveGroupId(null);
                  setMobileChat(true);
                  setTab("chats");
                }}
                className={cn(
                  "flex w-full items-center gap-3 rounded-2xl px-3 py-3 text-right transition",
                  activeChannelId === ch.id ? "bg-violet-400/15" : "hover:bg-white/5",
                )}
              >
                <span className="grid size-11 place-items-center rounded-2xl text-sm font-semibold text-[#071614]" style={{ background: ch.color }}>
                  {ch.name.slice(0, 1)}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="flex items-center justify-between gap-2">
                    <span className="truncate font-medium">{ch.name}</span>
                    <span className="text-[10px] text-violet-200">کانال</span>
                  </span>
                  <span className="mt-0.5 block truncate text-xs text-emerald-100/60">
                    {ch.username ? `@${ch.username} · ` : ""}
                    {ch.subscriberCount} دنبال‌کننده
                  </span>
                </span>
              </button>
            ))}
            {communities.map((community) => (
              <button
                key={community.id}
                type="button"
                onClick={() => {
                  setActiveCommunityId(community.id);
                  setActiveGroupId(null);
                  setActiveChannelId(null);
                  setMobileChat(true);
                  setTab("chats");
                }}
                className={cn(
                  "flex w-full items-center gap-3 rounded-2xl px-3 py-3 text-right transition",
                  activeCommunityId === community.id ? "bg-sky-400/15" : "hover:bg-white/5",
                )}
              >
                <span
                  className="grid size-11 place-items-center rounded-2xl text-sm font-semibold text-[#071614]"
                  style={{ background: community.color }}
                >
                  {community.name.slice(0, 1)}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="flex items-center justify-between gap-2">
                    <span className="truncate font-medium">{community.name}</span>
                    <span className="text-[10px] text-sky-200">جامعه</span>
                  </span>
                  <span className="mt-0.5 block truncate text-xs text-emerald-100/60">
                    {community.memberCount} عضو
                  </span>
                </span>
              </button>
            ))}
            {groups.map((group) => (
              <button
                key={group.id}
                type="button"
                onClick={() => {
                  setActiveGroupId(group.id);
                  setActiveCommunityId(null);
                  setActiveChannelId(null);
                  setMobileChat(true);
                  setTab("chats");
                }}
                className={cn(
                  "flex w-full items-center gap-3 rounded-2xl px-3 py-3 text-right transition",
                  activeGroupId === group.id ? "bg-amber-300/15" : "hover:bg-white/5",
                )}
              >
                <span
                  className="grid size-11 place-items-center rounded-2xl text-sm font-semibold text-[#071614]"
                  style={{ background: group.color }}
                >
                  {group.name.slice(0, 1)}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="flex items-center justify-between gap-2">
                    <span className="truncate font-medium">{group.name}</span>
                    <span className="text-[10px] text-amber-200">گروه</span>
                  </span>
                  <span className="mt-0.5 block truncate text-xs text-emerald-100/60">
                    {group.memberCount} عضو
                  </span>
                </span>
              </button>
            ))}
            {threads.map((thread) => (
              <button
                key={thread.id}
                type="button"
                onClick={() => {
                  setActiveId(thread.id);
                  setActiveGroupId(null);
                  setActiveCommunityId(null);
                  setActiveChannelId(null);
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
        {tab === "chats" && activeChannelId ? (
          <div className="flex min-h-0 flex-1 flex-col">
            <Button
              type="button"
              variant="ghost"
              className="md:hidden text-white hover:bg-white/10"
              onClick={() => {
                setActiveChannelId(null);
                setMobileChat(false);
              }}
            >
              گفتگوها
            </Button>
            <ChannelPane
              key={activeChannelId}
              channelId={activeChannelId}
              userIdHint={userId}
              onLeft={() => {
                setActiveChannelId(null);
                void loadChannels();
              }}
              onOpenGroup={(groupId) => {
                setActiveChannelId(null);
                setActiveGroupId(groupId);
              }}
            />
          </div>
        ) : tab === "chats" && activeCommunityId ? (
          <div className="flex min-h-0 flex-1 flex-col">
            <Button
              type="button"
              variant="ghost"
              className="md:hidden text-white hover:bg-white/10"
              onClick={() => {
                setActiveCommunityId(null);
                setMobileChat(false);
              }}
            >
              گفتگوها
            </Button>
            <CommunityPane
              key={activeCommunityId}
              communityId={activeCommunityId}
              userIdHint={userId}
              onLeft={() => {
                setActiveCommunityId(null);
                void loadCommunities();
              }}
              onOpenGroup={(groupId) => {
                setActiveCommunityId(null);
                setActiveGroupId(groupId);
              }}
            />
          </div>
        ) : tab === "chats" && activeGroupId ? (
          <div className="flex min-h-0 flex-1 flex-col">
            <Button
              type="button"
              variant="ghost"
              className="md:hidden text-white hover:bg-white/10"
              onClick={() => {
                setActiveGroupId(null);
                setMobileChat(false);
              }}
            >
              گفتگوها
            </Button>
            <GroupPane
              key={activeGroupId}
              groupId={activeGroupId}
              appearance={appearance}
              userIdHint={userId}
              username={username}
              onLeft={() => {
                setActiveGroupId(null);
                void loadGroups();
              }}
            />
          </div>
        ) : active && (
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
                className="grid size-10 cursor-pointer place-items-center rounded-2xl text-sm font-semibold text-[#071614]"
                style={{ background: active.color }}
                onClick={() => setPeerSheet(true)}
              >
                {active.peerName.slice(0, 1)}
              </span>
              <button type="button" className="min-w-0 flex-1 text-right" onClick={() => setPeerSheet(true)}>
                <p className="truncate font-medium">{active.peerName}</p>
                <p className="flex items-center gap-1 text-[11px] text-[color:var(--nixo-accent,#6ee7b7)]/80">
                  <Lock className="size-3" />
                  رمزنگاری سرتاسری روی این دستگاه · {active.peerTitle}
                </p>
              </button>
              <Button
                type="button"
                variant="ghost"
                className="text-white hover:bg-white/10"
                disabled={!active.callsAllowed}
                onClick={() => void startCall(active.id, "voice")}
                aria-label="تماس صوتی"
              >
                <Phone className="size-4" />
              </Button>
              <Button
                type="button"
                variant="ghost"
                className="text-white hover:bg-white/10"
                disabled={!active.callsAllowed}
                onClick={() => void startCall(active.id, "video")}
                aria-label="تماس تصویری"
              >
                <Video className="size-4" />
              </Button>
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
                className="text-xs text-amber-200 hover:bg-white/10"
                onClick={async () => {
                  const res = await fetch(`/api/chats/${active.id}/media`);
                  const data = await res.json();
                  setSharedItems((data.items ?? []) as Message[]);
                  setSharedOpen(true);
                }}
              >
                رسانه‌ها
              </Button>
              <Button
                type="button"
                variant="ghost"
                className="text-xs text-amber-200 hover:bg-white/10"
                onClick={() => setTimerOpen((v) => !v)}
              >
                <Timer className="size-3.5" />
                {active.disappearAfterMs ? labelDisappear(active.disappearAfterMs) : "تایمر"}
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
            {timerOpen && active && (
              <div className="space-y-2 border-b border-white/10 bg-black/25 px-4 py-3">
                <p className="text-xs font-medium">پیام‌های ناپدیدشونده این گفتگو</p>
                <DisappearPicker
                  value={
                    !active.disappearAfterMs
                      ? "off"
                      : ([10_000, 30_000, 60_000, 3_600_000, 86_400_000, 604_800_000].includes(active.disappearAfterMs)
                          ? ({
                              10000: "10s",
                              30000: "30s",
                              60000: "1m",
                              3600000: "1h",
                              86400000: "1d",
                              604800000: "1w",
                            }[active.disappearAfterMs] as TimerChoice)
                          : "custom")
                  }
                  onChange={async (id) => {
                    if (id === "inherit") return;
                    if (id === "custom") {
                      setCustomMs(active.disappearAfterMs && active.disappearAfterMs > 0 ? active.disappearAfterMs : customMs);
                      return;
                    }
                    const ms = msFromChoice(id, customMs) ?? 0;
                    const res = await fetch(`/api/chats/${active.id}/timer`, {
                      method: "PATCH",
                      headers: { "Content-Type": "application/json" },
                      body: JSON.stringify({ disappearAfterMs: ms === 0 ? null : ms }),
                    });
                    if (!res.ok) {
                      toast.error("تایمر ذخیره نشد.");
                      return;
                    }
                    const data = await res.json();
                    setThreads((list) =>
                      list.map((t) => (t.id === active.id ? { ...t, disappearAfterMs: data.disappearAfterMs } : t)),
                    );
                    const listed = await fetch(`/api/chats/${active.id}`, { cache: "no-store" });
                    if (listed.ok) {
                      const body = (await listed.json()) as { messages: WireMsg[] };
                      const remote = await mapRemote(active.id, body.messages);
                      const key = await loadOrCreateThreadKey(active.id);
                      const local = await loadLocalMessages(active.id, key);
                      setMessages(
                        [...local.map((m) => ({ ...m, local: true as const })), ...remote].sort((a, b) => a.createdAt - b.createdAt),
                      );
                    }
                  }}
                  customMs={customMs}
                  onCustomMs={async (ms) => {
                    setCustomMs(ms);
                    await fetch(`/api/chats/${active.id}/timer`, {
                      method: "PATCH",
                      headers: { "Content-Type": "application/json" },
                      body: JSON.stringify({ disappearAfterMs: ms }),
                    });
                    setThreads((list) => list.map((t) => (t.id === active.id ? { ...t, disappearAfterMs: ms } : t)));
                  }}
                />
                <p className="text-[11px] leading-5 text-emerald-100/55">
                  پیام‌های متنی از لحظهٔ ارسال زمان‌بندی می‌شوند. عکس، ویدیو و صوت ناپدیدشونده پس از مشاهده/پخش. View Once جدا است و فقط یک مشاهده دارد.
                </p>
              </div>
            )}
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
                    msg.kind === "system" ? (
                      <p key={msg.id} className="px-6 text-center text-[11px] leading-6 text-emerald-100/55">
                        {msg.text}
                      </p>
                    ) : (
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
                              expireFrom: msg.expireFrom,
                              expiresAt: msg.expiresAt,
                              viewedAt: msg.viewedAt,
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
                        ) : msg.kind === "photo" || msg.kind === "video" || msg.kind === "file" ? (
                          <MediaBubble
                            msg={{
                              id: msg.id,
                              sender: msg.sender,
                              createdAt: msg.createdAt,
                              enc: msg.enc ?? "e2ee-v1",
                              ciphertext: msg.ciphertext ?? "",
                              nonce: msg.nonce ?? "",
                              kind: msg.kind,
                              blobId: msg.blobId,
                              chunkCount: msg.chunkCount,
                              byteLength: msg.byteLength,
                              viewOnce: msg.viewOnce,
                              expired: msg.expired,
                              forwarded: msg.forwarded,
                              disappearAfterMs: msg.disappearAfterMs,
                              expireFrom: msg.expireFrom,
                              expiresAt: msg.expiresAt,
                              viewedAt: msg.viewedAt,
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
                            onOpen={(url, meta, m) =>
                              setViewer({
                                url,
                                kind: m.kind,
                                name: meta.name,
                                viewOnce: Boolean(m.viewOnce),
                                threadId: active.id,
                                messageId: m.id,
                              })
                            }
                          />
                        ) : (
                          <div className="px-3">
                            <p>{msg.expired ? "این پیام منقضی شد." : msg.text}</p>
                            <ExpiryBadge
                              createdAt={msg.createdAt}
                              expireFrom={msg.expireFrom}
                              disappearAfterMs={msg.disappearAfterMs}
                              expiresAt={msg.expiresAt}
                              viewedAt={msg.viewedAt}
                            />
                          </div>
                        )}
                      </div>
                    </div>
                    )
                  ))}
                  <div ref={endRef} />
                </div>
              </ScrollArea>
            </div>
            <MediaDock
              threadId={active.id}
              disabled={!active.messagesAllowed || busy}
              onSent={async () => {
                const res = await fetch(`/api/chats/${active.id}`, { cache: "no-store" });
                if (!res.ok) return;
                const data = (await res.json()) as { messages: WireMsg[] };
                const remote = await mapRemote(active.id, data.messages);
                const key = await loadOrCreateThreadKey(active.id);
                const local = await loadLocalMessages(active.id, key);
                setMessages([...local.map((m) => ({ ...m, local: true as const })), ...remote].sort((a, b) => a.createdAt - b.createdAt));
                await loadThreads();
              }}
            />
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
              <form onSubmit={onSend} className="flex flex-col gap-2">
                <DisappearPicker
                  value={textTimer}
                  onChange={setTextTimer}
                  customMs={customMs}
                  onCustomMs={setCustomMs}
                  allowInherit
                />
                <div className="flex gap-2">
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
                </div>
              </form>
            </VoiceComposer>
          </div>
        )}

        {tab === "calls" && (
          <CallsTab
            calls={callHistory}
            filter={callFilter}
            onFilter={setCallFilter}
            onCall={(id, kind) => void startCall(id, kind)}
            onDemoIncoming={async (kind) => {
              const res = await fetch("/api/calls/incoming", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ kind }),
              });
              const data = await res.json();
              if (!res.ok) {
                toast.error(data.error ?? "تماس ورودی ساخته نشد.");
                return;
              }
              setCallMin(false);
              setLiveCall(data.call as LiveCall);
            }}
            blockedHint={active && !active.callsAllowed ? "تماس با مخاطب فعلی مسدود است." : undefined}
          />
        )}
        {tab === "shop" && <Panel title="فروشگاه و پرداخت" body="فروشگاه، پرداخت و کیف پول بخشی از نیکسو خواهند بود، جدا از هستهٔ گفتگو و با کمترین دسترسی." />}
        {tab === "spaces" && (
          <div className="flex-1 overflow-auto p-5">
            <h2 className="text-xl font-semibold">فضاهای نیکسو</h2>
            <p className="mt-2 max-w-2xl text-sm leading-7 text-emerald-100/70">
              همهٔ سرویس‌ها در یک هویت جمع می‌شوند. گفتگوی خصوصی، گروه، جامعه، کانال، تماس و E2EE زنده‌اند.
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
                  {space.id === "group" && (
                    <Button
                      type="button"
                      size="sm"
                      className="mt-3 bg-amber-300 text-[#102824]"
                      onClick={() => {
                        setTab("chats");
                        setCreateGroup(true);
                      }}
                    >
                      ساخت گروه
                    </Button>
                  )}
                  {space.id === "community" && (
                    <Button
                      type="button"
                      size="sm"
                      className="mt-3 bg-amber-300 text-[#102824]"
                      onClick={() => {
                        setTab("chats");
                        setCreateCommunity(true);
                      }}
                    >
                      ساخت جامعه
                    </Button>
                  )}
                  {space.id === "channel" && (
                    <Button
                      type="button"
                      size="sm"
                      className="mt-3 bg-amber-300 text-[#102824]"
                      onClick={() => {
                        setTab("chats");
                        setCreateChannel(true);
                      }}
                    >
                      ساخت کانال
                    </Button>
                  )}
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
            <Link href="/app/settings/story" className="block text-sm text-amber-200">
              تنظیمات → حریم خصوصی → استوری
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
            <div className="max-w-xl rounded-2xl border border-white/10 bg-white/5 p-4 text-xs leading-6">
              <p className="text-sm font-medium">دانلود خودکار رسانه</p>
              {(["photos", "videos", "files", "voice"] as const).map((key) => (
                <label key={key} className="mt-2 flex items-center justify-between gap-2">
                  <span>{key === "photos" ? "عکس" : key === "videos" ? "ویدیو" : key === "files" ? "فایل" : "پیام صوتی"}</span>
                  <select
                    className="rounded bg-black/30 px-2 py-1"
                    value={autoMedia[key]}
                    onChange={(e) => {
                      const next = { ...autoMedia, [key]: e.target.value as AutoMode };
                      setAutoMedia(next);
                      saveAutoSettings(next);
                    }}
                  >
                    <option value="always">همیشه</option>
                    <option value="wifi">فقط Wi-Fi</option>
                    <option value="mobile">داده همراه</option>
                    <option value="never">هرگز</option>
                  </select>
                </label>
              ))}
              <label className="mt-3 flex items-center gap-2">
                <input
                  type="checkbox"
                  checked={gallerySave}
                  onChange={(e) => {
                    setGallerySave(e.target.checked);
                    setAutoSaveGallery(e.target.checked);
                  }}
                />
                ذخیرهٔ خودکار عکس‌های دریافتی (دانلود به دستگاه)
              </label>
            </div>
            <div className="max-w-xl rounded-2xl border border-white/10 bg-white/5 p-4 text-xs leading-6">
              <p className="text-sm font-medium">تماس</p>
              <p className="mt-1 text-emerald-100/65">چه کسانی بتوانند با تو تماس بگیرند:</p>
              {(
                [
                  ["everyone", "همه"],
                  ["contacts", "مخاطبین"],
                  ["nobody", "هیچ‌کس"],
                  ["selected", "افراد انتخاب‌شده"],
                ] as const
              ).map(([id, label]) => (
                <label key={id} className="mt-1 flex items-center gap-2">
                  <input
                    type="radio"
                    name="call-privacy"
                    checked={callPrivacy === id}
                    onChange={async () => {
                      setCallPrivacy(id);
                      await fetch("/api/calls/settings", {
                        method: "PATCH",
                        headers: { "Content-Type": "application/json" },
                        body: JSON.stringify({ callPrivacy: id }),
                      });
                    }}
                  />
                  {label}
                </label>
              ))}
              <label className="mt-3 flex items-center gap-2">
                <input
                  type="checkbox"
                  checked={lowDataCalls}
                  onChange={async (e) => {
                    setLowDataCalls(e.target.checked);
                    await fetch("/api/calls/settings", {
                      method: "PATCH",
                      headers: { "Content-Type": "application/json" },
                      body: JSON.stringify({ lowDataCalls: e.target.checked }),
                    });
                  }}
                />
                حالت کم‌مصرف برای تماس تصویری
              </label>
              <label className="mt-2 flex items-center gap-2">
                <input
                  type="checkbox"
                  checked={hideCallLock}
                  onChange={async (e) => {
                    setHideCallLock(e.target.checked);
                    await fetch("/api/calls/settings", {
                      method: "PATCH",
                      headers: { "Content-Type": "application/json" },
                      body: JSON.stringify({ hideCallOnLockScreen: e.target.checked }),
                    });
                  }}
                />
                مخفی کردن نام تماس‌گیرنده در اعلان
              </label>
            </div>
            <div className="max-w-xl rounded-2xl border border-white/10 bg-white/5 p-4">
              <p className="flex items-center gap-2 text-sm font-medium">
                <Lock className="size-4 text-amber-200" />
                امنیت چت نیکسو
              </p>
              <p className="mt-2 text-xs leading-6 text-emerald-100/70">
                پیام‌های خصوصی با AES-GCM روی این دستگاه رمز می‌شوند و سرور فقط پاکت رمزنگاری‌شده را نگه می‌دارد. کلید نخ در همین مرورگر است. پس از انقضا، ciphertext از مسیر عادی حذف می‌شود و در پشتیبان معمولی برنمی‌گردد. View Once و پیام ناپدیدشونده دو قابلیت جدا هستند. نیکسو تضمین نمی‌کند هرگز قابل نفوذ نباشد و نمی‌تواند عکس گرفتن از صفحه با دوربین دستگاه دیگر را ۱۰۰٪ متوقف کند.
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

      {storyComposer && (
        <StoryComposer
          onClose={() => setStoryComposer(false)}
          onPublished={() => {
            setStoryComposer(false);
            refreshStories();
          }}
        />
      )}
      {viewingRing && (
        <StoryViewer
          items={viewingRing.items}
          ownerName={viewingRing.name}
          isOwner={viewingRing.ownerId === userId}
          muted={viewingRing.muted}
          authorId={viewingRing.ownerId}
          onMute={async (muted) => {
            await fetch("/api/stories", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ action: "mute", authorId: viewingRing.ownerId, muted }),
            });
            refreshStories();
          }}
          onClose={() => {
            setViewingRing(null);
            refreshStories();
          }}
          onDeleted={() => refreshStories()}
        />
      )}
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
      {sharedOpen && active && (
        <div className="fixed inset-0 z-40 grid place-items-center bg-black/70 p-4" onClick={() => setSharedOpen(false)}>
          <div className="max-h-[80dvh] w-full max-w-md overflow-auto rounded-3xl bg-[#102824] p-5" onClick={(e) => e.stopPropagation()}>
            <h2 className="text-lg font-semibold">رسانه این گفتگو</h2>
            <div className="mt-3 grid grid-cols-3 gap-2">
              {sharedItems.length === 0 && <p className="col-span-3 text-xs text-emerald-100/60">هنوز عکسی، ویدیویی یا فایلی نیست.</p>}
              {sharedItems.map((item) => (
                <div key={item.id} className="rounded-xl bg-white/5 p-2 text-[10px]">
                  {item.kind === "photo" ? "عکس" : item.kind === "video" ? "ویدیو" : item.kind === "file" ? "فایل" : item.kind === "voice" ? "صوت" : "پیوند"}
                </div>
              ))}
            </div>
            <Button type="button" className="mt-4 w-full bg-amber-300 text-[#102824]" onClick={() => setSharedOpen(false)}>بستن</Button>
          </div>
        </div>
      )}
      {viewer && (
        <div className="fixed inset-0 z-50 grid place-items-center bg-black/85 p-4" onClick={() => setViewer(null)}>
          <ViewOnceShield
            active={Boolean(viewer.viewOnce)}
            threadId={viewer.threadId}
            messageId={viewer.messageId}
            className="max-h-[92dvh] w-full max-w-3xl"
          >
            <div onClick={(e) => e.stopPropagation()}>
            {viewer.kind === "video" ? (
              <video
                src={viewer.url}
                controls={!viewer.viewOnce}
                autoPlay
                disablePictureInPicture
                controlsList="nodownload noplaybackrate noremoteplayback"
                className="max-h-[85dvh] w-full"
                onContextMenu={(e) => e.preventDefault()}
              />
            ) : (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={viewer.url}
                alt={viewer.name ?? ""}
                className="pointer-events-none max-h-[85dvh] w-full object-contain"
                draggable={false}
              />
            )}
            {viewer.viewOnce && (
              <p className="mt-2 text-center text-[11px] leading-5 text-emerald-100/60">
                مشاهدهٔ یک‌بار. نیکسو روی وب تا حد ممکن کپی و اشتراک را محدود می‌کند؛ عکس از صفحه با دستگاه دیگر را نمی‌توان ۱۰۰٪ متوقف کرد.
              </p>
            )}
            <Button type="button" className="mt-3 w-full bg-amber-300 text-[#102824]" onClick={() => setViewer(null)}>بستن</Button>
            </div>
          </ViewOnceShield>
        </div>
      )}
      {peerSheet && active && (
        <div className="fixed inset-0 z-40 grid place-items-center bg-black/70 p-4" onClick={() => setPeerSheet(false)}>
          <div className="w-full max-w-sm rounded-3xl bg-[#102824] p-5" onClick={(e) => e.stopPropagation()}>
            <span
              className="mx-auto grid size-16 place-items-center rounded-3xl text-2xl font-semibold text-[#071614]"
              style={{ background: active.color }}
            >
              {active.peerName.slice(0, 1)}
            </span>
            <h2 className="mt-3 text-center text-lg font-semibold">{active.peerName}</h2>
            <p className="text-center text-xs text-emerald-100/60">{active.peerTitle}</p>
            <div className="mt-4 grid grid-cols-2 gap-2">
              <Button
                type="button"
                className="h-11 bg-amber-300 text-[#102824]"
                disabled={!active.callsAllowed}
                onClick={() => {
                  setPeerSheet(false);
                  void startCall(active.id, "voice");
                }}
              >
                <Phone className="size-4" />
                تماس صوتی
              </Button>
              <Button
                type="button"
                className="h-11 bg-amber-300 text-[#102824]"
                disabled={!active.callsAllowed}
                onClick={() => {
                  setPeerSheet(false);
                  void startCall(active.id, "video");
                }}
              >
                <Video className="size-4" />
                تماس تصویری
              </Button>
            </div>
            {!active.callsAllowed && (
              <p className="mt-3 text-center text-xs text-rose-200">مسدودسازی تماس را قطع کرده است.</p>
            )}
            <Button type="button" variant="ghost" className="mt-3 w-full text-white" onClick={() => setPeerSheet(false)}>
              بستن
            </Button>
          </div>
        </div>
      )}
      {liveCall && (
        <CallStage
          call={liveCall}
          lowData={lowDataCalls}
          hideLockInfo={hideCallLock}
          myName={displayName}
          minimized={callMin}
          onMinimized={setCallMin}
          onClose={() => {
            setLiveCall(null);
            setCallMin(false);
            void refreshCalls();
          }}
          onMessageDecline={() => {
            const id = liveCall.threadId;
            setLiveCall(null);
            void sendBusyMessage(id);
            void refreshCalls();
          }}
        />
      )}
      {createGroup && (
        <GroupCreate
          onClose={() => setCreateGroup(false)}
          onCreated={(id) => {
            setCreateGroup(false);
            setActiveGroupId(id);
            setTab("chats");
            setMobileChat(true);
            void loadGroups();
          }}
        />
      )}
      {createCommunity && (
        <CommunityCreate
          onClose={() => setCreateCommunity(false)}
          onCreated={(id) => {
            setCreateCommunity(false);
            setActiveCommunityId(id);
            setActiveGroupId(null);
            setTab("chats");
            setMobileChat(true);
            void loadCommunities();
          }}
        />
      )}
      {createChannel && (
        <ChannelCreate
          onClose={() => setCreateChannel(false)}
          onCreated={(id) => {
            setCreateChannel(false);
            setActiveChannelId(id);
            setActiveCommunityId(null);
            setActiveGroupId(null);
            setTab("chats");
            setMobileChat(true);
            void loadChannels();
          }}
        />
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
