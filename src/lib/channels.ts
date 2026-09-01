import "server-only";
import { randomId } from "@/lib/crypto-utils";
import { hitRateLimit } from "@/lib/rate-limit";
import { mutateStore, readStoreSnapshot } from "@/lib/store";
import type { ChannelPost, ChannelStaff, PubChannelRecord, StoreData } from "@/lib/store";
import { sniffVoiceBytes, validateVoiceDuration, VOICE_UPLOAD_MAX } from "@/lib/voice";
import { FILE_MAX_BYTES, sanitizeFileName, scanNamedFile, sniffFileBytes } from "@/lib/files";
import { applyUserReaction, allowedReactionSet, publicReactionView, prefsOf } from "@/lib/stickers";
import { canChannelInvite } from "@/lib/privacy";
import { emitNotification } from "@/lib/notify";
import { insertLive } from "@/lib/live";
import { rankRole } from "@/lib/group-types";
import {
  CHANNEL_FLOOD_MAX,
  CHANNEL_FLOOD_WINDOW_MS,
  CHANNEL_MAX_PINS,
  CHANNEL_SUBSCRIBE_MAX,
  CHANNEL_SUBSCRIBE_WINDOW_MS,
  DEFAULT_CHANNEL_ADMIN_PERMS,
  type ChannelAdminPerms,
  type ChannelJoinMode,
  type ChannelLifecycle,
  type ChannelNotify,
  type ChannelPostKind,
  type ChannelPurpose,
  type ChannelStaffRole,
} from "@/lib/channel-types";

const COLORS = ["#fbbf24", "#34d399", "#7dd3fc", "#c4b5fd", "#fda4af", "#67e8f9"];
const USERNAME = /^[a-z][a-z0-9_]{2,23}$/;
const BROADCAST_BATCH = 40;
const POST_KINDS: ChannelPostKind[] = ["text", "photo", "video", "voice", "audio", "file", "link", "poll", "album", "gif", "quiz"];

function liveSub(s: PubChannelRecord["subscribers"][number]) {
  return !s.leftAt;
}

function lifecycleOf(channel: PubChannelRecord): ChannelLifecycle {
  if (channel.deletedAt || channel.status === "deleted") return "deleted";
  if (channel.status === "suspended" || channel.status === "restricted") return channel.status;
  return "active";
}

function channelListed(channel: PubChannelRecord) {
  return lifecycleOf(channel) !== "deleted";
}

function channelDiscoverable(channel: PubChannelRecord) {
  return channel.visibility === "public" && lifecycleOf(channel) === "active";
}

function nixoOps(data: StoreData, userId: string) {
  const handle = data.users.find((u) => u.id === userId)?.username?.toLowerCase() ?? "";
  return handle === "nixo" || handle === "nixo_ops";
}

function staffOf(channel: PubChannelRecord, userId: string): ChannelStaff | undefined {
  return channel.staff.find((s) => s.userId === userId);
}

function isBanned(channel: PubChannelRecord, userId: string) {
  return channel.bans.some((b) => b.key === userId);
}

function inviteOk(channel: PubChannelRecord, now: number) {
  if (!channel.inviteToken) return false;
  if (channel.inviteExpiresAt && now > channel.inviteExpiresAt) return false;
  if (channel.inviteMaxUses !== null && channel.inviteUses >= channel.inviteMaxUses) return false;
  return true;
}

function canAdmin(staff: ChannelStaff | undefined, perm: keyof ChannelAdminPerms, channel: PubChannelRecord) {
  if (!staff) return false;
  if (staff.role === "owner") return true;
  if (staff.role === "admin") return channel.adminPerms[perm];
  if (staff.role === "moderator") {
    return perm === "deletePosts" || perm === "manageComments" || perm === "pinPosts";
  }
  return false;
}

function pushAudit(channel: PubChannelRecord, actor: ChannelStaff, kind: string, detail: string) {
  channel.audit = [
    { id: randomId(), at: Date.now(), actorKey: actor.userId, actorName: actor.name, kind, detail },
    ...(channel.audit ?? []),
  ].slice(0, 80);
}

function publishDue(data: StoreData, now: number) {
  for (const post of data.channelPosts) {
    if (post.cancelled) continue;
    if (post.status === "scheduled" && post.scheduledAt && post.scheduledAt <= now && !post.deleted) {
      post.status = "published";
      post.publishedAt = now;
      enqueueBroadcast(data, post.channelId, post.id);
    }
  }
  drainBroadcasts(data, now);
}

function enqueueBroadcast(data: StoreData, channelId: string, postId: string) {
  data.channelBroadcasts ??= [];
  if (data.channelBroadcasts.some((j) => j.postId === postId && j.status !== "done")) return;
  data.channelBroadcasts.push({
    id: randomId(),
    channelId,
    postId,
    offset: 0,
    status: "queued",
    createdAt: Date.now(),
  });
}

function drainBroadcasts(data: StoreData, now: number) {
  data.channelBroadcasts ??= [];
  for (const job of data.channelBroadcasts) {
    if (job.status === "done") continue;
    const channel = data.pubChannels.find((c) => c.id === job.channelId);
    const post = data.channelPosts.find((p) => p.id === job.postId);
    if (!channel || !post || post.deleted || post.cancelled || lifecycleOf(channel) === "deleted") {
      job.status = "done";
      continue;
    }
    job.status = "running";
    const staff = channel.staff.find((s) => s.userId === post.authorKey);
    const subs = channel.subscribers.filter((s) => liveSub(s) && s.userId !== post.authorKey);
    const slice = subs.slice(job.offset, job.offset + BROADCAST_BATCH);
    const mentionNeedle = /@([a-z][a-z0-9_]{2,23})/gi;
    const mentioned = new Set<string>();
    let m: RegExpExecArray | null;
    const blob = `${post.body} ${post.caption}`;
    while ((m = mentionNeedle.exec(blob))) mentioned.add(m[1]!.toLowerCase());
    for (const s of slice) {
      if (s.notify === "off") continue;
      const user = data.users.find((u) => u.id === s.userId);
      const isMention = Boolean(user?.username && mentioned.has(user.username));
      if (s.notify === "important" && !isMention) continue;
      emitNotification(data, {
        userId: s.userId,
        category: "channels",
        kind: isMention ? "mention" : "channel_post",
        title: channel.name,
        senderName: staff?.name ?? post.authorName,
        body: (post.kind === "voice" || post.kind === "audio" ? "رسانهٔ صوتی جدید" : post.caption || post.body || post.kind).slice(0, 120),
        mention: isMention,
        sourceId: `channel:${channel.id}`,
        muteType: "channel",
        muteId: channel.id,
        target: { type: "channel", id: channel.id },
      });
    }
    job.offset += slice.length;
    if (job.offset >= subs.length) job.status = "done";
  }
  data.channelBroadcasts = data.channelBroadcasts
    .filter((j) => j.status !== "done" || now - j.createdAt < 24 * 60 * 60_000)
    .slice(-200);
}

function publicChannel(channel: PubChannelRecord, viewerId: string | null, data: StoreData) {
  const staff = viewerId ? staffOf(channel, viewerId) : undefined;
  const sub = viewerId ? channel.subscribers.find((s) => s.userId === viewerId && liveSub(s)) : undefined;
  const posts = data.channelPosts
    .filter((p) => p.channelId === channel.id && !p.deleted)
    .filter((p) => {
      if (p.status === "published") return true;
      return Boolean(staff);
    })
    .sort((a, b) => (b.publishedAt ?? b.createdAt) - (a.publishedAt ?? a.createdAt));
  const published = posts.filter((p) => p.status === "published" && !p.deleted);
  const subCount = channel.subscribers.filter(liveSub).length;
  const showCount = Boolean(staff) || Boolean(sub) || (channel.visibility === "public" && channel.showSubscriberCount !== false);
  const life = lifecycleOf(channel);
  const analytics =
    staff && canAdmin(staff, "viewAnalytics", channel)
      ? {
          subscribers: subCount,
          posts: published.length,
          views: published.reduce((n, p) => n + (p.views?.length ?? 0), 0),
          viewHits: published.reduce((n, p) => n + (p.viewHits ?? p.views?.length ?? 0), 0),
          reactions: published.reduce((n, p) => n + p.reactions.reduce((m, r) => m + r.keys.length, 0), 0),
          comments: published.reduce((n, p) => n + p.comments.length, 0),
          forwards: published.reduce((n, p) => n + (p.forwards ?? 0), 0),
        }
      : null;
  return {
    id: channel.id,
    name: channel.name,
    description: channel.description,
    rules: channel.rules ?? "",
    username: channel.username,
    color: channel.color,
    photoDataUrl: channel.photoDataUrl ?? null,
    visibility: channel.visibility,
    status: life,
    joinMode: channel.joinMode ?? (channel.visibility === "private" ? "invite" : "open"),
    showSubscriberCount: channel.showSubscriberCount !== false,
    purpose: channel.purpose ?? "general",
    verified: channel.verified,
    commentsEnabled: channel.commentsEnabled,
    reactionsEnabled: channel.reactionsEnabled !== false,
    allowedReactions: channel.allowedReactions ?? null,
    allowForward: channel.allowForward,
    allowCopy: channel.allowCopy !== false,
    discussionGroupId: channel.discussionGroupId,
    subscriberCount: showCount ? subCount : 0,
    myRole: staff?.role ?? null,
    subscribed: Boolean(sub),
    notify: sub?.notify ?? "on",
    inviteToken: staff && (canAdmin(staff, "manageInvites", channel) || canAdmin(staff, "manageSubscribers", channel)) ? channel.inviteToken : null,
    inviteMaxUses: staff ? channel.inviteMaxUses : null,
    inviteUses: staff ? channel.inviteUses : null,
    inviteExpiresAt: staff ? channel.inviteExpiresAt : null,
    ownerName: channel.staff.find((s) => s.role === "owner")?.name ?? "",
    ownerUserId: staff ? channel.ownerUserId : undefined,
    adminPerms: staff
      ? channel.adminPerms
      : {
          ...DEFAULT_CHANNEL_ADMIN_PERMS,
          postMessages: false,
          editPosts: false,
          deletePosts: false,
          pinPosts: false,
          manageComments: false,
          manageSubscribers: false,
          manageChannelInfo: false,
          manageOtherAdmins: false,
          manageInvites: false,
          manageBots: false,
          manageAI: false,
          viewAnalytics: false,
        },
    pinIds: channel.pinIds,
    createdAt: channel.createdAt,
    updatedAt: channel.updatedAt,
    liveActive: Boolean(channel.liveActive),
    liveTitle: channel.liveTitle ?? "",
    liveChatEnabled: channel.liveChatEnabled !== false,
    liveChat: channel.liveActive ? (channel.liveChat ?? []).slice(-40) : [],
    liveStreamId: channel.liveStreamId ?? null,
    stories: (channel.stories ?? []).filter((s) => s.expiresAt > Date.now()).map((s) => ({
      id: s.id,
      body: s.body,
      photoDataUrl: s.photoDataUrl,
      createdAt: s.createdAt,
      expiresAt: s.expiresAt,
      views: s.views.length,
    })),
    analytics,
    audit: staff?.role === "owner" || staff?.role === "admin" ? (channel.audit ?? []).slice(0, 40) : [],
    staff: staff ? channel.staff.map((s) => ({ userId: s.userId, role: s.role, name: s.name })) : [],
    joinRequests:
      staff && canAdmin(staff, "manageSubscribers", channel)
        ? (channel.requests ?? []).filter((r) => r.status === "pending").map((r) => ({ id: r.id, userId: r.userId, name: r.name, createdAt: r.createdAt }))
        : [],
    pendingJoin: Boolean(viewerId && (channel.requests ?? []).some((r) => r.userId === viewerId && r.status === "pending")),
    subscribers:
      staff && canAdmin(staff, "manageSubscribers", channel)
        ? channel.subscribers.filter(liveSub).map((s) => ({
            userId: s.userId,
            name: s.name,
            username: s.username,
            subscribedAt: s.subscribedAt,
          }))
        : [],
    posts: posts.map((p) => ({
      id: p.id,
      channelId: p.channelId,
      authorName: p.authorName,
      kind: p.kind,
      body: p.body,
      caption: p.caption,
      status: p.status,
      scheduledAt: p.scheduledAt,
      publishedAt: p.publishedAt,
      editedAt: p.editedAt,
      cancelled: Boolean(p.cancelled),
      sourcePostId: p.sourcePostId ?? null,
      reactions: (p.reactions ?? []).map((r) => ({
        emoji: r.emoji,
        keys: staff ? r.keys : r.keys.map(() => "*"),
      })),
      album: p.album ?? [],
      views: p.views?.length ?? 0,
      viewHits: staff ? p.viewHits ?? p.views?.length ?? 0 : undefined,
      forwards: p.forwards ?? 0,
      comments: channel.commentsEnabled
        ? p.comments.map((c) => ({
            id: c.id,
            authorName: c.authorName,
            body: c.body,
            createdAt: c.createdAt,
            parentId: c.parentId ?? null,
          }))
        : [],
      durationMs: p.durationMs,
      poll: p.poll
        ? {
            ...p.poll,
            correctIndex: staff || p.poll.quiz ? p.poll.correctIndex : undefined,
            votes: p.poll.anonymous
              ? p.poll.votes.map((v) => ({ voterKey: "anon", indexes: v.indexes }))
              : p.poll.votes,
          }
        : undefined,
    })),
  };
}

export async function listMyChannels(userId: string) {
  const data = await readStoreSnapshot();
  publishDue(data, Date.now());
  return data.pubChannels
    .filter((c) => channelListed(c) && (staffOf(c, userId) || c.subscribers.some((s) => s.userId === userId && liveSub(s))))
    .sort((a, b) => b.updatedAt - a.updatedAt)
    .map((c) => publicChannel(c, userId, data));
}

export async function searchPublicChannels(q: string, userId: string) {
  const needle = q.trim().replace(/^@/, "").toLowerCase();
  if (needle.length < 2) return [];
  const data = await readStoreSnapshot();
  return data.pubChannels
    .filter((c) => channelDiscoverable(c))
    .filter((c) => c.name.toLowerCase().includes(needle) || (c.username ?? "").includes(needle))
    .slice(0, 20)
    .map((c) => ({
      id: c.id,
      name: c.name,
      username: c.username,
      color: c.color,
      subscriberCount: c.subscribers.filter(liveSub).length,
      verified: c.verified,
      subscribed: c.subscribers.some((s) => s.userId === userId && liveSub(s)),
    }));
}

export async function getChannel(userId: string, channelId: string) {
  return mutateStore((data) => {
    publishDue(data, Date.now());
    const channel = data.pubChannels.find((c) => c.id === channelId && channelListed(c));
    if (!channel) return null;
    const staff = staffOf(channel, userId);
    const sub = channel.subscribers.some((s) => s.userId === userId && liveSub(s));
    const life = lifecycleOf(channel);
    if (life === "suspended" && !staff) return null;
    if (channel.visibility === "private" && !staff && !sub) return null;
    return { channel: publicChannel(channel, userId, data) };
  });
}

export async function getPublicByUsername(username: string, userId: string | null) {
  const u = username.replace(/^@/, "").toLowerCase();
  const data = await readStoreSnapshot();
  const channel = data.pubChannels.find((c) => channelDiscoverable(c) && c.username === u);
  if (!channel) return null;
  return { channel: publicChannel(channel, userId, data) };
}

export async function createChannel(
  userId: string,
  input: {
    name: string;
    description?: string;
    color?: string;
    username?: string;
    visibility?: "public" | "private";
    photoDataUrl?: string | null;
    purpose?: ChannelPurpose;
    rules?: string;
    joinMode?: ChannelJoinMode;
  },
) {
  const name = input.name.trim().slice(0, 48);
  if (name.length < 2) return { ok: false as const, error: "نام کانال خیلی کوتاه است.", status: 400 };
  const data0 = await readStoreSnapshot();
  const user = data0.users.find((u) => u.id === userId);
  if (!user) return { ok: false as const, error: "حساب فعال نیست.", status: 401 };
  return mutateStore((data) => {
    const username = input.username?.trim().replace(/^@/, "").toLowerCase() || null;
    const visibility = input.visibility === "private" ? "private" : "public";
    if (visibility === "public") {
      if (!username || !USERNAME.test(username)) {
        return { ok: false as const, error: "کانال عمومی به نام کاربری یکتا نیاز دارد.", status: 400 };
      }
    }
    if (username) {
      if (!USERNAME.test(username)) return { ok: false as const, error: "نام کاربری نامعتبر است.", status: 400 };
      if (data.pubChannels.some((c) => c.username === username && !c.deletedAt)) {
        return { ok: false as const, error: "این نام کاربری کانال گرفته شده است.", status: 409 };
      }
    }
    const now = Date.now();
    const channel: PubChannelRecord = {
      id: randomId(),
      name,
      description: (input.description ?? "").trim().slice(0, 800),
      rules: (input.rules ?? "").trim().slice(0, 2000),
      username,
      color: input.color && COLORS.includes(input.color) ? input.color : COLORS[0]!,
      photoDataUrl:
        typeof input.photoDataUrl === "string" && input.photoDataUrl.startsWith("data:image/")
          ? input.photoDataUrl.slice(0, 400_000)
          : null,
      visibility,
      status: "active",
      joinMode: visibility === "private" ? (input.joinMode === "request" ? "request" : "invite") : "open",
      showSubscriberCount: true,
      purpose: input.purpose ?? "general",
      businessId: data.businesses?.find((b) => b.ownerUserId === userId)?.id ?? null,
      ownerUserId: userId,
      verified: false,
      commentsEnabled: true,
      reactionsEnabled: true,
      allowForward: true,
      allowCopy: true,
      discussionGroupId: null,
      inviteToken: randomId(),
      inviteMaxUses: null,
      inviteUses: 0,
      inviteExpiresAt: null,
      adminPerms: { ...DEFAULT_CHANNEL_ADMIN_PERMS },
      staff: [{ userId, role: "owner", name: user.displayName || user.firstName || "مالک" }],
      subscribers: [
        {
          userId,
          name: user.displayName || user.username || "مالک",
          username: user.username ?? null,
          subscribedAt: now,
          notify: "on",
          leftAt: null,
        },
      ],
      requests: [],
      bans: [],
      pinIds: [],
      audit: [],
      liveActive: false,
      liveTitle: "",
      liveChatEnabled: true,
      liveChat: [],
      stories: [],
      createdAt: now,
      updatedAt: now,
      deletedAt: null,
    };
    data.pubChannels.push(channel);
    return { ok: true as const, channel: publicChannel(channel, userId, data) };
  });
}

export async function updateChannel(
  userId: string,
  channelId: string,
  patch: Partial<{
    name: string;
    description: string;
    color: string;
    username: string | null;
    visibility: "public" | "private";
    commentsEnabled: boolean;
    reactionsEnabled: boolean;
    allowedReactions: string[] | null;
    allowForward: boolean;
    allowCopy: boolean;
    discussionGroupId: string | null;
    adminPerms: ChannelAdminPerms;
    photoDataUrl: string | null;
    rules: string;
    purpose: ChannelPurpose;
    joinMode: ChannelJoinMode;
    showSubscriberCount: boolean;
  }>,
) {
  return mutateStore((data) => {
    const channel = data.pubChannels.find((c) => c.id === channelId && channelListed(c));
    if (!channel) return { ok: false as const, error: "کانال یافت نشد.", status: 404 };
    const me = staffOf(channel, userId);
    if (patch.adminPerms && me?.role !== "owner") {
      return { ok: false as const, error: "فقط مالک مجوز ادمین را تغییر می‌دهد.", status: 403 };
    }
    if (patch.discussionGroupId !== undefined && me?.role !== "owner") {
      return { ok: false as const, error: "فقط مالک گروه بحث را وصل می‌کند.", status: 403 };
    }
    if (!canAdmin(me, "manageChannelInfo", channel) && !patch.adminPerms && patch.discussionGroupId === undefined) {
      return { ok: false as const, error: "اجازهٔ ویرایش نداری.", status: 403 };
    }
    if (typeof patch.name === "string" && patch.name.trim().length >= 2) channel.name = patch.name.trim().slice(0, 48);
    if (typeof patch.description === "string") channel.description = patch.description.trim().slice(0, 800);
    if (patch.color && COLORS.includes(patch.color)) channel.color = patch.color;
    if (typeof patch.commentsEnabled === "boolean") channel.commentsEnabled = patch.commentsEnabled;
    if (typeof patch.reactionsEnabled === "boolean") channel.reactionsEnabled = patch.reactionsEnabled;
    if (patch.allowedReactions !== undefined) {
      channel.allowedReactions = patch.allowedReactions === null ? null : allowedReactionSet(patch.allowedReactions);
    }
    if (typeof patch.allowForward === "boolean") channel.allowForward = patch.allowForward;
    if (typeof patch.allowCopy === "boolean") channel.allowCopy = patch.allowCopy;
    if (typeof patch.rules === "string") channel.rules = patch.rules.trim().slice(0, 2000);
    if (patch.purpose) channel.purpose = patch.purpose;
    if (patch.photoDataUrl !== undefined) {
      channel.photoDataUrl =
        typeof patch.photoDataUrl === "string" && patch.photoDataUrl.startsWith("data:image/")
          ? patch.photoDataUrl.slice(0, 400_000)
          : null;
    }
    if (patch.visibility) {
      channel.visibility = patch.visibility;
      if (patch.visibility === "public") channel.joinMode = "open";
      if (patch.visibility === "private" && channel.joinMode === "open") channel.joinMode = "invite";
    }
    if (patch.joinMode === "open" || patch.joinMode === "invite" || patch.joinMode === "request") {
      if (channel.visibility === "public" && patch.joinMode !== "open") {
        return { ok: false as const, error: "کانال عمومی Join Request ندارد.", status: 400 };
      }
      channel.joinMode = patch.joinMode;
    }
    if (typeof patch.showSubscriberCount === "boolean") channel.showSubscriberCount = patch.showSubscriberCount;
    if (patch.username !== undefined) {
      const u = patch.username?.trim().replace(/^@/, "").toLowerCase() || null;
      if (u && !USERNAME.test(u)) return { ok: false as const, error: "نام کاربری نامعتبر است.", status: 400 };
      if (u && data.pubChannels.some((c) => c.id !== channel.id && c.username === u && !c.deletedAt)) {
        return { ok: false as const, error: "این نام کاربری گرفته شده است.", status: 409 };
      }
      channel.username = u;
    }
    if (channel.visibility === "public" && !channel.username) {
      return { ok: false as const, error: "کانال عمومی باید نام کاربری داشته باشد.", status: 400 };
    }
    if (patch.discussionGroupId !== undefined) {
      if (patch.discussionGroupId) {
        const group = data.groups.find((g) => g.id === patch.discussionGroupId && !g.deletedAt);
        if (!group || group.ownerUserId !== userId) {
          return { ok: false as const, error: "فقط گروه خودت را می‌توانی وصل کنی.", status: 403 };
        }
      }
      channel.discussionGroupId = patch.discussionGroupId;
    }
    if (patch.adminPerms) {
      channel.adminPerms = { ...DEFAULT_CHANNEL_ADMIN_PERMS, ...patch.adminPerms };
      if (me) pushAudit(channel, me, "permission", "مجوز ادمین تغییر کرد");
    }
    channel.updatedAt = Date.now();
    return { ok: true as const, channel: publicChannel(channel, userId, data) };
  });
}

export async function rotateInvite(
  userId: string,
  channelId: string,
  action: "new" | "revoke",
  extra?: { maxUses?: number | null; expiresInMs?: number | null },
) {
  return mutateStore((data) => {
    const channel = data.pubChannels.find((c) => c.id === channelId && channelListed(c));
    if (!channel) return { ok: false as const, error: "کانال یافت نشد.", status: 404 };
    const me = staffOf(channel, userId);
    if (!canAdmin(me, "manageInvites", channel) && !canAdmin(me, "manageSubscribers", channel)) {
      return { ok: false as const, error: "اجازهٔ لینک دعوت نداری.", status: 403 };
    }
    if (action === "revoke") {
      channel.inviteToken = "";
      channel.inviteUses = 0;
      channel.inviteMaxUses = null;
      channel.inviteExpiresAt = null;
      if (me) pushAudit(channel, me, "invite", "Invite Revoked");
    } else {
      channel.inviteToken = randomId();
      channel.inviteUses = 0;
      channel.inviteMaxUses = typeof extra?.maxUses === "number" ? Math.max(1, extra.maxUses) : extra?.maxUses === null ? null : channel.inviteMaxUses;
      channel.inviteExpiresAt =
        typeof extra?.expiresInMs === "number" ? Date.now() + extra.expiresInMs : extra?.expiresInMs === null ? null : channel.inviteExpiresAt;
    }
    channel.updatedAt = Date.now();
    return {
      ok: true as const,
      inviteToken: channel.inviteToken || null,
      inviteMaxUses: channel.inviteMaxUses,
      inviteExpiresAt: channel.inviteExpiresAt,
    };
  });
}

export async function previewInvite(token: string) {
  const data = await readStoreSnapshot();
  const now = Date.now();
  const channel = data.pubChannels.find((c) => c.inviteToken && c.inviteToken === token && channelListed(c));
  if (!channel || !inviteOk(channel, now) || lifecycleOf(channel) === "suspended") return null;
  return {
    id: channel.id,
    name: channel.name,
    description: channel.description,
    color: channel.color,
    subscriberCount: channel.subscribers.filter(liveSub).length,
    visibility: channel.visibility,
    verified: channel.verified,
  };
}

function addSubscriber(channel: PubChannelRecord, user: { id: string; displayName?: string; username?: string }, now: number) {
  const existing = channel.subscribers.find((s) => s.userId === user.id);
  if (existing) {
    existing.leftAt = null;
    existing.subscribedAt = now;
    existing.name = user.displayName || user.username || existing.name;
    existing.username = user.username ?? existing.username;
    return;
  }
  channel.subscribers.push({
    userId: user.id,
    name: user.displayName || user.username || "دنبال‌کننده",
    username: user.username ?? null,
    subscribedAt: now,
    notify: "on",
    leftAt: null,
  });
}

export async function joinByToken(userId: string, token: string) {
  return mutateStore((data) => {
    const now = Date.now();
    const channel = data.pubChannels.find((c) => c.inviteToken && c.inviteToken === token && channelListed(c));
    if (!channel || !inviteOk(channel, now) || lifecycleOf(channel) === "suspended") {
      return { ok: false as const, error: "لینک دعوت نامعتبر یا منقضی است.", status: 404 };
    }
    const user = data.users.find((u) => u.id === userId);
    if (!user) return { ok: false as const, error: "حساب فعال نیست.", status: 401 };
    if (isBanned(channel, userId)) return { ok: false as const, error: "از این کانال بن شده‌ای.", status: 403 };
    const flood = hitRateLimit(data, `csub:${userId}`, CHANNEL_SUBSCRIBE_WINDOW_MS, CHANNEL_SUBSCRIBE_MAX, now);
    if (!flood.allowed) return { ok: false as const, error: "دنبال کردن پیاپی محدود شد.", status: 429 };
    addSubscriber(channel, { id: userId, displayName: user.displayName, username: user.username }, now);
    channel.inviteUses += 1;
    channel.updatedAt = now;
    return { ok: true as const, channel: publicChannel(channel, userId, data) };
  });
}

export async function subscribe(userId: string, channelId: string) {
  return mutateStore((data) => {
    const channel = data.pubChannels.find((c) => c.id === channelId && channelListed(c));
    if (!channel) return { ok: false as const, error: "کانال یافت نشد.", status: 404 };
    const life = lifecycleOf(channel);
    if (life === "suspended") return { ok: false as const, error: "این کانال معلق است.", status: 403 };
    const user = data.users.find((u) => u.id === userId);
    if (!user) return { ok: false as const, error: "حساب فعال نیست.", status: 401 };
    if (isBanned(channel, userId)) return { ok: false as const, error: "از این کانال بن شده‌ای.", status: 403 };
    const now = Date.now();
    const flood = hitRateLimit(data, `csub:${userId}`, CHANNEL_SUBSCRIBE_WINDOW_MS, CHANNEL_SUBSCRIBE_MAX, now);
    if (!flood.allowed) return { ok: false as const, error: "دنبال کردن پیاپی محدود شد.", status: 429 };
    if (channel.visibility === "private") {
      const mode = channel.joinMode ?? "invite";
      if (mode !== "request") {
        return { ok: false as const, error: "کانال خصوصی فقط با دعوت قابل دنبال است.", status: 403 };
      }
      channel.requests ??= [];
      const existing = channel.requests.find((r) => r.userId === userId && r.status === "pending");
      if (existing) return { ok: true as const, channel: publicChannel(channel, userId, data), requested: true as const };
      channel.requests.push({
        id: randomId(),
        userId,
        name: user.displayName || user.username || "کاربر",
        createdAt: now,
        status: "pending",
      });
      channel.updatedAt = now;
      return { ok: true as const, channel: publicChannel(channel, userId, data), requested: true as const };
    }
    addSubscriber(channel, { id: userId, displayName: user.displayName, username: user.username }, now);
    channel.updatedAt = now;
    return { ok: true as const, channel: publicChannel(channel, userId, data) };
  });
}

export async function unsubscribe(userId: string, channelId: string) {
  return mutateStore((data) => {
    const channel = data.pubChannels.find((c) => c.id === channelId && channelListed(c));
    if (!channel) return { ok: false as const, error: "کانال یافت نشد.", status: 404 };
    if (staffOf(channel, userId)?.role === "owner") {
      return { ok: false as const, error: "مالک نمی‌تواند کانال را ترک کند. حذف کن یا مالکیت را واگذار کن.", status: 400 };
    }
    const sub = channel.subscribers.find((s) => s.userId === userId && liveSub(s));
    if (!sub) return { ok: false as const, error: "دنبال نمی‌کنی.", status: 400 };
    sub.leftAt = Date.now();
    channel.staff = channel.staff.filter((s) => s.userId !== userId);
    channel.updatedAt = Date.now();
    return { ok: true as const };
  });
}

export async function inviteDirect(userId: string, channelId: string, keys: string[]) {
  return mutateStore((data) => {
    const channel = data.pubChannels.find((c) => c.id === channelId && channelListed(c));
    if (!channel) return { ok: false as const, error: "کانال یافت نشد.", status: 404 };
    const me = staffOf(channel, userId);
    if (!canAdmin(me, "manageSubscribers", channel)) {
      return { ok: false as const, error: "اجازهٔ دعوت نداری.", status: 403 };
    }
    const now = Date.now();
    for (const raw of keys.slice(0, 20)) {
      const other = data.users.find((u) => u.id === raw || u.username === raw.replace(/^@/, "").toLowerCase());
      if (!other || isBanned(channel, other.id)) continue;
      if (!canChannelInvite(data, userId, other.id)) continue;
      addSubscriber(channel, { id: other.id, displayName: other.displayName, username: other.username }, now);
    }
    channel.updatedAt = now;
    return { ok: true as const, channel: publicChannel(channel, userId, data) };
  });
}

export async function setNotify(userId: string, channelId: string, notify: ChannelNotify) {
  return mutateStore((data) => {
    const channel = data.pubChannels.find((c) => c.id === channelId && channelListed(c));
    if (!channel) return { ok: false as const, error: "کانال یافت نشد.", status: 404 };
    const sub = channel.subscribers.find((s) => s.userId === userId && liveSub(s));
    if (!sub) return { ok: false as const, error: "دنبال نمی‌کنی.", status: 403 };
    sub.notify = notify;
    return { ok: true as const, notify: sub.notify };
  });
}

export async function setStaff(userId: string, channelId: string, targetId: string, role: ChannelStaffRole | "none") {
  return mutateStore((data) => {
    const channel = data.pubChannels.find((c) => c.id === channelId && channelListed(c));
    if (!channel) return { ok: false as const, error: "کانال یافت نشد.", status: 404 };
    const me = staffOf(channel, userId);
    if (me?.role !== "owner" && !canAdmin(me, "manageOtherAdmins", channel)) {
      return { ok: false as const, error: "اجازهٔ تغییر ادمین نداری.", status: 403 };
    }
    if (targetId === channel.ownerUserId) return { ok: false as const, error: "مالک قابل تغییر از این مسیر نیست.", status: 400 };
    const targetUser = data.users.find((u) => u.id === targetId);
    const sub = channel.subscribers.find((s) => s.userId === targetId && liveSub(s));
    if (!sub && !targetUser) return { ok: false as const, error: "کاربر یافت نشد.", status: 404 };
    channel.staff = channel.staff.filter((s) => s.userId !== targetId);
    if (role !== "none") {
      if (role === "owner") return { ok: false as const, error: "نقش مالک از اینجا ست نمی‌شود.", status: 400 };
      if (me?.role !== "owner" && rankRole(role) >= 3) {
        return { ok: false as const, error: "فقط مالک ادمین تعیین می‌کند.", status: 403 };
      }
      channel.staff.push({
        userId: targetId,
        role,
        name: targetUser?.displayName || sub?.name || "ادمین",
      });
    }
    channel.updatedAt = Date.now();
    if (me) pushAudit(channel, me, "staff", `${targetId} → ${role}`);
    return { ok: true as const, channel: publicChannel(channel, userId, data) };
  });
}

export async function moderateSubscriber(
  userId: string,
  channelId: string,
  targetId: string,
  action: "remove" | "ban" | "unban",
) {
  return mutateStore((data) => {
    const channel = data.pubChannels.find((c) => c.id === channelId && channelListed(c));
    if (!channel) return { ok: false as const, error: "کانال یافت نشد.", status: 404 };
    const me = staffOf(channel, userId);
    if (!canAdmin(me, "manageSubscribers", channel)) {
      return { ok: false as const, error: "اجازه نداری.", status: 403 };
    }
    if (targetId === channel.ownerUserId) return { ok: false as const, error: "مالک قابل حذف نیست.", status: 400 };
    if (action === "unban") {
      channel.bans = channel.bans.filter((b) => b.key !== targetId);
      return { ok: true as const, channel: publicChannel(channel, userId, data) };
    }
    const sub = channel.subscribers.find((s) => s.userId === targetId && liveSub(s));
    if (sub) sub.leftAt = Date.now();
    channel.staff = channel.staff.filter((s) => s.userId !== targetId);
    if (action === "ban" && !channel.bans.some((b) => b.key === targetId)) {
      channel.bans.push({ key: targetId, at: Date.now() });
    }
    if (me) pushAudit(channel, me, action, targetId);
    channel.updatedAt = Date.now();
    return { ok: true as const, channel: publicChannel(channel, userId, data) };
  });
}

export async function deleteChannel(userId: string, channelId: string) {
  return mutateStore((data) => {
    const channel = data.pubChannels.find((c) => c.id === channelId && channelListed(c));
    if (!channel) return { ok: false as const, error: "کانال یافت نشد.", status: 404 };
    if (staffOf(channel, userId)?.role !== "owner") {
      return { ok: false as const, error: "فقط مالک می‌تواند کانال را حذف کند.", status: 403 };
    }
    channel.deletedAt = Date.now();
    channel.status = "deleted";
    channel.inviteToken = "";
    data.channelPosts = data.channelPosts.filter((p) => p.channelId !== channelId);
    return { ok: true as const };
  });
}

export async function createPost(
  userId: string,
  channelId: string,
  input: {
    kind?: ChannelPostKind;
    body?: string;
    caption?: string;
    status?: "draft" | "scheduled" | "published";
    scheduledAt?: number | null;
    poll?: { question: string; options: string[]; anonymous?: boolean; multiple?: boolean; closesAt?: number | null; quiz?: boolean; correctIndex?: number | null };
    album?: string[];
    durationMs?: number;
    voiceDataUrl?: string;
    fileDataUrl?: string;
    fileName?: string;
  },
) {
  return mutateStore((data) => {
    const channel = data.pubChannels.find((c) => c.id === channelId && channelListed(c));
    if (!channel) return { ok: false as const, error: "کانال یافت نشد.", status: 404 };
    const me = staffOf(channel, userId);
    if (!canAdmin(me, "postMessages", channel)) {
      return { ok: false as const, error: "اجازهٔ انتشار نداری.", status: 403 };
    }
    const life = lifecycleOf(channel);
    if (life === "suspended") return { ok: false as const, error: "کانال معلق است.", status: 403 };
    if (life === "restricted" && me?.role !== "owner") {
      return { ok: false as const, error: "کانال محدود است؛ فقط مالک می‌تواند پست بگذارد.", status: 403 };
    }
    const now = Date.now();
    const flood = hitRateLimit(data, `cpost:${channelId}:${userId}`, CHANNEL_FLOOD_WINDOW_MS, CHANNEL_FLOOD_MAX, now);
    if (!flood.allowed) return { ok: false as const, error: "انتشار پیاپی محدود شد.", status: 429 };
    const kind = input.kind && POST_KINDS.includes(input.kind) ? input.kind : "text";
    let body = (input.body ?? "").trim().slice(0, 4000);
    let caption = (input.caption ?? "").trim().slice(0, 1000);
    if (kind === "poll" || kind === "quiz") {
      const question = input.poll?.question?.trim() ?? "";
      const options = (input.poll?.options ?? []).map((o) => o.trim()).filter(Boolean).slice(0, 8);
      if (question.length < 2 || options.length < 2) return { ok: false as const, error: "نظرسنجی نامعتبر است.", status: 400 };
    } else if (kind === "voice") {
      const d = validateVoiceDuration(input.durationMs);
      if (!d.ok) return { ok: false as const, error: d.error, status: 400 };
      const raw = String(input.voiceDataUrl ?? input.body ?? "");
      const m = /^data:([a-zA-Z0-9.+/-]+);base64,([A-Za-z0-9+/]+=*)$/.exec(raw);
      if (!m) return { ok: false as const, error: "فایل صوت نامعتبر است.", status: 400 };
      let buf: Buffer;
      try {
        buf = Buffer.from(m[2]!, "base64");
      } catch {
        return { ok: false as const, error: "فایل صوت خراب است.", status: 400 };
      }
      if (buf.length > VOICE_UPLOAD_MAX) return { ok: false as const, error: "حجم صوت از سقف نیکسو بیشتر است.", status: 413 };
      const sniff = sniffVoiceBytes(new Uint8Array(buf));
      if (!sniff.ok) return { ok: false as const, error: sniff.error ?? "امضای فایل صوت پذیرفته نشد.", status: 400 };
      body = raw;
    } else if (kind === "file" || kind === "audio" || kind === "photo" || kind === "video" || kind === "gif") {
      const raw = String(input.fileDataUrl ?? input.body ?? "");
      if (raw.startsWith("data:")) {
        const m = /^data:([a-zA-Z0-9.+/-]+);base64,([A-Za-z0-9+/]+=*)$/.exec(raw);
        if (!m) return { ok: false as const, error: "فایل نامعتبر است.", status: 400 };
        let buf: Buffer;
        try {
          buf = Buffer.from(m[2]!, "base64");
        } catch {
          return { ok: false as const, error: "فایل خراب است.", status: 400 };
        }
        if (buf.length > FILE_MAX_BYTES) return { ok: false as const, error: "حجم فایل از سقف سرور بیشتر است.", status: 413 };
        const name = sanitizeFileName(String(input.fileName ?? (kind === "audio" ? "audio.bin" : "file.bin")));
        const named = scanNamedFile(name, m[1] ?? "", buf.length);
        if (!named.ok) return { ok: false as const, error: named.warning ?? "فایل مجاز نیست.", status: 400 };
        const sniff = sniffFileBytes(new Uint8Array(buf));
        if (!sniff.ok) return { ok: false as const, error: sniff.error ?? "امضای فایل پذیرفته نشد.", status: 400 };
        body = raw;
        if (!caption) caption = name;
      } else if (body.length < 1 && caption.length < 1) {
        return { ok: false as const, error: "پست خالی است.", status: 400 };
      }
    } else if (kind !== "album" && body.length < 1 && caption.length < 1) {
      return { ok: false as const, error: "پست خالی است.", status: 400 };
    }
    if (kind === "link" && /https?:\/\//i.test(body)) {
      const links = hitRateLimit(data, `clink:${channelId}:${userId}`, 60_000, 8, now);
      if (!links.allowed) return { ok: false as const, error: "لینک پیاپی محدود شد.", status: 429 };
    }
    let status: ChannelPost["status"] = input.status === "draft" || input.status === "scheduled" ? input.status : "published";
    if (status === "scheduled" && (!input.scheduledAt || input.scheduledAt <= now)) status = "published";
    const post: ChannelPost = {
      id: randomId(),
      channelId,
      authorKey: userId,
      authorName: me!.name,
      kind,
      body,
      caption,
      status,
      scheduledAt: status === "scheduled" ? input.scheduledAt ?? null : null,
      publishedAt: status === "published" ? now : null,
      editedAt: null,
      reactions: [],
      comments: [],
      poll:
        kind === "poll" || kind === "quiz"
          ? {
              question: input.poll!.question.trim().slice(0, 200),
              options: input.poll!.options.map((o) => o.trim().slice(0, 80)).filter(Boolean).slice(0, 8),
              anonymous: Boolean(input.poll?.anonymous),
              multiple: kind === "quiz" ? false : Boolean(input.poll?.multiple),
              closesAt: input.poll?.closesAt ?? null,
              votes: [],
              quiz: kind === "quiz" || Boolean(input.poll?.quiz),
              correctIndex: typeof input.poll?.correctIndex === "number" ? input.poll.correctIndex : null,
            }
          : undefined,
      album: kind === "album" ? (input.album ?? body.split("\n")).map((s) => s.trim()).filter(Boolean).slice(0, 10) : [],
      views: [],
      viewHits: 0,
      forwards: 0,
      createdAt: now,
      durationMs: kind === "voice" || kind === "audio" ? input.durationMs : undefined,
      sourcePostId: null,
      fileName: kind === "file" || kind === "audio" || kind === "photo" || kind === "video" || kind === "gif" ? sanitizeFileName(String(input.fileName ?? caption)).slice(0, 120) : undefined,
    };
    data.channelPosts.push(post);
    channel.updatedAt = now;
    if (status === "published") {
      enqueueBroadcast(data, channel.id, post.id);
      drainBroadcasts(data, now);
    }
    return { ok: true as const, post, channel: publicChannel(channel, userId, data) };
  });
}

export async function editPost(userId: string, channelId: string, postId: string, patch: { body?: string; caption?: string }) {
  return mutateStore((data) => {
    const channel = data.pubChannels.find((c) => c.id === channelId && channelListed(c));
    if (!channel) return { ok: false as const, error: "کانال یافت نشد.", status: 404 };
    const me = staffOf(channel, userId);
    if (!canAdmin(me, "editPosts", channel)) return { ok: false as const, error: "اجازهٔ ویرایش نداری.", status: 403 };
    const post = data.channelPosts.find((p) => p.id === postId && p.channelId === channelId && !p.deleted);
    if (!post) return { ok: false as const, error: "پست یافت نشد.", status: 404 };
    if (typeof patch.body === "string") post.body = patch.body.trim().slice(0, 4000);
    if (typeof patch.caption === "string") post.caption = patch.caption.trim().slice(0, 1000);
    post.editedAt = Date.now();
    channel.updatedAt = Date.now();
    return { ok: true as const, post };
  });
}

export async function deletePost(userId: string, channelId: string, postId: string) {
  return mutateStore((data) => {
    const channel = data.pubChannels.find((c) => c.id === channelId && channelListed(c));
    if (!channel) return { ok: false as const, error: "کانال یافت نشد.", status: 404 };
    const me = staffOf(channel, userId);
    if (!canAdmin(me, "deletePosts", channel)) return { ok: false as const, error: "اجازهٔ حذف نداری.", status: 403 };
    const post = data.channelPosts.find((p) => p.id === postId && p.channelId === channelId);
    if (!post) return { ok: false as const, error: "پست یافت نشد.", status: 404 };
    post.deleted = true;
    channel.pinIds = channel.pinIds.filter((id) => id !== postId);
    if (me) pushAudit(channel, me, "post_deleted", postId);
    return { ok: true as const };
  });
}

export async function pinPost(userId: string, channelId: string, postId: string, pin: boolean) {
  return mutateStore((data) => {
    const channel = data.pubChannels.find((c) => c.id === channelId && channelListed(c));
    if (!channel) return { ok: false as const, error: "کانال یافت نشد.", status: 404 };
    const me = staffOf(channel, userId);
    if (!canAdmin(me, "pinPosts", channel)) return { ok: false as const, error: "اجازهٔ پین نداری.", status: 403 };
    const exists = data.channelPosts.some((p) => p.id === postId && p.channelId === channelId && !p.deleted);
    if (!exists) return { ok: false as const, error: "پست یافت نشد.", status: 404 };
    if (pin) {
      if (!channel.pinIds.includes(postId)) {
        if (channel.pinIds.length >= CHANNEL_MAX_PINS) channel.pinIds.shift();
        channel.pinIds.push(postId);
      }
    } else channel.pinIds = channel.pinIds.filter((id) => id !== postId);
    return { ok: true as const, pinIds: channel.pinIds };
  });
}

export async function reactPost(userId: string, channelId: string, postId: string, emoji: string) {
  return mutateStore((data) => {
    const limit = hitRateLimit(data, `react:${userId}`, 60_000, 40);
    if (!limit.allowed) return { ok: false as const, error: "واکنش محدود شد.", status: 429 };
    const channel = data.pubChannels.find((c) => c.id === channelId && channelListed(c));
    if (!channel) return { ok: false as const, error: "کانال یافت نشد.", status: 404 };
    if (!channel.reactionsEnabled) return { ok: false as const, error: "واکنش در این کانال خاموش است.", status: 403 };
    const allowed = staffOf(channel, userId) || channel.subscribers.some((s) => s.userId === userId && liveSub(s));
    if (!allowed && channel.visibility === "private") return { ok: false as const, error: "اجازه نداری.", status: 403 };
    const post = data.channelPosts.find((p) => p.id === postId && p.channelId === channelId && !p.deleted);
    if (!post) return { ok: false as const, error: "پست یافت نشد.", status: 404 };
    const set = allowedReactionSet(channel.allowedReactions);
    const applied = applyUserReaction(post.reactions, userId, emoji, set);
    if (!applied.ok) return { ok: false as const, error: applied.error, status: 400 };
    post.reactions = applied.rows;
    prefsOf(data, userId).emojiRecent = [emoji.trim().slice(0, 8), ...prefsOf(data, userId).emojiRecent.filter((e) => e !== emoji)].slice(0, 32);
    if (applied.action !== "remove" && post.authorKey !== userId) {
      const lock = data.notifyPrefs?.find((p) => p.userId === post.authorKey);
      emitNotification(data, {
        userId: post.authorKey,
        category: "channels",
        kind: "reaction",
        title: lock?.lockScreen === "hidden" ? "NIXO" : channel.name,
        senderName: lock?.lockScreen === "hidden" ? "NIXO" : data.users.find((u) => u.id === userId)?.displayName || "مشترک",
        body: lock?.lockScreen === "hidden" ? "" : "واکنش جدید",
        sourceId: `creact:${channel.id}:${postId}`,
        muteType: "channel",
        muteId: channel.id,
        target: { type: "channel", id: channel.id },
      });
    }
    return { ok: true as const, reactions: publicReactionView(data, post.reactions, userId), action: applied.action };
  });
}

export async function commentPost(userId: string, channelId: string, postId: string, body: string, parentId?: string | null) {
  const text = body.trim().slice(0, 500);
  if (text.length < 1) return { ok: false as const, error: "نظر خالی است.", status: 400 };
  return mutateStore((data) => {
    const channel = data.pubChannels.find((c) => c.id === channelId && channelListed(c));
    if (!channel) return { ok: false as const, error: "کانال یافت نشد.", status: 404 };
    if (!channel.commentsEnabled) return { ok: false as const, error: "نظر برای این کانال خاموش است.", status: 403 };
    const user = data.users.find((u) => u.id === userId);
    const allowed = staffOf(channel, userId) || channel.subscribers.some((s) => s.userId === userId && liveSub(s));
    if (!allowed) return { ok: false as const, error: "ابتدا دنبال کن.", status: 403 };
    const post = data.channelPosts.find((p) => p.id === postId && p.channelId === channelId && !p.deleted);
    if (!post) return { ok: false as const, error: "پست یافت نشد.", status: 404 };
    const parent = parentId ? post.comments.find((c) => c.id === parentId) : null;
    if (parentId && !parent) return { ok: false as const, error: "نظر والد یافت نشد.", status: 404 };
    const flood = hitRateLimit(data, `cmt:${channelId}:${userId}`, CHANNEL_FLOOD_WINDOW_MS, CHANNEL_FLOOD_MAX);
    if (!flood.allowed) return { ok: false as const, error: "نظر پیاپی محدود شد.", status: 429 };
    post.comments.push({
      id: randomId(),
      authorKey: userId,
      authorName: user?.displayName || "کاربر",
      body: text,
      createdAt: Date.now(),
      parentId: parent ? parent.id : null,
    });
    return { ok: true as const, comments: post.comments };
  });
}

export async function deleteComment(userId: string, channelId: string, postId: string, commentId: string) {
  return mutateStore((data) => {
    const channel = data.pubChannels.find((c) => c.id === channelId && channelListed(c));
    if (!channel) return { ok: false as const, error: "کانال یافت نشد.", status: 404 };
    const me = staffOf(channel, userId);
    const post = data.channelPosts.find((p) => p.id === postId && p.channelId === channelId);
    if (!post) return { ok: false as const, error: "پست یافت نشد.", status: 404 };
    const comment = post.comments.find((c) => c.id === commentId);
    if (!comment) return { ok: false as const, error: "نظر یافت نشد.", status: 404 };
    if (comment.authorKey !== userId && !canAdmin(me, "manageComments", channel)) {
      return { ok: false as const, error: "اجازهٔ حذف نظر نداری.", status: 403 };
    }
    post.comments = post.comments.filter((c) => c.id !== commentId);
    return { ok: true as const };
  });
}

export async function votePoll(userId: string, channelId: string, postId: string, indexes: number[]) {
  return mutateStore((data) => {
    const channel = data.pubChannels.find((c) => c.id === channelId && channelListed(c));
    if (!channel) return { ok: false as const, error: "کانال یافت نشد.", status: 404 };
    const allowed = staffOf(channel, userId) || channel.subscribers.some((s) => s.userId === userId && liveSub(s));
    if (!allowed) return { ok: false as const, error: "ابتدا دنبال کن.", status: 403 };
    const flood = hitRateLimit(data, `cvote:${channelId}:${userId}`, 60_000, 20);
    if (!flood.allowed) return { ok: false as const, error: "رأی پیاپی محدود شد.", status: 429 };
    const post = data.channelPosts.find(
      (p) => p.id === postId && p.channelId === channelId && (p.kind === "poll" || p.kind === "quiz"),
    );
    if (!post?.poll) return { ok: false as const, error: "نظرسنجی یافت نشد.", status: 404 };
    if (post.poll.closesAt && Date.now() > post.poll.closesAt) {
      return { ok: false as const, error: "نظرسنجی بسته شده است.", status: 400 };
    }
    const clean = [...new Set(indexes.filter((i) => Number.isInteger(i) && i >= 0 && i < post.poll!.options.length))];
    const picked = post.poll.multiple ? clean : clean.slice(0, 1);
    const voterKey = post.poll.anonymous ? `anon:${userId.slice(0, 8)}` : userId;
    post.poll.votes = post.poll.votes.filter((v) => v.voterKey !== voterKey && v.voterKey !== userId);
    post.poll.votes.push({ voterKey, indexes: picked });
    return { ok: true as const, poll: post.poll };
  });
}

export async function searchChannel(userId: string, channelId: string, q: string) {
  const listed = await getChannel(userId, channelId);
  if (!listed) return null;
  const needle = q.trim().toLowerCase();
  if (needle.length < 2) return { posts: [] as ChannelPost[] };
  const hits = listed.channel.posts.filter((p) => {
    if (p.status !== "published" && !listed.channel.myRole) return false;
    const blob = `${p.body} ${p.caption} ${p.kind} ${p.poll?.question ?? ""} ${(p.album ?? []).join(" ")}`.toLowerCase();
    return blob.includes(needle) || ["عکس", "ویدیو", "فایل", "لینک", "صوت", "photo", "video", "file", "link", "voice"].some((k) => k.includes(needle) || needle.includes(k) && p.kind.includes(k.replace("عکس", "photo")));
  });
  return { posts: hits.slice(0, 40) };
}

export async function recordPostView(userId: string, channelId: string, postId: string) {
  return mutateStore((data) => {
    const channel = data.pubChannels.find((c) => c.id === channelId && channelListed(c));
    if (!channel) return { ok: false as const, error: "کانال یافت نشد.", status: 404 };
    const allowed = staffOf(channel, userId) || channel.subscribers.some((s) => s.userId === userId && liveSub(s)) || channel.visibility === "public";
    if (!allowed) return { ok: false as const, error: "اجازه نداری.", status: 403 };
    const post = data.channelPosts.find((p) => p.id === postId && p.channelId === channelId && !p.deleted);
    if (!post) return { ok: false as const, error: "پست یافت نشد.", status: 404 };
    post.views ??= [];
    post.viewHits = (post.viewHits ?? 0) + 1;
    const viewFlood = hitRateLimit(data, `cview:${userId}:${postId}`, 60_000, 12, Date.now());
    if (!viewFlood.allowed) return { ok: true as const, views: post.views.length, unique: post.views.length, hits: post.viewHits };
    if (!post.views.includes(userId)) post.views.push(userId);
    return { ok: true as const, views: post.views.length, unique: post.views.length, hits: post.viewHits };
  });
}

export async function recordForward(userId: string, channelId: string, postId: string) {
  return mutateStore((data) => {
    const channel = data.pubChannels.find((c) => c.id === channelId && channelListed(c));
    if (!channel) return { ok: false as const, error: "کانال یافت نشد.", status: 404 };
    if (!channel.allowForward) return { ok: false as const, error: "هدایت این کانال محدود شده است.", status: 403 };
    const post = data.channelPosts.find((p) => p.id === postId && p.channelId === channelId && !p.deleted);
    if (!post) return { ok: false as const, error: "پست یافت نشد.", status: 404 };
    post.forwards = (post.forwards ?? 0) + 1;
    return { ok: true as const, forwards: post.forwards };
  });
}

export async function transferChannelOwner(userId: string, channelId: string, targetId: string, confirm: string) {
  return mutateStore((data) => {
    const channel = data.pubChannels.find((c) => c.id === channelId && channelListed(c));
    if (!channel) return { ok: false as const, error: "کانال یافت نشد.", status: 404 };
    const me = staffOf(channel, userId);
    if (me?.role !== "owner") return { ok: false as const, error: "فقط مالک می‌تواند مالکیت را واگذار کند.", status: 403 };
    if (confirm !== "TRANSFER") return { ok: false as const, error: "تأیید امنیتی TRANSFER لازم است.", status: 400 };
    const target = channel.subscribers.find((s) => s.userId === targetId && liveSub(s));
    if (!target) return { ok: false as const, error: "فقط مشترک واردشده قابل انتقال است.", status: 400 };
    me.role = "admin";
    channel.staff = channel.staff.filter((s) => s.userId !== targetId);
    channel.staff.push({ userId: targetId, role: "owner", name: target.name });
    channel.ownerUserId = targetId;
    pushAudit(channel, me, "owner", `مالکیت به ${target.name}`);
    channel.updatedAt = Date.now();
    return { ok: true as const, channel: publicChannel(channel, userId, data) };
  });
}

export async function setLive(userId: string, channelId: string, active: boolean, title?: string, chatEnabled?: boolean) {
  return mutateStore((data) => {
    const channel = data.pubChannels.find((c) => c.id === channelId && channelListed(c));
    if (!channel) return { ok: false as const, error: "کانال یافت نشد.", status: 404 };
    const me = staffOf(channel, userId);
    if (!canAdmin(me, "postMessages", channel)) return { ok: false as const, error: "اجازهٔ پخش زنده نداری.", status: 403 };
    if (typeof chatEnabled === "boolean") channel.liveChatEnabled = chatEnabled;
    if (active) {
      const open = (data.lives ?? []).find((l) => l.channelId === channelId && l.status !== "ended" && !l.emergencyStopped);
      if (open) {
        channel.liveActive = true;
        channel.liveTitle = title?.slice(0, 80) || open.title;
        channel.liveStreamId = open.id;
      } else {
        const made = insertLive(data, userId, {
          title: title || "پخش نیکسو",
          scope: "channel",
          channelId,
          visibility: channel.visibility === "public" ? "public" : "members",
          chatEnabled: channel.liveChatEnabled !== false,
        });
        if (!made.ok) return { ok: false as const, error: made.error, status: made.status };
        channel.liveActive = true;
        channel.liveTitle = made.live.title;
        channel.liveStreamId = made.live.id;
      }
    } else {
      channel.liveActive = false;
      channel.liveChat = [];
      const cur = (data.lives ?? []).find((l) => l.id === channel.liveStreamId);
      if (cur && cur.status !== "ended") {
        cur.status = "ended";
        cur.endedAt = Date.now();
        cur.participants.forEach((p) => {
          if (!p.leftAt) p.leftAt = Date.now();
        });
      }
    }
    if (typeof title === "string") channel.liveTitle = title.slice(0, 80);
    if (me) pushAudit(channel, me, "live", active ? "Live On" : "Live Off");
    channel.updatedAt = Date.now();
    return { ok: true as const, channel: publicChannel(channel, userId, data) };
  });
}

export async function liveChat(userId: string, channelId: string, body: string) {
  const text = body.trim().slice(0, 280);
  if (!text) return { ok: false as const, error: "پیام خالی است.", status: 400 };
  return mutateStore((data) => {
    const channel = data.pubChannels.find((c) => c.id === channelId && channelListed(c));
    if (!channel) return { ok: false as const, error: "کانال یافت نشد.", status: 404 };
    if (!channel.liveActive || !channel.liveChatEnabled) return { ok: false as const, error: "چت زنده خاموش است.", status: 403 };
    const allowed = staffOf(channel, userId) || channel.subscribers.some((s) => s.userId === userId && liveSub(s));
    if (!allowed) return { ok: false as const, error: "ابتدا دنبال کن.", status: 403 };
    const flood = hitRateLimit(data, `clive:${channelId}:${userId}`, CHANNEL_FLOOD_WINDOW_MS, CHANNEL_FLOOD_MAX);
    if (!flood.allowed) return { ok: false as const, error: "پیام پیاپی محدود شد.", status: 429 };
    const user = data.users.find((u) => u.id === userId);
    channel.liveChat = [
      ...(channel.liveChat ?? []),
      { id: randomId(), authorKey: userId, authorName: user?.displayName || "کاربر", body: text, createdAt: Date.now() },
    ].slice(-80);
    return { ok: true as const, liveChat: channel.liveChat.slice(-40) };
  });
}

export async function publishChannelStory(userId: string, channelId: string, body: string, photoDataUrl?: string | null) {
  return mutateStore((data) => {
    const channel = data.pubChannels.find((c) => c.id === channelId && channelListed(c));
    if (!channel) return { ok: false as const, error: "کانال یافت نشد.", status: 404 };
    const me = staffOf(channel, userId);
    if (!canAdmin(me, "postMessages", channel)) return { ok: false as const, error: "اجازه نداری.", status: 403 };
    const now = Date.now();
    channel.stories = (channel.stories ?? []).filter((s) => s.expiresAt > now);
    channel.stories.unshift({
      id: randomId(),
      body: body.trim().slice(0, 280),
      photoDataUrl: typeof photoDataUrl === "string" && photoDataUrl.startsWith("data:image/") ? photoDataUrl.slice(0, 400_000) : null,
      createdAt: now,
      expiresAt: now + 24 * 60 * 60_000,
      views: [],
    });
    channel.updatedAt = now;
    return { ok: true as const, channel: publicChannel(channel, userId, data) };
  });
}

export async function moderateJoinRequest(userId: string, channelId: string, targetId: string, approve: boolean) {
  return mutateStore((data) => {
    const channel = data.pubChannels.find((c) => c.id === channelId && channelListed(c));
    if (!channel) return { ok: false as const, error: "کانال یافت نشد.", status: 404 };
    const me = staffOf(channel, userId);
    if (!canAdmin(me, "manageSubscribers", channel)) return { ok: false as const, error: "اجازه نداری.", status: 403 };
    const req = (channel.requests ?? []).find((r) => r.userId === targetId && r.status === "pending");
    if (!req) return { ok: false as const, error: "درخواست یافت نشد.", status: 404 };
    req.status = approve ? "approved" : "rejected";
    if (approve) {
      const user = data.users.find((u) => u.id === targetId);
      addSubscriber(channel, { id: targetId, displayName: user?.displayName || req.name, username: user?.username }, Date.now());
    }
    if (me) pushAudit(channel, me, approve ? "join_ok" : "join_no", targetId);
    channel.updatedAt = Date.now();
    return { ok: true as const, channel: publicChannel(channel, userId, data) };
  });
}

export async function cancelScheduledPost(userId: string, channelId: string, postId: string) {
  return mutateStore((data) => {
    const channel = data.pubChannels.find((c) => c.id === channelId && channelListed(c));
    if (!channel) return { ok: false as const, error: "کانال یافت نشد.", status: 404 };
    const me = staffOf(channel, userId);
    if (!canAdmin(me, "deletePosts", channel) && !canAdmin(me, "postMessages", channel)) {
      return { ok: false as const, error: "اجازه نداری.", status: 403 };
    }
    const post = data.channelPosts.find((p) => p.id === postId && p.channelId === channelId && !p.deleted);
    if (!post || post.status !== "scheduled") return { ok: false as const, error: "پست زمان‌بندی‌شده نیست.", status: 404 };
    post.cancelled = true;
    post.status = "draft";
    if (me) pushAudit(channel, me, "schedule_cancel", postId);
    return { ok: true as const, post };
  });
}

export async function repostPost(userId: string, channelId: string, sourcePostId: string) {
  return mutateStore((data) => {
    const dest = data.pubChannels.find((c) => c.id === channelId && channelListed(c));
    if (!dest) return { ok: false as const, error: "کانال یافت نشد.", status: 404 };
    const me = staffOf(dest, userId);
    if (!canAdmin(me, "postMessages", dest)) return { ok: false as const, error: "اجازهٔ انتشار نداری.", status: 403 };
    if (lifecycleOf(dest) !== "active") return { ok: false as const, error: "کانال برای انتشار آماده نیست.", status: 403 };
    const source = data.channelPosts.find((p) => p.id === sourcePostId && !p.deleted && p.status === "published");
    if (!source) return { ok: false as const, error: "پست مبدأ یافت نشد.", status: 404 };
    const srcCh = data.pubChannels.find((c) => c.id === source.channelId && channelListed(c));
    if (!srcCh || !srcCh.allowForward) return { ok: false as const, error: "هدایت این محتوا محدود است.", status: 403 };
    const canSee =
      srcCh.visibility === "public" ||
      Boolean(staffOf(srcCh, userId)) ||
      srcCh.subscribers.some((s) => s.userId === userId && liveSub(s));
    if (!canSee) return { ok: false as const, error: "به پست مبدأ دسترسی نداری.", status: 403 };
    const now = Date.now();
    const post: ChannelPost = {
      id: randomId(),
      channelId,
      authorKey: userId,
      authorName: me!.name,
      kind: source.kind === "voice" || source.kind === "file" || source.kind === "audio" ? "text" : source.kind,
      body: (source.caption || source.body).slice(0, 4000),
      caption: `بازنشر از ${srcCh.name}`,
      status: "published",
      scheduledAt: null,
      publishedAt: now,
      editedAt: null,
      reactions: [],
      comments: [],
      album: [],
      views: [],
      viewHits: 0,
      forwards: 0,
      createdAt: now,
      sourcePostId: source.id,
    };
    data.channelPosts.push(post);
    source.forwards = (source.forwards ?? 0) + 1;
    dest.updatedAt = now;
    enqueueBroadcast(data, dest.id, post.id);
    drainBroadcasts(data, now);
    return { ok: true as const, post, channel: publicChannel(dest, userId, data) };
  });
}

export async function listChannelDiscovery(userId: string, mode: "discovery" | "trending") {
  return mutateStore((data) => {
    publishDue(data, Date.now());
    const flood = hitRateLimit(data, `cdisc:${userId}`, 60_000, 30);
    if (!flood.allowed) return { ok: false as const, error: "جستجو محدود شد.", status: 429, channels: [] as { id: string }[] };
    const rows = data.pubChannels.filter((c) => channelDiscoverable(c)).map((c) => {
      const posts = data.channelPosts.filter((p) => p.channelId === c.id && p.status === "published" && !p.deleted);
      const unique = posts.reduce((n, p) => n + (p.views?.length ?? 0), 0);
      const hits = posts.reduce((n, p) => n + (p.viewHits ?? 0), 0);
      const reactions = posts.reduce((n, p) => n + p.reactions.reduce((m, r) => m + r.keys.length, 0), 0);
      const subs = c.subscribers.filter(liveSub).length;
      const abuse = Math.max(0, hits - unique);
      const score = unique * 2 + reactions + subs * 3 - abuse;
      return {
        id: c.id,
        name: c.name,
        username: c.username,
        color: c.color,
        verified: c.verified,
        subscriberCount: c.showSubscriberCount !== false ? subs : 0,
        score,
      };
    });
    rows.sort((a, b) => (mode === "trending" ? b.score - a.score : b.subscriberCount - a.subscriberCount || b.score - a.score));
    return { ok: true as const, channels: rows.slice(0, 40) };
  });
}

export async function adminChannelLifecycle(
  actorId: string,
  channelId: string,
  status: ChannelLifecycle,
  extra?: { verified?: boolean },
) {
  return mutateStore((data) => {
    if (!nixoOps(data, actorId)) return { ok: false as const, error: "فقط ایمنی نیکسو.", status: 403 };
    const channel = data.pubChannels.find((c) => c.id === channelId);
    if (!channel) return { ok: false as const, error: "کانال یافت نشد.", status: 404 };
    if (status === "deleted") {
      channel.status = "deleted";
      channel.deletedAt = Date.now();
      channel.inviteToken = "";
    } else {
      channel.status = status;
      channel.deletedAt = null;
    }
    if (typeof extra?.verified === "boolean") channel.verified = extra.verified;
    return { ok: true as const, status: lifecycleOf(channel), verified: channel.verified };
  });
}

export async function exportChannelData(userId: string, channelId: string) {
  return mutateStore((data) => {
    const channel = data.pubChannels.find((c) => c.id === channelId && channelListed(c));
    if (!channel) return { ok: false as const, error: "کانال یافت نشد.", status: 404 };
    if (staffOf(channel, userId)?.role !== "owner") {
      return { ok: false as const, error: "فقط مالک می‌تواند خروجی بگیرد.", status: 403 };
    }
    const posts = data.channelPosts
      .filter((p) => p.channelId === channelId)
      .map((p) => ({
        id: p.id,
        kind: p.kind,
        status: p.status,
        caption: p.caption,
        publishedAt: p.publishedAt,
        uniqueViews: p.views?.length ?? 0,
        viewHits: p.viewHits ?? 0,
        forwards: p.forwards ?? 0,
        comments: p.comments.length,
      }));
    return {
      ok: true as const,
      export: {
        id: channel.id,
        name: channel.name,
        username: channel.username,
        visibility: channel.visibility,
        status: lifecycleOf(channel),
        createdAt: channel.createdAt,
        subscriberCount: channel.subscribers.filter(liveSub).length,
        posts,
        audit: (channel.audit ?? []).slice(0, 80).map((a) => ({ at: a.at, kind: a.kind, detail: a.detail })),
      },
    };
  });
}
