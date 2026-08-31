import "server-only";
import { randomId } from "@/lib/crypto-utils";
import { mutateStore, readStoreSnapshot } from "@/lib/store";
import type { ChatMessage, StoreData } from "@/lib/store";

const SEED_PEERS = [
  {
    peerKey: "nixo",
    peerName: "نیکسو",
    peerTitle: "ارتباط رسمی",
    color: "#fbbf24",
    messages: [
      "سلام. به نیکسو خوش آمدی — پیام‌رسان نسل جدید برای اتصال، تبادل و ارتباط بدون مرز.",
      "حرف X در NIXO یعنی Connection، Exchange، Cross-border و Next: دو مسیر که به هم می‌رسند.",
      "نیکسو ادعا نمی‌کند غیرقابل‌هک است. امنیت اینجا از طراحی می‌آید: حریم خصوصی پیش‌فرض، Zero Trust، کمترین دسترسی، و رمزنگاری سرتاسری.",
    ],
  },
  {
    peerKey: "arya",
    peerName: "آریا کیان",
    peerTitle: "گفتگوی خصوصی",
    color: "#34d399",
    messages: [
      "رسیدی داخل نیکسو؟ مسیرش کوتاه بود.",
      "اگر خواستی بعداً گروه و کانال را هم از همین‌جا باز می‌کنیم — بدون منوی تو در تو.",
    ],
  },
  {
    peerKey: "noor",
    peerName: "استودیو نور",
    peerTitle: "کسب‌وکار",
    color: "#7dd3fc",
    messages: ["نمونهٔ گفتگوی کاری. فایل، پرداخت و مینی‌اپ روی همین نخ ساخته می‌شوند، نه در اپ جدا."],
  },
] as const;

export function seedInbox(data: StoreData, userId: string, now = Date.now()): void {
  if (data.threads.some((t) => t.ownerUserId === userId)) return;
  SEED_PEERS.forEach((peer, index) => {
    const threadId = randomId();
    data.threads.push({
      id: threadId,
      ownerUserId: userId,
      peerKey: peer.peerKey,
      peerName: peer.peerName,
      peerTitle: peer.peerTitle,
      color: peer.color,
      updatedAt: now - (SEED_PEERS.length - index) * 60_000,
    });
    peer.messages.forEach((text, i) => {
      data.messages.push({
        id: randomId(),
        threadId,
        ownerUserId: userId,
        sender: "peer",
        text,
        createdAt: now - (SEED_PEERS.length - index) * 60_000 + i * 12_000,
      });
    });
  });
}

export async function listThreads(userId: string) {
  return mutateStore((data) => {
    seedInbox(data, userId);
    const threads = data.threads
      .filter((t) => t.ownerUserId === userId)
      .sort((a, b) => b.updatedAt - a.updatedAt)
      .map((thread) => {
        const msgs = data.messages.filter((m) => m.threadId === thread.id);
        const last = msgs[msgs.length - 1];
        return {
          ...thread,
          lastText: last?.text ?? "",
          lastAt: last?.createdAt ?? thread.updatedAt,
        };
      });
    return threads;
  });
}

export async function listMessages(userId: string, threadId: string) {
  const data = await readStoreSnapshot();
  const thread = data.threads.find((t) => t.id === threadId && t.ownerUserId === userId);
  if (!thread) return null;
  const messages = data.messages
    .filter((m) => m.threadId === threadId && m.ownerUserId === userId)
    .sort((a, b) => a.createdAt - b.createdAt);
  return { thread, messages };
}

export async function sendMessage(userId: string, threadId: string, text: string) {
  const trimmed = text.trim();
  if (trimmed.length < 1 || trimmed.length > 2000) {
    return { ok: false as const, error: "متن پیام معتبر نیست.", status: 400 };
  }
  return mutateStore((data) => {
    seedInbox(data, userId);
    const thread = data.threads.find((t) => t.id === threadId && t.ownerUserId === userId);
    if (!thread) return { ok: false as const, error: "گفتگو یافت نشد.", status: 404 };
    const now = Date.now();
    const mine: ChatMessage = {
      id: randomId(),
      threadId,
      ownerUserId: userId,
      sender: "me",
      text: trimmed,
      createdAt: now,
    };
    data.messages.push(mine);
    thread.updatedAt = now;
    if (thread.peerKey === "nixo") {
      data.messages.push({
        id: randomId(),
        threadId,
        ownerUserId: userId,
        sender: "peer",
        text: nixoReply(trimmed),
        createdAt: now + 1,
      });
      thread.updatedAt = now + 1;
    }
    const messages = data.messages
      .filter((m) => m.threadId === threadId)
      .sort((a, b) => a.createdAt - b.createdAt);
    return { ok: true as const, thread, messages };
  });
}

function nixoReply(text: string): string {
  if (/امن|هک|hack|security/i.test(text)) {
    return "امنیت نیکسو تضمین مطلق نیست؛ لایه‌لایه است: احراز هویت سخت، کمترین دسترسی، و رمزنگاری سرتاسری. هر ادعای «هرگز هک نمی‌شویم» را باور نکن.";
  }
  if (/گروه|کانال|فروش|کیف|پرداخت|ai|ربات/i.test(text)) {
    return "گروه، کانال، جامعه، فروشگاه و کیف پول بخشی از نقشهٔ نیکسو هستند. این نسخه روی گفتگوی خصوصی و استوری کوتاه تمرکز دارد تا مسیر اصلی پیچیده نشود.";
  }
  return "پیامت رسید. نیکسو برای کارهای روزمره باید ساده بماند: بنویس، بفرست، ادامه بده.";
}

export const NIXO_STORY = {
  id: "nixo-origin",
  title: "چرا نیکسو؟",
  body: "نیکسو کپی واتساپ یا تلگرام نیست. یک پلتفرم مستقل برای ارتباط خصوصی، سریع و قابل‌توسعه است؛ از گفتگو تا کسب‌وکار، بدون اینکه کاربر در منو گم شود.",
};

export async function viewStory(userId: string, storyId: string) {
  return mutateStore((data) => {
    if (!data.storyViews.some((v) => v.ownerUserId === userId && v.storyId === storyId)) {
      data.storyViews.push({ ownerUserId: userId, storyId, viewedAt: Date.now() });
    }
    return { ok: true as const, storyId };
  });
}

export async function storyState(userId: string) {
  const data = await readStoreSnapshot();
  const viewed = data.storyViews.some((v) => v.ownerUserId === userId && v.storyId === NIXO_STORY.id);
  return { ...NIXO_STORY, viewed };
}
