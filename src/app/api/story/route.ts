import { json, jsonError } from "@/lib/http";
import { requireActiveUser } from "@/lib/auth";
import { NIXO_STORY, storyState, viewStory } from "@/lib/chat";

export async function GET() {
  const user = await requireActiveUser();
  if (!user) return jsonError("نشست فعال نیست.", 401);
  const story = await storyState(user.id);
  return json({ ok: true, story });
}

export async function POST() {
  const user = await requireActiveUser();
  if (!user) return jsonError("نشست فعال نیست.", 401);
  await viewStory(user.id, NIXO_STORY.id);
  return json({ ok: true });
}
