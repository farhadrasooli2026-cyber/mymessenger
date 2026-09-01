import "server-only";

export type ChatLiveEvent = {
  type: "message" | "edit" | "delete" | "read" | "typing" | "ack";
  threadId: string;
  at: number;
};

type Sub = { userId: string; threadId: string; send: (line: string) => void };

const subs = new Set<Sub>();

export function publishChatLive(userId: string, threadId: string, type: ChatLiveEvent["type"]) {
  const payload = JSON.stringify({ type, threadId, at: Date.now() });
  for (const sub of subs) {
    if (sub.userId === userId && sub.threadId === threadId) {
      try {
        sub.send(`data: ${payload}\n\n`);
      } catch {
        subs.delete(sub);
      }
    }
  }
}

export function subscribeChatLive(userId: string, threadId: string, send: (line: string) => void): () => void {
  const sub: Sub = { userId, threadId, send };
  subs.add(sub);
  return () => {
    subs.delete(sub);
  };
}
