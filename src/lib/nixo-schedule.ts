import { randomId } from "@/lib/crypto-utils";
import { mergeNixoPrefs, shouldSelfDeleteForInactivity } from "@/lib/nixo-features";
import type { ChatMessage, StoreData } from "@/lib/store";

const COLORS = ["#34d399", "#fbbf24", "#38bdf8", "#c084fc", "#fb7185"] as const;

export function releaseScheduledDirectMessages(data: StoreData, now: number) {
  const pending = data.messages.filter(
    (m) => m.sender === "me" && m.scheduledAt && m.scheduledAt <= now && !m.scheduledReleased,
  );
  for (const mine of pending) {
    mine.scheduledReleased = true;
    mine.createdAt = mine.scheduledAt ?? now;
    const thread = data.threads.find((t) => t.id === mine.threadId && t.ownerUserId === mine.ownerUserId);
    if (!thread) continue;
    thread.updatedAt = now;
    const peer = data.users.find((u) => u.id === thread.peerKey && u.status === "active");
    if (!peer) continue;
    let peerThread = data.threads.find((t) => t.ownerUserId === peer.id && t.peerKey === mine.ownerUserId);
    if (!peerThread) {
      const from = data.users.find((u) => u.id === mine.ownerUserId);
      peerThread = {
        id: randomId(),
        ownerUserId: peer.id,
        peerKey: mine.ownerUserId,
        peerName: from?.displayName || from?.username || "کاربر نیکسو",
        peerTitle: from?.username ? `@${from.username}` : "گفتگوی خصوصی",
        color: COLORS[mine.ownerUserId.charCodeAt(0) % COLORS.length]!,
        updatedAt: now,
      };
      data.threads.push(peerThread);
    }
    const copy: ChatMessage = {
      ...mine,
      id: randomId(),
      threadId: peerThread.id,
      ownerUserId: peer.id,
      sender: "peer",
      clientNonce: undefined,
      deliveredAt: now,
      scheduledReleased: true,
    };
    data.messages.push(copy);
    mine.deliveredAt = now;
    peerThread.updatedAt = now;
  }
}

export function applyOptionalInactivityDeletes(data: StoreData, now: number) {
  for (const user of data.users) {
    const prefs = mergeNixoPrefs(user.prefs);
    if (
      !shouldSelfDeleteForInactivity({
        enabled: prefs.inactivityDeleteEnabled,
        months: prefs.inactivityDeleteMonths,
        lastSeenAt: user.lastSeenAt ?? 0,
        createdAt: user.createdAt ?? 0,
        accountStatus: user.accountStatus,
        now,
      })
    ) {
      continue;
    }
    user.accountStatus = "pending_deletion";
    user.deletionRequestedAt = now;
    user.deletionFinalizeAt = now;
  }
}
