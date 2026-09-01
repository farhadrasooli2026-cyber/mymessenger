"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Ban, Bookmark, Flag, Globe, Lock, MessageCircle, Phone, Plus, Radio, Search, Send, Smile, Sparkles, Sticker, Store, Timer, UserRound, Users, Video } from "lucide-react";
import { toast } from "sonner";
import { NixoMark } from "@/components/nixo-mark";
import { nixoSpaces } from "@/lib/brand";
import { NotifyBell } from "@/components/notify-bell";
import { MUTE_CHAT_PRESETS } from "@/lib/notify-types";
import { InboxList, type InboxItem } from "@/components/inbox-list";
import { cn } from "@/lib/utils";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Textarea } from "@/components/ui/textarea";
import { BackgroundPicker, type BgDraft } from "@/components/background-picker";
import { BusinessDirectory } from "@/components/business-directory";
import { ThemeApplicator } from "@/components/theme-applicator";
import { defaultAppearance, type Appearance, type BackgroundSpec, type BubbleStyle, type TextSize } from "@/lib/appearance-types";
import { backgroundPreview } from "@/lib/background-style";
import { nixoLocalReply, REPORT_CATEGORIES, SEED_PEERS, type ReportCategory } from "@/lib/chat-copy";
import { inspectTextLinks } from "@/lib/link-safety";
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
import { VoiceQueueProvider } from "@/components/voice-queue";
import { MediaDock } from "@/components/media-dock";
import { MediaBubble } from "@/components/media-bubble";
import { EmojiPicker } from "@/components/emoji-picker";
import { StickerPicker } from "@/components/sticker-picker";
import { ReactionBar, type PublicReaction } from "@/components/reaction-bar";
import { setVoiceSaveAllowed } from "@/lib/voice";
import { defaultAuto, saveAutoSettings, setAutoSaveGallery, type AutoMode } from "@/lib/media";
import { DisappearPicker, msFromChoice, type TimerChoice } from "@/components/disappear-picker";
import { ExpiryBadge } from "@/components/expiry-badge";
import { ViewOnceShield } from "@/components/view-once-shield";
import { missedCallChatText } from "@/lib/call-copy";
import { labelDisappear, systemCaptureText, systemDisappearText } from "@/lib/disappear";
import { CallStage, type LiveCall } from "@/components/call-stage";
import { CallsTab, type HistoryCall } from "@/components/calls-tab";
import { GroupCreate } from "@/components/group-create";
import { GroupsDiscover } from "@/components/groups-discover";
import { GroupPane } from "@/components/group-pane";
import { CommunityCreate } from "@/components/community-create";
import { CommunityPane } from "@/components/community-pane";
import { ChannelCreate } from "@/components/channel-create";
import { ChannelPane } from "@/components/channel-pane";
import { AiComposerTools } from "@/components/ai-composer-tools";
import { translateText } from "@/lib/ai-engine";
import { StoryComposer } from "@/components/story-composer";
import { StoryViewer, type StoryItem } from "@/components/story-viewer";
import { SearchPanel } from "@/components/search-panel";
import { ChatSearch } from "@/components/chat-search";
import { SavedPane } from "@/components/saved-pane";
import type { SearchHit } from "@/lib/search-types";

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
  muteUntil?: number | null;
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
  kind?: "text" | "voice" | "photo" | "video" | "file" | "system" | "sticker";
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
  systemEvent?:
    | { type: "disappear"; ms: number | null }
    | { type: "capture"; messageId: string }
    | { type: "missed_call"; callKind: "voice" | "video" }
    | null;
  stickerId?: string | null;
  stickerUrl?: string;
  stickerMissing?: boolean;
  reactions?: PublicReaction[];
  replyToId?: string | null;
  state?: "sent" | "delivered" | "read" | "deleted" | "failed";
  editedAt?: number | null;
  clientNonce?: string | null;
};

type Tab = "chats" | "calls" | "spaces" | "shop" | "me";

type WireMsg = {
  id: string;
  sender: "me" | "peer";
  createdAt: number;
  enc: string;
  ciphertext: string;
  nonce: string;
  kind?: "text" | "voice" | "photo" | "video" | "file" | "system" | "sticker";
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
  systemEvent?:
    | { type: "disappear"; ms: number | null }
    | { type: "capture"; messageId: string }
    | { type: "missed_call"; callKind: "voice" | "video" }
    | null;
  stickerId?: string | null;
  stickerUrl?: string | null;
  stickerMissing?: boolean;
  reactions?: PublicReaction[];
  replyToId?: string | null;
  state?: "sent" | "delivered" | "read" | "deleted";
  editedAt?: number | null;
  editCount?: number | null;
  clientNonce?: string | null;
};

async function mapRemote(threadId: string, raws: WireMsg[]): Promise<Message[]> {
  const key = await loadOrCreateThreadKey(threadId);
  const remote: Message[] = [];
  const meta = (raw: WireMsg) => ({
    replyToId: raw.replyToId ?? null,
    state: raw.state,
    editedAt: raw.editedAt ?? null,
    clientNonce: raw.clientNonce ?? null,
  });
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
              : raw.systemEvent?.type === "missed_call"
                ? missedCallChatText(raw.systemEvent.callKind)
                : "رویداد سیستم",
        kind: "system",
        systemEvent: raw.systemEvent,
        ...meta(raw),
      });
      continue;
    }
    if (raw.kind === "sticker") {
      remote.push({
        id: raw.id,
        sender: raw.sender,
        createdAt: raw.createdAt,
        text: "",
        kind: "sticker",
        stickerId: raw.stickerId,
        stickerUrl: raw.stickerUrl ?? undefined,
        stickerMissing: Boolean(raw.stickerMissing),
        reactions: raw.reactions,
        forwarded: raw.forwarded,
        ...meta(raw),
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
        reactions: raw.reactions,
        ...meta(raw),
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
        reactions: raw.reactions,
        ...meta(raw),
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
        ...meta(raw),
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
        reactions: raw.reactions,
        ...meta(raw),
      });
    } catch {
      remote.push({
        id: raw.id,
        sender: raw.sender,
        createdAt: raw.createdAt,
        text: "•••• کلید این دستگاه برای این پیام موجود نیست.",
        locked: true,
        ...meta(raw),
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
  const [pendingDeletion, setPendingDeletion] = useState(false);
  const [threads, setThreads] = useState<Thread[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [draft, setDraft] = useState("");
  const [emojiOpen, setEmojiOpen] = useState(false);
  const [stickerOpen, setStickerOpen] = useState(false);
  const [emojiRecent, setEmojiRecent] = useState<string[]>([]);
  const [emojiFavorites, setEmojiFavorites] = useState<string[]>([]);
  const [failedReact, setFailedReact] = useState<Record<string, string>>({});
  const [chatCursor, setChatCursor] = useState<string | null>(null);
  const [peerTyping, setPeerTyping] = useState(false);
  const [replyTo, setReplyTo] = useState<Message | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [story, setStory] = useState<{ title: string; body: string; viewed: boolean } | null>(null);
  const [storyOpen, setStoryOpen] = useState(false);
  const [storyRings, setStoryRings] = useState<StoryRing[]>([]);
  const [storyComposer, setStoryComposer] = useState(false);
  const [viewingRing, setViewingRing] = useState<StoryRing | null>(null);
  const [query, setQuery] = useState("");
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
  const [waitingCall, setWaitingCall] = useState<LiveCall | null>(null);
  const [callMin, setCallMin] = useState(false);
  const [callHistory, setCallHistory] = useState<HistoryCall[]>([]);
  const [callFilter, setCallFilter] = useState("all");
  const [lowDataCalls, setLowDataCalls] = useState(false);
  const [hideCallLock, setHideCallLock] = useState(false);
  const [callPrivacy, setCallPrivacy] = useState<"everyone" | "contacts" | "friends" | "nobody" | "selected">("everyone");
  const [, setGroups] = useState<{ id: string; name: string; color: string; memberCount: number; updatedAt: number }[]>([]);
  const [activeGroupId, setActiveGroupId] = useState<string | null>(null);
  const [createGroup, setCreateGroup] = useState(false);
  const [discoverGroups, setDiscoverGroups] = useState(false);
  const [, setCommunities] = useState<{ id: string; name: string; color: string; memberCount: number }[]>([]);
  const [activeCommunityId, setActiveCommunityId] = useState<string | null>(null);
  const [createCommunity, setCreateCommunity] = useState(false);
  const [, setPubChannels] = useState<{ id: string; name: string; color: string; subscriberCount: number; username: string | null }[]>([]);
  const [activeChannelId, setActiveChannelId] = useState<string | null>(null);
  const [createChannel, setCreateChannel] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const [searchSeed, setSearchSeed] = useState("");
  const [chatSearchOpen, setChatSearchOpen] = useState(false);
  const [savedOpen, setSavedOpen] = useState(false);
  const [highlightMsgId, setHighlightMsgId] = useState<string | null>(null);
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

  const reactOn = useCallback(async (messageId: string, emoji: string) => {
    if (!activeId) return;
    const key = `nixo-react-q:${userId}`;
    const nonce =
      typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : `r-${Date.now()}-${Math.random()}`;
    const send = async (clientNonce: string) => {
      const res = await fetch(`/api/chats/${activeId}/reactions`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ messageId, emoji, clientNonce, intent: "toggle" }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "واکنش ارسال نشد.");
      setFailedReact((prev) => {
        const next = { ...prev };
        delete next[messageId];
        return next;
      });
      setMessages((prev) => prev.map((m) => (m.id === messageId ? { ...m, reactions: data.reactions } : m)));
    };
    try {
      if (typeof navigator !== "undefined" && !navigator.onLine) throw new Error("offline");
      await send(nonce);
    } catch {
      setFailedReact((prev) => ({ ...prev, [messageId]: emoji }));
      try {
        const q = JSON.parse(sessionStorage.getItem(key) || "[]") as { messageId: string; emoji: string; threadId: string; clientNonce?: string }[];
        if (!q.some((x) => x.messageId === messageId && x.emoji === emoji && x.threadId === activeId)) {
          q.push({ messageId, emoji, threadId: activeId, clientNonce: nonce });
          sessionStorage.setItem(key, JSON.stringify(q.slice(-40)));
        }
      } catch {
        /* ignore */
      }
      toast.error("واکنش ارسال نشد. Retry در دسترس است.");
    }
  }, [activeId, userId]);

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
    fetch("/api/stickers", { cache: "no-store", signal: ac.signal })
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (!d?.prefs) return;
        setEmojiRecent(d.prefs.emojiRecent ?? []);
        setEmojiFavorites(d.prefs.emojiFavorites ?? []);
      })
      .catch(() => undefined);
    try {
      const q = JSON.parse(sessionStorage.getItem(`nixo-react-q:${userId}`) || "[]") as { messageId: string; emoji: string; threadId: string; clientNonce?: string }[];
      if (q.length) {
        void (async () => {
          const left: typeof q = [];
          for (const item of q) {
            const res = await fetch(`/api/chats/${item.threadId}/reactions`, {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                messageId: item.messageId,
                emoji: item.emoji,
                clientNonce: item.clientNonce,
                intent: "toggle",
              }),
            });
            if (!res.ok) left.push(item);
          }
          sessionStorage.setItem(`nixo-react-q:${userId}`, JSON.stringify(left));
        })();
      }
    } catch {
      /* ignore */
    }
    loadOrCreateIdentity()
      .then((identity) =>
        fetch("/api/crypto/keys", {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ publicKey: identity.publicJwk }),
        }),
      )
      .catch(() => undefined);
    fetch("/api/me", { cache: "no-store", signal: ac.signal })
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (d?.user?.accountStatus === "pending_deletion") setPendingDeletion(true);
        const notices = (d?.notices ?? []) as { id: string; title: string; detail?: string }[];
        if (!notices.length) return;
        const ids = notices.map((n) => n.id).join(",");
        try {
          if (sessionStorage.getItem("nixo.notices") === ids) return;
          sessionStorage.setItem("nixo.notices", ids);
        } catch {
          /* ignore */
        }
        const first = notices[0]!;
        toast.message(first.title, { description: first.detail ?? "از تنظیمات → امنیت جزئیات را ببینید." });
      })
      .catch(() => undefined);
    return () => ac.abort();
  }, [router, decorateThreads, userId]);

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
          const waiting = (data.waiting as LiveCall | null) ?? null;
          setWaitingCall(waiting && waiting.id !== incoming?.id ? waiting : null);
          setLiveCall((cur) => {
            if (cur && (cur.status === "active" || cur.direction === "out")) return cur;
            if (incoming && (incoming.status === "ringing" || incoming.status === "queued")) {
              try {
                window.dispatchEvent(new Event("nixo:incoming-call"));
              } catch {
                /* ignore */
              }
              return {
                ...incoming,
                mediaToken: data.mediaToken ?? null,
                bridged: Boolean(incoming.bridged),
                peerMicMuted: Boolean((incoming as LiveCall).peerMicMuted),
              };
            }
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
        setChatCursor(typeof data.nextCursor === "string" ? data.nextCursor : null);
        setPeerTyping(Boolean(data.typing));
        void fetch(`/api/chats/${threadId}/read`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({}),
        });
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
    if (!highlightMsgId) return;
    const el = document.querySelector(`[data-msg-id="${highlightMsgId}"]`);
    if (el) el.scrollIntoView({ behavior: "smooth", block: "center" });
  }, [highlightMsgId, messages.length]);

  useEffect(() => {
    if (!activeId) return;
    const typing = draft.trim().length > 0;
    const t = window.setTimeout(() => {
      void fetch("/api/privacy", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "presence", threadId: activeId, typing, recording: voiceRec }),
      });
    }, 400);
    return () => window.clearTimeout(t);
  }, [draft, activeId, voiceRec]);

  useEffect(() => {
    if (!activeId) return;
    const t = window.setTimeout(() => {
      void fetch("/api/inbox", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ key: `dm:${activeId}`, action: "draft", draft }),
      });
    }, 800);
    return () => window.clearTimeout(t);
  }, [draft, activeId]);

  useEffect(() => {
    if (!activeId) return;
    const es = new EventSource(`/api/chats/${activeId}/live`);
    es.onmessage = () => {
      void fetch(`/api/chats/${activeId}?since=${Date.now() - 120_000}`, { cache: "no-store" })
        .then((res) => (res.ok ? res.json() : null))
        .then(async (data) => {
          if (!data) return;
          setPeerTyping(Boolean(data.typing));
          const remote = await mapRemote(activeId, data.messages as WireMsg[]);
          const key = await loadOrCreateThreadKey(activeId);
          const local = await loadLocalMessages(activeId, key);
          setMessages((cur) => {
            const ids = new Set(cur.map((m) => m.id));
            const extra = remote.filter((m) => !ids.has(m.id));
            if (extra.length === 0) {
              return cur.map((m) => {
                const hit = remote.find((r) => r.id === m.id);
                return hit ? { ...m, ...hit } : m;
              });
            }
            return [...local.map((m) => ({ ...m, local: true as const })), ...remote].sort((a, b) => a.createdAt - b.createdAt);
          });
        })
        .catch(() => undefined);
    };
    return () => es.close();
  }, [activeId]);

  useEffect(() => {
    if (!activeId) return;
    const tick = window.setInterval(() => {
      void fetch(`/api/chats/${activeId}`, { cache: "no-store" })
        .then((res) => (res.ok ? res.json() : null))
        .then(async (data) => {
          if (!data) return;
          setPeerTyping(Boolean(data.typing));
          setChatCursor(typeof data.nextCursor === "string" ? data.nextCursor : null);
          const remote = await mapRemote(activeId, data.messages as WireMsg[]);
          const key = await loadOrCreateThreadKey(activeId);
          const local = await loadLocalMessages(activeId, key);
          setMessages([...local.map((m) => ({ ...m, local: true as const })), ...remote].sort((a, b) => a.createdAt - b.createdAt));
        })
        .catch(() => undefined);
    }, 8000);
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
    const linkHit = inspectTextLinks(draft);
    if (linkHit.warn) {
      toast.message("هشدار لینک", { description: linkHit.reason });
    }
    setBusy(true);
    try {
      const key = await loadOrCreateThreadKey(activeId);
      const envelope = await encryptText(key, draft.trim());
      const disappearAfterMs = msFromChoice(textTimer, customMs);
      const clientNonce =
        typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : `n-${Date.now()}`;
      const body: Record<string, unknown> = { ...envelope, clientNonce };
      if (disappearAfterMs !== undefined) body.disappearAfterMs = disappearAfterMs;
      if (replyTo && !editingId) body.replyToId = replyTo.id;
      if (editingId) {
        const res = await fetch(`/api/chats/${activeId}/messages/${editingId}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(envelope),
        });
        if (!res.ok) {
          toast.error("ویرایش انجام نشد.");
          return;
        }
        setEditingId(null);
        setDraft("");
        const listed = await fetch(`/api/chats/${activeId}`, { cache: "no-store" });
        if (listed.ok) {
          const data = (await listed.json()) as { messages: WireMsg[] };
          const remote = await mapRemote(activeId, data.messages);
          const local = await loadLocalMessages(activeId, key);
          setMessages([...local.map((m) => ({ ...m, local: true as const })), ...remote].sort((a, b) => a.createdAt - b.createdAt));
        }
        return;
      }
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
      setReplyTo(null);
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
    setLiveCall({ ...(data.call as LiveCall), mediaToken: data.mediaToken ?? null, bridged: Boolean(data.call?.bridged) });
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

  async function saveToVault(msg: Message, thread: Thread) {
    const res = await fetch("/api/saved", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        kind: msg.kind === "photo" || msg.kind === "video" || msg.kind === "voice" || msg.kind === "file" ? msg.kind : /https?:\/\//.test(msg.text) ? "link" : "message",
        body: msg.text,
        linkUrl: msg.text.match(/https?:\/\/\S+/)?.[0] ?? "",
        fileSize: msg.byteLength ?? 0,
        fileType: msg.kind,
        source: { type: "chat", id: thread.id, name: thread.peerName, messageId: msg.id },
      }),
    });
    if (!res.ok) toast.error("ذخیره نشد.");
    else toast.success("به Saved Messages اضافه شد.");
  }

  function openSearchHit(hit: SearchHit) {
    setSearchOpen(false);
    setSavedOpen(false);
    setActiveGroupId(null);
    setActiveCommunityId(null);
    setActiveChannelId(null);
    if (hit.target.type === "group") {
      setActiveGroupId(hit.target.id);
      setTab("chats");
      setMobileChat(true);
      return;
    }
    if (hit.target.type === "channel") {
      setActiveChannelId(hit.target.id);
      setTab("chats");
      setMobileChat(true);
      return;
    }
    if (hit.target.type === "community") {
      setActiveCommunityId(hit.target.id);
      setTab("chats");
      setMobileChat(true);
      return;
    }
    if (hit.target.type === "saved") {
      setSavedOpen(true);
      setTab("chats");
      setMobileChat(true);
      return;
    }
    if (hit.target.type === "chat") {
      setActiveId(hit.target.id);
      setHighlightMsgId(hit.target.messageId ?? null);
      setTab("chats");
      setMobileChat(true);
      return;
    }
    if (hit.target.type === "bot") {
      router.push(`/app/bots/chat/${hit.target.id}`);
      return;
    }
    if (hit.target.type === "business") {
      router.push(`/app/business/b/${hit.target.id}`);
      return;
    }
    if (hit.target.type === "mini") {
      router.push(`/app/mini/${hit.target.id}`);
      return;
    }
    if (hit.target.type === "product") {
      router.push(`/app/business/b/${hit.target.businessId}/p/${hit.target.id}`);
      return;
    }
    if (hit.target.type === "live") {
      router.push(`/app/live/${hit.target.id}`);
      return;
    }
    if (hit.target.type === "user") {
      void fetch("/api/users/search", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ userId: hit.target.id }),
      });
      const existing = threads.find((t) => t.peerKey === hit.target.id);
      if (existing) {
        setActiveId(existing.id);
        setMobileChat(true);
      } else {
        void fetch("/api/contacts", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action: "open-chat", userId: hit.target.id }),
        })
          .then((r) => r.json())
          .then(async (d) => {
            if (d.thread?.id) {
              await loadThreads();
              setActiveId(d.thread.id);
              setMobileChat(true);
            } else toast.message(d.error ?? "طبق حریم، گفتگو باز نشد.");
          });
      }
    }
  }

  async function logout() {
    try {
      Object.keys(sessionStorage)
        .filter((k) => k.startsWith("nixo-inbox") || k.startsWith("nixo-saved") || k.startsWith("nixo-react-q") || k === "nixo.notices")
        .forEach((k) => sessionStorage.removeItem(k));
    } catch {
      /* ignore */
    }
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

  function openInboxItem(item: InboxItem) {
    void fetch("/api/inbox", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ key: item.key, action: "read" }),
    }).catch(() => undefined);
    setSavedOpen(false);
    if (item.kind === "dm") {
      setActiveId(item.targetId);
      setActiveGroupId(null);
      setActiveCommunityId(null);
      setActiveChannelId(null);
      setDraft(item.draft ?? "");
      setMobileChat(true);
      setTab("chats");
      return;
    }
    setActiveId(null);
    if (item.kind === "group") {
      setActiveGroupId(item.targetId);
      setActiveCommunityId(null);
      setActiveChannelId(null);
      setMobileChat(true);
      setTab("chats");
      return;
    }
    if (item.kind === "community") {
      setActiveCommunityId(item.targetId);
      setActiveGroupId(null);
      setActiveChannelId(null);
      setMobileChat(true);
      setTab("chats");
      return;
    }
    if (item.kind === "channel") {
      setActiveChannelId(item.targetId);
      setActiveGroupId(null);
      setActiveCommunityId(null);
      setMobileChat(true);
      setTab("chats");
      return;
    }
    if (item.kind === "bot") {
      router.push(`/app/bots/chat/${item.targetId}`);
      return;
    }
    if (item.kind === "business") {
      router.push(`/app/business/b/${item.navId ?? item.targetId}/chat`);
    }
  }

  const inboxActiveKey = activeChannelId
    ? `channel:${activeChannelId}`
    : activeCommunityId
      ? `community:${activeCommunityId}`
      : activeGroupId
        ? `group:${activeGroupId}`
        : activeId
          ? `dm:${activeId}`
          : null;

  return (
    <VoiceQueueProvider>
    <div
      className="flex min-h-dvh text-[var(--nixo-text,#ecfdf5)]"
      style={{
        backgroundColor: "var(--nixo-bg,#071614)",
        ...backgroundPreview(appearance.appBackground),
      }}
    >
      <ThemeApplicator appearance={appearance} />
      {pendingDeletion && (
        <div className="fixed inset-x-0 top-0 z-40 bg-amber-300 px-3 py-2 text-center text-xs text-[#102824]">
          حساب در دورهٔ بازیابی حذف است. از تنظیمات ← حساب می‌توانید لغو کنید.{" "}
          <Link href="/app/settings/account" className="underline">
            باز کردن
          </Link>
        </div>
      )}
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
          <div className="flex items-center gap-2">
            <NotifyBell
              onOpen={(href, target) => {
                if (target?.type === "chat") {
                  setActiveId(target.id);
                  setActiveGroupId(null);
                  setActiveCommunityId(null);
                  setActiveChannelId(null);
                  setMobileChat(true);
                  setTab("chats");
                  return;
                }
                if (target?.type === "group") {
                  setActiveId(null);
                  setActiveGroupId(target.id);
                  setActiveCommunityId(null);
                  setActiveChannelId(null);
                  setMobileChat(true);
                  setTab("chats");
                  return;
                }
                if (target?.type === "channel") {
                  setActiveId(null);
                  setActiveGroupId(null);
                  setActiveChannelId(target.id);
                  setMobileChat(true);
                  setTab("chats");
                  return;
                }
                if (target?.type === "call") {
                  setTab("calls");
                  return;
                }
                if (target?.type === "story") {
                  router.push("/app/stories");
                  return;
                }
                if (target?.type === "security") {
                  router.push("/app/settings/security");
                  return;
                }
                router.push(href);
              }}
            />
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
          <Button
            type="button"
            variant="secondary"
            className="h-9 w-full"
            onClick={() => {
              setSearchSeed(query);
              setSearchOpen(true);
            }}
          >
            <Search className="ml-1 size-3.5" />
            جستجوی نیکسو
          </Button>
          <div className="flex gap-2">
            <Input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search Chats · @username یا عبارت…"
              dir="ltr"
              className="h-9 bg-black/20 text-left text-xs"
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  setSearchSeed(query);
                  setSearchOpen(true);
                }
              }}
            />
            <Button
              type="button"
              size="sm"
              variant="secondary"
              onClick={() => {
                setSearchSeed(query);
                setSearchOpen(true);
              }}
            >
              <Search className="size-3.5" />
            </Button>
          </div>
          <Link
            href="/app/contacts"
            className="inline-flex h-9 w-full items-center justify-center rounded-lg bg-amber-300 text-sm font-medium text-[#102824]"
          >
            <UserRound className="ml-1 size-3.5" />
            مخاطبین و افراد
          </Link>
          <Button
            type="button"
            className="h-9 w-full bg-amber-300 text-[#102824]"
            onClick={() => {
              setSavedOpen(true);
              setActiveGroupId(null);
              setActiveCommunityId(null);
              setActiveChannelId(null);
              setTab("chats");
              setMobileChat(true);
            }}
          >
            <Bookmark className="ml-1 size-3.5" />
            Saved Messages
          </Button>
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
            onClick={() => setDiscoverGroups(true)}
          >
            <Search className="ml-1 size-3.5" />
            کشف گروه عمومی
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
          <InboxList accountId={userId} query={query} activeKey={inboxActiveKey} onOpen={openInboxItem} />
        </ScrollArea>
      </aside>

      <section
        className={cn(
          "relative min-w-0 flex-1 flex-col",
          mobileChat ? "flex" : "hidden md:flex",
        )}
      >
        {tab === "chats" && savedOpen ? (
          <div className="flex min-h-0 flex-1 flex-col bg-[#0b2421]/40">
            <SavedPane
              onClose={() => {
                setSavedOpen(false);
                setMobileChat(false);
              }}
              onJumpChat={(threadId, messageId) => {
                setSavedOpen(false);
                setActiveId(threadId);
                setHighlightMsgId(messageId ?? null);
              }}
            />
          </div>
        ) : tab === "chats" && activeChannelId ? (
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
                onClick={() => setChatSearchOpen((v) => !v)}
                aria-label="جستجو در گفتگو"
              >
                <Search className="size-4" />
              </Button>
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
            {chatSearchOpen && active && (
              <ChatSearch
                chatName={active.peerName}
                threadId={active.id}
                messages={messages.map((m) => ({
                  id: m.id,
                  text: m.text,
                  createdAt: m.createdAt,
                  sender: m.sender,
                  kind: m.kind,
                }))}
                onJump={(id) => {
                  setHighlightMsgId(id);
                  setChatSearchOpen(false);
                }}
                onClose={() => setChatSearchOpen(false)}
              />
            )}
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
                <Button
                  type="button"
                  size="sm"
                  variant="secondary"
                  onClick={() => {
                    if (!confirm("پیام‌های این گفتگو فقط برای تو پاک شود؟ حساب و پیام‌های طرف مقابل حذف نمی‌شود.")) return;
                    void fetch("/api/inbox", {
                      method: "POST",
                      headers: { "Content-Type": "application/json" },
                      body: JSON.stringify({ key: `dm:${active.id}`, action: "clear", confirm: true }),
                    }).then(() => {
                      setMessages([]);
                    });
                  }}
                >
                  Clear Chat
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
                  {chatCursor && (
                    <button
                      type="button"
                      className="mx-auto block text-[11px] text-amber-200/80"
                      onClick={async () => {
                        const res = await fetch(`/api/chats/${active.id}?cursor=${encodeURIComponent(chatCursor)}`, { cache: "no-store" });
                        if (!res.ok) return;
                        const data = (await res.json()) as { messages: WireMsg[]; nextCursor: string | null };
                        const older = await mapRemote(active.id, data.messages);
                        setChatCursor(data.nextCursor);
                        setMessages((cur) => {
                          const ids = new Set(cur.map((m) => m.id));
                          return [...older.filter((m) => !ids.has(m.id)), ...cur].sort((a, b) => a.createdAt - b.createdAt);
                        });
                      }}
                    >
                      پیام‌های قدیمی‌تر
                    </button>
                  )}
                  {peerTyping && (
                    <p className="text-center text-[11px] text-emerald-100/50">در حال نوشتن…</p>
                  )}
                  {messages.map((msg) => (
                    msg.kind === "system" ? (
                      <p key={msg.id} className="px-6 text-center text-[11px] leading-6 text-emerald-100/55">
                        {msg.text}
                      </p>
                    ) : (
                    <div
                      key={msg.id}
                      data-msg-id={msg.id}
                      className={cn("flex", msg.sender === "me" ? "justify-start" : "justify-end", highlightMsgId === msg.id && "ring-1 ring-amber-300 rounded-2xl")}
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
                        {msg.kind === "sticker" ? (
                          <div className="p-2">
                            {msg.stickerMissing ? (
                              <p className="px-3 py-2 text-sm opacity-70">استیکر حذف شده</p>
                            ) : msg.stickerUrl ? (
                              // eslint-disable-next-line @next/next/no-img-element
                              <img src={msg.stickerUrl} alt="sticker" className="h-24 w-24" />
                            ) : (
                              <p className="px-3 py-2 text-sm">استیکر</p>
                            )}
                          </div>
                        ) : msg.kind === "voice" ? (
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
                            senderLabel={msg.sender === "me" ? "تو" : active.peerName}
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
                            {msg.replyToId && (
                              <p className="mb-1 truncate text-[10px] opacity-60">پاسخ به پیام</p>
                            )}
                            <p>{msg.expired ? "این پیام منقضی شد." : msg.text}</p>
                            {msg.editedAt ? <p className="text-[10px] opacity-50">ویرایش‌شده</p> : null}
                            {msg.sender === "me" && msg.state ? (
                              <p className="text-[10px] opacity-50">
                                {msg.state === "read" ? "خوانده شد" : msg.state === "delivered" ? "تحویل شد" : msg.state === "deleted" ? "حذف شد" : "ارسال شد"}
                              </p>
                            ) : null}
                            <ExpiryBadge
                              createdAt={msg.createdAt}
                              expireFrom={msg.expireFrom}
                              disappearAfterMs={msg.disappearAfterMs}
                              expiresAt={msg.expiresAt}
                              viewedAt={msg.viewedAt}
                            />
                          </div>
                        )}
                        <div className="px-2 pb-1">
                          <ReactionBar
                            reactions={msg.reactions}
                            disabled={Boolean(msg.local) || !active.interactionsAllowed}
                            failed={Boolean(failedReact[msg.id])}
                            onPick={(emoji) => void reactOn(msg.id, emoji)}
                            onRetry={() => void reactOn(msg.id, failedReact[msg.id])}
                          />
                        </div>
                        <button
                          type="button"
                          className="block w-full px-3 pb-2 text-left text-[10px] opacity-70"
                          onClick={() => void saveToVault(msg, active)}
                        >
                          Save Message
                        </button>
                        <button
                          type="button"
                          className="block w-full px-3 pb-1 text-left text-[10px] opacity-70"
                          onClick={async () => {
                            await fetch("/api/saved", {
                              method: "POST",
                              headers: { "Content-Type": "application/json" },
                              body: JSON.stringify({
                                kind: msg.kind === "photo" || msg.kind === "video" || msg.kind === "voice" || msg.kind === "file" ? msg.kind : "message",
                                body: msg.text,
                                bookmark: true,
                                tag: "Important",
                                source: { type: "chat", id: active.id, name: active.peerName, messageId: msg.id },
                              }),
                            });
                            toast.success("Bookmark شد.");
                          }}
                        >
                          Bookmark
                        </button>
                        {msg.text && !msg.expired && (
                          <div className="flex flex-wrap gap-2 px-3 pb-2 text-[10px] opacity-80">
                            <button type="button" onClick={() => setReplyTo(msg)}>
                              پاسخ
                            </button>
                            {msg.sender === "me" && !msg.local && (
                              <button
                                type="button"
                                onClick={() => {
                                  setEditingId(msg.id);
                                  setDraft(msg.text);
                                }}
                              >
                                ویرایش
                              </button>
                            )}
                            <button
                              type="button"
                              onClick={() => {
                                void navigator.clipboard?.writeText(msg.text);
                                toast.success("متن کپی شد.");
                              }}
                            >
                              کپی
                            </button>
                            {msg.sender === "me" && (
                              <button
                                type="button"
                                onClick={async () => {
                                  await fetch(`/api/chats/${active.id}/messages/${msg.id}`, {
                                    method: "DELETE",
                                    headers: { "Content-Type": "application/json" },
                                    body: JSON.stringify({ scope: "me" }),
                                  });
                                  setMessages((cur) => cur.filter((m) => m.id !== msg.id));
                                }}
                              >
                                حذف برای من
                              </button>
                            )}
                          </div>
                        )}
                        {msg.text && !msg.expired && (
                          <div className="flex flex-wrap gap-1 px-3 pb-2">
                            <span className="text-[10px] opacity-50">Translate</span>
                            {(["fa", "en", "tr"] as const).map((lng) => (
                              <button
                                key={lng}
                                type="button"
                                className="text-[10px] text-amber-200"
                                onClick={() => {
                                  const out = translateText(msg.text, lng);
                                  toast.message(out.slice(0, 280));
                                }}
                              >
                                {lng}
                              </button>
                            ))}
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
                {replyTo && (
                  <div className="flex items-center justify-between rounded-lg bg-black/25 px-3 py-1 text-[11px] text-emerald-100/70">
                    <span className="truncate">پاسخ: {replyTo.text.slice(0, 80)}</span>
                    <button type="button" onClick={() => setReplyTo(null)}>
                      بستن
                    </button>
                  </div>
                )}
                {editingId && (
                  <div className="flex items-center justify-between rounded-lg bg-black/25 px-3 py-1 text-[11px] text-amber-100/80">
                    <span>ویرایش پیام</span>
                    <button
                      type="button"
                      onClick={() => {
                        setEditingId(null);
                        setDraft("");
                      }}
                    >
                      لغو
                    </button>
                  </div>
                )}
                <DisappearPicker
                  value={textTimer}
                  onChange={setTextTimer}
                  customMs={customMs}
                  onCustomMs={setCustomMs}
                  allowInherit
                />
                <AiComposerTools
                  draft={draft}
                  onDraft={setDraft}
                  lastIncoming={[...messages].reverse().find((m) => m.sender === "peer" && m.text)?.text}
                />
                <div className="flex gap-2">
                <Button type="button" size="icon" variant="secondary" className="h-11 w-11" aria-label="Emoji" onClick={() => { setEmojiOpen((v) => !v); setStickerOpen(false); }}>
                  <Smile className="size-4" />
                </Button>
                <Button type="button" size="icon" variant="secondary" className="h-11 w-11" aria-label="Stickers" onClick={() => { setStickerOpen((v) => !v); setEmojiOpen(false); }}>
                  <Sticker className="size-4" />
                </Button>
                <Input
                  value={draft}
                  onChange={(e) => setDraft(e.target.value)}
                  placeholder={
                    editingId
                      ? "متن ویرایش‌شده…"
                      : active.messagesAllowed
                        ? "پیام رمزنگاری‌شده بنویس..."
                        : "ارسال پیام محدود شده است"
                  }
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
                  {editingId ? "ذخیره" : "ارسال"}
                </Button>
                </div>
                {emojiOpen && (
                  <EmojiPicker
                    recent={emojiRecent}
                    favorites={emojiFavorites}
                    onPick={(e) => {
                      setDraft((d) => (d + e).slice(0, 2000));
                      void fetch("/api/stickers", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "emoji", emoji: e }) });
                    }}
                    onFavorite={(e, next) => {
                      void fetch("/api/stickers", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "emoji", emoji: e, favorite: next }) }).then(() => {
                        setEmojiFavorites((prev) => (next ? [e, ...prev.filter((x) => x !== e)] : prev.filter((x) => x !== e)));
                      });
                    }}
                  />
                )}
                {stickerOpen && (
                  <StickerPicker
                    draft={draft}
                    onSend={async (stickerId) => {
                      if (!active.messagesAllowed) return;
                      const res = await fetch(`/api/chats/${active.id}/stickers`, {
                        method: "POST",
                        headers: { "Content-Type": "application/json" },
                        body: JSON.stringify({ stickerId }),
                      });
                      const data = await res.json();
                      if (!res.ok) toast.error(data.error ?? "استیکر ارسال نشد.");
                      else {
                        setStickerOpen(false);
                        const list = await fetch(`/api/chats/${active.id}`, { cache: "no-store" });
                        if (list.ok) {
                          const payload = (await list.json()) as { messages: WireMsg[] };
                          const remote = await mapRemote(active.id, payload.messages);
                          setMessages(remote);
                        }
                      }
                    }}
                  />
                )}
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
              setLiveCall({ ...(data.call as LiveCall), mediaToken: data.mediaToken ?? null, bridged: Boolean(data.call?.bridged) });
            }}
            onClearHistory={async () => {
              const res = await fetch("/api/calls", { method: "DELETE" });
              if (!res.ok) {
                toast.error("پاک‌کردن سابقه انجام نشد.");
                return;
              }
              setCallHistory([]);
              toast.success("سابقه تماس این حساب پاک شد.");
            }}
            onReport={async (c) => {
              const res = await fetch("/api/reports", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                  targetKind: "call",
                  targetKey: c.id,
                  threadId: c.threadId,
                  category: "harassment",
                  details: "گزارش تماس مزاحم",
                }),
              });
              const data = await res.json();
              if (!res.ok) toast.error(data.error ?? "گزارش ثبت نشد.");
              else toast.success("گزارش تماس ثبت شد.");
            }}
            blockedHint={active && !active.callsAllowed ? "تماس با مخاطب فعلی مسدود است." : undefined}
          />
        )}
        {tab === "shop" && <BusinessDirectory embedded />}
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
                  {space.id === "bot" && (
                    <Link href="/app/bots" className="mt-3 inline-flex h-8 items-center rounded-lg bg-amber-300 px-3 text-sm font-medium text-[#102824]">
                      ربات‌ها و Directory
                    </Link>
                  )}
                  {space.id === "mini" && (
                    <Link href="/app/apps" className="mt-3 inline-flex h-8 items-center rounded-lg bg-amber-300 px-3 text-sm font-medium text-[#102824]">
                      Mini Apps
                    </Link>
                  )}
                  {space.id === "ai" && (
                    <Link href="/app/ai" className="mt-3 inline-flex h-8 items-center rounded-lg bg-amber-300 px-3 text-sm font-medium text-[#102824]">
                      NIXO AI
                    </Link>
                  )}
                  {space.id === "business" && (
                    <Link href="/app/settings/business" className="mt-3 inline-flex h-8 items-center rounded-lg bg-amber-300 px-3 text-sm font-medium text-[#102824]">
                      حساب Business
                    </Link>
                  )}
                  {space.id === "shop" && (
                    <Link href="/app/business" className="mt-3 inline-flex h-8 items-center rounded-lg bg-amber-300 px-3 text-sm font-medium text-[#102824]">
                      Directory فروشگاه
                    </Link>
                  )}
                  {space.id === "pay" && (
                    <Link href="/app/settings/shop" className="mt-3 inline-flex h-8 items-center rounded-lg bg-amber-300 px-3 text-sm font-medium text-[#102824]">
                      NIXO Pay
                    </Link>
                  )}
                  {space.id === "wallet" && (
                    <Link href="/app/wallet" className="mt-3 inline-flex h-8 items-center rounded-lg bg-amber-300 px-3 text-sm font-medium text-[#102824]">
                      Wallet
                    </Link>
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
            <Link href="/app/contacts" className="block text-sm text-amber-200">
              مخاطبین و افراد
            </Link>
            <Link href="/app/settings/privacy-center" className="block text-sm text-amber-200">
              تنظیمات → مرکز حریم خصوصی و امنیت
            </Link>
            <Link href="/app/settings/privacy" className="block text-sm text-amber-200">
              تنظیمات → حریم خصوصی
            </Link>
            <Link href="/app/settings/security" className="block text-sm text-amber-200">
              تنظیمات → امنیت
            </Link>
            <Link href="/app/settings/notifications" className="block text-sm text-amber-200">
              تنظیمات → اعلان‌ها
            </Link>
            <Link href="/app/settings/chats" className="block text-sm text-amber-200">
              تنظیمات → Chats → Chat Organization
            </Link>
            <Link href="/app/settings/stickers" className="block text-sm text-amber-200">
              تنظیمات → Stickers & Emoji
            </Link>
            <Link href="/app/settings/account" className="block text-sm text-amber-200">
              تنظیمات → حساب و پشتیبان
            </Link>
            <Link href="/app/settings/devices" className="block text-sm text-amber-200">
              تنظیمات → دستگاه‌ها
            </Link>
            <Link href="/app/settings/connected-bots" className="block text-sm text-amber-200">
              Settings → Privacy & Security → Connected Bots
            </Link>
            <Link href="/app/apps" className="block text-sm text-amber-200">
              Mini Apps & Web Apps
            </Link>
            <Link href="/app/settings/apps" className="block text-sm text-amber-200">
              Settings → Privacy & Security → Connected Apps
            </Link>
            <Link href="/app/bots" className="block text-sm text-amber-200">
              تنظیمات → ربات‌ها و مینی‌اپ
            </Link>
            <Link href="/app/settings/bots" className="block text-sm text-amber-200">
              تنظیمات → Developer Dashboard
            </Link>
            <Link href="/app/ai" className="block text-sm text-amber-200">
              NIXO AI
            </Link>
            <Link href="/app/settings/ai" className="block text-sm text-amber-200">
              تنظیمات → AI → Data Controls
            </Link>
            <Link href="/app/business" className="block text-sm text-amber-200">
              فروشگاه و کسب‌وکار
            </Link>
            <Link href="/app/settings/business" className="block text-sm text-amber-200">
              تنظیمات → Business
            </Link>
            <Link href="/app/settings/shop" className="block text-sm text-amber-200">
              تنظیمات → Shop و پرداخت
            </Link>
            <Link href="/app/orders" className="block text-sm text-amber-200">
              Profile → Orders
            </Link>
            <Link href="/app/wallet" className="block text-sm text-amber-200">
              NIXO Wallet
            </Link>
            <Link href="/app/music" className="block text-sm text-amber-200">
              موسیقی نیکسو
            </Link>
            <Link href="/app/settings/audio" className="block text-sm text-amber-200">
              تنظیمات → Voice & Audio
            </Link>
            <Link href="/app/live" className="block text-sm text-amber-200">
              Live Streaming
            </Link>
            <Link href="/app/settings/live" className="block text-sm text-amber-200">
              تنظیمات → Live
            </Link>
            <Link href="/app/stickers" className="block text-sm text-amber-200">
              ایموجی و استیکر
            </Link>
            <Link href="/app/settings/stickers" className="block text-sm text-amber-200">
              تنظیمات → استیکر و ایموجی
            </Link>
            <Link href="/app/spaces" className="block text-sm text-amber-200">
              گروه و کانال
            </Link>
            <Link href="/app/settings/spaces" className="block text-sm text-amber-200">
              تنظیمات → گروه و کانال
            </Link>
            <Link href="/app/calls" className="block text-sm text-amber-200">
              مرکز تماس
            </Link>
            <Link href="/app/settings/calls" className="block text-sm text-amber-200">
              تنظیمات → تماس
            </Link>
            <Link href="/app/storage" className="block text-sm text-amber-200">
              فضای رسانه و فایل
            </Link>
            <Link href="/app/files" className="block text-sm text-amber-200">
              Files & Documents
            </Link>
            <Link href="/app/settings/files" className="block text-sm text-amber-200">
              تنظیمات → Files & Storage
            </Link>
            <Link href="/app/gallery" className="block text-sm text-amber-200">
              گالری نیکسو
            </Link>
            <Link href="/app/settings/media" className="block text-sm text-amber-200">
              تنظیمات → Data & Storage → Media
            </Link>
            <Link href="/app/stories" className="block text-sm text-amber-200">
              استوری و وضعیت
            </Link>
            <Link href="/app/settings/story" className="block text-sm text-amber-200">
              تنظیمات → حریم خصوصی → استوری
            </Link>
            <button type="button" className="block text-sm text-amber-200" onClick={() => { setSavedOpen(true); setTab("chats"); setMobileChat(true); }}>
              Saved Messages
            </button>
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
              <p className="mt-1 text-emerald-100/65">
                چه کسانی بتوانند با تو تماس بگیرند. افراد مسدود نمی‌توانند تماس بگیرند. تماس ناشناس طبق همین حریم محدود می‌شود.
              </p>
              {(
                [
                  ["everyone", "همه"],
                  ["contacts", "مخاطبین"],
                  ["friends", "دوستان"],
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

      {searchOpen && (
        <SearchPanel
          threads={threads.map((t) => ({ id: t.id, peerName: t.peerName, peerKey: t.peerKey }))}
          initialQuery={searchSeed}
          onClose={() => setSearchOpen(false)}
          onOpen={openSearchHit}
          chatId={activeId}
        />
      )}
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
            <p className="mt-4 text-xs text-emerald-100/60">Mute Chat</p>
            <div className="mt-1 flex flex-wrap gap-1">
              {MUTE_CHAT_PRESETS.map((p) => (
                <Button
                  key={p.id}
                  type="button"
                  size="xs"
                  variant="secondary"
                  onClick={async () => {
                    await fetch("/api/notify", {
                      method: "POST",
                      headers: { "Content-Type": "application/json" },
                      body: JSON.stringify({ action: "mute", targetType: "chat", targetId: active.id, ms: p.ms, forever: p.ms == null }),
                    });
                    toast.success("Mute ذخیره شد.");
                  }}
                >
                  {p.label}
                </Button>
              ))}
              <Button
                type="button"
                size="xs"
                variant="ghost"
                className="text-amber-200"
                onClick={async () => {
                  await fetch("/api/notify", {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ action: "unmute", targetType: "chat", targetId: active.id }),
                  });
                  toast.success("اعلان چت روشن شد.");
                }}
              >
                Unmute
              </Button>
            </div>
            <p className="mt-3 text-[11px] text-emerald-100/50">Custom: پیش‌نمایش این گفتگو</p>
            <div className="mt-1 flex gap-1">
              <Button
                type="button"
                size="xs"
                variant="secondary"
                onClick={async () => {
                  await fetch("/api/notify", {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ action: "override", targetType: "chat", targetId: active.id, preview: false }),
                  });
                  toast.success("پیش‌نمایش این چت خاموش شد.");
                }}
              >
                Hide preview
              </Button>
            </div>
            <Button type="button" variant="ghost" className="mt-3 w-full text-white" onClick={() => setPeerSheet(false)}>
              بستن
            </Button>
          </div>
        </div>
      )}
      {liveCall && (
        <CallStage
          call={liveCall}
          waiting={waitingCall && waitingCall.id !== liveCall.id ? waitingCall : null}
          lowData={lowDataCalls}
          hideLockInfo={hideCallLock}
          myName={displayName}
          minimized={callMin}
          onMinimized={setCallMin}
          onWaitingAction={async (action, waitingId) => {
            const res = await fetch(`/api/calls/${waitingId}`, {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ action }),
            });
            const data = await res.json();
            if (!res.ok) {
              toast.error(data.error ?? "عملیات تماس دوم انجام نشد.");
              return;
            }
            if (action === "decline") {
              setWaitingCall(null);
              return;
            }
            setWaitingCall(null);
            setCallMin(false);
            setLiveCall({ ...(data.call as LiveCall), mediaToken: data.mediaToken ?? null, bridged: Boolean(data.call?.bridged) });
          }}
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
          onRetry={() => {
            const threadId = liveCall.threadId;
            const kind = liveCall.kind;
            setLiveCall(null);
            void startCall(threadId, kind);
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
      {discoverGroups && (
        <GroupsDiscover
          onClose={() => setDiscoverGroups(false)}
          onOpen={(id) => {
            setDiscoverGroups(false);
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
    </VoiceQueueProvider>
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
