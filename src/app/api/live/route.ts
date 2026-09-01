import { json, jsonError } from "@/lib/http";
import { requireActiveUser } from "@/lib/auth";
import { createLive, listLives, updateLivePrefs } from "@/lib/live";

export async function GET(request: Request) {
  const user = await requireActiveUser();
  if (!user) return jsonError("نشست فعال نیست.", 401);
  const url = new URL(request.url);
  const modeRaw = url.searchParams.get("mode") ?? "discovery";
  const mode = modeRaw === "mine" || modeRaw === "trending" || modeRaw === "export" ? modeRaw : "discovery";
  const result = await listLives(user.id, mode);
  return json(result);
}

export async function PATCH(request: Request) {
  const user = await requireActiveUser();
  if (!user) return jsonError("نشست فعال نیست.", 401);
  const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
  if (!body) return jsonError("درخواست نامعتبر است.");
  const result = await updateLivePrefs(user.id, {
    notifyLive: typeof body.notifyLive === "boolean" ? body.notifyLive : undefined,
    hideLiveOnLockScreen: typeof body.hideLiveOnLockScreen === "boolean" ? body.hideLiveOnLockScreen : undefined,
    adultConfirmed: typeof body.adultConfirmed === "boolean" ? body.adultConfirmed : undefined,
    region: typeof body.region === "string" ? body.region : undefined,
  });
  return json(result);
}

export async function POST(request: Request) {
  const user = await requireActiveUser();
  if (!user) return jsonError("نشست فعال نیست.", 401);
  const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
  if (!body) return jsonError("درخواست نامعتبر است.");
  const result = await createLive(user.id, {
    title: typeof body.title === "string" ? body.title : "پخش نیکسو",
    description: typeof body.description === "string" ? body.description : undefined,
    thumbDataUrl: typeof body.thumbDataUrl === "string" ? body.thumbDataUrl : undefined,
    visibility:
      body.visibility === "private" || body.visibility === "members" || body.visibility === "invite" || body.visibility === "public"
        ? body.visibility
        : undefined,
    allowIds: Array.isArray(body.allowIds) ? body.allowIds.map(String) : undefined,
    scope: body.scope === "group" || body.scope === "channel" ? body.scope : "solo",
    groupId: typeof body.groupId === "string" ? body.groupId : undefined,
    channelId: typeof body.channelId === "string" ? body.channelId : undefined,
    scheduledAt: typeof body.scheduledAt === "number" ? body.scheduledAt : undefined,
    audioOnly: typeof body.audioOnly === "boolean" ? body.audioOnly : undefined,
    maxViewers: typeof body.maxViewers === "number" ? body.maxViewers : undefined,
    category: typeof body.category === "string" ? body.category : undefined,
    tags: Array.isArray(body.tags) ? body.tags.map(String) : undefined,
    ageRestricted: typeof body.ageRestricted === "boolean" ? body.ageRestricted : undefined,
    geoHint: typeof body.geoHint === "string" ? body.geoHint : undefined,
    chatEnabled: typeof body.chatEnabled === "boolean" ? body.chatEnabled : undefined,
    reactionsEnabled: typeof body.reactionsEnabled === "boolean" ? body.reactionsEnabled : undefined,
    guestRequestsEnabled: typeof body.guestRequestsEnabled === "boolean" ? body.guestRequestsEnabled : undefined,
    recordEnabled: typeof body.recordEnabled === "boolean" ? body.recordEnabled : undefined,
    quality: body.quality === "low" || body.quality === "medium" || body.quality === "high" || body.quality === "auto" ? body.quality : undefined,
  });
  if (!result.ok) return jsonError(result.error, result.status);
  return json({ ok: true, live: result.live });
}
