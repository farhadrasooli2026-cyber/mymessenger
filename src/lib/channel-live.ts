import "server-only";

export type ChannelLiveEvent = {
  type: "post" | "edit" | "delete" | "comment" | "pin" | "hello";
  channelId: string;
  postId?: string;
  at: number;
};

type Sub = { userId: string; channelId: string; send: (line: string) => void };

const subs = new Set<Sub>();

export function publishChannelLive(channelId: string, type: ChannelLiveEvent["type"], postId?: string) {
  const payload = JSON.stringify({ type, channelId, postId, at: Date.now() });
  for (const sub of subs) {
    if (sub.channelId === channelId) {
      try {
        sub.send(`data: ${payload}\n\n`);
      } catch {
        subs.delete(sub);
      }
    }
  }
}

export function subscribeChannelLive(userId: string, channelId: string, send: (line: string) => void): () => void {
  const sub: Sub = { userId, channelId, send };
  subs.add(sub);
  return () => {
    subs.delete(sub);
  };
}
