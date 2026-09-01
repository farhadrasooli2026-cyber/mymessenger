import "server-only";
import { z } from "zod";
import { randomId } from "@/lib/crypto-utils";
import { hitRateLimit } from "@/lib/rate-limit";
import { mutateStore, readStoreSnapshot } from "@/lib/store";
import type { StoreData } from "@/lib/store";
import { canViewStory } from "@/lib/stories";
import type { ReportCategory } from "@/lib/chat-copy";

export const reportCategorySchema = z.enum(["spam", "abuse", "fake", "harassment", "other"]);

export type BlockState = {
  blockedByMe: boolean;
  blockedByPeer: boolean;
  blocked: boolean;
  messagesAllowed: boolean;
  callsAllowed: boolean;
  interactionsAllowed: boolean;
};

export function blockState(data: StoreData, userId: string, peerKey: string): BlockState {
  const me = data.users.find((u) => u.id === userId);
  const blockedByMe = Boolean(me?.blockedPeerKeys.includes(peerKey));
  const peerUser = data.users.find((u) => u.id === peerKey);
  const blockedByPeer = Boolean(peerUser?.blockedPeerKeys.includes(userId));
  const blocked = blockedByMe || blockedByPeer;
  return {
    blockedByMe,
    blockedByPeer,
    blocked,
    messagesAllowed: !blocked,
    callsAllowed: !blocked,
    interactionsAllowed: !blocked,
  };
}

export async function setBlocked(userId: string, threadId: string, blocked: boolean) {
  return mutateStore((data) => {
    const thread = data.threads.find((t) => t.id === threadId && t.ownerUserId === userId);
    if (!thread) return { ok: false as const, error: "گفتگو یافت نشد.", status: 404 };
    const user = data.users.find((u) => u.id === userId);
    if (!user) return { ok: false as const, error: "حساب فعال نیست.", status: 401 };
    const key = thread.peerKey;
    if (blocked) {
      if (!user.blockedPeerKeys.includes(key)) user.blockedPeerKeys.push(key);
    } else {
      user.blockedPeerKeys = user.blockedPeerKeys.filter((k) => k !== key);
    }
    return { ok: true as const, status: 200, peerKey: key, ...blockState(data, userId, key) };
  });
}

export async function listBlocked(userId: string) {
  const data = await readStoreSnapshot();
  const me = data.users.find((u) => u.id === userId);
  if (!me) return [];
  return me.blockedPeerKeys.map((peerKey) => {
    const thread = data.threads.find((t) => t.ownerUserId === userId && t.peerKey === peerKey);
    const peerUser = data.users.find((u) => u.id === peerKey);
    return {
      peerKey,
      peerName: thread?.peerName ?? peerUser?.displayName ?? peerKey,
      threadId: thread?.id ?? null,
    };
  });
}

export const reportInputSchema = z.object({
  targetKind: z.enum(["user", "chat", "group", "community", "channel", "story", "bot", "miniapp", "business", "sticker", "live"]),
  targetKey: z.string().min(1).max(160),
  threadId: z.string().max(80).optional(),
  messageIds: z.array(z.string().max(80)).max(20).optional(),
  category: reportCategorySchema,
  details: z.string().trim().max(500).optional().default(""),
});

export async function fileReport(
  reporterId: string,
  input: z.infer<typeof reportInputSchema>,
) {
  return mutateStore((data) => {
    const limit = hitRateLimit(data, `report:${reporterId}`, 60 * 60 * 1000, 8);
    if (!limit.allowed) {
      return { ok: false as const, error: "تعداد گزارش در این ساعت به سقف رسیده است.", status: 429 };
    }
    if (input.targetKind === "chat") {
      const thread = data.threads.find((t) => t.id === input.targetKey && t.ownerUserId === reporterId);
      if (!thread) return { ok: false as const, error: "گفتگو یافت نشد.", status: 404 };
    }
    if (input.targetKind === "group") {
      const parts = input.targetKey.split(":");
      const gid = parts[0];
      const group = data.groups.find((g) => g.id === gid && !g.deletedAt);
      if (!group || !group.members.some((m) => m.key === reporterId && !m.leftAt)) {
        return { ok: false as const, error: "گروه یافت نشد.", status: 404 };
      }
      if (parts[1] === "member") {
        const memberKey = parts[2] ?? "";
        if (!group.members.some((m) => m.key === memberKey)) {
          return { ok: false as const, error: "عضو یافت نشد.", status: 404 };
        }
      } else if (parts[1]) {
        const mid = parts.slice(1).join(":");
        if (!data.groupMessages.some((m) => m.id === mid && m.groupId === gid)) {
          return { ok: false as const, error: "پیام یافت نشد.", status: 404 };
        }
      }
    }
    if (input.targetKind === "community") {
      const community = data.communities.find((c) => c.id === input.targetKey && !c.deletedAt);
      if (!community || !community.members.some((m) => m.key === reporterId && !m.leftAt)) {
        return { ok: false as const, error: "جامعه یافت نشد.", status: 404 };
      }
    }
    if (input.targetKind === "channel") {
      const parts = input.targetKey.split(":");
      const cid = parts[0];
      const inCommunity = data.communities.some(
        (c) => !c.deletedAt && c.channels.some((ch) => ch.id === cid || ch.id === input.targetKey),
      );
      const pub = data.pubChannels.find((c) => (c.id === cid || c.id === input.targetKey) && !c.deletedAt);
      if (!inCommunity && !pub) return { ok: false as const, error: "کانال یافت نشد.", status: 404 };
      if (pub && pub.visibility === "private") {
        const staff = pub.staff.some((s) => s.userId === reporterId);
        const sub = pub.subscribers.some((s) => s.userId === reporterId && !s.leftAt);
        if (!staff && !sub) return { ok: false as const, error: "کانال یافت نشد.", status: 404 };
      }
      if (pub && parts[1] === "comment") {
        const postId = parts[2] ?? "";
        const commentId = parts[3] ?? "";
        const post = data.channelPosts.find((p) => p.id === postId && p.channelId === pub.id);
        if (!post || !post.comments.some((c) => c.id === commentId)) {
          return { ok: false as const, error: "نظر یافت نشد.", status: 404 };
        }
      } else if (pub && parts[1] === "member") {
        const memberKey = parts[2] ?? "";
        if (!pub.subscribers.some((s) => s.userId === memberKey) && !pub.staff.some((s) => s.userId === memberKey)) {
          return { ok: false as const, error: "مشترک یافت نشد.", status: 404 };
        }
      } else {
        const pid = input.targetKey.includes(":") ? input.targetKey.slice(cid.length + 1) : "";
        if (pid && pub && !data.channelPosts.some((p) => p.id === pid && p.channelId === pub.id)) {
          return { ok: false as const, error: "پست یافت نشد.", status: 404 };
        }
      }
    }
    if (input.targetKind === "sticker") {
      const [packId] = input.targetKey.split(":");
      if (!(data.stickerPacks ?? []).some((p) => p.id === packId || p.shareToken === input.targetKey)) {
        return { ok: false as const, error: "بسته یافت نشد.", status: 404 };
      }
    }
    if (input.targetKind === "story") {
      const story = data.userStories.find((s) => s.id === input.targetKey && !s.deletedAt);
      if (!story || !canViewStory(data, story, reporterId, Date.now(), { archive: story.ownerUserId === reporterId })) {
        return { ok: false as const, error: "استوری یافت نشد.", status: 404 };
      }
    }
    if (input.targetKind === "bot") {
      const bot = (data.bots ?? []).find((b) => b.id === input.targetKey);
      if (!bot) return { ok: false as const, error: "ربات یافت نشد.", status: 404 };
    }
    if (input.targetKind === "miniapp") {
      const mini = (data.miniApps ?? []).find((m) => m.id === input.targetKey);
      if (!mini) return { ok: false as const, error: "مینی‌اپ یافت نشد.", status: 404 };
    }
    if (input.targetKind === "live") {
      const live = (data.lives ?? []).find((l) => l.id === input.targetKey);
      if (!live) return { ok: false as const, error: "Live یافت نشد.", status: 404 };
    }
    const report = {
      id: randomId(),
      reporterId,
      targetKind: input.targetKind,
      targetKey: input.targetKey,
      threadId: input.threadId,
      messageIds: input.messageIds ?? [],
      category: input.category as ReportCategory,
      details: input.details ?? "",
      createdAt: Date.now(),
    };
    data.reports.push(report);
    return { ok: true as const, status: 200, reportId: report.id };
  });
}

export async function savePublicKey(userId: string, publicKey: JsonWebKey) {
  if (publicKey.kty !== "EC" || publicKey.crv !== "P-256" || !publicKey.x || !publicKey.y) {
    return { ok: false as const, error: "کلید عمومی معتبر نیست.", status: 400 };
  }
  return mutateStore((data) => {
    const user = data.users.find((u) => u.id === userId);
    if (!user) return { ok: false as const, error: "حساب فعال نیست.", status: 401 };
    user.cryptoPublicKey = {
      kty: publicKey.kty,
      crv: publicKey.crv,
      x: publicKey.x,
      y: publicKey.y,
      ext: true,
      key_ops: [],
    };
    return { ok: true as const, status: 200 };
  });
}

export async function getPeerPublicKey(viewerId: string, peerKey: string) {
  const data = await readStoreSnapshot();
  const state = blockState(data, viewerId, peerKey);
  if (!state.interactionsAllowed) return { ok: false as const, error: "تعامل محدود شده است.", status: 403 };
  const peer = data.users.find((u) => u.id === peerKey);
  return { ok: true as const, publicKey: peer?.cryptoPublicKey ?? null };
}
