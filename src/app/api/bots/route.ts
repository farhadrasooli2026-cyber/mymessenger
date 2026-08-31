import { json, jsonError } from "@/lib/http";
import { requireActiveUser } from "@/lib/auth";
import { createBotSchema, createBot, directoryBots, directoryMiniApps, listOwnedBots, usernameAvailableForBot } from "@/lib/bots";

export async function GET(request: Request) {
  const user = await requireActiveUser();
  if (!user) return jsonError("نشست فعال نیست.", 401);
  const url = new URL(request.url);
  const q = url.searchParams.get("q") ?? "";
  const category = url.searchParams.get("category") ?? "";
  const mine = url.searchParams.get("mine") === "1";
  if (mine) {
    const owned = await listOwnedBots(user.id);
    return json({ ok: true, bots: owned });
  }
  const bots = await directoryBots(q);
  const miniApps = await directoryMiniApps(category || undefined);
  return json({ ok: true, bots, miniApps });
}

export async function POST(request: Request) {
  const user = await requireActiveUser();
  if (!user) return jsonError("نشست فعال نیست.", 401);
  const url = new URL(request.url);
  if (url.searchParams.get("check") === "username") {
    const body = (await request.json().catch(() => null)) as { username?: string } | null;
    const result = await usernameAvailableForBot(body?.username ?? "");
    return json(result);
  }
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return jsonError("درخواست نامعتبر است.");
  }
  const parsed = createBotSchema.safeParse(body);
  if (!parsed.success) return jsonError("نام، نام کاربری یکتا و توضیح لازم است.");
  const result = await createBot(user.id, parsed.data);
  if (!result.ok) return jsonError(result.error, result.status, { retryAfterSec: "retryAfterSec" in result ? result.retryAfterSec : undefined });
  return json(result);
}
