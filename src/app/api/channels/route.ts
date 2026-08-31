import { json, jsonError } from "@/lib/http";
import { requireActiveUser } from "@/lib/auth";
import { createChannel, listMyChannels, searchPublicChannels } from "@/lib/channels";

export async function GET(request: Request) {
  const user = await requireActiveUser();
  if (!user) return jsonError("نشست فعال نیست.", 401);
  const q = new URL(request.url).searchParams.get("q");
  if (q) {
    const channels = await searchPublicChannels(q, user.id);
    return json({ ok: true, channels });
  }
  const channels = await listMyChannels(user.id);
  return json({ ok: true, channels });
}

export async function POST(request: Request) {
  const user = await requireActiveUser();
  if (!user) return jsonError("نشست فعال نیست.", 401);
  const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
  if (!body) return jsonError("درخواست نامعتبر است.");
  const result = await createChannel(user.id, {
    name: String(body.name ?? ""),
    description: typeof body.description === "string" ? body.description : "",
    color: typeof body.color === "string" ? body.color : undefined,
    photoDataUrl: typeof body.photoDataUrl === "string" ? body.photoDataUrl : undefined,
    username: typeof body.username === "string" ? body.username : undefined,
    visibility: body.visibility === "private" ? "private" : "public",
    purpose:
      body.purpose === "news" || body.purpose === "products" || body.purpose === "promotions" || body.purpose === "announcements"
        ? body.purpose
        : "general",
    rules: typeof body.rules === "string" ? body.rules : undefined,
  });
  if (!result.ok) return jsonError(result.error, result.status);
  return json({ ok: true, channel: result.channel });
}
