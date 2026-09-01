"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Flag, Lock, Phone, Pin, Radio, Search, Send, Users, Video } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import { decryptText, encryptText, loadOrCreateThreadKey } from "@/lib/e2ee";
import { MUTE_PRESETS, PERM_FA, ROLE_FA, type GroupPerms, type GroupRole } from "@/lib/group-types";
import { backgroundPreview } from "@/lib/background-style";
import type { Appearance } from "@/lib/appearance-types";
import { BackgroundPicker, type BgDraft } from "@/components/background-picker";
import { ReactionBar, type PublicReaction } from "@/components/reaction-bar";
import { StickerPicker } from "@/components/sticker-picker";
import { EmojiPicker } from "@/components/emoji-picker";
import { blobMatches } from "@/lib/search-match";
import { GroupCallStage, type PublicGroupCallUi } from "@/components/group-call-stage";
import { VoiceComposer } from "@/components/voice-composer";
import { VoicePlayer } from "@/components/voice-player";
import { VoiceQueueProvider } from "@/components/voice-queue";
import { MediaDock } from "@/components/media-dock";
import { MediaBubble } from "@/components/media-bubble";

type GMember = {
  id?: string;
  key?: string;
  kind: "user" | "seed" | "bot";
  role: GroupRole;
  name: string;
  state?: string;
  mutedUntil: number | null;
  restrictedUntil: number | null;
};

type GInfo = {
  id: string;
  name: string;
  description: string;
  rules: string;
  welcome: string;
  username: string | null;
  publicLink?: string | null;
  color: string;
  photoDataUrl?: string | null;
  joinMode: "invite" | "request" | "open";
  visibility?: "public" | "private";
  hideMemberList?: boolean;
  historyMode?: "all" | "from-join";
  maxMembers: number;
  perms: GroupPerms;
  inviteToken: string | null;
  inviteExpiresAt?: number | null;
  inviteMaxUses?: number | null;
  memberCount: number;
  pinIds: string[];
  reactionsEnabled?: boolean;
  allowedReactions?: string[] | null;
  fileMaxBytes?: number | null;
  allowedFileExts?: string[] | null;
  myRole: GroupRole | null;
  notifyMutedUntil: number | null;
  members: GMember[];
  pendingRequests: { id: string; userId: string; name: string; createdAt: number; expiresAt?: number }[];
  bans?: { id?: string; key: string; until?: number | null; permanent?: boolean; reason?: string }[];
  audit?: { id: string; at: number; kind: string; detail: string; actorName: string }[];
};

type GMsg = {
  id: string;
  senderKey: string;
  senderName: string;
  enc: string;
  ciphertext: string;
  nonce: string;
  bodyFa?: string;
  createdAt: number;
  kind: string;
  replyToId?: string | null;
  mentions?: string[];
  reactions: PublicReaction[];
  poll?: {
    question: string;
    options: string[];
    anonymous: boolean;
    multiple: boolean;
    closesAt: number | null;
    votes: { voterKey: string; indexes: number[] }[];
  };
  deleted?: boolean;
  text?: string;
  stickerId?: string;
  stickerUrl?: string | null;
  stickerMissing?: boolean;
  durationMs?: number;
  blobId?: string;
  chunkCount?: number;
  byteLength?: number;
};

export function GroupPane({
  groupId,
  appearance,
  userIdHint,
  onLeft,
}: {
  groupId: string;
  appearance: Appearance;
  userIdHint: string;
  username: string | null;
  onLeft: () => void;
}) {
  const router = useRouter();
  const [group, setGroup] = useState<GInfo | null>(null);
  const [messages, setMessages] = useState<GMsg[]>([]);
  const [draft, setDraft] = useState("");
  const [replyTo, setReplyTo] = useState<GMsg | null>(null);
  const [settings, setSettings] = useState(false);
  const [busy, setBusy] = useState(false);
  const [search, setSearch] = useState("");
  const [searchOpen, setSearchOpen] = useState(false);
  const [fromUser, setFromUser] = useState("");
  const [fromDate, setFromDate] = useState("");
  const [toDate, setToDate] = useState("");
  const [pollOpen, setPollOpen] = useState(false);
  const [stickerOpen, setStickerOpen] = useState(false);
  const [emojiOpen, setEmojiOpen] = useState(false);
  const [pollQ, setPollQ] = useState("");
  const [pollOpts, setPollOpts] = useState("بله\nخیر");
  const [deleteStep, setDeleteStep] = useState(0);
  const [memberQuery, setMemberQuery] = useState("");
  const [bgOpen, setBgOpen] = useState(false);
  const [bgDraft, setBgDraft] = useState<BgDraft>(() => {
    if (typeof window === "undefined") return { kind: "default" };
    try {
      const raw = window.localStorage.getItem(`nixo.group.bg.${groupId}`);
      if (!raw) return { kind: "default" };
      return JSON.parse(raw) as BgDraft;
    } catch {
      return { kind: "default" };
    }
  });
  const [qr, setQr] = useState<string | null>(null);
  const [addKey, setAddKey] = useState("");
  const [reportCat, setReportCat] = useState<"spam" | "abuse" | "fake" | "harassment" | "other">("spam");
  const [groupCall, setGroupCall] = useState<PublicGroupCallUi | null>(null);
  const [callMin, setCallMin] = useState(false);
  const [liveHint, setLiveHint] = useState<PublicGroupCallUi | null>(null);

  const load = useCallback(async () => {
    const res = await fetch(`/api/groups/${groupId}`, { cache: "no-store" });
    if (!res.ok) return;
    const data = await res.json();
    setGroup(data.group as GInfo);
    const key = await loadOrCreateThreadKey(`group:${groupId}`);
    const next: GMsg[] = [];
    for (const raw of data.messages as GMsg[]) {
      if (raw.kind === "system" || raw.kind === "poll" || raw.kind === "sticker" || raw.kind === "voice" || raw.kind === "photo" || raw.kind === "video" || raw.kind === "file" || raw.enc !== "e2ee-v1") {
        next.push({ ...raw, text: raw.kind === "voice" ? "پیام صوتی" : raw.kind === "file" || raw.kind === "photo" || raw.kind === "video" ? "فایل" : (raw.bodyFa ?? "") });
        continue;
      }
      try {
        const text = await decryptText(key, { enc: "e2ee-v1", ciphertext: raw.ciphertext, nonce: raw.nonce });
        next.push({ ...raw, text });
      } catch {
        next.push({ ...raw, text: "•••• قابل خواندن نیست", deleted: true });
      }
    }
    setMessages(next);
  }, [groupId]);

  useEffect(() => {
    const tick = () => {
      void fetch(`/api/calls/group?groupId=${encodeURIComponent(groupId)}`, { cache: "no-store" })
        .then((r) => (r.ok ? r.json() : null))
        .then((d) => {
          if (d?.call) setLiveHint(d.call as PublicGroupCallUi);
          else setLiveHint(null);
        })
        .catch(() => undefined);
    };
    tick();
    const t = window.setInterval(tick, 4000);
    return () => window.clearInterval(t);
  }, [groupId]);

  async function startGroupCall(kind: "voice" | "video") {
    const res = await fetch("/api/calls/group", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ groupId, kind }),
    });
    const data = await res.json();
    if (!res.ok && !data.call) {
      toast.error(data.error ?? "تماس گروهی شروع نشد.");
      return;
    }
    const room = (data.call ?? null) as PublicGroupCallUi | null;
    if (res.status === 409 && room) {
      const join = await fetch(`/api/calls/group/${room.id}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "join" }),
      });
      const j = await join.json();
      if (!join.ok) {
        toast.error(j.error ?? "ورود به تماس ممکن نشد.");
        return;
      }
      setCallMin(false);
      setGroupCall(j.call as PublicGroupCallUi);
      return;
    }
    if (room) {
      setCallMin(false);
      setGroupCall(room);
    }
  }

  async function startNixoLive() {
    const res = await fetch("/api/live", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        title: `${group?.name ?? "گروه"} Live`,
        scope: "group",
        groupId,
        visibility: "members",
        guestRequestsEnabled: true,
      }),
    });
    const data = await res.json();
    if (!res.ok) {
      toast.error(data.error ?? "Live شروع نشد.");
      return;
    }
    router.push(`/app/live/${data.live.id}`);
  }

  async function joinLive() {
    if (!liveHint) return;
    const join = await fetch(`/api/calls/group/${liveHint.id}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "join" }),
    });
    const j = await join.json();
    if (!join.ok) {
      toast.error(j.error ?? "ورود ممکن نشد.");
      return;
    }
    setCallMin(false);
    setGroupCall(j.call as PublicGroupCallUi);
  }

  useEffect(() => {
    const ac = new AbortController();
    fetch(`/api/groups/${groupId}`, { cache: "no-store", signal: ac.signal })
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => {
        if (!data) return;
        void (async () => {
          setGroup(data.group as GInfo);
          const key = await loadOrCreateThreadKey(`group:${groupId}`);
          const next: GMsg[] = [];
          for (const raw of data.messages as GMsg[]) {
            if (raw.kind === "system" || raw.kind === "poll" || raw.kind === "sticker" || raw.kind === "voice" || raw.kind === "photo" || raw.kind === "video" || raw.kind === "file" || raw.enc !== "e2ee-v1") {
              next.push({ ...raw, text: raw.kind === "voice" ? "پیام صوتی" : raw.kind === "file" || raw.kind === "photo" || raw.kind === "video" ? "فایل" : (raw.bodyFa ?? "") });
              continue;
            }
            try {
              const text = await decryptText(key, { enc: "e2ee-v1", ciphertext: raw.ciphertext, nonce: raw.nonce });
              next.push({ ...raw, text });
            } catch {
              next.push({ ...raw, text: "•••• قابل خواندن نیست", deleted: true });
            }
          }
          setMessages(next);
        })();
      })
      .catch(() => undefined);
    return () => ac.abort();
  }, [groupId]);

  useEffect(() => {
    const t = window.setInterval(() => void load(), 4000);
    return () => window.clearInterval(t);
  }, [load]);

  const admin = group && (group.myRole === "owner" || group.myRole === "admin");
  const inviteUrl = group?.inviteToken && typeof window !== "undefined" ? `${window.location.origin}/join/${group.inviteToken}` : "";

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

  async function send() {
    if (!draft.trim() || !group) return;
    setBusy(true);
    try {
      const mentions = [...draft.matchAll(/@([a-zA-Z0-9_]+)/g)].map((m) => m[1]!);
      const key = await loadOrCreateThreadKey(`group:${groupId}`);
      const envelope = await encryptText(key, draft.trim());
      const res = await fetch(`/api/groups/${groupId}/messages`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...envelope, kind: "text", replyToId: replyTo?.id, mentions }),
      });
      const data = await res.json();
      if (!res.ok) {
        toast.error(data.error ?? "ارسال نشد.");
        return;
      }
      setDraft("");
      setReplyTo(null);
      await load();
    } finally {
      setBusy(false);
    }
  }

  async function sendPoll() {
    const options = pollOpts.split("\n").map((s) => s.trim()).filter(Boolean);
    const res = await fetch(`/api/groups/${groupId}/messages`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ kind: "poll", poll: { question: pollQ, options, anonymous: false, multiple: false } }),
    });
    const data = await res.json();
    if (!res.ok) toast.error(data.error ?? "نظرسنجی ساخته نشد.");
    else {
      setPollOpen(false);
      await load();
    }
  }

  async function act(messageId: string, action: string, extra?: Record<string, unknown>) {
    const res = await fetch(`/api/groups/${groupId}/messages/${messageId}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action, ...extra }),
    });
    if (!res.ok) {
      const data = await res.json();
      toast.error(data.error ?? "انجام نشد.");
      return;
    }
    await load();
  }

  if (!group) {
    return <div className="flex flex-1 items-center justify-center text-sm text-emerald-100/60">در حال بارگذاری گروه…</div>;
  }

  const pins = messages.filter((m) => group.pinIds.includes(m.id));
  const fromMs = fromDate ? new Date(fromDate).getTime() : 0;
  const toMs = toDate ? new Date(toDate).getTime() + 86_399_000 : Number.MAX_SAFE_INTEGER;
  const filtered = search.trim().length >= 1
    ? messages.filter((m) => {
        if (fromMs && m.createdAt < fromMs) return false;
        if (toDate && m.createdAt > toMs) return false;
        if (fromUser.trim() && !blobMatches(`${m.senderName} ${m.senderKey}`, fromUser)) return false;
        return blobMatches(`${m.text ?? ""} ${m.kind} ${m.poll?.question ?? ""} ${m.bodyFa ?? ""}`, search);
      })
    : messages;

  const media = messages.filter((m) => m.kind === "photo" || m.kind === "video" || m.kind === "file" || m.kind === "voice");

  return (
    <VoiceQueueProvider>
    <div className="relative flex min-w-0 flex-1 flex-col">
      <header className="flex items-center gap-3 border-b border-white/10 px-4 py-3">
        <span className="grid size-10 place-items-center rounded-2xl text-sm font-semibold text-[#071614]" style={{ background: group.color }}>
          {group.name.slice(0, 1)}
        </span>
        <button type="button" className="min-w-0 flex-1 text-right" onClick={() => setSettings(true)}>
          <p className="truncate font-medium">{group.name}</p>
          <p className="text-[11px] text-emerald-100/60">
            {group.memberCount} عضو · {group.username ? `@${group.username}` : ROLE_FA[group.myRole ?? "member"]}
          </p>
        </button>
        <Button type="button" variant="ghost" className="text-white" onClick={() => void startGroupCall("voice")} aria-label="تماس صوتی گروهی">
          <Phone className="size-4" />
        </Button>
        <Button type="button" variant="ghost" className="text-white" onClick={() => void startGroupCall("video")} aria-label="تماس تصویری گروهی">
          <Video className="size-4" />
        </Button>
        <Button type="button" variant="ghost" className="text-white" onClick={() => void startNixoLive()} aria-label="پخش زنده">
          <Radio className="size-4" />
        </Button>
        <Button type="button" variant="ghost" className="text-white" onClick={() => setSearchOpen((v) => !v)} aria-label="Search in Conversation">
          <Search className="size-4" />
        </Button>
        <Button type="button" variant="ghost" className="text-white" onClick={() => setSettings(true)}>
          <Users className="size-4" />
        </Button>
      </header>
      {liveHint && !groupCall && (
        <button type="button" className="border-b border-amber-300/30 bg-amber-300/10 px-4 py-2 text-right text-xs" onClick={() => void joinLive()}>
          تماس گروهی {liveHint.kind === "video" ? "تصویری" : "صوتی"} در جریان است · {liveHint.participants.length} نفر · ورود
        </button>
      )}
      {searchOpen && (
        <div className="border-b border-white/10 bg-black/40 p-3">
          <p className="text-xs font-medium">Search in Conversation</p>
          <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="meeting، فایل، رسانه…" className="mt-2 h-9 bg-black/20" />
          <div className="mt-2 flex flex-wrap gap-2 text-[10px]">
            <Input value={fromUser} onChange={(e) => setFromUser(e.target.value)} placeholder="From User" className="h-8 w-32 bg-black/20" />
            <input type="date" className="rounded bg-black/30 px-1" value={fromDate} onChange={(e) => setFromDate(e.target.value)} />
            <input type="date" className="rounded bg-black/30 px-1" value={toDate} onChange={(e) => setToDate(e.target.value)} />
          </div>
          <p className="mt-1 text-[10px] text-emerald-100/45">متن E2EE فقط روی همین دستگاه، پس از رمزگشایی.</p>
        </div>
      )}
      {pins.length > 0 && (
        <div className="border-b border-amber-300/20 bg-amber-300/10 px-4 py-2 text-[11px]">
          {pins.map((p) => (
            <p key={p.id} className="flex items-center gap-1">
              <Pin className="size-3" />
              {p.text || p.poll?.question || p.kind}
            </p>
          ))}
        </div>
      )}
      <div className="relative flex-1 overflow-hidden">
        <div className="pointer-events-none absolute inset-0" style={backgroundPreview(bgDraft.kind === "default" ? appearance.chatBackground : bgDraft)} />
        <ScrollArea className="h-full">
          <div className="space-y-2 px-4 py-4">
            {filtered.map((msg) => (
              <div key={msg.id} className={cn("flex", msg.senderKey === userIdHint || msg.kind === "system" ? "justify-start" : "justify-end")}>
                {msg.kind === "system" ? (
                  <p className="w-full text-center text-[11px] text-emerald-100/50">{msg.bodyFa || msg.text}</p>
                ) : (
                  <div className={cn("max-w-[80%] rounded-2xl px-3 py-2 text-sm", msg.senderKey === userIdHint ? "bg-amber-300 text-[#102824]" : "bg-black/35")}>
                    <p className="text-[10px] opacity-70">{msg.senderName}</p>
                    {msg.replyToId && <p className="text-[10px] opacity-60">پاسخ</p>}
                    {msg.kind === "sticker" ? (
                      msg.stickerMissing ? (
                        <p className="opacity-70">استیکر حذف شده</p>
                      ) : msg.stickerUrl ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img src={msg.stickerUrl} alt="" className="h-24 w-24" />
                      ) : (
                        <p>استیکر</p>
                      )
                    ) : msg.kind === "photo" || msg.kind === "video" || msg.kind === "file" ? (
                      <MediaBubble
                        msg={{
                          id: msg.id,
                          sender: msg.senderKey === userIdHint ? "me" : "peer",
                          createdAt: msg.createdAt,
                          enc: msg.enc,
                          ciphertext: msg.ciphertext,
                          nonce: msg.nonce,
                          kind: msg.kind,
                          blobId: msg.blobId,
                          chunkCount: msg.chunkCount,
                          byteLength: msg.byteLength,
                        }}
                        threadId={`group:${groupId}`}
                        threads={[]}
                        chunkBase={`/api/groups/${groupId}`}
                        senderLabel={msg.senderName}
                        onGone={() => void load()}
                      />
                    ) : msg.kind === "voice" ? (
                      <VoicePlayer
                        msg={{
                          id: msg.id,
                          sender: msg.senderKey === userIdHint ? "me" : "peer",
                          createdAt: msg.createdAt,
                          enc: msg.enc,
                          ciphertext: msg.ciphertext,
                          nonce: msg.nonce,
                          durationMs: msg.durationMs,
                        }}
                        threadId={`group:${groupId}`}
                        threads={[]}
                        senderLabel={msg.senderName}
                        deleteMode="group"
                        groupId={groupId}
                        onGone={() => void load()}
                      />
                    ) : msg.kind === "poll" && msg.poll ? (
                      <div className="space-y-1">
                        <p className="font-medium">{msg.poll.question}</p>
                        {msg.poll.options.map((opt, i) => {
                          const count = msg.poll!.votes.filter((v) => v.indexes.includes(i)).length;
                          return (
                            <button
                              key={i}
                              type="button"
                              className="block w-full rounded bg-black/10 px-2 py-1 text-right text-xs"
                              onClick={() => void act(msg.id, "vote", { indexes: [i] })}
                            >
                              {opt} · {count}
                            </button>
                          );
                        })}
                      </div>
                    ) : (
                      <p>{msg.text}</p>
                    )}
                    <ReactionBar
                      reactions={msg.reactions}
                      allowed={group.allowedReactions}
                      disabled={group.reactionsEnabled === false}
                      onPick={(e) => void act(msg.id, "react", { emoji: e })}
                    />
                    <div className="mt-1 flex flex-wrap gap-1 text-[10px]">
                    <button type="button" onClick={() => setReplyTo(msg)}>پاسخ</button>
                      {admin && (
                        <button type="button" onClick={() => void act(msg.id, group.pinIds.includes(msg.id) ? "unpin" : "pin")}>
                          پین
                        </button>
                      )}
                      <button type="button" onClick={() => void act(msg.id, "delete")}>حذف</button>
                      <button
                        type="button"
                        onClick={() => {
                          void fetch("/api/saved", {
                            method: "POST",
                            headers: { "Content-Type": "application/json" },
                            body: JSON.stringify({
                              kind: "message",
                              body: msg.text,
                              source: { type: "group", id: groupId, name: group.name, messageId: msg.id },
                            }),
                          }).then((r) => {
                            if (r.ok) toast.success("در Saved Messages ذخیره شد.");
                          });
                        }}
                      >
                        ذخیره
                      </button>
                    </div>
                  </div>
                )}
              </div>
            ))}
          </div>
        </ScrollArea>
      </div>
      {media.length === 0 && searchOpen ? (
        <p className="px-4 text-[11px] text-emerald-100/50">Voiceای در این گفتگو نیست.</p>
      ) : null}
      {replyTo && (
        <div className="flex items-center justify-between border-t border-white/10 px-4 py-1 text-[11px]">
          پاسخ به {replyTo.senderName}
          <button type="button" onClick={() => setReplyTo(null)}>×</button>
        </div>
      )}
      <MediaDock
        threadId={`group:${groupId}`}
        sendPath={`/api/groups/${groupId}/messages`}
        blobBase={`/api/groups/${groupId}`}
        disabled={busy || group.perms.sendFiles === false}
        onSent={() => void load()}
      />
      <VoiceComposer
        threadId={`group:${groupId}`}
        sendPath={`/api/groups/${groupId}/messages`}
        replyToId={replyTo?.id}
        disabled={busy || group.perms.sendVoice === false}
        onSent={() => {
          setReplyTo(null);
          void load();
        }}
      >
      <form
        className="flex gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          void send();
        }}
      >
        <Button type="button" variant="ghost" className="text-white" onClick={() => setPollOpen(true)}>نظرسنجی</Button>
        <Button type="button" variant="ghost" className="text-white" onClick={() => setEmojiOpen((v) => !v)}>😀</Button>
        <Button type="button" variant="ghost" className="text-white" onClick={() => setStickerOpen((v) => !v)}>استیکر</Button>
        <Input
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          placeholder="پیام گروه… از @نام‌کاربری برای منشن"
          className="h-11 flex-1 bg-black/20"
        />
        <Button type="submit" className="h-11 bg-amber-300 text-[#102824]" disabled={busy || !draft.trim()}>
          <Send className="size-4" />
        </Button>
      </form>
      </VoiceComposer>
      {emojiOpen && (
        <div className="px-3 pb-2">
          <EmojiPicker onPick={(e) => setDraft((d) => (d + e).slice(0, 2000))} />
        </div>
      )}
      {stickerOpen && (
        <div className="px-3 pb-2">
          <StickerPicker
            draft={draft}
            onSend={async (stickerId) => {
              const res = await fetch(`/api/groups/${groupId}/messages`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ kind: "sticker", stickerId }),
              });
              const data = await res.json();
              if (!res.ok) toast.error(data.error ?? "استیکر ارسال نشد.");
              else {
                setStickerOpen(false);
                await load();
              }
            }}
          />
        </div>
      )}

      {pollOpen && (
        <div className="fixed inset-0 z-40 grid place-items-center bg-black/70 p-4" onClick={() => setPollOpen(false)}>
          <div className="w-full max-w-sm rounded-3xl bg-[#102824] p-4" onClick={(e) => e.stopPropagation()}>
            <h3 className="font-medium">نظرسنجی</h3>
            <Input value={pollQ} onChange={(e) => setPollQ(e.target.value)} placeholder="سؤال" className="mt-2 bg-black/20" />
            <Textarea value={pollOpts} onChange={(e) => setPollOpts(e.target.value)} className="mt-2 min-h-24 bg-black/20" />
            <p className="text-[10px] opacity-60">هر خط یک گزینه</p>
            <Button type="button" className="mt-3 w-full bg-amber-300 text-[#102824]" onClick={() => void sendPoll()}>ارسال</Button>
          </div>
        </div>
      )}

      {settings && (
        <div className="fixed inset-0 z-40 overflow-auto bg-black/80 p-4" onClick={() => setSettings(false)}>
          <div className="mx-auto max-w-lg space-y-4 rounded-3xl bg-[#102824] p-5" onClick={(e) => e.stopPropagation()}>
            <h2 className="text-lg font-semibold">اطلاعات گروه</h2>
            <p className="text-xs leading-6 text-emerald-100/70">{group.description || "بدون توضیحات"}</p>
            {group.rules && (
              <div>
                <p className="text-sm font-medium">قوانین</p>
                <p className="whitespace-pre-wrap text-xs leading-6">{group.rules}</p>
              </div>
            )}
            <div className="flex gap-2">
              <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search in Conversation" className="h-9 bg-black/20" />
              <Search className="mt-2 size-4 opacity-50" />
            </div>
            <p className="text-xs">رسانهٔ مشترک: {media.length} مورد</p>
            {group.inviteToken && (
              <div className="rounded-2xl bg-white/5 p-3">
                <p className="text-sm font-medium">لینک دعوت</p>
                <p className="mt-1 break-all text-[11px]" dir="ltr">{inviteUrl}</p>
                {qr && (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={qr} alt="QR دعوت" className="mx-auto mt-2 h-40 w-40 rounded-xl" />
                )}
                {admin && (
                  <div className="mt-2 flex gap-2">
                    <Button type="button" size="sm" variant="secondary" onClick={() => void fetch(`/api/groups/${groupId}/invite`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "new", expiresInHours: 168, maxUses: 50 }) }).then(load)}>لینک جدید (۷روز / ۵۰)</Button>
                    <Button type="button" size="sm" variant="ghost" className="text-rose-200" onClick={() => void fetch(`/api/groups/${groupId}/invite`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "revoke" }) }).then(load)}>باطل کردن</Button>
                  </div>
                )}
              </div>
            )}
            {admin && group.pendingRequests.length > 0 && (
              <div>
                <p className="text-sm font-medium">درخواست عضویت</p>
                {group.pendingRequests.map((r) => (
                  <div key={r.id} className="mt-1 flex items-center justify-between text-sm">
                    <span>{r.name}</span>
                    <span className="flex gap-1">
                      <Button type="button" size="sm" onClick={() => void fetch(`/api/groups/${groupId}/requests`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ requestId: r.id, approve: true }) }).then(load)}>تأیید</Button>
                      <Button type="button" size="sm" variant="ghost" onClick={() => void fetch(`/api/groups/${groupId}/requests`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ requestId: r.id, approve: false }) }).then(load)}>رد</Button>
                    </span>
                  </div>
                ))}
              </div>
            )}
            {admin && (
              <div className="flex gap-2">
                <Input
                  value={addKey}
                  onChange={(e) => setAddKey(e.target.value)}
                  placeholder="مخاطب، @username یا شناسه"
                  className="h-9 bg-black/20"
                />
                <Button
                  type="button"
                  size="sm"
                  variant="secondary"
                  onClick={async () => {
                    if (!addKey.trim()) return;
                    const res = await fetch(`/api/groups/${groupId}/members`, {
                      method: "POST",
                      headers: { "Content-Type": "application/json" },
                      body: JSON.stringify({ action: "add", keys: [addKey.trim()] }),
                    });
                    const data = await res.json();
                    if (!res.ok) toast.error(data.error ?? "عضو اضافه نشد.");
                    else {
                      setAddKey("");
                      toast.success("عضو اضافه شد.");
                    }
                    await load();
                  }}
                >
                  افزودن
                </Button>
              </div>
            )}
            <div>
              <p className="text-sm font-medium">اعضا</p>
              <Input
                value={memberQuery}
                onChange={(e) => setMemberQuery(e.target.value)}
                placeholder="جستجوی عضو"
                className="mt-1 h-8 bg-black/20 text-xs"
              />
              {group.members
                .filter((m) => !memberQuery.trim() || m.name.includes(memberQuery.trim()) || (m.role ?? "").includes(memberQuery.trim().toLowerCase()))
                .map((m) => (
                <div key={m.id ?? m.key ?? m.name} className="mt-1 flex flex-wrap items-center justify-between gap-1 text-xs">
                  <span>{m.name} · {ROLE_FA[m.role]}{m.state && m.state !== "active" ? ` · ${m.state}` : ""}</span>
                  {admin && m.key && m.key !== userIdHint && (
                    <span className="flex flex-wrap gap-1">
                      {MUTE_PRESETS.map((p) => (
                        <button key={p.id} type="button" className="rounded bg-white/10 px-1" onClick={() => void fetch(`/api/groups/${groupId}/members`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "mute", targetKey: m.key, ms: p.ms }) }).then(load)}>{p.label}</button>
                      ))}
                      <button
                        type="button"
                        className="rounded bg-white/10 px-1"
                        onClick={() => {
                          const hours = Number(window.prompt("بی‌صدا چند ساعت؟", "2"));
                          if (!Number.isFinite(hours) || hours <= 0) return;
                          void fetch(`/api/groups/${groupId}/members`, {
                            method: "POST",
                            headers: { "Content-Type": "application/json" },
                            body: JSON.stringify({ action: "mute", targetKey: m.key, ms: hours * 3600_000 }),
                          }).then(load);
                        }}
                      >
                        سفارشی
                      </button>
                      <button type="button" className="rounded bg-white/10 px-1" onClick={() => void fetch(`/api/groups/${groupId}/members`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "restrict", targetKey: m.key, ms: 86400000 }) }).then(load)}>محدود</button>
                      <button type="button" className="rounded bg-white/10 px-1" onClick={() => void fetch(`/api/groups/${groupId}/members`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "kick", targetKey: m.key, membershipId: m.id }) }).then(load)}>اخراج</button>
                      <button type="button" className="rounded bg-white/10 px-1" onClick={() => void fetch(`/api/groups/${groupId}/members`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "remove", targetKey: m.key, membershipId: m.id }) }).then(load)}>حذف</button>
                      <button type="button" className="rounded bg-rose-500/20 px-1" onClick={() => void fetch(`/api/groups/${groupId}/members`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "ban", targetKey: m.key, membershipId: m.id, until: null }) }).then(load)}>بن دائم</button>
                      <button type="button" className="rounded bg-rose-500/10 px-1" onClick={() => void fetch(`/api/groups/${groupId}/members`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "ban", targetKey: m.key, membershipId: m.id, ms: 24 * 3600_000 }) }).then(load)}>بن ۱روز</button>
                      <button type="button" className="rounded bg-white/10 px-1" onClick={() => void fetch(`/api/groups/${groupId}/members`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "role", targetKey: m.key, role: "member" }) }).then(load)}>عادی</button>
                      <button
                        type="button"
                        className="rounded bg-white/10 px-1"
                        onClick={() =>
                          void fetch("/api/reports", {
                            method: "POST",
                            headers: { "Content-Type": "application/json" },
                            body: JSON.stringify({ targetKind: "group", targetKey: `${groupId}:member:${m.key}`, category: reportCat }),
                          }).then((r) => toast.message(r.ok ? "گزارش عضو ثبت شد." : "گزارش ارسال نشد."))
                        }
                      >
                        گزارش
                      </button>
                      {group.myRole === "owner" && m.kind === "user" && (
                        <>
                          <button type="button" className="rounded bg-white/10 px-1" onClick={() => void fetch(`/api/groups/${groupId}/members`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "role", targetKey: m.key, role: "admin" }) }).then(load)}>ادمین</button>
                          <button type="button" className="rounded bg-white/10 px-1" onClick={() => void fetch(`/api/groups/${groupId}/members`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "role", targetKey: m.key, role: "moderator" }) }).then(load)}>ناظم</button>
                          <button type="button" className="rounded bg-white/10 px-1" onClick={() => {
                            if (!window.confirm("مالکیت منتقل شود؟ باید TRANSFER را تأیید کنی.")) return;
                            const confirm = window.prompt("برای تأیید بنویس TRANSFER", "");
                            if (confirm !== "TRANSFER") return;
                            void fetch(`/api/groups/${groupId}/members`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "transfer", targetKey: m.key, membershipId: m.id, confirm: "TRANSFER" }) }).then(load);
                          }}>مالکیت</button>
                        </>
                      )}
                    </span>
                  )}
                </div>
              ))}
            </div>
            {admin && (group.bans ?? []).length > 0 && (
              <div>
                <p className="text-sm font-medium">بن‌ها</p>
                {(group.bans ?? []).map((b) => (
                  <div key={b.id ?? b.key} className="mt-1 flex items-center justify-between text-xs">
                    <span>
                      {b.key.slice(0, 8)} · {b.permanent ? "دائم" : "موقت"}
                      {b.reason ? ` · ${b.reason}` : ""}
                    </span>
                    <button
                      type="button"
                      className="rounded bg-white/10 px-2 py-0.5"
                      onClick={() =>
                        void fetch(`/api/groups/${groupId}/members`, {
                          method: "POST",
                          headers: { "Content-Type": "application/json" },
                          body: JSON.stringify({ action: "unban", targetKey: b.key }),
                        }).then(load)
                      }
                    >
                      رفع بن
                    </button>
                  </div>
                ))}
              </div>
            )}
            {admin && (
              <div className="space-y-2 text-xs">
                <p className="text-sm font-medium">مجوز اعضای عادی</p>
                {(Object.keys(group.perms) as (keyof GroupPerms)[]).map((k) => (
                  <label key={k} className="flex items-center justify-between">
                    <span>{PERM_FA[k]}</span>
                    <input
                      type="checkbox"
                      checked={group.perms[k]}
                      disabled={group.myRole !== "owner"}
                      onChange={async (e) => {
                        await fetch(`/api/groups/${groupId}`, {
                          method: "PATCH",
                          headers: { "Content-Type": "application/json" },
                          body: JSON.stringify({ perms: { ...group.perms, [k]: e.target.checked } }),
                        });
                        await load();
                      }}
                    />
                  </label>
                ))}
                <label className="flex items-center justify-between gap-2">
                  <span>سقف حجم فایل (بایت)</span>
                  <input
                    type="number"
                    defaultValue={group.fileMaxBytes ?? 28 * 1024 * 1024}
                    className="h-8 w-32 rounded bg-black/30 px-2"
                    onBlur={(e) =>
                      void fetch(`/api/groups/${groupId}`, {
                        method: "PATCH",
                        headers: { "Content-Type": "application/json" },
                        body: JSON.stringify({ fileMaxBytes: Number(e.target.value) }),
                      }).then(load)
                    }
                  />
                </label>
                <label className="block space-y-1">
                  <span>فرمت‌های مجاز فایل (خالی = همهٔ فهرست نیکسو)</span>
                  <input
                    defaultValue={(group.allowedFileExts ?? []).join(",")}
                    placeholder="pdf,docx,xlsx,zip"
                    className="h-8 w-full rounded bg-black/30 px-2"
                    onBlur={(e) => {
                      const raw = e.target.value.trim();
                      void fetch(`/api/groups/${groupId}`, {
                        method: "PATCH",
                        headers: { "Content-Type": "application/json" },
                        body: JSON.stringify({
                          allowedFileExts: raw ? raw.split(/[,\s]+/).filter(Boolean) : null,
                        }),
                      }).then(load);
                    }}
                  />
                </label>
                <label className="flex items-center justify-between">
                  <span>تاریخچه برای عضو جدید فقط از زمان عضویت</span>
                  <input
                    type="checkbox"
                    checked={group.historyMode === "from-join"}
                    onChange={(e) =>
                      void fetch(`/api/groups/${groupId}`, {
                        method: "PATCH",
                        headers: { "Content-Type": "application/json" },
                        body: JSON.stringify({ historyMode: e.target.checked ? "from-join" : "all" }),
                      }).then(load)
                    }
                  />
                </label>
                <label className="flex items-center justify-between">
                  <span>مخفی کردن فهرست کامل اعضا از اعضای عادی</span>
                  <input
                    type="checkbox"
                    checked={Boolean(group.hideMemberList)}
                    onChange={(e) =>
                      void fetch(`/api/groups/${groupId}`, {
                        method: "PATCH",
                        headers: { "Content-Type": "application/json" },
                        body: JSON.stringify({ hideMemberList: e.target.checked }),
                      }).then(load)
                    }
                  />
                </label>
                <label className="block space-y-1">
                  <span>عکس گروه</span>
                  <input
                    type="file"
                    accept="image/jpeg,image/png,image/webp"
                    className="text-[11px]"
                    onChange={(e) => {
                      const file = e.target.files?.[0];
                      if (!file) return;
                      const reader = new FileReader();
                      reader.onload = () => {
                        void fetch(`/api/groups/${groupId}`, {
                          method: "PATCH",
                          headers: { "Content-Type": "application/json" },
                          body: JSON.stringify({ photoDataUrl: String(reader.result ?? "") }),
                        }).then(load);
                      };
                      reader.readAsDataURL(file);
                    }}
                  />
                </label>
                <Textarea
                  defaultValue={group.description}
                  placeholder="توضیحات گروه"
                  className="min-h-16 bg-black/20"
                  onBlur={(e) =>
                    void fetch(`/api/groups/${groupId}`, {
                      method: "PATCH",
                      headers: { "Content-Type": "application/json" },
                      body: JSON.stringify({ description: e.target.value }),
                    }).then(load)
                  }
                />
                <Textarea
                  defaultValue={group.rules}
                  placeholder="قوانین گروه"
                  className="min-h-20 bg-black/20"
                  onBlur={(e) => void fetch(`/api/groups/${groupId}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ rules: e.target.value }) }).then(load)}
                />
                <Input
                  defaultValue={group.welcome}
                  placeholder="پیام خوشامد"
                  className="bg-black/20"
                  onBlur={(e) => void fetch(`/api/groups/${groupId}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ welcome: e.target.value }) })}
                />
              </div>
            )}
            <div className="flex flex-wrap gap-2">
              <Button type="button" size="sm" variant="secondary" onClick={() => void fetch(`/api/groups/${groupId}/members`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "notify", ms: 3600000 }) })}>Mute 1 Hour</Button>
              <Button type="button" size="sm" variant="secondary" onClick={() => void fetch(`/api/groups/${groupId}/members`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "notify", ms: 8 * 3600000 }) })}>8 Hours</Button>
              <Button type="button" size="sm" variant="secondary" onClick={() => void fetch(`/api/groups/${groupId}/members`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "notify", ms: 86400000 }) })}>1 Day</Button>
              <Button type="button" size="sm" variant="secondary" onClick={() => void fetch(`/api/groups/${groupId}/members`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "notify", ms: 7 * 86400000 }) })}>1 Week</Button>
              <Button type="button" size="sm" variant="secondary" onClick={() => void fetch(`/api/notify`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "mute", targetType: "group", targetId: groupId, forever: true }) })}>Until I Turn It Back On</Button>
              <Button type="button" size="sm" variant="secondary" onClick={() => void fetch(`/api/groups/${groupId}/members`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "notify", ms: null }) })}>Unmute</Button>
              <Button type="button" size="sm" variant="secondary" onClick={() => setBgOpen(true)}>پس‌زمینه این گروه</Button>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <select
                className="rounded-lg bg-black/30 px-2 py-1 text-xs"
                value={reportCat}
                onChange={(e) => setReportCat(e.target.value as typeof reportCat)}
              >
                <option value="spam">هرزنامه / کلاهبرداری</option>
                <option value="harassment">آزار</option>
                <option value="abuse">محتوای غیرمجاز</option>
                <option value="fake">گروه جعلی</option>
                <option value="other">سایر</option>
              </select>
              <Button
                type="button"
                variant="ghost"
                className="text-rose-200"
                onClick={async () => {
                  const res = await fetch("/api/reports", {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ targetKind: "group", targetKey: groupId, category: reportCat }),
                  });
                  toast.message(res.ok ? "گزارش ثبت شد." : "گزارش ارسال نشد.");
                }}
              >
                <Flag className="size-3.5" /> گزارش گروه
              </Button>
            </div>
            {group.myRole !== "owner" && (
              <Button
                type="button"
                variant="secondary"
                onClick={async () => {
                  if (!confirm("گروه را ترک می‌کنی؟")) return;
                  await fetch(`/api/groups/${groupId}?leave=1`, { method: "DELETE" });
                  onLeft();
                }}
              >
                ترک گروه
              </Button>
            )}
            {group.myRole === "owner" && (
              <div className="rounded-2xl border border-rose-400/30 p-3 text-xs">
                <p>حذف گروه — مرحله {deleteStep} از ۳</p>
                <Button
                  type="button"
                  className="mt-2 bg-rose-500 text-white"
                  onClick={async () => {
                    if (deleteStep < 2) {
                      setDeleteStep((s) => s + 1);
                      return;
                    }
                    await fetch(`/api/groups/${groupId}`, { method: "DELETE", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ confirm: "DELETE" }) });
                    onLeft();
                  }}
                >
                  {deleteStep === 0 ? "هشدار: برگشت‌ناپذیر است" : deleteStep === 1 ? "تأیید می‌کنم" : "تأیید نهایی و حذف"}
                </Button>
              </div>
            )}
            {admin && (
              <label className="flex items-center justify-between text-sm">
                واکنش‌ها
                <input
                  type="checkbox"
                  checked={group.reactionsEnabled !== false}
                  onChange={(e) =>
                    void fetch(`/api/groups/${groupId}`, {
                      method: "PATCH",
                      headers: { "Content-Type": "application/json" },
                      body: JSON.stringify({ reactionsEnabled: e.target.checked }),
                    }).then(load)
                  }
                />
              </label>
            )}
            <p className="flex items-center gap-1 text-[11px] text-emerald-100/50">
              <Lock className="size-3" /> مجوزها روی سرور اعمال می‌شوند. متن پیام‌های معمولی E2EE است.
            </p>
            <Button type="button" className="w-full bg-amber-300 text-[#102824]" onClick={() => setSettings(false)}>بستن</Button>
          </div>
        </div>
      )}
      {bgOpen && (
        <div className="fixed inset-0 z-50 grid place-items-center bg-black/70 p-4" onClick={() => setBgOpen(false)}>
          <div className="max-h-[90dvh] w-full max-w-lg overflow-auto rounded-3xl bg-[#102824] p-4" onClick={(e) => e.stopPropagation()}>
            <BackgroundPicker value={bgDraft} onChange={setBgDraft} label="پس‌زمینه فقط روی این دستگاه" />
            <Button
              type="button"
              className="mt-3 w-full bg-amber-300 text-[#102824]"
              onClick={() => {
                try {
                  window.localStorage.setItem(`nixo.group.bg.${groupId}`, JSON.stringify(bgDraft));
                } catch {
                  /* ignore */
                }
                setBgOpen(false);
              }}
            >
              اعمال محلی
            </Button>
          </div>
        </div>
      )}
      {groupCall && (
        <GroupCallStage
          initial={groupCall}
          members={(group?.members ?? []).filter((m) => m.kind === "user" && m.key).map((m) => ({ key: m.key!, name: m.name }))}
          lowData={false}
          minimized={callMin}
          onMinimized={setCallMin}
          onClose={() => {
            setGroupCall(null);
            setCallMin(false);
          }}
        />
      )}
    </div>
    </VoiceQueueProvider>
  );
}
