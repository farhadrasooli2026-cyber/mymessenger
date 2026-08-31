import { json, jsonError } from "@/lib/http";
import { requireActiveUser } from "@/lib/auth";
import {
  createStory,
  getStorySettings,
  listArchive,
  listDrafts,
  listStoryFeed,
  muteAuthor,
  publishDraft,
  updateStorySettings,
} from "@/lib/stories";
import type { StoryKind } from "@/lib/story-types";

const KINDS: StoryKind[] = ["text", "photo", "video", "gif", "sticker", "location"];

export async function GET(request: Request) {
  const user = await requireActiveUser();
  if (!user) return jsonError("نشست فعال نیست.", 401);
  const url = new URL(request.url);
  if (url.searchParams.get("archive") === "1") {
    const archive = await listArchive(user.id);
    return json({ ok: true, archive });
  }
  if (url.searchParams.get("drafts") === "1") {
    const drafts = await listDrafts(user.id);
    return json({ ok: true, drafts });
  }
  if (url.searchParams.get("settings") === "1") {
    const settings = await getStorySettings(user.id);
    if (!settings) return jsonError("نشست فعال نیست.", 401);
    return json({ ok: true, settings });
  }
  const feed = await listStoryFeed(user.id);
  return json({ ok: true, ...feed });
}

export async function POST(request: Request) {
  const user = await requireActiveUser();
  if (!user) return jsonError("نشست فعال نیست.", 401);
  const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
  if (!body) return jsonError("درخواست نامعتبر است.");
  if (body.action === "mute") {
    const result = await muteAuthor(user.id, String(body.authorId ?? ""), Boolean(body.muted));
    if (!result.ok) return jsonError(result.error, result.status);
    return json({ ok: true });
  }
  if (body.action === "publish-draft") {
    const result = await publishDraft(user.id, String(body.storyId ?? ""));
    if (!result.ok) return jsonError(result.error, result.status);
    return json({ ok: true, story: result.story });
  }
  if (body.action === "settings") {
    const result = await updateStorySettings(user.id, {
      closeFriendIds: Array.isArray(body.closeFriendIds) ? body.closeFriendIds.map(String) : undefined,
      storyNotifyOffIds: Array.isArray(body.storyNotifyOffIds) ? body.storyNotifyOffIds.map(String) : undefined,
      defaultHideFromIds: Array.isArray(body.defaultHideFromIds) ? body.defaultHideFromIds.map(String) : undefined,
      statusPreset:
        body.statusPreset === "available" ||
        body.statusPreset === "busy" ||
        body.statusPreset === "work" ||
        body.statusPreset === "away" ||
        body.statusPreset === "custom" ||
        body.statusPreset === ""
          ? body.statusPreset
          : undefined,
      statusText: typeof body.statusText === "string" ? body.statusText : undefined,
      statusPrivacy:
        body.statusPrivacy === "everyone" ||
        body.statusPrivacy === "contacts" ||
        body.statusPrivacy === "nobody" ||
        body.statusPrivacy === "selected"
          ? body.statusPrivacy
          : undefined,
      statusAllowIds: Array.isArray(body.statusAllowIds) ? body.statusAllowIds.map(String) : undefined,
      defaultStoryPrivacy:
        body.defaultStoryPrivacy === "everyone" ||
        body.defaultStoryPrivacy === "contacts" ||
        body.defaultStoryPrivacy === "closeFriends" ||
        body.defaultStoryPrivacy === "selected"
          ? body.defaultStoryPrivacy
          : undefined,
      storyAllowReplies: typeof body.storyAllowReplies === "boolean" ? body.storyAllowReplies : undefined,
      storyAllowShare: typeof body.storyAllowShare === "boolean" ? body.storyAllowShare : undefined,
      storyArchiveEnabled: typeof body.storyArchiveEnabled === "boolean" ? body.storyArchiveEnabled : undefined,
    });
    if (!result.ok) return jsonError(result.error, result.status);
    return json({ ok: true });
  }
  const kind = KINDS.includes(body.kind as StoryKind) ? (body.kind as StoryKind) : "text";
  const result = await createStory(user.id, {
    kind,
    body: typeof body.body === "string" ? body.body : "",
    caption: typeof body.caption === "string" ? body.caption : "",
    bg: typeof body.bg === "string" ? body.bg : undefined,
    font: typeof body.font === "string" ? body.font : undefined,
    align: body.align === "left" || body.align === "center" || body.align === "right" ? body.align : undefined,
    filter: typeof body.filter === "string" ? body.filter : undefined,
    rotate: typeof body.rotate === "number" ? body.rotate : undefined,
    zoom: typeof body.zoom === "number" ? body.zoom : undefined,
    overlay: typeof body.overlay === "string" ? body.overlay : undefined,
    textSize: typeof body.textSize === "number" ? body.textSize : undefined,
    textX: typeof body.textX === "number" ? body.textX : undefined,
    textY: typeof body.textY === "number" ? body.textY : undefined,
    blur: typeof body.blur === "number" ? body.blur : undefined,
    drawData: typeof body.drawData === "string" ? body.drawData : undefined,
    stickers: Array.isArray(body.stickers) ? (body.stickers as { emoji: string; x: number; y: number }[]) : undefined,
    location: typeof body.location === "string" ? body.location : undefined,
    media: typeof body.media === "string" ? body.media : "",
    musicId: typeof body.musicId === "string" ? body.musicId : null,
    linkUrl: typeof body.linkUrl === "string" ? body.linkUrl : "",
    mentions: Array.isArray(body.mentions) ? body.mentions.map(String) : [],
    allowShare: body.allowShare !== false,
    allowReplies: body.allowReplies !== false,
    visibility:
      body.visibility === "contacts" || body.visibility === "closeFriends" || body.visibility === "selected" || body.visibility === "everyone"
        ? body.visibility
        : undefined,
    allowIds: Array.isArray(body.allowIds) ? body.allowIds.map(String) : [],
    hideFromIds: Array.isArray(body.hideFromIds) ? body.hideFromIds.map(String) : [],
    purpose:
      body.purpose === "product" || body.purpose === "discount" || body.purpose === "announcement" || body.purpose === "service"
        ? body.purpose
        : "general",
    source: body.source === "business" ? "business" : "user",
    draft: Boolean(body.draft),
    videoDurationMs: typeof body.videoDurationMs === "number" ? body.videoDurationMs : undefined,
  });
  if (!result.ok) return jsonError(result.error, result.status);
  return json({ ok: true, story: result.story });
}
