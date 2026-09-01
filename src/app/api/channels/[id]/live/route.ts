import { jsonError } from "@/lib/http";
import { requireActiveUser } from "@/lib/auth";
import { getChannel } from "@/lib/channels";
import { subscribeChannelLive } from "@/lib/channel-live";

type Ctx = { params: Promise<{ id: string }> };

export async function GET(request: Request, ctx: Ctx) {
  const user = await requireActiveUser();
  if (!user) return jsonError("نشست فعال نیست.", 401);
  const { id } = await ctx.params;
  const listed = await getChannel(user.id, id);
  if (!listed) return jsonError("کانال یافت نشد.", 404);

  const encoder = new TextEncoder();
  let closed = false;
  const stream = new ReadableStream({
    start(controller) {
      const send = (line: string) => {
        if (closed) return;
        try {
          controller.enqueue(encoder.encode(line));
        } catch {
          closed = true;
        }
      };
      const unsub = subscribeChannelLive(user.id, id, send);
      send(`data: ${JSON.stringify({ type: "hello", channelId: id, at: Date.now() })}\n\n`);
      const beat = setInterval(() => send(`: ping\n\n`), 15_000);
      const stop = () => {
        if (closed) return;
        closed = true;
        clearInterval(beat);
        unsub();
        try {
          controller.close();
        } catch {
          /* already closed */
        }
      };
      request.signal.addEventListener("abort", stop);
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
      "Content-Encoding": "none",
    },
  });
}
